/* BOMX açılışı: bağlantı ayarı (yalnız bu tarayıcıda), veritabanı, eşitleme zamanlaması.
   P&PX'in ppx-boot.js dosyasından uyarlandı. BOMX tek sayfadır: kurulum ekranı, ana ekran ve
   malzeme listesi düzenleyicisi aynı sayfadadır, sayfa değişmeden çalışılır.
   Sayfa dosyadan çift tıkla açılır; sunucu gerekmez. */

(function () {
  'use strict';

  const SETTINGS_KEY = 'bomx_ayarlar';
  const DB_NAME = 'bomx-veri';
  const FOREGROUND_SYNC_MS = 5 * 60 * 1000;
  const FOCUS_SYNC_GAP_MS = 60 * 1000;
  const FIRST_SYNC_WAIT_MS = 3000;

  let db = null;
  let readyPromise = null;
  const listeners = new Set();

  function settings() {
    try {
      return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
    } catch {
      return {};
    }
  }

  function saveSettings(value) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(value));
  }

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function lockFn() {
    // Sekmeler aynı anda göndermesin; tarayıcı bu dosya için kilit vermezse kilitsiz devam edilir
    try {
      await navigator.locks.query();
      return (fn) => navigator.locks.request('bomx-sync', fn);
    } catch {
      return (fn) => fn();
    }
  }

  function watchPage() {
    let lastFocusSync = Date.now();
    const syncIfDue = () => {
      if (Date.now() - lastFocusSync < FOCUS_SYNC_GAP_MS) return;
      lastFocusSync = Date.now();
      db.sync();
    };
    document.addEventListener('visibilitychange', () => {
      // Sayfa kapanırken gönderim yarım kalsa da kayıt cihazda bekler, sonraki açılışta gider
      if (document.visibilityState === 'hidden') db.flush();
      else syncIfDue();
    });
    setInterval(() => {
      if (document.visibilityState === 'visible') syncIfDue();
    }, FOREGROUND_SYNC_MS);
    window.addEventListener('online', () => db.sync());
  }

  async function connect() {
    const s = settings();
    const remote = s.mode === 'github' ? BomxGitHub.createRemote({ repo: s.repo, token: s.token }) : null;
    const local = BomxDb.indexedDbLocal(DB_NAME);
    db = BomxDb.createDb({ local, remote, lock: await lockFn(), merge: BomxModel.mergeFile, backupFormat: 'bomx-yedek' });
    db.onStatus((status) => {
      for (const fn of listeners) fn(status);
    });
    await db.refreshPending();
    if (remote) {
      // Yerel veri varsa açılış ağa takılmaz; yoksa ilk alma bitmeden gösterilecek bir şey yok
      const first = db.sync();
      const hasData = (await db.list()).some((r) => r.path.startsWith('BOM/'));
      if (hasData) await Promise.race([first, wait(FIRST_SYNC_WAIT_MS)]);
      else await first;
      watchPage();
    }
    return db;
  }

  /** "https://github.com/ben/bomx-veri.git", "ben/bomx-veri" ya da yalnız "bomx-veri" */
  function normalizeRepo(input) {
    return String(input || '').trim()
      .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
      .replace(/^git@github\.com:/i, '')
      .replace(/\.git$/i, '')
      .replace(/\/+$/, '')
      .replace(/\s+/g, '');
  }

  /**
   * Depoyu ve anahtarı dener. Açık depoya müşteri ve fiyat bilgisi yazılmasın diye yalnız özel depo kabul edilir.
   * Depo adı yalnız "bomx-veri" yazılmışsa sahibi anahtardan bulunur.
   */
  async function connectGitHub(repoInput, tokenInput) {
    const token = String(tokenInput || '').trim();
    if (!token) throw new Error('Erişim anahtarı gerekli.');
    let repo = normalizeRepo(repoInput) || 'bomx-veri';
    if (!repo.includes('/')) {
      const me = await BomxGitHub.whoAmI(token);
      repo = `${me.login}/${repo}`;
    }
    const remote = BomxGitHub.createRemote({ repo, token });
    let info;
    try {
      info = await remote.info();
    } catch (e) {
      if (e && e.notFound) {
        throw new Error(`"${repo}" deposu bulunamadı ya da anahtar bu depoya izinli değil. Depo adını ve anahtarın "Only select repositories" altında bu depoyu seçtiğinizi kontrol edin.`);
      }
      throw e;
    }
    if (!info.private) throw new Error('Bu depo herkese açık. Müşteri ve fiyat bilgisi içerdiği için özel (Private) depo gerekir.');
    saveSettings({ mode: 'github', repo: remote.id, token, connectedAt: Date.now(), tokenExpires: info.tokenExpires || null, url: info.url });
    return { repo: remote.id, info };
  }

  window.BomxBoot = {
    DB_NAME,
    ready() {
      if (!readyPromise) readyPromise = connect();
      return readyPromise;
    },
    db: () => db,
    settings,
    normalizeRepo,
    connectGitHub,
    useLocal: () => saveSettings({ mode: 'yerel', lastRepo: settings().lastRepo || settings().repo || '' }),
    /** Anahtar silinir, veriler bu cihazda kalır; yeniden bağlanınca gönderilir */
    disconnect: () => {
      const s = settings();
      saveSettings({ mode: 'yerel', lastRepo: s.repo || s.lastRepo || '' });
    },
    onStatus(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }
  };
})();
