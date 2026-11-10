/* BOMX veritabanı: önce bu cihaza yazar, sonra Git deposuna gönderir.
   P&PX'in ortak veritabanından (ppx-db.js) türetildi; davranışı aynıdır, iki ek vardır:
   - options.merge(path, mine, theirs): iki cihaz aynı dosyayı değiştirince içeriği birleştirir
     (ELECTRICX ex-db.js ile aynı imza). null dönerse eski davranış: yeni olan asıl dosya olur,
     eskisi yanında .catisma-<tarih> adıyla saklanır.
   - options.backupFormat: yedek dosyasının biçim adı (varsayılan "bomx-yedek").
   Her kayıt anında tarayıcı veritabanına (IndexedDB) girer, internet kesilse de çalışma kaybolmaz.
   Depo tarafı yalnız commit bilir: değişen dosyalar toplanır, tek commit olarak gönderilir.
   Eşitleme üç yönlü karşılaştırmadır: bu cihazdaki hâl, depodaki hâl, ikisinin son ortak hâli (base).
   Bu dosya tarayıcıya bağlı değildir; Node testleri aynı kodu çalıştırır. */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.BomxDb = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_FLUSH_MS = 60000;
  const RETRY_MS = 60000;
  const SYNC_ATTEMPTS = 4;
  // GitHub saatte en çok 500 içerik isteği kabul eder; büyük aktarmalar birkaç tura bölünür
  const MAX_BLOBS_PER_PUSH = 50;

  /** Git'in dosya kimliği: aynı içerik her yerde aynı değeri verir, değişen dosya böyle anlaşılır */
  async function gitBlobSha(bytes) {
    const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
    const all = new Uint8Array(header.length + bytes.length);
    all.set(header);
    all.set(bytes, header.length);
    const digest = await crypto.subtle.digest('SHA-1', all);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function stamp(ms) {
    return new Date(ms).toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
  }

  function bytesToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }

  function base64ToBytes(text) {
    const binary = atob(text);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  }

  /* ─── Yerel depo: testler için bellekte, tarayıcıda IndexedDB ── */

  function memoryLocal() {
    const files = new Map();
    const meta = new Map();
    return {
      get: async (path) => files.get(path) || null,
      put: async (record) => { files.set(record.path, record); },
      remove: async (path) => { files.delete(path); },
      all: async () => [...files.values()],
      getMeta: async (key) => (meta.has(key) ? meta.get(key) : null),
      setMeta: async (key, value) => { meta.set(key, value); }
    };
  }

  function indexedDbLocal(name) {
    let opening = null;
    const open = () => {
      if (!opening) {
        opening = new Promise((resolve, reject) => {
          const req = indexedDB.open(name, 1);
          req.onupgradeneeded = () => {
            req.result.createObjectStore('files', { keyPath: 'path' });
            req.result.createObjectStore('meta');
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
      }
      return opening;
    };
    const run = async (store, mode, action) => {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = action(tx.objectStore(store));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    };
    return {
      get: async (path) => (await run('files', 'readonly', (s) => s.get(path))) || null,
      put: (record) => run('files', 'readwrite', (s) => s.put(record)),
      remove: (path) => run('files', 'readwrite', (s) => s.delete(path)),
      all: () => run('files', 'readonly', (s) => s.getAll()),
      getMeta: async (key) => {
        const value = await run('meta', 'readonly', (s) => s.get(key));
        return value === undefined ? null : value;
      },
      setMeta: (key, value) => run('meta', 'readwrite', (s) => s.put(value, key))
    };
  }

  /* ─── Veritabanı ─────────────────────────────────────────── */

  /** Kayıt alanları: dirty = depoya gönderilecek, base = depoda bilinen son hâl (yoksa null).
      remote yoksa yerel modda çalışır; kayıtlar sonradan depoya bağlanınca gönderilmek üzere bekler. */
  function createDb(options) {
    const { local, remote = null } = options;
    const now = options.now || Date.now;
    const lock = options.lock || ((fn) => fn());
    const flushMs = options.flushMs === undefined ? DEFAULT_FLUSH_MS : options.flushMs;
    const merge = options.merge || (() => null);
    const backupFormat = options.backupFormat || 'bomx-yedek';
    const listeners = new Set();
    const status = {
      mode: remote ? 'cloud' : 'local',
      state: remote ? 'idle' : 'ok',
      pending: 0,
      lastSync: null,
      error: '',
      changed: []
    };
    let timer = null;

    function emit(patch) {
      Object.assign(status, patch);
      for (const fn of listeners) fn(Object.assign({}, status));
    }

    /** changed yalnız onu getiren eşitlemenin son bildiriminde dolu olur; sonraki bildirimler aynı listeyi yinelemez */
    async function refreshPending() {
      if (!remote) return;
      emit({ pending: (await local.all()).filter((r) => r.dirty).length, changed: [] });
    }

    /** Sürekli çalışırken de gönderim gecikmesin: bekleyen zamanlayıcı yeni yazmayla ertelenmez */
    function schedule(delay) {
      if (!remote) return;
      if (timer) {
        if (delay === undefined) return;
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = null;
        sync().catch(() => {});
      }, delay === undefined ? flushMs : delay);
      if (timer && timer.unref) timer.unref();
    }

    async function write(path, bytes) {
      const hash = await gitBlobSha(bytes);
      const current = await local.get(path);
      // Aynı içerik yeniden yazılmaz: commit yalnız gerçek değişiklikten oluşur
      if (current && current.kind === 'file' && current.hash === hash) return false;
      await local.put({ path, kind: 'file', bytes, hash, at: now(), dirty: true, base: current ? current.base : null });
      if (!current || !current.dirty) await refreshPending();
      schedule();
      return true;
    }

    async function mkdir(path) {
      const current = await local.get(path);
      if (current && current.kind !== 'deleted') return;
      await local.put({ path, kind: 'dir', bytes: null, hash: 'dir', at: now(), dirty: true, base: current ? current.base : null });
      await refreshPending();
      schedule();
    }

    /** Depoda olan kayıt silindi diye işaretlenir ki commit'e girsin; hiç gönderilmemişse doğrudan silinir */
    async function remove(path) {
      const prefix = `${path}/`;
      const targets = (await local.all()).filter((r) => (r.path === path || r.path.startsWith(prefix)) && r.kind !== 'deleted');
      for (const record of targets) {
        if (record.base === null) {
          await local.remove(record.path);
          continue;
        }
        await local.put({
          path: record.path,
          kind: 'deleted',
          was: record.kind,
          bytes: null,
          hash: 'deleted',
          at: now(),
          dirty: true,
          base: record.base
        });
      }
      await refreshPending();
      schedule();
      return targets.length;
    }

    async function read(path) {
      const record = await local.get(path);
      return record && record.kind !== 'deleted' ? record : null;
    }

    async function list() {
      return (await local.all()).filter((r) => r.kind !== 'deleted');
    }

    /* ── Depodan alma ── */

    /** Başka depoya bağlanılınca buradaki her şey o depoya gönderilmek üzere işaretlenir */
    async function adopt() {
      if ((await local.getMeta('repo')) === remote.id) return;
      for (const record of await local.all()) {
        if (record.kind === 'deleted') await local.remove(record.path);
        else await local.put(Object.assign({}, record, { dirty: true, base: null }));
      }
      await local.setMeta('head', null);
      await local.setMeta('repo', remote.id);
    }

    /** Depo ağacı: boş klasörü tutan .gitkeep dosyası klasör kaydına çevrilir */
    function normalizeTree(tree) {
      const out = new Map();
      for (const [path, sha] of tree) {
        if (path === '.gitkeep') continue;
        if (path.endsWith('/.gitkeep')) out.set(path.slice(0, -'/.gitkeep'.length), 'dir');
        else out.set(path, sha);
      }
      return out;
    }

    /** @returns güncel commit; depo boşsa null */
    async function pull(changed) {
      const sha = await remote.headSha();
      if (!sha) return null;
      const known = await local.getMeta('head');
      if (known && known.sha === sha) return known;
      const head = await remote.commitInfo(sha);
      // Sunucu kısa süreliğine eski commit'i döndürebilir; eski hâl yeni çalışmanın üstüne yazılmaz
      if (known && head.at < known.at) return known;

      const theirs = normalizeTree(await remote.tree(head.treeSha));
      const mine = new Map((await local.all()).map((r) => [r.path, r]));
      const blobs = new Map();
      const blob = async (id) => {
        if (!blobs.has(id)) {
          const bytes = await remote.blob(id);
          if ((await gitBlobSha(bytes)) !== id) throw new Error('Depodan gelen dosya bozuk, yeniden denenecek');
          blobs.set(id, bytes);
        }
        return blobs.get(id);
      };
      const apply = async (path, id) => {
        const isDir = id === 'dir';
        await local.put({ path, kind: isDir ? 'dir' : 'file', bytes: isDir ? null : await blob(id), hash: id, at: head.at, dirty: false, base: id });
        changed.push(path);
      };

      for (const path of new Set([...theirs.keys(), ...mine.keys()])) {
        const id = theirs.has(path) ? theirs.get(path) : null;
        const record = mine.get(path);
        if (!record) {
          await apply(path, id);
          continue;
        }
        const value = record.kind === 'deleted' ? null : record.hash;
        if (value === id) {
          if (id === null) await local.remove(path);
          else if (record.dirty || record.base !== id) await local.put(Object.assign({}, record, { dirty: false, base: id }));
          continue;
        }
        if (!record.dirty) {
          if (id === null) {
            await local.remove(path);
            changed.push(path);
          } else {
            await apply(path, id);
          }
          continue;
        }
        if (record.base === id) continue; // Yalnız burada değişmiş, gönderilecek

        // İki taraf da değiştirmiş. Silme ile düzenleme karşılaşırsa düzenleme kazanır, içerik kaybolmaz.
        if (id === null) {
          await local.put(Object.assign({}, record, { base: null }));
          continue;
        }
        if (record.kind !== 'file' || id === 'dir') {
          await apply(path, id);
          continue;
        }
        // Program dosyanın içeriğini biliyorsa iki sürüm kayıt kayıt birleşir, kopya oluşmaz
        let merged = null;
        try {
          merged = merge(path, record.bytes, await blob(id));
        } catch {
          merged = null;
        }
        if (merged) {
          const hash = await gitBlobSha(merged);
          await local.put(Object.assign({}, record, { bytes: merged, hash, at: now(), dirty: hash !== id, base: id }));
          changed.push(path);
          continue;
        }
        // İki sürüm: yenisi asıl dosya olur, eskisi silinmeden yanına kopyalanır
        const theirsIsNewer = head.at > record.at;
        const loser = theirsIsNewer
          ? { bytes: record.bytes, hash: record.hash, at: record.at }
          : { bytes: await blob(id), hash: id, at: head.at };
        const copy = `${path}.catisma-${stamp(loser.at)}`;
        await local.put({ path: copy, kind: 'file', bytes: loser.bytes, hash: loser.hash, at: loser.at, dirty: true, base: null });
        changed.push(copy);
        if (theirsIsNewer) await apply(path, id);
        else await local.put(Object.assign({}, record, { base: id }));
      }
      await local.setMeta('head', head);
      return head;
    }

    /* ── Depoya gönderme ── */

    function toEntry(record) {
      if (record.kind === 'dir') return { path: `${record.path}/.gitkeep`, bytes: new Uint8Array(0) };
      if (record.kind === 'deleted') return { path: record.was === 'dir' ? `${record.path}/.gitkeep` : record.path, remove: true };
      return { path: record.path, bytes: record.bytes };
    }

    /** Değişenler tek commit olur; o sırada başka cihaz göndermişse depo reddeder (conflict), yeniden alınır */
    async function push(head) {
      const batch = [];
      let blobs = 0;
      const all = await local.all();
      const live = all.filter((r) => r.kind !== 'deleted').map((r) => r.path);
      for (const record of all.filter((r) => r.dirty)) {
        if (record.kind === 'deleted' && record.base === null) {
          await local.remove(record.path);
          continue;
        }
        // İçinde dosya olan klasör zaten depoda görünür; yalnız gerçekten boş klasör .gitkeep ister
        if (record.kind === 'dir' && record.base === null && live.some((p) => p.startsWith(`${record.path}/`))) {
          await local.remove(record.path);
          continue;
        }
        const needsBlob = record.kind === 'file' && !remote.canInline(record.bytes);
        if (needsBlob && blobs >= MAX_BLOBS_PER_PUSH) continue;
        if (needsBlob) blobs += 1;
        batch.push(record);
      }
      if (!batch.length) return;
      const first = batch[0].path.split('/').pop();
      const message = batch.length === 1 ? `Kayıt: ${first}` : `Kayıt: ${first} ve ${batch.length - 1} dosya`;
      const next = await remote.commit(head, batch.map(toEntry), message);
      await local.setMeta('head', next);
      for (const record of batch) {
        const latest = await local.get(record.path);
        if (!latest) continue;
        if (latest.hash !== record.hash) {
          // Gönderim sürerken yeniden değişti: yeni hâl sonraki turda gider
          await local.put(Object.assign({}, latest, { base: record.kind === 'deleted' ? null : record.hash }));
        } else if (record.kind === 'deleted') {
          await local.remove(record.path);
        } else {
          await local.put(Object.assign({}, latest, { dirty: false, base: record.hash }));
        }
      }
    }

    async function exchange(changed) {
      await adopt();
      for (let attempt = 0; attempt < SYNC_ATTEMPTS; attempt += 1) {
        const head = await pull(changed);
        if (!head) {
          await remote.init();
          continue;
        }
        try {
          await push(head);
          return;
        } catch (e) {
          if (!e || !e.conflict) throw e;
        }
      }
      throw new Error('Depo o sırada değişiyordu, yeniden denenecek');
    }

    let syncing = null;
    function sync() {
      if (!remote) return Promise.resolve(Object.assign({}, status));
      if (syncing) return syncing;
      clearTimeout(timer);
      timer = null;
      syncing = (async () => {
        emit({ state: 'syncing', error: '', changed: [] });
        const changed = [];
        try {
          await lock(() => exchange(changed));
          const pending = (await local.all()).filter((r) => r.dirty).length;
          emit({ state: 'ok', pending, lastSync: now(), error: '', changed });
          if (pending) schedule();
        } catch (e) {
          const pending = (await local.all()).filter((r) => r.dirty).length;
          // Gönderim başarısız olsa da önce çekilen değişiklikler bildirilir: açık ekran eski kalmasın
          emit({ state: e && e.offline ? 'offline' : 'error', error: (e && e.message) || 'Eşitleme hatası', pending, changed, auth: !!(e && e.auth) });
          schedule(Math.max(RETRY_MS, (e && e.retryAfterMs) || 0));
        }
        return Object.assign({}, status);
      })().finally(() => { syncing = null; });
      return syncing;
    }

    /* ── Yedek ── */

    async function exportBackup() {
      const files = (await list()).map((r) => ({
        path: r.path,
        kind: r.kind,
        at: r.at,
        b64: r.bytes ? bytesToBase64(r.bytes) : null
      }));
      return { format: backupFormat, version: 1, createdAt: new Date(now()).toISOString(), files };
    }

    /** Var olan dosyalar overwrite istenmedikçe korunur */
    async function importBackup(backup, opts) {
      if (!backup || backup.format !== backupFormat || !Array.isArray(backup.files)) throw new Error('Bu dosya BOMX yedeği değil');
      let written = 0;
      let kept = 0;
      for (const file of backup.files) {
        if (file.kind === 'dir') {
          await mkdir(file.path);
          continue;
        }
        if (!(opts && opts.overwrite) && (await read(file.path))) {
          kept += 1;
          continue;
        }
        if (await write(file.path, base64ToBytes(file.b64 || ''))) written += 1;
      }
      return { written, kept };
    }

    return {
      read,
      write,
      mkdir,
      remove,
      list,
      sync,
      exportBackup,
      importBackup,
      flush: () => (remote ? sync() : Promise.resolve(Object.assign({}, status))),
      status: () => Object.assign({}, status),
      onStatus: (fn) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      refreshPending
    };
  }

  return { createDb, memoryLocal, indexedDbLocal, gitBlobSha, bytesToBase64, base64ToBytes };
});
