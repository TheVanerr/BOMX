/* BOMX uygulama akışı: açılış, ortak durum (kütüphane, projeler, şablonlar, ayarlar), veri işlemleri,
   başka cihazdan gelen değişikliklerin açık ekrana yansıması ve P&PX köprüsü. */

const BomxApp = (() => {
  const M = BomxModel;
  const U = BomxUi;

  const state = {
    db: null,
    store: null,
    settings: M.normalizeSettings({}),
    library: [],
    libraryById: new Map(),
    libraryIndex: new Map(),
    libVersion: 0,
    photos: new Map(),
    projects: [],
    templates: [],
    usage: new Map(),
    view: 'home',
    status: { mode: 'local', state: 'ok', pending: 0 },
    ppx: null,
    conflicts: []
  };

  /* ─── Olaylar ─────────────────────────────────────────── */

  const listeners = new Map();
  function on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
  }
  function emit(event, data) {
    for (const fn of listeners.get(event) || []) {
      try {
        fn(data);
      } catch (e) {
        console.error(e);
      }
    }
  }

  /* ─── Kütüphane ───────────────────────────────────────── */

  function setLibrary(list) {
    state.library = list.slice().sort(M.compareComponents);
    state.libraryById = new Map(state.library.map((c) => [c.id, c]));
    state.libraryIndex = M.buildSearchIndex(state.library);
    state.libVersion += 1;
    emit('library');
  }

  /** Doğrular ve kaydeder. @returns { ok, saved, errors: [{ kod, errors }] } */
  async function saveComponents(list, options) {
    const o = options || {};
    const incoming = list.map((c) => M.normalizeComponent(c));
    const errors = [];
    // Toplu kayıtta dosya içindeki tekrarlar da denetlenir
    const others = state.library.filter((c) => !incoming.some((x) => x.id === c.id));
    const pool = others.slice();
    for (const c of incoming) {
      const e = M.validateComponent(c, pool);
      if (e.length) errors.push({ kod: c.kod || '(kodsuz)', errors: e });
      else pool.push(c);
    }
    if (errors.length && !o.skipInvalid) return { ok: false, saved: [], errors };
    const valid = incoming.filter((c) => !errors.some((e) => e.kod === (c.kod || '(kodsuz)')));
    if (!valid.length) return { ok: !errors.length, saved: [], errors };
    const saved = await state.store.saveComponents(valid);
    const map = new Map(state.library.map((c) => [c.id, c]));
    for (const c of saved) map.set(c.id, c);
    setLibrary([...map.values()]);
    return { ok: true, saved, errors };
  }

  async function deleteComponents(ids) {
    const count = await state.store.deleteComponents(ids);
    const set = new Set(ids);
    setLibrary(state.library.filter((c) => !set.has(c.id)));
    // Silinen komponentin fotoğrafı da silinir (geri alınırsa kütüphane ekranı fotoğrafı yeniden yazar)
    const photos = ids.filter((id) => state.photos.has(id));
    if (photos.length) await savePhotos(photos.map((id) => ({ id, veri: '' })));
    return count;
  }

  /* ─── Fotoğraflar ─────────────────────────────────────── */

  const photoOf = (id) => state.photos.get(id) || '';

  /**
   * Komponent fotoğraflarını yazar; veri boşsa siler.
   * @param list [{ id, veri }]
   */
  async function savePhotos(list) {
    const changed = list.filter((p) => p && p.id && (p.veri || '') !== photoOf(p.id));
    if (!changed.length) return 0;
    const n = await state.store.savePhotos(changed);
    for (const p of changed) {
      if (p.veri) state.photos.set(p.id, p.veri);
      else state.photos.delete(p.id);
    }
    emit('photos', changed.map((p) => p.id));
    return n;
  }

  async function toggleFavorite(id) {
    const c = state.libraryById.get(id);
    if (!c) return;
    await saveComponents([Object.assign({}, c, { favori: !c.favori })]);
  }

  /** Bir komponentin kullanıldığı projeler (proje özetlerinden) */
  function usageOf(componentId) {
    return state.projects.filter((p) => p.komponentler.includes(componentId));
  }

  function computeUsage() {
    const map = new Map();
    for (const p of state.projects) {
      for (const id of p.komponentler) {
        if (!map.has(id)) map.set(id, 0);
        map.set(id, map.get(id) + 1);
      }
    }
    state.usage = map;
  }

  /* ─── Ayarlar ─────────────────────────────────────────── */

  async function updateSettings(patch) {
    let next = state.settings;
    for (const [key, value] of Object.entries(patch)) next = M.setSetting(next, key, value);
    // Kayıt veritabanındaki hâlle birleşir (eşitlemenin getirdiği ayar ezilmez); ekran yazılanı gösterir
    state.settings = await state.store.saveSettings(next);
    emit('settings');
    return state.settings;
  }

  /* ─── Projeler ────────────────────────────────────────── */

  async function refreshProjects() {
    const res = await state.store.listProjects();
    state.projects = res.projects;
    computeUsage();
    emit('projects');
    if (res.errors.length) U.toast(`Okunamayan proje dosyası: ${res.errors.join(', ')}`, 'error');
  }

  async function createProject(input, seed) {
    const project = await state.store.createProject(input, state.settings, seed);
    await refreshProjects();
    return project;
  }

  async function openProject(id, options) {
    // Açık projenin bekleyen kaydı yeni proje açılmadan biter: son değişiklik kaybolmaz
    const wasEditor = state.view === 'editor';
    if (wasEditor) await BomxEditor.close();
    const project = await state.store.readProject(id);
    if (!project) {
      U.toast('Proje bulunamadı', 'error');
      await refreshProjects();
      if (wasEditor) await showHome('projects');
      return false;
    }
    state.view = 'editor';
    U.$('home').classList.add('hidden');
    U.$('app').classList.remove('hidden');
    await BomxEditor.open(project, options);
    U.setPref('sonProje', id);
    return true;
  }

  async function showHome(tab) {
    if (state.view === 'editor') await BomxEditor.close();
    state.view = 'home';
    U.$('app').classList.add('hidden');
    U.$('home').classList.remove('hidden');
    BomxHome.show(tab);
  }

  async function deleteProject(id) {
    await state.store.deleteProject(id);
    await refreshProjects();
  }

  /* ─── Şablonlar ───────────────────────────────────────── */

  async function refreshTemplates() {
    const res = await state.store.listTemplates();
    state.templates = res.templates;
    emit('templates');
  }

  async function saveTemplate(template) {
    const saved = await state.store.saveTemplate(template);
    await refreshTemplates();
    return saved;
  }

  async function deleteTemplate(id) {
    await state.store.deleteTemplate(id);
    await refreshTemplates();
  }

  /* ─── Eşitleme ve başka cihazdan gelenler ─────────────── */

  let authShown = false;

  function onStatus(status) {
    state.status = status;
    emit('status', status);
    if (status.state === 'ok') authShown = false;
    if (status.state === 'error' && status.auth && !authShown) {
      authShown = true;
      U.toast('GitHub anahtarı geçersiz ya da süresi dolmuş. Kayıtlar bu bilgisayarda bekliyor.', 'error', {
        action: { label: 'Anahtarı yenile', run: () => BomxSetup.show({ reason: 'auth', onCancel: () => {} }) },
        ms: 15000
      });
    }
    // Gönderim başarısız olsa da (çevrimdışı, hız sınırı) önce çekilen değişiklikler ekrana yansır
    if (status.changed && status.changed.length) handleRemote(status.changed);
  }

  /* ─── Aynı tarayıcıda birden çok sekme ────────────────── */

  const TAB_KEY = 'bomx_sekme';
  const tabId = M.uid();

  /** Bu sekmenin yazdığı dosyalar öbür sekmelere bildirilir (localStorage olayı dosyadan açılan sayfada da çalışır) */
  function shareWrites(db) {
    const paths = new Set();
    const notify = U.debounce(() => {
      try {
        localStorage.setItem(TAB_KEY, JSON.stringify({ tab: tabId, at: Date.now(), paths: [...paths] }));
      } catch { /* gizli pencere */ }
      paths.clear();
    }, 250);
    const write = db.write;
    const remove = db.remove;
    db.write = async (path, bytes) => {
      const changed = await write(path, bytes);
      if (changed) {
        paths.add(path);
        notify();
      }
      return changed;
    };
    db.remove = async (path) => {
      const n = await remove(path);
      if (n) {
        paths.add(path);
        notify();
      }
      return n;
    };
    window.addEventListener('storage', (e) => {
      if (e.key !== TAB_KEY || !e.newValue) return;
      try {
        const msg = JSON.parse(e.newValue);
        if (msg.tab !== tabId && Array.isArray(msg.paths) && msg.paths.length) handleRemote(msg.paths);
      } catch { /* bozuk bildirim */ }
    });
  }

  async function handleRemote(paths) {
    const has = (fn) => paths.some(fn);
    try {
      if (has(M.isShardPath)) {
        const lib = await state.store.loadLibrary();
        setLibrary(lib.components);
      }
      if (has(M.isPhotoShardPath)) {
        state.photos = await state.store.loadPhotos();
        emit('photos', null);
      }
      if (paths.includes(M.PATHS.settings)) {
        state.settings = await state.store.readSettings();
        emit('settings');
      }
      if (has(M.isTemplatePath)) await refreshTemplates();
      if (has((p) => p.startsWith(`${M.PATHS.projects}/`))) {
        await refreshProjects();
        const open = BomxEditor.currentId();
        if (open && paths.some((p) => p === M.projectPath(open))) {
          const fresh = await state.store.readProject(open);
          BomxEditor.remoteChanged(fresh);
        } else if (open && paths.some((p) => p.startsWith(`${M.PATHS.projects}/${open}/`)) && !(await state.store.readProject(open))) {
          BomxEditor.remoteChanged(null);
        }
      }
      const conflicts = paths.filter((p) => BomxStore.isConflict(p));
      if (conflicts.length) {
        await refreshConflicts();
        U.toast(`${conflicts.length} dosya iki cihazda değiştirildi; eski sürüm saklandı.`, 'warn', {
          action: { label: 'Göster', run: () => showHome('db') }
        });
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function refreshConflicts() {
    state.conflicts = await state.store.listConflicts();
    emit('conflicts');
  }

  function syncNow() {
    return state.db.sync();
  }

  /* ─── P&PX köprüsü ────────────────────────────────────── */

  /** P&PX bu tarayıcıda kullanılıyorsa veritabanı (ppx-veri) burada da okunur; dosyadan açılan sayfalar ortak saklama kullanır */
  async function ppxAvailable() {
    try {
      if (!indexedDB.databases) return false;
      return (await indexedDB.databases()).some((d) => d.name === 'ppx-veri');
    } catch {
      return false;
    }
  }

  function openForeign(name) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(name);
      // Yoksa oluşturulmaz: başka programın veritabanına dokunulmaz
      req.onupgradeneeded = () => req.transaction.abort();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error(`${name} açılamadı`));
    });
  }

  async function readPpx() {
    const db = await openForeign('ppx-veri');
    try {
      if (!db.objectStoreNames.contains('files')) return null;
      const records = await new Promise((resolve, reject) => {
        const req = db.transaction('files', 'readonly').objectStore('files').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
      const live = records.filter((r) => r.kind === 'file' && r.bytes);
      const text = (path) => {
        const r = live.find((x) => x.path === path);
        return r ? U.decodeText(r.bytes) : null;
      };
      const kodText = text('ML/kayitlar/kodlar.json');
      let codes = [];
      if (kodText) {
        try {
          const data = JSON.parse(kodText);
          codes = (Array.isArray(data) ? data : data.kodlar || []).filter((k) => k && k.kod);
        } catch { /* bozuk kod listesi */ }
      } else {
        const csv = text('ML/KODListesi.csv');
        if (csv) codes = M.tableToComponents(M.parseCsv(csv)).items.map((i) => ({ kod: i.fields.kod, aciklama: i.fields.ad }));
      }
      const catalogText = text('P&ID/data/kod.csv');
      const catalog = catalogText ? M.parseCsv(catalogText).slice(1).map((r) => ({ kod: r[0], ad: r[1], aciklama: r[2] || '' })) : [];
      const machines = [];
      for (const r of live) {
        if (!/^ML\/kayitlar\/[^/]+\.json$/.test(r.path) || r.path.endsWith('/kodlar.json')) continue;
        try {
          const m = JSON.parse(U.decodeText(r.bytes));
          if (m && m.seriNo) machines.push({ id: m.id || r.path, seriNo: m.seriNo, firma: m.firma || '', model: m.model || '', kodlar: Array.isArray(m.kodlar) ? m.kodlar : [] });
        } catch { /* okunamayan kayıt atlanır */ }
      }
      machines.sort((a, b) => M.compareText(a.seriNo, b.seriNo));
      return { codes, catalog, machines };
    } finally {
      db.close();
    }
  }

  async function loadPpx() {
    if (!(await ppxAvailable())) {
      state.ppx = null;
      return null;
    }
    try {
      state.ppx = await readPpx();
    } catch {
      state.ppx = null;
    }
    emit('ppx');
    return state.ppx;
  }

  /* ─── Açılış ──────────────────────────────────────────── */

  async function loadAll() {
    const store = state.store;
    const [lib, settings, projects, templates, photos] = await Promise.all([store.loadLibrary(), store.readSettings(), store.listProjects(), store.listTemplates(), store.loadPhotos()]);
    state.settings = settings;
    state.photos = photos;
    setLibrary(lib.components);
    state.projects = projects.projects;
    state.templates = templates.templates;
    computeUsage();
    const errors = [...lib.errors, ...projects.errors, ...templates.errors];
    if (errors.length) U.toast(`Okunamayan dosya: ${errors.join(', ')}`, 'error');
    await refreshConflicts();
  }

  function showFatal(error) {
    U.$('home').classList.add('hidden');
    U.$('app').classList.add('hidden');
    const root = U.$('setup');
    root.classList.remove('hidden');
    root.innerHTML = `<div class="setup-inner"><div class="setup-card"><h2>Veritabanı açılamadı</h2>
      <p>${U.esc(error && error.message ? error.message : String(error))}</p>
      <p class="field-help">Tarayıcı veritabanı (IndexedDB) kapalı olabilir: gizli pencerede ya da site verileri engelliyken program çalışmaz. Chrome veya Edge'in normal penceresinde açın.</p>
      <div class="actions"><button type="button" class="btn btn-primary" onclick="location.reload()">Yeniden dene</button>
      <button type="button" class="btn" id="fatalSetup">Bağlantı ayarları</button></div></div></div>`;
    U.$('fatalSetup').addEventListener('click', () => BomxSetup.show({ reason: 'change' }));
  }

  function bindGlobalKeys() {
    document.addEventListener('keydown', (e) => {
      if (BomxSetup.isOpen()) return;
      const modal = U.topModal();
      if (modal) {
        if (e.key === 'Escape') {
          e.preventDefault();
          modal.cancel();
        }
        return;
      }
      if (BomxOutput.isOpen()) {
        if (e.key === 'Escape') BomxOutput.close();
        return;
      }
      if (e.key === 'Escape') U.closeMenu();
      if (state.view === 'editor') BomxEditor.handleKey(e);
      else BomxHome.handleKey(e);
    });
    window.addEventListener('beforeunload', (e) => {
      if (!BomxEditor.hasUnsaved()) return;
      BomxEditor.saveNow();
      e.preventDefault();
      e.returnValue = '';
    });
    // Pencereye bırakılan dosya tarayıcıda açılıp çalışmayı kapatmasın
    window.addEventListener('dragover', (e) => {
      if (!e.target.closest || !e.target.closest('[data-drop]')) e.preventDefault();
    });
    window.addEventListener('drop', (e) => {
      if (!e.target.closest || !e.target.closest('[data-drop]')) e.preventDefault();
    });
  }

  async function boot() {
    const settings = BomxBoot.settings();
    if (!settings.mode) {
      BomxSetup.show({ reason: 'first' });
      return;
    }
    const b = U.busy(settings.mode === 'github' ? 'Veritabanı açılıyor, depo ile eşitleniyor…' : 'Veritabanı açılıyor…');
    try {
      state.db = await BomxBoot.ready();
      shareWrites(state.db);
      state.store = BomxStore.createStore(state.db);
      await loadAll();
    } catch (e) {
      b.close();
      showFatal(e);
      return;
    }
    b.close();
    BomxBoot.onStatus(onStatus);
    BomxHome.init();
    BomxLibrary.init();
    BomxEditor.init();
    BomxPanels.init();
    BomxOutput.init();
    bindGlobalKeys();
    onStatus(state.db.status());
    await showHome(U.pref('sekme', 'projects'));
    loadPpx();
  }

  document.addEventListener('DOMContentLoaded', () => {
    boot().catch((e) => {
      console.error(e);
      showFatal(e);
    });
  });

  return {
    state,
    on,
    emit,
    setLibrary,
    saveComponents,
    deleteComponents,
    photoOf,
    savePhotos,
    toggleFavorite,
    usageOf,
    updateSettings,
    refreshProjects,
    createProject,
    openProject,
    showHome,
    deleteProject,
    refreshTemplates,
    saveTemplate,
    deleteTemplate,
    refreshConflicts,
    syncNow,
    loadPpx,
    get store() { return state.store; },
    get settings() { return state.settings; },
    get library() { return state.library; }
  };
})();
