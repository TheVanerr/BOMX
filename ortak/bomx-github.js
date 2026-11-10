/* GitHub deposu veritabanı olarak. Sunucu kodu yoktur, tarayıcı doğrudan GitHub API'siyle konuşur.
   P&PX'in ppx-github.js dosyasından türetildi. Ayrı dosya yazmak yerine Git'in kendi yapı taşları
   kullanılır: ağaç, commit, dal başı. Dal başı "yalnız ileri" güncellenir; başka cihaz arada
   göndermişse GitHub reddeder, hiçbir şey ezilmez.
   Ekler: anahtarın sahibini bulma (user), anahtarın bitiş tarihi (GitHub başlığı okunabiliyorsa),
   boş depoya yazılan README'nin metni (options.readme). */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.BomxGitHub = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const API = 'https://api.github.com';
  const INLINE_LIMIT = 100 * 1024;
  const DEFAULT_README = {
    message: 'BOMX veri deposu',
    text: '# BOMX veri deposu\n\nBu depo BOMX (malzeme listesi) programi tarafindan yonetilir. Dosyalari elle degistirmeyin.\n\n' +
      '- `BOM/kutuphane/` komponent kutuphanesi\n- `BOM/projeler/` projeler ve malzeme listeleri\n' +
      '- `BOM/sablonlar/` hazir setler\n- `BOM/ayarlar.json` ayarlar\n'
  };

  function isText(bytes) {
    try {
      new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      return true;
    } catch {
      return false;
    }
  }

  function bytesToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  }

  function base64ToBytes(text) {
    const binary = atob(String(text).replace(/\s/g, ''));
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  }

  function utf8Base64(text) {
    return bytesToBase64(new TextEncoder().encode(text));
  }

  function failure(message, extra) {
    return Object.assign(new Error(message), extra);
  }

  /** res: { status, ok, headers, text } (gövde zaman aşımı içinde okunmuştur) */
  function explain(res) {
    let detail = '';
    try {
      detail = JSON.parse(res.text).message || '';
    } catch { /* gövde JSON değilse durum kodu yeter */ }
    const retryAfter = Number(res.headers.get('retry-after')) || 0;
    const limited = retryAfter > 0 || res.headers.get('x-ratelimit-remaining') === '0' || /rate limit/i.test(detail);
    if (res.status === 401) return failure('GitHub anahtarı geçersiz ya da süresi dolmuş. Veritabanı sekmesinden yenileyin.', { auth: true });
    if ((res.status === 403 || res.status === 429) && limited) {
      return failure('GitHub hız sınırına ulaşıldı. Kayıtlar bu cihazda bekliyor, kendiliğinden gönderilecek.', { retryAfterMs: (retryAfter || 60) * 1000 });
    }
    if (res.status === 403) return failure('GitHub anahtarının bu depoya yazma izni yok (Contents: Read and write gerekli).', { auth: true });
    if (res.status === 404) return failure('Depo bulunamadı ya da anahtarın bu depoya erişimi yok.', { auth: true, notFound: true });
    if (res.status >= 500) return failure('GitHub şu an yanıt vermiyor. Kayıtlar bu cihazda bekliyor.', { offline: true });
    return failure(`GitHub hatası ${res.status}: ${detail}`, { status: res.status });
  }

  /** "2027-11-10 12:00:00 UTC" → zaman damgası (ms); okunamazsa null */
  function parseExpiry(value) {
    if (!value) return null;
    const m = String(value).match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (!m) return null;
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  }

  const TIMEOUT_MS = 45000;

  /**
   * Sahte sunucu ve gerçek GitHub için ortak istek. Yanıtın gövdesi de süre içinde okunur:
   * takılan bağlantı eşitlemeyi (ve ilk açılışı) sonsuza dek bekletmez, kayıt cihazda bekler.
   * @returns { status, ok, headers, text }
   */
  async function request(fetchFn, url, method, token, body, timeoutMs) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    let timedOut = false;
    let timer = null;
    // Süre dolunca istek iptal edilir; iptali dinlemeyen bağlantıda da bekleme kesin biter
    const deadline = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        if (ctrl) ctrl.abort();
        reject(new Error('timeout'));
      }, timeoutMs || TIMEOUT_MS);
    });
    try {
      const res = await Promise.race([fetchFn(url, {
        method,
        // GitHub yanıtları 60 saniye önbelleğe alınabilir; eski dal başı okunursa eşitleme yanılır
        cache: 'no-store',
        headers: Object.assign(
          { Accept: 'application/vnd.github+json' },
          token ? { Authorization: `Bearer ${token}` } : {},
          body ? { 'Content-Type': 'application/json' } : {}
        ),
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl ? ctrl.signal : undefined
      }), deadline]);
      const text = await Promise.race([res.text(), deadline]);
      return { status: res.status, ok: res.ok, headers: res.headers, text };
    } catch {
      throw failure(timedOut
        ? 'GitHub zamanında yanıt vermedi. Kayıtlar bu cihazda bekliyor, yeniden denenecek.'
        : 'İnternet bağlantısı yok. Kayıtlar bu cihazda bekliyor.', { offline: true });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function json(res) {
    try {
      return JSON.parse(res.text);
    } catch {
      throw failure(`GitHub yanıtı okunamadı (${res.status})`, { offline: true });
    }
  }

  /** Anahtarın sahibi (GitHub kullanıcı adı): depo adı yalnız "bomx-veri" yazılınca başına eklenir */
  async function whoAmI(token, fetchFn) {
    const run = fetchFn || ((...args) => fetch(...args));
    const res = await request(run, `${API}/user`, 'GET', token);
    if (!res.ok) throw explain(res);
    const data = json(res);
    return { login: data.login, name: data.name || '' };
  }

  /** repo: "kullanici/depo". fetchFn testlerde sahte sunucuya bağlanır. */
  function createRemote(options) {
    const [owner, name, extra] = String(options.repo || '').trim().split('/');
    if (!owner || !name || extra !== undefined) throw new Error('Depo adı kullanici/depo biçiminde olmalı');
    const token = options.token || '';
    const fetchFn = options.fetchFn || ((...args) => fetch(...args));
    const timeoutMs = options.timeoutMs || TIMEOUT_MS;
    const readme = Object.assign({}, DEFAULT_README, options.readme || {});
    const base = `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
    let branch = null;
    let emptyBlob = null;

    async function send(method, path, body, allow) {
      // Büyük dosya yüklemesi daha uzun sürebilir
      const res = await request(fetchFn, `${base}${path}`, method, token, body, path === '/git/blobs' ? timeoutMs * 2 : timeoutMs);
      if (allow && allow.includes(res.status)) return { status: res.status, data: null, headers: res.headers };
      if (!res.ok) throw explain(res);
      return { status: res.status, data: json(res), headers: res.headers };
    }

    async function info() {
      const { data, headers } = await send('GET', '');
      branch = data.default_branch;
      return {
        private: !!data.private,
        branch: data.default_branch,
        fullName: data.full_name || `${owner}/${name}`,
        url: data.html_url || `https://github.com/${owner}/${name}`,
        // GitHub bu başlığı tarayıcıya her zaman açmaz; okunamazsa bilinmiyor sayılır
        tokenExpires: parseExpiry(headers && headers.get('github-authentication-token-expiration'))
      };
    }

    async function ensureBranch() {
      if (!branch) await info();
      return branch;
    }

    /** Dal başı; depo henüz boşsa null (GitHub boş depoda 409 döndürür) */
    async function headSha() {
      const { data } = await send('GET', `/git/ref/heads/${await ensureBranch()}`, null, [404, 409]);
      return data ? data.object.sha : null;
    }

    async function commitInfo(sha) {
      const { data } = await send('GET', `/git/commits/${sha}`);
      return { sha, treeSha: data.tree.sha, at: Date.parse(data.committer.date) };
    }

    /** @returns yol → dosya kimliği */
    async function tree(sha) {
      const { data } = await send('GET', `/git/trees/${sha}?recursive=1`);
      if (data.truncated) throw new Error('Depo bir seferde okunamayacak kadar büyük');
      return new Map(data.tree.filter((e) => e.type === 'blob').map((e) => [e.path, e.sha]));
    }

    async function blob(sha) {
      const { data } = await send('GET', `/git/blobs/${sha}`);
      return base64ToBytes(data.content);
    }

    /** Boş depoda ağaç ve commit oluşturulamaz; ilk commit dosya arayüzüyle atılır */
    async function init() {
      await send('PUT', '/contents/README.md', { message: readme.message, content: utf8Base64(readme.text) });
    }

    const canInline = (bytes) => bytes.length > 0 && bytes.length <= INLINE_LIMIT && isText(bytes);

    async function postBlob(bytes) {
      const { data } = await send('POST', '/git/blobs', { content: bytesToBase64(bytes), encoding: 'base64' });
      return data.sha;
    }

    /** Küçük metin dosyaları ağaç isteğinin içinde gider: istek sayısı dosya sayısından bağımsız kalır */
    async function treeEntry(entry) {
      const row = { path: entry.path, mode: '100644', type: 'blob' };
      if (entry.remove) return Object.assign(row, { sha: null });
      if (canInline(entry.bytes)) return Object.assign(row, { content: new TextDecoder('utf-8', { ignoreBOM: true }).decode(entry.bytes) });
      if (entry.bytes.length) return Object.assign(row, { sha: await postBlob(entry.bytes) });
      if (!emptyBlob) emptyBlob = await postBlob(entry.bytes);
      return Object.assign(row, { sha: emptyBlob });
    }

    async function commit(head, entries, message) {
      const rows = [];
      for (const entry of entries) rows.push(await treeEntry(entry));
      const newTree = (await send('POST', '/git/trees', { base_tree: head.treeSha, tree: rows })).data;
      const created = (await send('POST', '/git/commits', { message, tree: newTree.sha, parents: [head.sha] })).data;
      const moved = await send('PATCH', `/git/refs/heads/${await ensureBranch()}`, { sha: created.sha, force: false }, [409, 422]);
      if (!moved.data) throw failure('Depo arada değişti', { conflict: true });
      return { sha: created.sha, treeSha: newTree.sha, at: Date.parse(created.committer.date) };
    }

    return { id: `${owner}/${name}`, owner, name, info, headSha, commitInfo, tree, blob, init, commit, canInline };
  }

  return { createRemote, whoAmI, parseExpiry };
});
