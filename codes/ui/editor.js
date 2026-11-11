/* Malzeme listesi düzenleyicisi: tablo, bölümler, satır içi düzenleme, seçim, sürükle-bırak,
   geri al / yinele, kayıt, pano, sağ tık menüsü ve revizyon.
   Her değişiklik commit'ten geçer: önceki hâle göre değişen kayda zaman yazılır (birleştirme buna bakar),
   geri alma yığınına girer, 0,6 saniye sonra veritabanına kaydedilir. */

const BomxEditor = (() => {
  const M = BomxModel;
  const U = BomxUi;
  const { esc } = U;
  const app = () => BomxApp;

  /* Malzeme listesinin sütunları sabittir (BomxModel.COLUMNS ile aynı sıra). Kütüphaneden gelen kalemde tabloda yalnız adet yazılır. */
  const SCREEN_COLUMNS = [
    { key: 'handle', w: '22px', label: '' },
    { key: 'foto', w: '62px', label: 'Fotoğraf' },
    { key: 'kod', w: '124px', label: 'Stok Kodu' },
    { key: 'ad', w: 'minmax(220px, 1.5fr)', label: 'Tanım' },
    { key: 'ureticiKodu', w: 'minmax(150px, 0.8fr)', label: 'Model Kodu' },
    { key: 'miktar', w: '112px', label: 'Adet', edit: 'num', align: 'r' },
    { key: 'aciklama', w: 'minmax(260px, 2.2fr)', label: 'Açıklama' }
  ];
  const CLIP_KEY = 'bomx_pano';
  const SAVE_DELAY = 600;
  const SAVE_RETRY = 15000;
  const MAX_UNDO = 200;

  const E = {
    project: null,
    saved: null,
    undo: [],
    redo: [],
    selection: new Set(),
    anchor: null,
    activeSection: null,
    view: 'all',
    collapsed: new Set(),
    filter: '',
    dirty: false,
    saving: null,
    saveTimer: null,
    saveFailed: false,
    renderQueued: false
  };

  /* ─── Yardımcılar ─────────────────────────────────────── */

  const lib = () => app().state.libraryById;
  const lineById = (id) => (E.project ? E.project.kalemler.find((l) => l.id === id) : null);
  const sectionById = (id) => (E.project ? E.project.bolumler.find((s) => s.id === id) : null);

  function activeSectionId() {
    if (!E.project) return null;
    if (!E.project.bolumler.some((s) => s.id === E.activeSection)) E.activeSection = E.project.bolumler[0].id;
    return E.activeSection;
  }

  /** Ekranda görünen sırayla kalemler (bölüm sırası, bölüm içinde liste sırası) */
  function displayOrder() {
    if (!E.project) return [];
    return M.numberedLines(E.project).map((n) => n.line);
  }

  function lineMatches(line, tokens) {
    if (!tokens.length) return true;
    const text = M.fold([line.kod, line.ad, line.ureticiKodu, M.lineDescription(line, E.project.dil), line.kategori, line.uretici].join(' '));
    return tokens.every((t) => text.includes(t));
  }

  function filterTokens() {
    return M.fold(E.filter).split(/[\s,;]+/).filter(Boolean);
  }

  /** Ekranda görünen kalemler: bölüm görünümü, daraltma ve arama dahil */
  function visibleLines() {
    const tokens = filterTokens();
    return displayOrder().filter((l) => (E.view === 'all' || l.bolum === E.view) && (tokens.length || !E.collapsed.has(l.bolum)) && lineMatches(l, tokens));
  }

  /* ─── Kayıt ───────────────────────────────────────────── */

  function setSaveState(text, cls) {
    const el = U.$('saveState');
    el.textContent = text;
    el.className = `save-state ${cls || ''}`;
  }

  const refreshProjectsSoon = U.debounce(() => app().refreshProjects(), 1500);

  function scheduleSave() {
    E.dirty = true;
    setSaveState('Kaydediliyor…', 'dirty');
    clearTimeout(E.saveTimer);
    E.saveTimer = setTimeout(saveNow, SAVE_DELAY);
  }

  function saveNow() {
    clearTimeout(E.saveTimer);
    if (E.saving) return E.saving;
    if (!E.project || !E.dirty) return Promise.resolve();
    E.dirty = false;
    const doc = M.clone(E.saved);
    E.saving = app().store.saveProject(doc).then((res) => {
      E.saveFailed = false;
      setSaveState(`Kaydedildi ${new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`);
      // Veritabanında bu ekranın görmediği değişiklik vardıysa (eşitleme, başka sekme) kayıt onları korudu; ekrana da alınır
      if (res && res.project && E.project && E.project.id === doc.id) {
        const r = absorb(res.project, 'Başka cihazdan ya da sekmeden gelen değişiklikler bu ekranla birleştirildi.');
        if (r && r.ahead) E.dirty = true;
      }
      refreshProjectsSoon();
    }, (e) => {
      E.dirty = true;
      setSaveState('Kaydedilemedi, yeniden denenecek', 'err');
      if (!E.saveFailed) U.toast(`Kaydedilemedi: ${e.message}`, 'error');
      E.saveFailed = true;
      clearTimeout(E.saveTimer);
      E.saveTimer = setTimeout(saveNow, SAVE_RETRY);
    }).finally(() => {
      E.saving = null;
      if (E.dirty && !E.saveFailed) scheduleSave();
    });
    return E.saving;
  }

  async function flush() {
    if (E.saving) await E.saving;
    if (E.dirty) await saveNow();
  }

  /* ─── Değişiklik ve geçmiş ────────────────────────────── */

  function commit(label, options) {
    // Değerler kaydedileceği biçime getirilir (ör. notun sonundaki boş satır): karşılaştırma ve damga doğru olsun
    E.project = M.normalizeProject(E.project);
    const changed = M.stampChanges(E.saved, E.project);
    if (!changed) {
      changedUi(options);
      return false;
    }
    E.undo.push({ state: E.saved, label, selection: [...E.selection], active: E.activeSection });
    if (E.undo.length > MAX_UNDO) E.undo.shift();
    E.redo = [];
    E.saved = M.clone(E.project);
    scheduleSave();
    changedUi(options);
    return true;
  }

  /** fn projeyi değiştirir; hata verirse proje değişmemiş hâline döner */
  function mutate(label, fn, options) {
    let result;
    try {
      result = fn(E.project);
    } catch (e) {
      E.project = M.clone(E.saved);
      U.toast(e.message || String(e), 'error');
      changedUi();
      return undefined;
    }
    commit(label, options);
    return result;
  }

  function restore(entry, from, to, verb) {
    const current = E.saved;
    from.push({ state: current, label: entry.label, selection: [...E.selection], active: E.activeSection });
    const restored = M.clone(entry.state);
    // Proje adı değiştiyse geri alma eski klasörü geri getirmez: kimlik bugünkü addır
    restored.id = E.project.id;
    // Geri gelen kayıtlar yeni zaman alır: öbür cihazdaki eski silme ya da düzenleme bunları ezmesin
    M.stampChanges(current, restored);
    E.project = restored;
    E.saved = M.clone(restored);
    E.selection = new Set(entry.selection.filter((id) => restored.kalemler.some((l) => l.id === id)));
    if (entry.active) E.activeSection = entry.active;
    scheduleSave();
    changedUi();
    U.toast(`${verb}: ${entry.label}`);
  }

  function undo() {
    const entry = E.undo.pop();
    if (entry) restore(entry, E.redo, E.undo, 'Geri alındı');
  }

  function redo() {
    const entry = E.redo.pop();
    if (entry) restore(entry, E.undo, E.redo, 'Yinelendi');
  }

  function changedUi(options) {
    scheduleRender();
    updateToolbar();
    BomxPanels.refresh(options);
  }

  /* ─── Açma ve kapama ──────────────────────────────────── */

  async function open(project) {
    clearTimeout(E.saveTimer);
    if (E.saving) await E.saving;
    E.project = M.normalizeProject(project);
    E.saved = M.clone(E.project);
    E.undo = [];
    E.redo = [];
    E.selection = new Set();
    E.anchor = null;
    E.view = 'all';
    E.collapsed = new Set(U.pref(`daralt:${project.id}`, []));
    E.filter = '';
    E.dirty = false;
    E.saveFailed = false;
    E.activeSection = U.pref(`bolum:${project.id}`, null);
    activeSectionId();
    U.$('bomFilter').value = '';
    U.$('projName').textContent = project.id;
    U.$('projName').title = project.id;
    setSaveState(`Kaydedildi · ${U.relTime(project.guncelleme)}`);
    render();
    updateToolbar();
    BomxPanels.onOpen();
    U.$('bomScroll').scrollTop = 0;
  }

  async function close() {
    await flush();
    if (E.project) {
      U.setPref(`bolum:${E.project.id}`, E.activeSection);
      U.setPref(`daralt:${E.project.id}`, [...E.collapsed]);
    }
    E.project = null;
    E.saved = null;
    E.undo = [];
    E.redo = [];
    E.selection = new Set();
  }

  /**
   * Başka bir hâli (eşitlemeden ya da veritabanından) açık projeyle kayıt kayıt birleştirir.
   * @returns null (değişiklik yok) ya da { ahead }: ahead = ekranda öbür hâlde olmayan değişiklik de var (kaydedilmeli)
   */
  function absorb(other, message) {
    if (!E.project || !other) return null;
    const before = JSON.stringify(M.projectDocument(E.saved));
    const merged = M.mergeProjects(E.saved, other);
    merged.id = E.project.id;
    const after = JSON.stringify(M.projectDocument(merged));
    if (after === before) return null;
    E.project = merged;
    E.saved = M.clone(merged);
    // Geri alma yığını birleşmeden önceki hâllerdir; geri almak öbür cihazın değişikliğini silerdi
    E.undo = [];
    E.redo = [];
    E.selection = new Set([...E.selection].filter((id) => merged.kalemler.some((l) => l.id === id)));
    changedUi();
    if (message) U.toast(message, 'warn');
    return { ahead: after !== JSON.stringify(M.projectDocument(other)) };
  }

  /** Başka cihazdan gelen sürüm açık projeyle kayıt kayıt birleşir */
  function remoteChanged(fresh) {
    if (!E.project) return;
    if (!fresh) {
      U.toast('Bu proje başka bir cihazda silindi ya da adı değişti. Ana ekrandan kontrol edin; buradaki kopya kaydedilirse yeniden oluşur.', 'warn', { ms: 9000 });
      return;
    }
    const r = absorb(fresh, 'Proje başka bir cihazda güncellendi; değişiklikler bu ekranla birleştirildi.');
    if (r && r.ahead) scheduleSave();
  }

  /* ─── Kalem işlemleri ─────────────────────────────────── */

  function insertLines(p, lines, sectionId, beforeId) {
    if (beforeId) {
      const i = p.kalemler.findIndex((l) => l.id === beforeId);
      if (i >= 0) {
        p.kalemler.splice(i, 0, ...lines);
        return;
      }
    }
    let at = -1;
    p.kalemler.forEach((l, i) => {
      if (l.bolum === sectionId) at = i;
    });
    if (at >= 0) p.kalemler.splice(at + 1, 0, ...lines);
    else p.kalemler.push(...lines);
  }

  function targetSection(id) {
    return sectionById(id) ? id : activeSectionId();
  }

  /** Kütüphaneden ekler; aynı bölümde varsa miktarı artar. @returns kalem kimliği */
  function addComponent(component, qty, options) {
    const o = options || {};
    const sec = targetSection(o.sectionId);
    const q = qty === undefined ? 1 : qty;
    let lineId = null;
    mutate(`${component.kod} eklendi`, (p) => {
      const existing = o.merge === false || o.beforeId ? null : p.kalemler.find((l) => l.bolum === sec && l.komponentId === component.id);
      if (existing) {
        existing.miktar = M.round((Number(existing.miktar) || 0) + q, 6);
        lineId = existing.id;
      } else {
        const line = M.lineFromComponent(component, q, sec);
        insertLines(p, [line], sec, o.beforeId);
        lineId = line.id;
      }
    });
    if (lineId && o.reveal !== false) reveal(lineId);
    return lineId;
  }

  /** Bu bölümdeki toplam miktar istenen değere gelir (sol paneldeki miktar kutusu) */
  function setComponentQty(component, qty) {
    const sec = activeSectionId();
    const lines = E.project.kalemler.filter((l) => l.bolum === sec && l.komponentId === component.id);
    if (!lines.length) {
      if (qty > 0) addComponent(component, qty);
      return;
    }
    const total = lines.reduce((n, l) => n + (Number(l.miktar) || 0), 0);
    let delta = M.round(qty - total, 6);
    if (!delta) return;
    mutate(`${component.kod} miktarı ${M.formatQty(qty)}`, (p) => {
      const live = lines.map((l) => p.kalemler.find((x) => x.id === l.id));
      if (delta > 0) {
        live[0].miktar = M.round(live[0].miktar + delta, 6);
        return;
      }
      const remove = new Set();
      for (const l of live.slice().reverse()) {
        const take = Math.min(-delta, l.miktar);
        l.miktar = M.round(l.miktar - take, 6);
        delta += take;
        if (l.miktar <= 0) remove.add(l.id);
        if (delta >= 0) break;
      }
      p.kalemler = p.kalemler.filter((l) => !remove.has(l.id));
      remove.forEach((id) => E.selection.delete(id));
    });
    if (qty > 0) flash(lines[0].id);
  }

  /** @param options.sectionId hedef bölüm, options.newSection yeni bölüm adı, options.beforeId araya ekleme */
  function addLines(lines, label, options) {
    const o = options || {};
    if (!lines.length) return [];
    let ids = [];
    mutate(label, (p) => {
      let sec = targetSection(o.sectionId);
      if (o.newSection) {
        const s = M.normalizeSection({ id: M.uid(), ad: o.newSection });
        p.bolumler.push(s);
        sec = s.id;
        E.activeSection = s.id;
      }
      const copies = lines.map((l) => M.normalizeLine(Object.assign({}, l, { id: M.uid(), bolum: sec })));
      insertLines(p, copies, sec, o.beforeId);
      ids = copies.map((l) => l.id);
    });
    if (ids.length) {
      E.selection = new Set(ids);
      reveal(ids[0]);
      ids.forEach(flash);
    }
    return ids;
  }

  function updateLine(id, patch, label) {
    mutate(label || 'Kalem değişti', (p) => {
      const line = p.kalemler.find((l) => l.id === id);
      if (line) Object.assign(line, patch);
    });
  }

  function updateLines(ids, fn, label) {
    const set = new Set(ids);
    mutate(label, (p) => {
      for (const line of p.kalemler) if (set.has(line.id)) fn(line);
    });
  }

  function removeLines(ids, options) {
    const set = new Set(ids);
    if (!set.size) return;
    const n = E.project.kalemler.filter((l) => set.has(l.id)).length;
    const label = n === 1 ? `${(lineById(ids[0]) || {}).kod || 'Kalem'} silindi` : `${n} kalem silindi`;
    mutate(label, (p) => {
      p.kalemler = p.kalemler.filter((l) => !set.has(l.id));
    });
    ids.forEach((id) => E.selection.delete(id));
    if (!(options && options.silent)) U.toast(label, '', { action: { label: 'Geri al', run: undo } });
  }

  function duplicateLines(ids) {
    const set = new Set(ids);
    const created = [];
    mutate(set.size === 1 ? 'Kalem çoğaltıldı' : `${set.size} kalem çoğaltıldı`, (p) => {
      const out = [];
      for (const line of p.kalemler) {
        out.push(line);
        if (set.has(line.id)) {
          const copy = Object.assign({}, line, { id: M.uid() });
          out.push(copy);
          created.push(copy.id);
        }
      }
      p.kalemler = out;
    });
    E.selection = new Set(created);
    changedUi();
  }

  /** Kalemleri bölüme ve sıraya taşır (sürükle-bırak, bölüme taşı) */
  function moveLines(ids, target) {
    const set = new Set(ids);
    const sec = targetSection(target.sectionId);
    if (target.beforeId && set.has(target.beforeId)) return;
    mutate(set.size === 1 ? 'Kalem taşındı' : `${set.size} kalem taşındı`, (p) => {
      const moving = displayOrder().filter((l) => set.has(l.id)).map((l) => p.kalemler.find((x) => x.id === l.id));
      p.kalemler = p.kalemler.filter((l) => !set.has(l.id));
      moving.forEach((l) => { l.bolum = sec; });
      insertLines(p, moving, sec, target.beforeId);
    });
  }

  /** Alt+↑/↓: seçili kalemler bir sıra kayar; bölüm sınırında komşu bölüme geçer */
  function nudgeSelection(dir) {
    if (!E.selection.size) return;
    const order = displayOrder();
    const sel = order.filter((l) => E.selection.has(l.id));
    if (!sel.length) return;
    const first = order.indexOf(sel[0]);
    const last = order.indexOf(sel[sel.length - 1]);
    const ids = sel.map((l) => l.id);
    if (dir < 0) {
      const prev = order[first - 1];
      const section = sel[0].bolum;
      if (prev && prev.bolum === section) moveLines(ids, { sectionId: section, beforeId: prev.id });
      else {
        const si = E.project.bolumler.findIndex((s) => s.id === section);
        if (si > 0) moveLines(ids, { sectionId: E.project.bolumler[si - 1].id });
      }
    } else {
      const next = order[last + 1];
      const section = sel[sel.length - 1].bolum;
      if (next && next.bolum === section) {
        const after = order[last + 2];
        moveLines(ids, { sectionId: section, beforeId: after && after.bolum === section ? after.id : null });
      } else {
        const si = E.project.bolumler.findIndex((s) => s.id === section);
        const target = E.project.bolumler[si + 1];
        if (target) {
          const firstOfNext = order.find((l) => l.bolum === target.id);
          moveLines(ids, { sectionId: target.id, beforeId: firstOfNext ? firstOfNext.id : null });
        }
      }
    }
    E.selection = new Set(ids);
    reveal(ids[0], true);
  }

  function changeQty(ids, delta) {
    updateLines(ids, (l) => {
      l.miktar = Math.max(0, M.round((Number(l.miktar) || 0) + delta, 6));
    }, delta > 0 ? 'Adet artırıldı' : 'Adet azaltıldı');
  }

  /* ── Kütüphaneyle eşleştirme ── */

  function refreshFromLibrary(ids, fields) {
    const library = lib();
    let n = 0;
    updateLines(ids, (l) => {
      const c = l.komponentId ? library.get(l.komponentId) : null;
      if (!c) return;
      const next = M.refreshFromLibrary(l, c, fields);
      if (M.libraryDiff(l, c).some((f) => !fields || fields.includes(f))) n += 1;
      Object.assign(l, next);
    }, 'Kütüphaneden güncellendi');
    U.toast(n ? `${n} kalem kütüphanedeki hâline getirildi` : 'Kalemler zaten kütüphaneyle aynı');
  }

  function relinkLines(ids) {
    const byKey = new Map(app().state.library.map((c) => [M.codeKey(c.kod), c]));
    let n = 0;
    updateLines(ids, (l) => {
      const c = byKey.get(M.codeKey(l.kod));
      if (!c) return;
      Object.assign(l, M.refreshFromLibrary(l, c));
      n += 1;
    }, 'Kütüphaneye bağlandı');
    U.toast(`${n} kalem kütüphanedeki kayda bağlandı`);
  }

  function mergeDuplicates(ids) {
    const set = new Set(ids);
    const groups = new Map();
    for (const l of E.project.kalemler) {
      if (!set.has(l.id)) continue;
      const key = `${l.bolum}|${M.bomKey(l)}|${l.birim}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(l.id);
    }
    let merged = 0;
    mutate('Tekrar eden kalemler birleşti', (p) => {
      const remove = new Set();
      for (const list of groups.values()) {
        if (list.length < 2) continue;
        const [keep, ...rest] = list.map((id) => p.kalemler.find((l) => l.id === id));
        for (const l of rest) {
          keep.miktar = M.round(keep.miktar + l.miktar, 6);
          const refs = [...new Set([...M.splitRefs(keep.referans), ...M.splitRefs(l.referans)])];
          keep.referans = refs.join(', ');
          if (l.not && !keep.not.includes(l.not)) keep.not = keep.not ? `${keep.not}; ${l.not}` : l.not;
          remove.add(l.id);
          merged += 1;
        }
      }
      p.kalemler = p.kalemler.filter((l) => !remove.has(l.id));
    });
    U.toast(`${merged} tekrar eden satır birleştirildi`);
  }

  function removeZero() {
    const ids = E.project.kalemler.filter((l) => !(Number(l.miktar) > 0)).map((l) => l.id);
    removeLines(ids);
  }

  /** Serbest kalem kütüphaneye eklenir ve bağlanır */
  async function addLineToLibrary(id) {
    const line = lineById(id);
    if (!line) return;
    const res = await app().saveComponents([{
      kod: line.kod, ad: line.ad, kategori: line.kategori, uretici: line.uretici, ureticiKodu: line.ureticiKodu,
      tedarikci: line.tedarikci, birim: line.birim, aciklama: line.aciklama, aciklamaEn: line.aciklamaEn, aciklamaDe: line.aciklamaDe
    }]);
    if (!res.ok) {
      U.toast(res.errors.map((e) => e.errors.join(', ')).join(' · '), 'error');
      return;
    }
    updateLine(id, { komponentId: res.saved[0].id }, 'Kütüphaneye eklendi');
    U.toast(`${line.kod} kütüphaneye eklendi`);
  }

  /* ─── Bölümler ────────────────────────────────────────── */

  async function addSection(name) {
    const ad = name || await U.promptModal('Yeni bölüm', 'Bölüm adı', '', 'Ekle', {
      placeholder: 'Elektrik Panosu, Pnömatik, Mekanik…',
      list: [...new Set([...app().settings.varsayilanBolumler, 'Elektrik Panosu', 'Pnömatik', 'Mekanik', 'Hidrolik', 'Sarf Malzeme', 'Montaj ve İşçilik'])]
    });
    if (!ad) return null;
    let id = null;
    mutate(`"${ad}" bölümü eklendi`, (p) => {
      const s = M.normalizeSection({ id: M.uid(), ad });
      p.bolumler.push(s);
      id = s.id;
    });
    E.activeSection = id;
    if (E.view !== 'all') E.view = id;
    changedUi();
    return id;
  }

  async function renameSection(id) {
    const s = sectionById(id);
    if (!s) return;
    const ad = await U.promptModal('Bölümü yeniden adlandır', 'Bölüm adı', s.ad, 'Kaydet');
    if (!ad || ad === s.ad) return;
    mutate('Bölüm adı değişti', (p) => {
      p.bolumler.find((x) => x.id === id).ad = ad;
    });
  }

  function moveSection(id, dir) {
    const i = E.project.bolumler.findIndex((s) => s.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= E.project.bolumler.length) return;
    mutate('Bölüm sırası değişti', (p) => {
      const [s] = p.bolumler.splice(i, 1);
      p.bolumler.splice(j, 0, s);
    });
  }

  async function deleteSection(id) {
    const s = sectionById(id);
    if (!s) return;
    if (E.project.bolumler.length < 2) {
      U.toast('Son bölüm silinemez; adını değiştirebilirsiniz', 'error');
      return;
    }
    const lines = E.project.kalemler.filter((l) => l.bolum === id);
    const others = E.project.bolumler.filter((x) => x.id !== id);
    let moveTo = null;
    if (lines.length) {
      const choice = await new Promise((resolve) => {
        U.modal(`
          <h2>"${esc(s.ad)}" bölümünü sil</h2>
          <p class="field-help">Bu bölümde ${lines.length} kalem var.</p>
          <div class="radio-list">
            <label><input type="radio" name="dsMode" value="move" checked><span>Kalemleri başka bölüme taşı<small><select id="dsTarget" class="field-input" style="margin-top:6px">${others.map((o) => `<option value="${esc(o.id)}">${esc(o.ad)}</option>`).join('')}</select></small></span></label>
            <label><input type="radio" name="dsMode" value="delete"><span>Kalemleri de sil<small>Geri Al ile geri getirilir.</small></span></label>
          </div>
          <div class="modal-actions"><button type="button" class="btn" data-close>Vazgeç</button><button type="submit" class="btn btn-danger">Bölümü sil</button></div>`, {
          onSubmit: (e, m) => {
            const mode = m.el.querySelector('input[name=dsMode]:checked').value;
            const target = m.el.querySelector('#dsTarget').value;
            m.close();
            resolve(mode === 'move' ? { move: target } : { remove: true });
          },
          onCancel: () => resolve(null)
        });
      });
      if (!choice) return;
      moveTo = choice.move || null;
    }
    mutate(`"${s.ad}" bölümü silindi`, (p) => {
      if (moveTo) {
        const moving = p.kalemler.filter((l) => l.bolum === id);
        p.kalemler = p.kalemler.filter((l) => l.bolum !== id);
        moving.forEach((l) => { l.bolum = moveTo; });
        insertLines(p, moving, moveTo);
      } else {
        p.kalemler = p.kalemler.filter((l) => l.bolum !== id);
      }
      p.bolumler = p.bolumler.filter((x) => x.id !== id);
    });
    if (E.view === id) E.view = 'all';
    activeSectionId();
    changedUi();
    U.toast(`"${s.ad}" bölümü silindi`, '', { action: { label: 'Geri al', run: undo } });
  }

  function setActiveSection(id) {
    if (!sectionById(id)) return;
    E.activeSection = id;
    changedUi({ light: true });
  }

  function setView(id) {
    E.view = id === 'all' || sectionById(id) ? id : 'all';
    if (E.view !== 'all') {
      E.activeSection = E.view;
      E.collapsed.delete(E.view);
    }
    E.selection = new Set([...E.selection].filter((sid) => {
      const l = lineById(sid);
      return l && (E.view === 'all' || l.bolum === E.view);
    }));
    changedUi();
    U.$('bomScroll').scrollTop = 0;
  }

  function toggleCollapse(id) {
    if (E.collapsed.has(id)) E.collapsed.delete(id);
    else E.collapsed.add(id);
    render();
  }

  /* ─── Proje bilgileri ve revizyon ─────────────────────── */

  function setMeta(key, value, label) {
    mutate(label || 'Proje bilgisi değişti', (p) => {
      p[key] = value;
    });
  }

  /** Rev. yükseltilince listenin o anki hâli saklanır; sonraki değişiklikler Revizyon Farkı'nda ona göre görünür */
  async function bumpRevision() {
    const p = E.project;
    const prevRev = p.rev;
    const next = M.nextRev(prevRev);
    const text = await U.promptModal(`Rev. ${next}`, 'Revizyon açıklaması (tek satır, revizyon tablosuna yazılır)', '', `Rev. ${next} oluştur`, {
      required: false,
      placeholder: 'Ne değişti? Örn: Pompa PE03 eklendi, vana tipi değişti',
      help: `Rev. ${prevRev} hâli saklanır; bundan sonraki değişiklikler Revizyon Farkı sekmesinde Rev. ${prevRev}'e göre görünür. Belge tarihi bugün olur.`
    });
    if (text === null || !E.project) return;
    await flush();
    try {
      await app().store.saveRevision(p.id, E.saved);
    } catch (e) {
      U.toast(`Revizyon kaydedilemedi: ${e.message}`, 'error');
      return;
    }
    mutate(`Rev. ${next}`, (x) => {
      x.rev = next;
      x.tarih = M.today();
      x.revizyonlar.push({ id: M.uid(), rev: next, tarih: M.today(), hazirlayan: x.hazirlayan, aciklama: text, zaman: '' });
    });
    BomxPanels.revisionsChanged();
    U.toast(`Rev. ${next} oluşturuldu; Rev. ${prevRev} hâli saklandı.`);
  }

  async function dropRevision() {
    const p = E.project;
    if (p.rev === '00' || p.revizyonlar.length < 2) return;
    const current = p.revizyonlar[p.revizyonlar.length - 1];
    const previous = p.revizyonlar[p.revizyonlar.length - 2];
    const ok = await U.confirmModal('Revizyonu geri al', `Rev. ${current.rev} satırı (tarih ve açıklama) silinecek; geçerli revizyon Rev. ${previous.rev} olacak. Malzeme listesindeki kalemler değişmez.`, `Rev. ${current.rev} sil`, { danger: true });
    if (!ok) return;
    // Önceki revizyonun anlık görüntüsü silinmez: Geri Al ile Rev. satırı dönünce fark yine ona göre görünür;
    // yeniden revizyon yükseltilince zaten yenisiyle yazılır
    mutate(`Rev. ${current.rev} silindi`, (x) => {
      x.revizyonlar = x.revizyonlar.filter((r) => r.id !== current.id);
      x.rev = previous.rev;
      if (previous.tarih) x.tarih = previous.tarih;
    });
    BomxPanels.revisionsChanged();
  }

  async function renameProject() {
    const p = E.project;
    const next = M.projectId(p.seriNo, p.musteri, p.model);
    if (!next) {
      U.toast('Seri no, müşteri ve model dolu olmalı', 'error');
      return;
    }
    if (next === p.id) {
      U.toast('Proje adı bu bilgilerle zaten aynı');
      return;
    }
    const ok = await U.confirmModal('Proje adını güncelle', `"${p.id}" → "${next}". Proje klasörü ve revizyon dosyaları yeni ada taşınır.`, 'Güncelle');
    if (!ok) return;
    await flush();
    try {
      const id = await app().store.renameProject(p.id, E.saved);
      E.project.id = id;
      E.saved.id = id;
      U.$('projName').textContent = id;
      await app().refreshProjects();
      BomxPanels.refresh();
      U.toast(`Proje adı güncellendi: ${id}`);
    } catch (e) {
      U.toast(`Proje adı güncellenemedi: ${e.message}`, 'error');
    }
  }

  /* ─── Seçim ───────────────────────────────────────────── */

  function select(id, e) {
    const additive = e && (e.ctrlKey || e.metaKey);
    const range = e && e.shiftKey && E.anchor;
    if (range) {
      const order = visibleLines().map((l) => l.id);
      const a = order.indexOf(E.anchor);
      const b = order.indexOf(id);
      if (a >= 0 && b >= 0) {
        const [x, y] = a < b ? [a, b] : [b, a];
        if (!additive) E.selection.clear();
        order.slice(x, y + 1).forEach((sid) => E.selection.add(sid));
      }
    } else if (additive) {
      if (E.selection.has(id)) E.selection.delete(id);
      else E.selection.add(id);
      E.anchor = id;
    } else {
      E.selection = new Set([id]);
      E.anchor = id;
    }
    const line = lineById(id);
    if (line) E.activeSection = line.bolum;
    paintSelection();
    BomxPanels.refresh({ light: true, selection: true });
  }

  function setSelection(ids) {
    E.selection = new Set(ids.filter((id) => lineById(id)));
    E.anchor = ids[0] || null;
    paintSelection();
    BomxPanels.refresh({ light: true, selection: true });
  }

  function clearSelection() {
    if (!E.selection.size) return;
    E.selection.clear();
    paintSelection();
    BomxPanels.refresh({ light: true, selection: true });
  }

  function moveCursor(dir, extend) {
    const order = visibleLines().map((l) => l.id);
    if (!order.length) return;
    const current = [...E.selection];
    const last = current.length ? current[current.length - 1] : null;
    let i = last ? order.indexOf(last) : -1;
    i = Math.max(0, Math.min(order.length - 1, i + dir));
    if (i < 0) i = 0;
    const id = order[i];
    if (extend) {
      E.selection.add(id);
    } else {
      E.selection = new Set([id]);
      E.anchor = id;
    }
    paintSelection();
    reveal(id, true);
    BomxPanels.refresh({ light: true, selection: true });
  }

  function paintSelection() {
    U.$('bomTable').querySelectorAll('.bt-row').forEach((row) => row.classList.toggle('selected', E.selection.has(row.dataset.id)));
    updateToolbar();
  }

  /* ─── Görünüm ─────────────────────────────────────────── */

  function scheduleRender() {
    if (E.renderQueued) return;
    E.renderQueued = true;
    requestAnimationFrame(() => {
      E.renderQueued = false;
      render();
    });
  }

  const cellValue = (line) => M.formatQty(line.miktar);

  function rowHtml(line, diffs) {
    const comp = line.komponentId ? lib().get(line.komponentId) : null;
    const diffSet = new Set(diffs);
    const cells = SCREEN_COLUMNS.map((c) => {
      const cls = `bt-cell${c.align ? ` ${c.align}` : ''}${diffSet.has(c.key) ? ' diff' : ''}`;
      switch (c.key) {
        case 'handle': return '<div class="bt-cell bt-handle" draggable="true" title="Sürükleyerek taşıyın">⋮⋮</div>';
        case 'foto': {
          const photo = line.komponentId ? app().photoOf(line.komponentId) : '';
          return `<div class="bt-cell bt-foto">${photo ? `<img class="bt-thumb" src="${esc(photo)}" alt="" loading="lazy" draggable="false" title="Büyüt">` : ''}</div>`;
        }
        case 'kod': {
          const tag = !line.komponentId ? '<span class="free" title="Kütüphanede olmayan kalem">SERBEST</span>'
            : !comp ? '<span class="free" title="Kütüphanede silinmiş">SİLİNMİŞ</span>' : '';
          const flag = diffs.length ? `<span class="bt-flag" title="Kütüphaneden farklı: ${esc(diffs.join(', '))}">⚑</span>` : '';
          const pas = comp && comp.pasif ? '<span class="bt-flag" title="Pasif komponent">⊘</span>' : '';
          return `<div class="${cls} bt-kod" title="${esc(line.kod)}"><span>${U.highlight(line.kod, E.filter)}</span>${tag}${flag}${pas}</div>`;
        }
        case 'ad': return `<div class="${cls} bt-ad bt-text" title="${esc(line.ad)}"><span>${U.highlight(line.ad, E.filter)}</span></div>`;
        case 'miktar': {
          const bad = !(Number(line.miktar) > 0);
          const unit = M.isPieceUnit(line.birim) ? '' : `<span class="bt-sub bt-unit">${esc(line.birim)}</span>`;
          return `<div class="${cls}"><input class="bt-in num qty${bad ? ' bad' : ''}" data-f="miktar" value="${esc(cellValue(line))}" spellcheck="false" autocomplete="off" inputmode="decimal">${unit}</div>`;
        }
        default: {
          const value = c.key === 'aciklama' ? M.lineDescription(line, E.project.dil) : line[c.key] || '';
          return `<div class="${cls} bt-sub bt-text" title="${esc(value)}"><span>${U.highlight(String(value).replace(/\n+/g, ' · '), E.filter)}</span></div>`;
        }
      }
    });
    return `<div class="bt-row${E.selection.has(line.id) ? ' selected' : ''}" data-id="${esc(line.id)}" data-drop>${cells.join('')}</div>`;
  }

  function startHtml() {
    const count = app().state.library.length;
    return `<div class="bt-start">
      <strong>Malzeme listesi boş</strong>
      ${count
        ? `Soldaki kütüphaneden (${count} komponent) ekleyin: arayın, satırdaki <b>+</b> düğmesine basın, çift tıklayın ya da tabloya sürükleyin. Listede yalnız adet değişir; ürün bilgileri kütüphaneden gelir.`
        : 'Kütüphanede henüz komponent yok. Ana ekrandaki <b>Komponentler</b> sekmesinden ekleyin ya da CSV / Excel yükleyin; ya da kütüphanesiz <b>serbest kalem</b> ekleyin.'}
      <div class="keys">
        <kbd>/</kbd><span>komponent aramaya git; <kbd>↑</kbd> <kbd>↓</kbd> ile seçip <kbd>Enter</kbd> ile ekle</span>
        <kbd>Ctrl</kbd><span>+ <kbd>V</kbd> Excel'den stok kodu ve adet sütunlarını yapıştır</span>
        <kbd>Ctrl</kbd><span>+ <kbd>Z</kbd> geri al, <kbd>Ctrl</kbd> + <kbd>Y</kbd> yinele, <kbd>Ctrl</kbd> + <kbd>S</kbd> kaydet</span>
      </div>
      <div class="actions">
        <button type="button" class="btn btn-sm" data-start="paste">${U.ICONS.paste} Yapıştırarak ekle</button>
        <button type="button" class="btn btn-sm" data-start="free">${U.ICONS.free} Serbest kalem</button>
        <button type="button" class="btn btn-sm" data-start="templates">Şablondan ekle</button>
        <button type="button" class="btn btn-sm" data-start="projects">Başka projeden al</button>
      </div>
    </div>`;
  }

  /** Odaktaki hücre ve yazılmış ama kaydedilmemiş değer yeniden çizimde korunur */
  function captureFocus() {
    const el = document.activeElement;
    if (!el || !el.classList || !el.classList.contains('bt-in')) return null;
    const row = el.closest('.bt-row');
    return row ? { id: row.dataset.id, f: el.dataset.f, value: el.value, start: el.selectionStart, end: el.selectionEnd, dirty: el.dataset.dirty === '1' } : null;
  }

  function restoreFocus(focus) {
    if (!focus) return;
    const row = U.$('bomTable').querySelector(`.bt-row[data-id="${CSS.escape(focus.id)}"]`);
    const input = row && row.querySelector(`.bt-in[data-f="${focus.f}"]`);
    if (!input) return;
    if (focus.dirty) {
      input.value = focus.value;
      input.dataset.dirty = '1';
    }
    input.focus({ preventScroll: true });
    try {
      input.setSelectionRange(focus.start, focus.end);
    } catch { /* sayı alanı */ }
  }

  function render() {
    const table = U.$('bomTable');
    if (!E.project) {
      table.innerHTML = '';
      return;
    }
    const focus = captureFocus();
    const p = E.project;
    const cols = SCREEN_COLUMNS;
    table.style.setProperty('--bt-cols', cols.map((c) => c.w).join(' '));
    table.style.setProperty('--bt-min', `${cols.reduce((n, c) => n + parseInt(c.w.match(/(\d+)px/)[1], 10), 0)}px`);
    // Başlıklar içerik dilinde (araç çubuğundaki TR / EN / DE)
    const T = M.docText(p.dil);
    const headText = (c) => { const col = M.COLUMNS.find((x) => x.key === c.key); return col ? T[col.doc] || c.label : c.label; };
    const head = `<div class="bt-head">${cols.map((c) => `<div class="${c.align || ''}">${esc(headText(c))}</div>`).join('')}</div>`;
    if (!p.kalemler.length && p.bolumler.length === 1 && !E.filter) {
      table.innerHTML = head + startHtml();
      updateCounts();
      return;
    }
    const library = lib();
    const tokens = filterTokens();
    const multi = p.bolumler.length > 1;
    const active = activeSectionId();
    const parts = [head];
    p.bolumler.forEach((s, si) => {
      if (E.view !== 'all' && E.view !== s.id) return;
      const lines = p.kalemler.filter((l) => l.bolum === s.id);
      const shown = tokens.length ? lines.filter((l) => lineMatches(l, tokens)) : lines;
      if (tokens.length && !shown.length) return;
      const collapsed = !tokens.length && E.collapsed.has(s.id);
      const sums = M.summarize(lines);
      const pieces = sums.pieces ? ` · ${M.formatQty(sums.pieces)} adet` : '';
      parts.push(`<div class="bt-section${s.id === active ? ' active' : ''}${collapsed ? ' collapsed' : ''}" data-sec="${esc(s.id)}" data-drop title="Tıklayın: eklenecek bölüm olsun · çift tık: adını değiştir">
        <button type="button" class="bt-collapse" data-act="collapse" title="Daralt / aç">▼</button>
        <span class="bt-sec-no">${si + 1}</span>
        <span class="bt-sec-name">${esc(s.ad)}</span>
        <span class="bt-sec-meta">${lines.length} kalem${pieces}${tokens.length ? ` · ${shown.length} eşleşen` : ''}</span>
        <span class="bt-sec-actions">
          <button type="button" data-act="sec-up" title="Yukarı taşı">${'↑'}</button>
          <button type="button" data-act="sec-down" title="Aşağı taşı">${'↓'}</button>
          <button type="button" data-act="sec-rename" title="Yeniden adlandır">✎</button>
          ${multi ? '<button type="button" data-act="sec-del" title="Bölümü sil">×</button>' : ''}
        </span>
      </div>`);
      if (collapsed) return;
      if (!shown.length) {
        parts.push(`<div class="bt-empty" data-sec="${esc(s.id)}" data-drop>Bu bölüm boş. Soldan komponent ekleyin ya da kalemleri buraya sürükleyin.</div>`);
        return;
      }
      for (const line of shown) {
        const comp = line.komponentId ? library.get(line.komponentId) : null;
        parts.push(rowHtml(line, M.libraryDiff(line, comp)));
      }
    });
    if (parts.length === 1) parts.push(`<div class="bt-start"><strong>Eşleşen kalem yok</strong>"${esc(E.filter)}" aramasına uyan kalem bulunamadı.</div>`);
    table.innerHTML = parts.join('');
    restoreFocus(focus);
    updateCounts();
  }

  function updateCounts() {
    const p = E.project;
    if (!p) return;
    const shown = visibleLines().length;
    U.$('bomCount').textContent = E.filter || E.view !== 'all'
      ? `${shown} / ${p.kalemler.length} kalem gösteriliyor`
      : `${p.kalemler.length} kalem · ${p.bolumler.length} bölüm`;
  }

  function setLanguage(lang) {
    if (!E.project || E.project.dil === lang) return;
    setMeta('dil', lang, 'İçerik dili');
    paintLanguage();
  }

  function paintLanguage() {
    if (!E.project) return;
    U.$('bomLang').querySelectorAll('[data-lang]').forEach((b) => {
      const on = b.dataset.lang === E.project.dil;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  function updateToolbar() {
    paintLanguage();
    U.$('btnUndo').disabled = !E.undo.length;
    U.$('btnRedo').disabled = !E.redo.length;
    U.$('btnUndo').title = E.undo.length ? `Geri al: ${E.undo[E.undo.length - 1].label} (Ctrl+Z)` : 'Geri al (Ctrl+Z)';
    U.$('btnRedo').title = E.redo.length ? `Yinele: ${E.redo[E.redo.length - 1].label} (Ctrl+Y)` : 'Yinele (Ctrl+Y)';
    const has = E.selection.size > 0;
    for (const id of ['btnDelete', 'btnDuplicate', 'btnMoveUp', 'btnMoveDown']) U.$(id).disabled = !has;
  }

  function flash(id) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const row = U.$('bomTable').querySelector(`.bt-row[data-id="${CSS.escape(id)}"]`);
      if (!row) return;
      row.classList.remove('flash');
      void row.offsetWidth;
      row.classList.add('flash');
    }));
  }

  /** Kalem görünür olsun: bölüm açılır, görünüm uygunsa satıra kaydırılır */
  function reveal(id, keepFlash) {
    const line = lineById(id);
    if (!line) return;
    let rerender = false;
    if (E.collapsed.has(line.bolum)) {
      E.collapsed.delete(line.bolum);
      rerender = true;
    }
    if (E.view !== 'all' && E.view !== line.bolum) {
      E.view = 'all';
      rerender = true;
    }
    if (rerender) render();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const row = U.$('bomTable').querySelector(`.bt-row[data-id="${CSS.escape(id)}"]`);
      if (!row) return;
      row.scrollIntoView({ block: 'nearest' });
      if (!keepFlash) flash(id);
    }));
  }

  /* ─── Satır içi düzenleme ─────────────────────────────── */

  /** Tablodaki tek düzenlenebilir hücre: adet */
  function commitInput(input) {
    const row = input.closest('.bt-row');
    if (!row) return true;
    const line = lineById(row.dataset.id);
    if (!line) return true;
    input.dataset.dirty = '';
    const raw = input.value.trim();
    const n = raw === '' ? 0 : M.parseNumber(raw);
    if (n === null || n < 0) {
      U.toast(n === null ? `"${raw}" sayı değil` : 'Eksi değer girilemez', 'error');
      input.value = cellValue(line);
      return false;
    }
    if (M.round(line.miktar, 6) === M.round(n, 6)) {
      input.value = cellValue(line);
      return true;
    }
    updateLine(line.id, { miktar: n }, `${line.kod}: Adet ${M.formatQty(n)}`);
    return true;
  }

  function focusCell(id, f) {
    const row = U.$('bomTable').querySelector(`.bt-row[data-id="${CSS.escape(id)}"]`);
    const input = row && row.querySelector(`.bt-in[data-f="${f}"]`);
    if (input) {
      input.focus();
      input.select();
      row.scrollIntoView({ block: 'nearest' });
    }
  }

  function neighborRow(id, dir) {
    const order = visibleLines().map((l) => l.id);
    const i = order.indexOf(id);
    return order[i + dir] || null;
  }

  function bindTable() {
    const table = U.$('bomTable');
    table.addEventListener('input', (e) => {
      if (e.target.classList.contains('bt-in')) e.target.dataset.dirty = '1';
    });
    table.addEventListener('change', (e) => {
      if (e.target.classList.contains('bt-in')) commitInput(e.target);
    });
    table.addEventListener('focusin', (e) => {
      const input = e.target.closest('.bt-in');
      if (!input) return;
      const row = input.closest('.bt-row');
      if (row && !(E.selection.size > 1 && E.selection.has(row.dataset.id))) {
        if (!(E.selection.size === 1 && E.selection.has(row.dataset.id))) select(row.dataset.id);
      }
    });
    table.addEventListener('keydown', (e) => {
      const input = e.target.closest('.bt-in');
      if (!input) return;
      const row = input.closest('.bt-row');
      const id = row.dataset.id;
      const f = input.dataset.f;
      if (e.key === 'Escape') {
        const line = lineById(id);
        input.value = cellValue(line);
        input.dataset.dirty = '';
        input.blur();
        e.stopPropagation();
        return;
      }
      if (e.key === 'Enter' || ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && input.classList.contains('num'))) {
        e.preventDefault();
        const dir = e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey) ? -1 : 1;
        commitInput(input);
        const next = neighborRow(id, dir);
        // Çizim sonrası yeni satırdaki aynı alana geçilir (Excel gibi)
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (next) {
            select(next);
            focusCell(next, f);
          } else {
            const el = U.$('bomTable').querySelector(`.bt-row[data-id="${CSS.escape(id)}"] .bt-in[data-f="${f}"]`);
            if (el) el.select();
          }
        }));
      }
    });
    table.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const row = e.target.closest('.bt-row');
      if (row && !e.target.closest('.bt-in') && !e.target.closest('.bt-handle')) {
        // Kaydırma seçimi değiştirmesin: metin seçimi engellenir
        if (e.shiftKey) e.preventDefault();
        select(row.dataset.id, e);
      }
    });
    table.addEventListener('click', (e) => {
      if (e.target.classList.contains('bt-thumb')) {
        const line = lineById(e.target.closest('.bt-row').dataset.id);
        if (line) U.lightbox(e.target.src, [line.kod, line.ad].filter(Boolean).join(' · '));
        return;
      }
      const start = e.target.closest('[data-start]');
      if (start) {
        const what = start.dataset.start;
        if (what === 'paste') openPasteDialog();
        else if (what === 'free') openFreeLineDialog();
        else BomxPanels.selectLeftTab(what);
        return;
      }
      const sec = e.target.closest('.bt-section');
      if (sec) {
        const act = e.target.closest('[data-act]');
        const id = sec.dataset.sec;
        if (act) {
          e.stopPropagation();
          const a = act.dataset.act;
          if (a === 'collapse') toggleCollapse(id);
          else if (a === 'sec-up') moveSection(id, -1);
          else if (a === 'sec-down') moveSection(id, 1);
          else if (a === 'sec-rename') renameSection(id);
          else if (a === 'sec-del') deleteSection(id);
          return;
        }
        setActiveSection(id);
        return;
      }
      if (!e.target.closest('.bt-row') && !e.target.closest('.bt-head')) clearSelection();
    });
    table.addEventListener('dblclick', (e) => {
      const sec = e.target.closest('.bt-section');
      if (sec && !e.target.closest('[data-act]')) {
        renameSection(sec.dataset.sec);
        return;
      }
      const row = e.target.closest('.bt-row');
      if (row && !e.target.closest('.bt-in')) {
        BomxPanels.selectRightTab('props');
        BomxPanels.focusInspector();
      }
    });
    table.addEventListener('contextmenu', (e) => {
      const sec = e.target.closest('.bt-section');
      if (sec) {
        e.preventDefault();
        sectionMenu(sec.dataset.sec, e.clientX, e.clientY);
        return;
      }
      const row = e.target.closest('.bt-row');
      if (!row || e.target.closest('.bt-in')) return;
      e.preventDefault();
      if (!E.selection.has(row.dataset.id)) select(row.dataset.id);
      rowMenu(e.clientX, e.clientY);
    });
    bindDrag(table);
  }

  function sectionMenu(id, x, y) {
    const s = sectionById(id);
    const i = E.project.bolumler.indexOf(s);
    U.contextMenu(x, y, [
      { title: s.ad },
      { label: 'Eklenecek bölüm yap', run: () => setActiveSection(id) },
      { label: 'Yalnız bu bölümü göster', run: () => setView(id) },
      { label: 'Yeniden adlandır', run: () => renameSection(id) },
      { label: 'Yukarı taşı', disabled: i === 0, run: () => moveSection(id, -1) },
      { label: 'Aşağı taşı', disabled: i === E.project.bolumler.length - 1, run: () => moveSection(id, 1) },
      '-',
      { label: 'Bölümün kalemlerini seç', run: () => setSelection(displayOrder().filter((l) => l.bolum === id).map((l) => l.id)) },
      { label: 'Bölümden şablon oluştur', run: () => BomxPanels.templateFromLines(displayOrder().filter((l) => l.bolum === id).map((l) => l.id), s.ad) },
      '-',
      { label: 'Bölümü sil', danger: true, disabled: E.project.bolumler.length < 2, run: () => deleteSection(id) }
    ]);
  }

  function rowMenu(x, y) {
    const ids = displayOrder().filter((l) => E.selection.has(l.id)).map((l) => l.id);
    const lines = ids.map(lineById);
    const one = lines.length === 1 ? lines[0] : null;
    const comp = one && one.komponentId ? lib().get(one.komponentId) : null;
    const others = E.project.bolumler.filter((s) => !lines.every((l) => l.bolum === s.id));
    const anyDiff = lines.some((l) => l.komponentId && lib().get(l.komponentId) && M.libraryDiff(l, lib().get(l.komponentId)).length);
    U.contextMenu(x, y, [
      { title: one ? `${one.kod} · ${one.ad}` : `${lines.length} kalem` },
      { label: 'Çoğalt', key: 'Ctrl+D', run: () => duplicateLines(ids) },
      { label: 'Kopyala', key: 'Ctrl+C', run: () => copySelection() },
      { label: 'Adet +1', key: '+', run: () => changeQty(ids, 1) },
      { label: 'Adet −1', key: '−', run: () => changeQty(ids, -1) },
      { label: 'Bölüme taşı', disabled: !others.length, items: others.map((s) => ({ label: s.ad, run: () => moveLines(ids, { sectionId: s.id }) })) },
      { label: 'Yukarı taşı', key: 'Alt+↑', run: () => nudgeSelection(-1) },
      { label: 'Aşağı taşı', key: 'Alt+↓', run: () => nudgeSelection(1) },
      '-',
      { label: 'Kütüphaneden güncelle', disabled: !anyDiff, run: () => refreshFromLibrary(ids) },
      one && !one.komponentId ? { label: 'Kütüphaneye ekle', run: () => addLineToLibrary(one.id) } : null,
      comp ? { label: 'Kütüphanede düzenle', run: () => BomxLibrary.openForm(comp) } : null,
      { label: 'Seçilenlerden şablon oluştur', run: () => BomxPanels.templateFromLines(ids) },
      '-',
      { label: lines.length > 1 ? `${lines.length} kalemi sil` : 'Sil', key: 'Delete', danger: true, run: () => removeLines(ids) }
    ]);
  }

  /* ─── Sürükle-bırak ───────────────────────────────────── */

  const DRAG_COMPONENT = 'application/x-bomx-komponent';
  const DRAG_LINES = 'application/x-bomx-kalem';
  let dragIds = null;

  function clearDropMarks() {
    document.querySelectorAll('.drop-before, .drop-after, .bt-section.drop, .bt-empty.drop, .bt-start.drop, #bomTable.drop, .sec-tab.drop').forEach((el) => el.classList.remove('drop-before', 'drop-after', 'drop'));
  }

  function dropTarget(e) {
    const row = e.target.closest('.bt-row');
    if (row) {
      const line = lineById(row.dataset.id);
      if (!line) return null;
      const r = row.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      let beforeId = row.dataset.id;
      if (after) {
        const next = neighborRow(row.dataset.id, 1);
        const nextLine = next ? lineById(next) : null;
        beforeId = nextLine && nextLine.bolum === line.bolum ? next : null;
      }
      return { el: row, cls: after ? 'drop-after' : 'drop-before', sectionId: line.bolum, beforeId };
    }
    const sec = e.target.closest('.bt-section, .bt-empty');
    if (sec) return { el: sec, cls: 'drop', sectionId: sec.dataset.sec, beforeId: null };
    // Boş liste ya da tablonun boş kısmı: eklenecek bölümün sonuna
    const table = U.$('bomTable');
    if (E.project && table.contains(e.target) && !e.target.closest('.bt-head')) return { el: e.target.closest('.bt-start') || table, cls: 'drop', sectionId: activeSectionId(), beforeId: null };
    return null;
  }

  function isOurDrag(e) {
    const types = [...(e.dataTransfer ? e.dataTransfer.types : [])];
    return types.includes(DRAG_COMPONENT) || types.includes(DRAG_LINES);
  }

  function bindDrag(table) {
    table.addEventListener('dragstart', (e) => {
      const handle = e.target.closest('.bt-handle');
      if (!handle) return;
      const id = handle.closest('.bt-row').dataset.id;
      dragIds = E.selection.has(id) ? displayOrder().filter((l) => E.selection.has(l.id)).map((l) => l.id) : [id];
      e.dataTransfer.setData(DRAG_LINES, JSON.stringify(dragIds));
      e.dataTransfer.setData('text/plain', dragIds.map((i) => (lineById(i) || {}).kod).join('\n'));
      e.dataTransfer.effectAllowed = 'move';
      const row = handle.closest('.bt-row');
      e.dataTransfer.setDragImage(row, 20, 15);
      requestAnimationFrame(() => dragIds.forEach((i) => {
        const el = table.querySelector(`.bt-row[data-id="${CSS.escape(i)}"]`);
        if (el) el.classList.add('dragging');
      }));
    });
    table.addEventListener('dragend', () => {
      dragIds = null;
      clearDropMarks();
      table.querySelectorAll('.dragging').forEach((el) => el.classList.remove('dragging'));
    });
    table.addEventListener('dragover', (e) => {
      if (!isOurDrag(e)) return;
      const t = dropTarget(e);
      if (!t) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = [...e.dataTransfer.types].includes(DRAG_LINES) ? 'move' : 'copy';
      clearDropMarks();
      t.el.classList.add(t.cls);
    });
    table.addEventListener('dragleave', (e) => {
      if (!table.contains(e.relatedTarget)) clearDropMarks();
    });
    table.addEventListener('drop', (e) => {
      if (!isOurDrag(e)) return;
      const t = dropTarget(e);
      clearDropMarks();
      if (!t) return;
      e.preventDefault();
      handleDrop(e.dataTransfer, t);
    });
  }

  /** Tablo ya da bölüm sekmesine bırakılan komponent / kalem */
  function handleDrop(dt, target) {
    const lines = dt.getData(DRAG_LINES);
    if (lines) {
      const ids = JSON.parse(lines);
      moveLines(ids, target);
      E.selection = new Set(ids);
      changedUi();
      return;
    }
    const compId = dt.getData(DRAG_COMPONENT);
    const comp = compId ? lib().get(compId) : null;
    if (comp) {
      const id = addComponent(comp, 1, { sectionId: target.sectionId, beforeId: target.beforeId, merge: !target.beforeId });
      E.activeSection = target.sectionId;
      if (id) setSelection([id]);
    }
  }

  /* ─── Pano ────────────────────────────────────────────── */

  function linesToTsv(lines) {
    const head = ['Stok Kodu', 'Tanım', 'Model Kodu', 'Adet', 'Birim', 'Açıklama'];
    const rows = lines.map((l) => [l.kod, l.ad, l.ureticiKodu, M.formatQty(l.miktar), l.birim, l.aciklama.replace(/\s+/g, ' ')]);
    return [head, ...rows].map((r) => r.map((c) => String(c == null ? '' : c).replace(/\t/g, ' ')).join('\t')).join('\n');
  }

  async function copySelection() {
    const lines = displayOrder().filter((l) => E.selection.has(l.id));
    if (!lines.length) return;
    const tsv = linesToTsv(lines);
    try {
      localStorage.setItem(CLIP_KEY, JSON.stringify({ at: Date.now(), tsv, lines }));
    } catch { /* gizli pencere */ }
    await U.copyText(tsv);
    U.toast(`${lines.length} kalem kopyalandı. Başka projede Ctrl+V ile yapıştırılır, Excel'e de tablo olarak yapışır.`);
  }

  function internalClip(text) {
    try {
      const clip = JSON.parse(localStorage.getItem(CLIP_KEY));
      if (!clip || Date.now() - clip.at > 12 * 3600 * 1000) return null;
      if (text !== undefined && text.replace(/\r\n/g, '\n').trim() !== clip.tsv.trim()) return null;
      return clip;
    } catch {
      return null;
    }
  }

  function onPaste(e) {
    if (!E.project || app().state.view !== 'editor' || U.topModal() || BomxOutput.isOpen()) return;
    if (U.isTyping(e.target)) return;
    const text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
    e.preventDefault();
    const clip = internalClip(text);
    if (clip) {
      const ids = addLines(clip.lines, `${clip.lines.length} kalem yapıştırıldı`, { beforeId: null });
      U.toast(`${ids.length} kalem "${(sectionById(activeSectionId()) || {}).ad}" bölümüne yapıştırıldı`);
      return;
    }
    if (text.trim()) openPasteDialog(text);
  }

  /* ─── Yapıştırarak ekleme ve serbest kalem ────────────── */

  function sectionOptions(selected) {
    return E.project.bolumler.map((s) => `<option value="${esc(s.id)}"${s.id === selected ? ' selected' : ''}>${esc(s.ad)}</option>`).join('');
  }

  function openPasteDialog(initial) {
    const library = app().state.library;
    const m = U.modal(`
      <h2>Yapıştırarak ekle <button type="button" class="icon-btn sm x" data-close>×</button></h2>
      <p class="field-help">Excel'den stok kodu ve adet sütunlarını kopyalayıp buraya yapıştırın ya da her satıra bir kalem yazın: <code>PE01 2</code>, <code>2 x V31</code>, <code>LS01;4</code>. Kodlar kütüphanede aranır; başlık satırı atlanır.</p>
      <textarea id="paText" class="field-input paste-area" placeholder="STOK KODU&#9;ADET&#10;PE01&#9;2&#10;V31&#9;4">${esc(initial || '')}</textarea>
      <div class="field-row">
        <div class="field"><label for="paSection">Eklenecek bölüm</label><select id="paSection" class="field-input">${sectionOptions(activeSectionId())}<option value="__new">+ Yeni bölüm…</option></select></div>
        <div class="field"><label for="paMissing">Kütüphanede olmayan kodlar</label><select id="paMissing" class="field-input"><option value="free">Serbest kalem olarak ekle</option><option value="skip">Atla</option></select></div>
      </div>
      <label class="check-inline"><input type="checkbox" id="paMerge" checked> Bölümde zaten olan komponentin adedini artır</label>
      <div id="paPreview" class="scroll"></div>
      <div class="modal-actions"><span class="left muted" id="paSummary"></span><button type="button" class="btn" data-close>Vazgeç</button><button type="submit" class="btn btn-primary" id="paSubmit">Ekle</button></div>`, {
      size: 'wide',
      onSubmit: async (e, entry) => {
        const rows = M.parsePasted(entry.el.querySelector('#paText').value, library);
        const missing = entry.el.querySelector('#paMissing').value;
        const merge = entry.el.querySelector('#paMerge').checked;
        let sec = entry.el.querySelector('#paSection').value;
        const use = rows.filter((r) => r.component || (missing === 'free' && r.kod));
        if (!use.length) {
          U.toast('Eklenecek satır yok', 'error');
          return;
        }
        if (sec === '__new') {
          const name = await U.promptModal('Yeni bölüm', 'Bölüm adı', '', 'Oluştur');
          if (!name) return;
          sec = await addSection(name);
        }
        entry.close();
        let added = 0;
        let increased = 0;
        const newIds = [];
        mutate(`${use.length} satır yapıştırıldı`, (p) => {
          for (const r of use) {
            if (r.component && merge) {
              const existing = p.kalemler.find((l) => l.bolum === sec && l.komponentId === r.component.id);
              if (existing) {
                existing.miktar = M.round(existing.miktar + r.miktar, 6);
                increased += 1;
                newIds.push(existing.id);
                continue;
              }
            }
            const line = r.component ? M.lineFromComponent(r.component, r.miktar, sec) : M.freeLine(sec, { kod: r.kod, ad: r.ad || r.kod, miktar: r.miktar });
            insertLines(p, [line], sec);
            newIds.push(line.id);
            added += 1;
          }
        });
        E.activeSection = sec;
        setSelection(newIds);
        if (newIds[0]) reveal(newIds[0]);
        U.toast(`${added} kalem eklendi${increased ? `, ${increased} kalemin adedi arttı` : ''}`);
      }
    });
    const text = m.el.querySelector('#paText');
    const preview = () => {
      const rows = M.parsePasted(text.value, library);
      const missing = m.el.querySelector('#paMissing').value;
      const found = rows.filter((r) => r.component).length;
      const free = rows.length - found;
      m.el.querySelector('#paSummary').textContent = rows.length
        ? `${rows.length} satır · ${found} kütüphanede${free ? ` · ${free} ${missing === 'free' ? 'serbest kalem olacak' : 'atlanacak'}` : ''}`
        : '';
      m.el.querySelector('#paPreview').innerHTML = rows.length ? `<table class="mini-table"><thead><tr><th>Durum</th><th>Stok Kodu</th><th>Tanım</th><th class="num">Adet</th></tr></thead><tbody>${rows.slice(0, 300).map((r) => `<tr>
        <td>${r.component ? '<span class="ok-text">✓ kütüphanede</span>' : missing === 'free' ? '<span class="warn-text">serbest kalem</span>' : '<span class="muted">atlanacak</span>'}</td>
        <td><b>${esc(r.kod)}</b></td><td>${esc(r.ad)}</td><td class="num">${esc(M.formatQty(r.miktar))}</td></tr>`).join('')}</tbody></table>` : '<div class="dk-empty">Önizleme burada görünür</div>';
    };
    text.addEventListener('input', U.debounce(preview, 120));
    m.el.querySelector('#paMissing').addEventListener('change', preview);
    preview();
    setTimeout(() => text.focus(), 0);
  }

  function openFreeLineDialog() {
    const s = app().settings;
    U.modal(`
      <h2>Serbest kalem</h2>
      <p class="field-help">Kütüphanede olmayan kalem (işçilik, nakliye, özel parça). İsterseniz kütüphaneye de eklenir.</p>
      <div class="field-row"><div class="field"><label for="flKod">Stok kodu <span class="req">*</span></label><input id="flKod" class="field-input" autocomplete="off" placeholder="MONTAJ"></div>
      <div class="field"><label for="flBolum">Bölüm</label><select id="flBolum" class="field-input">${sectionOptions(activeSectionId())}</select></div></div>
      <div class="field"><label for="flAd">Tanım <span class="req">*</span></label><input id="flAd" class="field-input" autocomplete="off" placeholder="Montaj işçiliği"></div>
      <div class="field"><label for="flModel">Model kodu</label><input id="flModel" class="field-input" autocomplete="off"></div>
      <div class="field-row">
        <div class="field"><label for="flMiktar">Adet</label><input id="flMiktar" class="field-input" value="1"></div>
        <div class="field"><label for="flBirim">Birim</label><input id="flBirim" class="field-input" value="${esc(s.varsayilanBirim)}" list="flUnits"><datalist id="flUnits">${s.birimler.map((u) => `<option value="${esc(u)}">`).join('')}</datalist></div>
      </div>
      <div class="field"><label for="flAciklama">Açıklama</label><input id="flAciklama" class="field-input"></div>
      <label class="check-inline"><input type="checkbox" id="flLib"> Kütüphaneye de ekle</label>
      <div class="field-error" id="flError"></div>
      <div class="modal-actions"><button type="button" class="btn" data-close>Vazgeç</button><button type="submit" class="btn btn-primary">Ekle</button></div>`, {
      onSubmit: async (e, m) => {
        const v = (id) => m.el.querySelector(`#${id}`).value.trim();
        const fields = {
          kod: v('flKod'), ad: v('flAd'), ureticiKodu: v('flModel'), miktar: M.parseNumber(v('flMiktar')), birim: v('flBirim'), aciklama: v('flAciklama')
        };
        const err = (t) => { m.el.querySelector('#flError').textContent = t; };
        if (!fields.kod || !fields.ad) return err('Stok kodu ve tanım gerekli');
        if (!(fields.miktar > 0)) return err('Adet sıfırdan büyük olmalı');
        const sec = v('flBolum');
        if (m.el.querySelector('#flLib').checked) {
          const res = await app().saveComponents([{ kod: fields.kod, ad: fields.ad, ureticiKodu: fields.ureticiKodu, birim: fields.birim, aciklama: fields.aciklama }]);
          if (!res.ok) return err(res.errors.map((x) => x.errors.join(', ')).join(' · '));
          m.close();
          const id = addComponent(res.saved[0], fields.miktar, { sectionId: sec, merge: false });
          setSelection([id]);
          return undefined;
        }
        m.close();
        const ids = addLines([M.freeLine(sec, fields)], `${fields.kod} eklendi`, { sectionId: sec });
        setSelection(ids);
        return undefined;
      }
    });
  }

  /* ─── Klavye ──────────────────────────────────────────── */

  function handleKey(e) {
    if (!E.project) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    const typing = U.isTyping(e.target);
    if (ctrl && key === 's') {
      e.preventDefault();
      E.dirty = true;
      saveNow().then(() => U.toast(`Kaydedildi: BOM/projeler/${E.project ? E.project.id : ''}`));
      return;
    }
    if (ctrl && key === 'p') {
      e.preventDefault();
      BomxOutput.openStudio();
      return;
    }
    if (ctrl && key === 'f') {
      e.preventDefault();
      U.$('bomFilter').focus();
      U.$('bomFilter').select();
      return;
    }
    if (typing) return;
    // Odaktaki düğme ya da bağlantı Enter / boşlukla kendi işini yapar
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest && e.target.closest('button, a, [role=button]')) return;
    if (ctrl && key === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (ctrl && key === 'y') {
      e.preventDefault();
      redo();
      return;
    }
    if (ctrl && key === 'a') {
      e.preventDefault();
      setSelection(visibleLines().map((l) => l.id));
      return;
    }
    if (ctrl && key === 'c') {
      if (window.getSelection && String(window.getSelection())) return;
      e.preventDefault();
      copySelection();
      return;
    }
    if (ctrl && key === 'd') {
      e.preventDefault();
      if (E.selection.size) duplicateLines([...E.selection]);
      return;
    }
    if (e.key === '/' || (ctrl && key === 'k')) {
      e.preventDefault();
      BomxPanels.focusSearch();
      return;
    }
    if (e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault();
      const views = ['all', ...E.project.bolumler.map((s) => s.id)];
      const i = views.indexOf(E.view);
      setView(views[Math.max(0, Math.min(views.length - 1, i + (e.key === 'PageDown' ? 1 : -1)))]);
      return;
    }
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      nudgeSelection(e.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      moveCursor(e.key === 'ArrowUp' ? -1 : 1, e.shiftKey);
      return;
    }
    if (!E.selection.size) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      removeLines([...E.selection]);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = displayOrder().find((l) => E.selection.has(l.id));
      if (first) focusCell(first.id, 'miktar');
      return;
    }
    if (e.key === '+' || e.key === '=' || e.key === '-' || e.key === 'Subtract' || e.key === 'Add') {
      e.preventDefault();
      changeQty([...E.selection], e.key === '-' || e.key === 'Subtract' ? -1 : 1);
      return;
    }
    if (e.key === 'Escape') clearSelection();
  }

  /* ─── Bağlantılar ─────────────────────────────────────── */

  function init() {
    bindTable();
    U.$('btnUndo').addEventListener('click', undo);
    U.$('btnRedo').addEventListener('click', redo);
    U.$('btnDelete').addEventListener('click', () => removeLines([...E.selection]));
    U.$('btnDuplicate').addEventListener('click', () => duplicateLines([...E.selection]));
    U.$('btnMoveUp').addEventListener('click', () => nudgeSelection(-1));
    U.$('btnMoveDown').addEventListener('click', () => nudgeSelection(1));
    U.$('btnAddSection').addEventListener('click', () => addSection());
    U.$('btnFreeLine').addEventListener('click', openFreeLineDialog);
    U.$('btnPaste').addEventListener('click', () => openPasteDialog());
    U.$('btnSave').addEventListener('click', () => {
      E.dirty = true;
      saveNow().then(() => U.toast(`Kaydedildi: BOM/projeler/${E.project ? E.project.id : ''}`));
    });
    U.$('bomLang').addEventListener('click', (e) => {
      const b = e.target.closest('[data-lang]');
      if (b) setLanguage(b.dataset.lang);
    });
    U.$('btnCollapseAll').addEventListener('click', () => {
      if (!E.project) return;
      const all = E.project.bolumler.every((s) => E.collapsed.has(s.id));
      E.collapsed = all ? new Set() : new Set(E.project.bolumler.map((s) => s.id));
      render();
    });
    const filter = U.$('bomFilter');
    filter.addEventListener('input', U.debounce(() => {
      E.filter = filter.value;
      render();
    }, 90));
    filter.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        filter.value = '';
        E.filter = '';
        render();
        filter.blur();
        e.stopPropagation();
      }
    });
    document.addEventListener('paste', onPaste);
    // Uygulama sekmesinden çıkarken kayıt beklemez
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') saveNow();
    });
  }

  return {
    init,
    open,
    close,
    currentId: () => (E.project ? E.project.id : null),
    get project() { return E.project; },
    get selection() { return E.selection; },
    get activeSection() { return activeSectionId(); },
    get view() { return E.view; },
    hasUnsaved: () => !!(E.dirty || E.saving),
    saveNow,
    flush,
    remoteChanged,
    handleKey,
    handleDrop,
    commit,
    mutate,
    undo,
    redo,
    addComponent,
    setComponentQty,
    addLines,
    updateLine,
    updateLines,
    removeLines,
    duplicateLines,
    moveLines,
    changeQty,
    refreshFromLibrary,
    relinkLines,
    mergeDuplicates,
    removeZero,
    addLineToLibrary,
    addSection,
    renameSection,
    moveSection,
    deleteSection,
    setActiveSection,
    setView,
    setMeta,
    setLanguage,
    bumpRevision,
    dropRevision,
    renameProject,
    select,
    setSelection,
    clearSelection,
    reveal,
    render,
    displayOrder,
    lineById,
    sectionById,
    openPasteDialog,
    openFreeLineDialog,
    copySelection,
    DRAG_COMPONENT,
    DRAG_LINES
  };
})();
