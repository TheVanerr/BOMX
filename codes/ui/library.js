/* Komponent kütüphanesi: ana ekrandaki Komponentler sekmesi (tablo, tabloda düzenleme, yan form, toplu düzenleme,
   geri al / yinele), içe aktarma ve dışa aktarma, düzenleyiciden açılan komponent formu.

   İçe aktarma: CSV, Excel, JSON, P&PX kod listesi, HTML raporları (ürün ağacı, kritik parça, sarf listesi)
   ve HTML tabloları. Her kaynak önce önizlemeye gelir: satırlar hücre hücre düzenlenir, istenmeyenler
   çıkarılır, sonra kütüphaneye yazılır. */

const BomxLibrary = (() => {
  const M = BomxModel;
  const R = BomxReports;
  const U = BomxUi;
  const { esc } = U;
  const app = () => BomxApp;

  const S = {
    query: '', category: '', filter: 'all', sort: U.pref('kutuphaneSira', { key: 'kod', desc: false }),
    checked: new Set(), openId: null, draft: null, drawerOpen: false, edit: !!U.pref('kutuphaneDuzen', false)
  };
  /** Kütüphane değişikliklerinin geçmişi: her kayıtta önceki ve sonraki hâller (eklenen için önce, silinen için sonra yok) */
  const H = { undo: [], redo: [] };
  const HISTORY_MAX = 60;
  let grid = null;

  const LABELS = Object.fromEntries(M.COMPONENT_FIELDS.map((f) => [f.key, f.label]));
  const firstLine = (t) => String(t || '').split('\n')[0];
  const distinct = (k) => [...new Set(app().state.library.map((c) => c[k]).filter(Boolean))].sort(M.compareText);
  const categories = () => [...new Set([...app().state.settings.kategoriler, ...distinct('kategori')])];

  /* ─── Son aktarma ─────────────────────────────────────── */

  function lastImport() {
    const v = U.pref('sonAktarma', null);
    return v && Array.isArray(v.ids) && v.ids.length ? v : null;
  }

  function rememberImport(ids) {
    U.setPref('sonAktarma', { at: M.nowIso(), ids });
  }

  /* ─── Geçmiş (geri al / yinele) ───────────────────────── */

  function pushHistory(label, pairs) {
    if (!pairs.length) return null;
    const entry = { label, pairs };
    H.undo.push(entry);
    if (H.undo.length > HISTORY_MAX) H.undo.shift();
    H.redo = [];
    renderHistory();
    return entry;
  }

  /** Kaydeder ve geçmişe yazar. @param before kaydedilenlerin önceki hâlleri (yeni kayıt için yok). res.entry geçmiş kaydıdır */
  async function saveTracked(label, before, list, options) {
    const res = await app().saveComponents(list, options);
    res.entry = null;
    if (res.saved.length) {
      const prev = new Map(before.filter(Boolean).map((c) => [c.id, c]));
      res.entry = pushHistory(label, res.saved.map((c) => ({ id: c.id, before: prev.get(c.id) || null, after: c })));
    }
    return res;
  }

  /** Silinen komponentin fotoğrafı da geçmişe girer: geri alınca fotoğrafıyla gelir. @returns { n, entry } */
  async function deleteTracked(label, list) {
    const photos = new Map(list.map((c) => [c.id, app().photoOf(c.id)]));
    const n = await app().deleteComponents(list.map((c) => c.id));
    const entry = pushHistory(label, list.map((c) => Object.assign({ id: c.id, before: c, after: null },
      photos.get(c.id) ? { fotoBefore: photos.get(c.id), fotoAfter: '' } : {})));
    return { n, entry };
  }

  /**
   * Fotoğraf değişikliğini yazar ve geçmiş kaydına ekler (kayıt yoksa yeni kayıt açar).
   * @param changes [{ id, veri }] veri boşsa fotoğraf silinir
   */
  async function savePhotosTracked(label, changes, entry) {
    const list = changes.filter((p) => p && p.id && (p.veri || '') !== app().photoOf(p.id));
    if (!list.length) return entry || null;
    const before = new Map(list.map((p) => [p.id, app().photoOf(p.id)]));
    await app().savePhotos(list);
    let target = entry;
    if (!target) {
      const lib = app().state.libraryById;
      target = pushHistory(label, list.map((p) => ({ id: p.id, before: lib.get(p.id) || null, after: lib.get(p.id) || null })));
    }
    for (const p of list) {
      let pair = target.pairs.find((x) => x.id === p.id);
      if (!pair) {
        const c = app().state.libraryById.get(p.id) || null;
        pair = { id: p.id, before: c, after: c };
        target.pairs.push(pair);
      }
      if (!('fotoBefore' in pair)) pair.fotoBefore = before.get(p.id) || '';
      pair.fotoAfter = p.veri || '';
    }
    renderHistory();
    return target;
  }

  /** Bildirimdeki "Geri al": en son işlemi değil, bildirimin kendi işlemini geri alır */
  const undoButton = (entry) => (entry ? { action: { label: 'Geri al', run: () => undoEntry(entry) } } : {});

  /** side 'before' geri alır, 'after' yineler: eklenen silinir, silinen ve değişen eski hâliyle (fotoğrafıyla) yeniden yazılır */
  async function applySide(entry, side) {
    const lib = app().state.libraryById;
    const save = entry.pairs.filter((p) => p[side]).map((p) => Object.assign({}, p[side]));
    const remove = entry.pairs.filter((p) => !p[side] && lib.has(p.id)).map((p) => p.id);
    if (remove.length) await app().deleteComponents(remove);
    if (save.length) {
      const res = await app().saveComponents(save, { skipInvalid: true });
      if (res.errors.length) U.toast(`${res.errors.length} kayıt geri yazılamadı: ${res.errors.slice(0, 2).map((x) => `${x.kod} ${x.errors[0]}`).join('; ')}`, 'warn', { ms: 8000 });
    }
    const photos = entry.pairs.filter((p) => 'fotoAfter' in p && p[side]).map((p) => ({ id: p.id, veri: side === 'before' ? p.fotoBefore : p.fotoAfter }));
    if (photos.length) await app().savePhotos(photos);
  }

  let historyBusy = false;

  function undo() {
    const entry = H.undo[H.undo.length - 1];
    if (!entry) {
      U.toast('Geri alınacak kütüphane değişikliği yok', 'warn');
      return Promise.resolve();
    }
    return undoEntry(entry);
  }

  /**
   * Belirli bir işlemi geri alır. Sonraki işlemler başka kayıtlara dokunduysa sırası beklenmez;
   * aynı kayda sonradan dokunulduysa eski hâli yeni değişikliği silmesin diye geri alınmaz.
   */
  async function undoEntry(entry) {
    const i = H.undo.indexOf(entry);
    if (i < 0) {
      U.toast('Bu değişiklik zaten geri alınmış', 'warn');
      return;
    }
    const ids = new Set(entry.pairs.map((p) => p.id));
    if (H.undo.slice(i + 1).some((e) => e.pairs.some((p) => ids.has(p.id)))) {
      U.toast(`"${entry.label}" kayıtları sonra yeniden değişti; Ctrl+Z ile sırayla geri alın`, 'warn', { ms: 8000 });
      return;
    }
    if (historyBusy) return;
    historyBusy = true;
    try {
      H.undo.splice(i, 1);
      await applySide(entry, 'before');
      H.redo.push(entry);
      U.toast(`Geri alındı: ${entry.label}`, '', { action: { label: 'Yinele', run: redo } });
    } finally {
      historyBusy = false;
      renderHistory();
    }
  }

  async function redo() {
    const entry = H.redo[H.redo.length - 1];
    if (!entry || historyBusy) return;
    historyBusy = true;
    try {
      H.redo.pop();
      await applySide(entry, 'after');
      H.undo.push(entry);
      U.toast(`Yinelendi: ${entry.label}`);
    } finally {
      historyBusy = false;
      renderHistory();
    }
  }

  function renderHistory() {
    const u = U.$('libUndo');
    const r = U.$('libRedo');
    if (!u || !r) return;
    const last = H.undo[H.undo.length - 1];
    const next = H.redo[H.redo.length - 1];
    u.disabled = !last;
    r.disabled = !next;
    u.title = last ? `Geri al: ${last.label} (Ctrl+Z)` : 'Geri alınacak değişiklik yok';
    r.title = next ? `Yinele: ${next.label} (Ctrl+Y)` : 'Yinelenecek değişiklik yok';
  }

  /* ─── Liste ───────────────────────────────────────────── */

  function filtered() {
    const st = app().state;
    let list = S.query ? M.searchComponents(st.library, S.query, st.libraryIndex) : st.library.slice();
    if (S.category) list = list.filter((c) => (c.kategori || '') === (S.category === '__none' ? '' : S.category));
    if (S.filter === 'fav') list = list.filter((c) => c.favori);
    else if (S.filter === 'unused') list = list.filter((c) => !st.usage.get(c.id));
    else if (S.filter === 'pasif') list = list.filter((c) => c.pasif);
    else if (S.filter === 'aktif') list = list.filter((c) => !c.pasif);
    else if (S.filter === 'last') {
      const last = lastImport();
      const ids = new Set(last ? last.ids : []);
      list = list.filter((c) => ids.has(c.id));
    }
    if (!S.query || S.sort.key !== 'kod') {
      const k = S.sort.key;
      const dir = S.sort.desc ? -1 : 1;
      const value = (c) => (k === 'kullanim' ? st.usage.get(c.id) || 0 : c[k] || '');
      list.sort((a, b) => {
        const va = value(a);
        const vb = value(b);
        const r = typeof va === 'number' && typeof vb === 'number' ? va - vb : M.compareText(va, vb);
        return r * dir || M.compareComponents(a, b);
      });
    }
    return list;
  }

  function columns() {
    const st = app().state;
    const hl = (v) => U.highlight(v || '', S.query);
    return [
      { key: 'fav', width: '26px', label: '★', cell: (c) => `<button type="button" class="star${c.favori ? ' on' : ''}" data-act="fav" title="Favori">★</button>` },
      {
        key: 'foto', width: '44px', label: 'Foto', className: 'c-foto', headTitle: 'Fotoğraf: tıklayınca büyür; eklemek için formu açın',
        cell: (c) => { const p = app().photoOf(c.id); return p ? `<img class="gt-thumb" src="${esc(p)}" alt="" loading="lazy" data-act="foto">` : ''; }
      },
      { key: 'kod', width: '130px', label: 'Stok Kodu', sort: true, editable: true, className: 'c-kod', cell: (c) => hl(c.kod), title: (c) => c.kod },
      { key: 'ad', width: 'minmax(240px, 2fr)', label: 'Tanım', sort: true, editable: true, cell: (c) => `${hl(c.ad)}${c.pasif ? ' <span class="chip gray">pasif</span>' : ''}`, value: (c) => c.ad, title: (c) => c.ad },
      { key: 'kategori', width: '130px', label: 'Kategori', sort: true, editable: true, className: 'c-muted', list: categories },
      { key: 'uretici', width: '120px', label: 'Üretici', sort: true, editable: true, list: () => distinct('uretici'), cell: (c) => hl(c.uretici) },
      { key: 'ureticiKodu', width: '170px', label: 'Model Kodu', sort: true, editable: true, cell: (c) => hl(c.ureticiKodu), title: (c) => c.ureticiKodu },
      { key: 'tedarikci', width: '130px', label: 'Tedarikçi', sort: true, editable: true, list: () => distinct('tedarikci'), cell: (c) => hl(c.tedarikci) },
      { key: 'birim', width: '62px', label: 'Birim', editable: true, className: 'c-muted', list: () => st.settings.birimler },
      S.edit ? { key: 'aciklama', width: 'minmax(200px, 1.5fr)', label: 'Açıklama', editable: true, kind: 'multiline', className: 'c-muted', cell: (c) => esc(firstLine(c.aciklama)), value: (c) => c.aciklama || '', title: (c) => c.aciklama || '' } : null,
      { key: 'kullanim', width: '78px', label: 'Kullanım', sort: true, align: 'right', className: 'c-muted', cell: (c) => { const used = st.usage.get(c.id) || 0; return used ? `${used} proje` : ''; } },
      { key: 'zaman', width: '110px', label: 'Güncelleme', sort: true, className: 'c-muted', cell: (c) => esc(U.relTime(c.zaman)), title: (c) => c.zaman }
    ].filter(Boolean);
  }

  function emptyHtml() {
    const st = app().state;
    if (st.library.length) return 'Filtreye uyan komponent yok.';
    return `<strong style="color:var(--text);font-size:14px">Kütüphane boş</strong><br>
      Genel komponent listenizi buraya kurun: <b>+ Yeni komponent</b> ile tek tek ekleyin ya da elinizdeki listeyi <b>İçe aktar</b> ile alın.<br>
      Dosyayı bu sayfaya sürükleyip bırakabilirsiniz: fotoğraflı komponent paketi (JSON), CSV, Excel, ERP ürün ağacı (Excel), ürün ağacı / kritik parça / sarf listesi HTML raporları.<br>
      <button type="button" class="btn btn-sm btn-primary" data-act="file" style="margin-top:12px">Dosya seç: paket (JSON), CSV, Excel…</button>
      <button type="button" class="btn btn-sm" data-act="html" style="margin-top:12px">HTML raporlarından al (ürün ağacı…)</button>
      ${st.ppx && st.ppx.codes.length ? `<button type="button" class="btn btn-sm" data-act="ppx" style="margin-top:12px">P&amp;PX kod listesini al (${st.ppx.codes.length} kod)</button>` : ''}
      <button type="button" class="btn btn-sm" data-act="template" style="margin-top:12px">Boş CSV şablonu indir</button>`;
  }

  function renderChips() {
    const st = app().state;
    const counts = M.categoryCounts(st.library, st.settings);
    U.$('libChips').innerHTML = `<button type="button" class="chip-filter${!S.category ? ' active' : ''}" data-cat="">Tümü <span>${st.library.length}</span></button>` +
      counts.map(([k, n]) => `<button type="button" class="chip-filter${S.category === (k || '__none') ? ' active' : ''}" data-cat="${esc(k || '__none')}">${esc(k || 'Kategorisiz')} <span>${n}</span></button>`).join('');
  }

  function renderFilterOptions() {
    const opt = U.$('libFilterLast');
    const last = lastImport();
    const lib = app().state.libraryById;
    const n = last ? last.ids.filter((id) => lib.has(id)).length : 0;
    opt.hidden = !n;
    opt.textContent = n ? `Son aktarılanlar (${n} · ${U.relTime(last.at)})` : 'Son aktarılanlar';
    if (!n && S.filter === 'last') S.filter = 'all';
    U.$('libFilter').value = S.filter;
  }

  function render() {
    const st = app().state;
    renderChips();
    renderFilterOptions();
    renderHistory();
    const toggle = U.$('libEdit');
    toggle.classList.toggle('on', S.edit);
    toggle.setAttribute('aria-pressed', String(S.edit));
    grid.render();
    const list = filtered();
    const count = list.length === st.library.length ? `${st.library.length} komponent` : `${list.length} / ${st.library.length} komponent`;
    U.$('libResult').textContent = st.library.length ? `${count} · ${S.edit ? 'hücreye tıklayıp yazın; Enter alta, Tab sağa geçer, Esc vazgeçer' : 'düzenlemek için hücreye çift tıklayın'}` : '';
    renderBulk();
  }

  function renderBulk() {
    const box = U.$('libBulk');
    const n = S.checked.size;
    box.classList.toggle('hidden', !n);
    if (!n) return;
    box.innerHTML = `<strong>${n} seçili</strong>
      <button type="button" class="btn btn-xs" data-bulk="kategori">Kategori</button>
      <button type="button" class="btn btn-xs" data-bulk="uretici">Üretici</button>
      <button type="button" class="btn btn-xs" data-bulk="tedarikci">Tedarikçi</button>
      <button type="button" class="btn btn-xs" data-bulk="birim">Birim</button>
      <button type="button" class="btn btn-xs" data-bulk="fav">Favori</button>
      <button type="button" class="btn btn-xs" data-bulk="pasif">Pasif / aktif</button>
      <button type="button" class="btn btn-xs btn-danger" data-bulk="sil" title="Delete">Sil</button>
      <span class="tb-spacer"></span>
      <span class="muted">Shift ile aralık seçilir · Delete siler · Ctrl+Z geri alır</span>
      <button type="button" class="btn btn-xs btn-ghost" data-bulk="clear">Seçimi temizle</button>`;
  }

  const checkedList = () => [...S.checked].map((id) => app().state.libraryById.get(id)).filter(Boolean);

  async function bulk(action) {
    const st = app().state;
    const list = checkedList();
    if (!list.length) return;
    const n = list.length;
    const setField = async (field, title, label, values) => {
      const v = await U.promptModal(title, label, '', 'Uygula', { list: values, required: false, help: 'Boş bırakırsanız alan temizlenir.' });
      if (v === null) return;
      const res = await saveTracked(`${n} komponentte ${LABELS[field] || field}`, list, list.map((c) => Object.assign({}, c, { [field]: v })));
      U.toast(res.ok ? `${n} komponent güncellendi` : res.errors[0].errors.join(', '), res.ok ? '' : 'error', res.ok ? undoButton(res.entry) : undefined);
    };
    switch (action) {
      case 'kategori': await setField('kategori', 'Kategori ata', 'Kategori', categories()); break;
      case 'uretici': await setField('uretici', 'Üretici ata', 'Üretici / marka', distinct('uretici')); break;
      case 'tedarikci': await setField('tedarikci', 'Tedarikçi ata', 'Tedarikçi', distinct('tedarikci')); break;
      case 'birim': await setField('birim', 'Birim ata', 'Birim', st.settings.birimler); break;
      case 'fav': {
        const on = !list.every((c) => c.favori);
        await saveTracked(on ? `${n} komponent favorilere` : `${n} komponent favorilerden`, list, list.map((c) => Object.assign({}, c, { favori: on })));
        U.toast(on ? 'Favorilere eklendi' : 'Favorilerden çıkarıldı');
        break;
      }
      case 'pasif': {
        const on = !list.every((c) => c.pasif);
        const res = await saveTracked(on ? `${n} komponent pasif` : `${n} komponent aktif`, list, list.map((c) => Object.assign({}, c, { pasif: on })));
        U.toast(on ? `${n} komponent pasif: listelerde gizlenir, kullanıldığı projelerde uyarı verir` : `${n} komponent yeniden aktif`, '', undoButton(res.entry));
        break;
      }
      case 'sil': await deleteDialog(list); break;
      case 'clear': S.checked.clear(); render(); break;
      default: break;
    }
  }

  /** Silmek yerine pasif yapmak önerilir: kullanılan komponentin bağlantısı korunur */
  // GitHub'daki gibi: yanlışlıkla silmemek için onay metni yazılır (büyük/küçük harf, boşluk ve Türkçe işaret fark etmez)
  const DELETE_PHRASE = 'TheVanerr/EMİNİM';
  const isDeletePhrase = (text) => M.fold(String(text || '').replace(/\s+/g, '')) === M.fold(DELETE_PHRASE);

  function deleteDialog(list) {
    return new Promise((resolve) => {
      const used = list.filter((c) => app().state.usage.get(c.id));
      const projects = new Set(used.flatMap((c) => app().usageOf(c.id).map((p) => p.id)));
      const shown = list.slice(0, 8);
      const m = U.modal(`
        <h2>${list.length === 1 ? `${esc(list[0].kod)} silinsin mi?` : `${list.length} komponent silinsin mi?`}</h2>
        <ul class="dd-list">${shown.map((c) => `<li><b>${esc(c.kod)}</b> ${esc(c.ad)}</li>`).join('')}${list.length > shown.length ? `<li class="muted">ve ${list.length - shown.length} komponent daha</li>` : ''}</ul>
        <div class="field"><label for="ddConfirm">Silmek için <b>${esc(DELETE_PHRASE)}</b> yazın</label>
          <input id="ddConfirm" class="field-input" autocomplete="off" spellcheck="false" placeholder="${esc(DELETE_PHRASE)}"></div>
        ${used.length ? `<p class="field-help warn">${used.length} komponent ${projects.size} projede kullanılıyor. Silinirse o projelerdeki kalemler bilgileriyle durur, ama kütüphane bağlantısı kopar (Kontrol'de “silinmiş” görünür). Kullanımdan kalktıysa <b>Pasif yap</b> daha uygundur.</p>` : `<p class="field-help">${list.length === 1 ? 'Komponent' : 'Komponentler'} hiçbir projede kullanılmıyor.</p>`}
        <p class="field-help">Hemen sonra <b>Geri al</b> (Ctrl+Z) ile ya da GitHub geçmişinden geri alınabilir.</p>
        <div class="modal-actions">
          <button type="button" class="btn" data-close>Vazgeç</button>
          <button type="button" class="btn" id="ddPassive">Pasif yap</button>
          <button type="submit" class="btn btn-danger" id="ddDelete" disabled>${list.length === 1 ? 'Sil' : `${list.length} komponenti sil`}</button>
        </div>`, {
        onSubmit: async (e, m) => {
          // Enter da yalnız onay metni doğruysa siler
          if (!isDeletePhrase(m.el.querySelector('#ddConfirm').value)) {
            m.el.querySelector('#ddConfirm').focus();
            return;
          }
          m.close();
          const { n, entry } = await deleteTracked(list.length === 1 ? `${list[0].kod} silindi` : `${list.length} komponent silindi`, list);
          list.forEach((c) => S.checked.delete(c.id));
          if (list.some((c) => c.id === S.openId)) closeDrawer();
          U.toast(`${n} komponent silindi`, '', Object.assign({ ms: 8000 }, undoButton(entry)));
          resolve(true);
        },
        onCancel: () => resolve(false)
      });
      const input = m.el.querySelector('#ddConfirm');
      input.addEventListener('input', () => { m.el.querySelector('#ddDelete').disabled = !isDeletePhrase(input.value); });
      setTimeout(() => input.focus(), 0);
      m.el.querySelector('#ddPassive').addEventListener('click', async () => {
        U.topModal().close();
        const res = await saveTracked(`${list.length} komponent pasif`, list, list.map((c) => Object.assign({}, c, { pasif: true })));
        U.toast(`${list.length} komponent pasif yapıldı`, '', undoButton(res.entry));
        resolve(true);
      });
    });
  }

  /* ─── Tabloda düzenleme ───────────────────────────────── */

  /** Hücre kaydı. @returns hata metni ya da boş */
  async function commitCell(c, key, text) {
    const fresh = app().state.libraryById.get(c.id);
    if (!fresh) return 'Komponent bu arada silinmiş';
    let value = text;
    if (key === 'aciklama') {
      value = M.cleanMultiline(text);
    } else {
      value = M.clean(text);
      if ((key === 'kod' || key === 'ad') && !value) return `${LABELS[key]} boş bırakılamaz`;
      if (key === 'birim' && !value) value = app().state.settings.varsayilanBirim;
    }
    const next = M.normalizeComponent(Object.assign({}, fresh, { [key]: value }));
    if (M.sameValue(next[key], fresh[key])) return '';
    const errors = M.validateComponent(next, app().state.library);
    if (errors.length) return errors.join(' · ');
    const res = await saveTracked(`${fresh.kod}: ${LABELS[key] || key}`, [fresh], [next]);
    return res.ok ? '' : res.errors.map((x) => x.errors.join(', ')).join(' · ');
  }

  async function toggleFav(c) {
    await saveTracked(`${c.kod} favori`, [c], [Object.assign({}, c, { favori: !c.favori })]);
  }

  function setEditMode(on) {
    S.edit = on;
    U.setPref('kutuphaneDuzen', on);
    if (on && S.drawerOpen) closeDrawer();
    else render();
  }

  function rowMenu(c, e) {
    U.contextMenu(e.clientX, e.clientY, [
      { title: `${c.kod} · ${c.ad}` },
      { label: 'Formda düzenle', run: () => openDrawer(c, false) },
      { label: 'Çoğalt', run: () => openDrawer(Object.assign({}, c, { id: '', kod: `${c.kod}-2`, olusturma: '', zaman: '', fotoKaynakId: c.id }), true) },
      { label: c.favori ? 'Favorilerden çıkar' : 'Favorilere ekle', run: () => toggleFav(c) },
      { label: c.pasif ? 'Aktif yap' : 'Pasif yap', run: () => saveTracked(`${c.kod} ${c.pasif ? 'aktif' : 'pasif'}`, [c], [Object.assign({}, c, { pasif: !c.pasif })]) },
      '-',
      { label: S.checked.size > 1 && S.checked.has(c.id) ? `Seçili ${S.checked.size} komponenti sil` : 'Sil', danger: true, run: () => deleteDialog(S.checked.size > 1 && S.checked.has(c.id) ? checkedList() : [c]) }
    ]);
  }

  /* ─── Form ────────────────────────────────────────────── */

  function formHtml(c, prefix) {
    const st = app().state;
    const cats = categories();
    const id = (k) => `${prefix}${k}`;
    const input = (k, label, opts) => {
      const o = opts || {};
      return `<div class="field"><label for="${id(k)}">${esc(label)}${o.req ? ' <span class="req">*</span>' : ''}</label><input id="${id(k)}" class="field-input" value="${esc(c[k] == null ? '' : o.num ? (M.isNum(c[k]) ? String(c[k]) : '') : c[k])}"${o.list ? ` list="${id(`${k}List`)}"` : ''}${o.ph ? ` placeholder="${esc(o.ph)}"` : ''} autocomplete="off" spellcheck="false">${o.list ? `<datalist id="${id(`${k}List`)}">${o.list.map((v) => `<option value="${esc(v)}">`).join('')}</datalist>` : ''}</div>`;
    };
    return `
      <div class="photo-field" id="${id('photo')}"></div>
      <div class="field-row">${input('kod', 'Stok kodu', { req: true, ph: '10 00243…' })}${input('kategori', 'Kategori', { list: cats })}</div>
      ${input('ad', 'Tanım (bizim sistemdeki)', { req: true, ph: 'POMPA GOULDS ESHE 32-160/22 380V/50HZ' })}
      <div class="field-row">${input('uretici', 'Üretici / marka', { list: distinct('uretici') })}${input('ureticiKodu', 'Model kodu (üreticinin tam kodu)')}</div>
      <div class="field-row">${input('tedarikci', 'Tedarikçi', { list: distinct('tedarikci') })}${input('tedarikciKodu', 'Tedarikçi kodu')}</div>
      <div class="field-row">${input('birim', 'Birim', { list: st.settings.birimler })}${input('teslimSuresi', 'Teslim süresi (gün)', { num: true })}</div>
      ${input('link', 'Bağlantı', { ph: 'https://… (katalog, ürün sayfası)' })}
      <div class="field"><label for="${id('aciklama')}">Açıklama / teknik özellik</label><textarea id="${id('aciklama')}" class="field-input" rows="4" placeholder="Güç, gerilim, malzeme, bağlantı ölçüsü…">${esc(c.aciklama || '')}</textarea></div>
      <div class="field"><label for="${id('aciklamaEn')}">Açıklama (EN)</label><textarea id="${id('aciklamaEn')}" class="field-input" rows="2" placeholder="İngilizce belgede görünür; boşsa Türkçesi yazar">${esc(c.aciklamaEn || '')}</textarea></div>
      <div class="field"><label for="${id('aciklamaDe')}">Açıklama (DE)</label><textarea id="${id('aciklamaDe')}" class="field-input" rows="2" placeholder="Almanca belgede görünür; boşsa Türkçesi yazar">${esc(c.aciklamaDe || '')}</textarea></div>
      <div class="field-row">
        <label class="check-inline"><input type="checkbox" id="${id('favori')}" ${c.favori ? 'checked' : ''}> Favori (listelerde üstte)</label>
        <label class="check-inline"><input type="checkbox" id="${id('pasif')}" ${c.pasif ? 'checked' : ''}> Pasif (kullanımdan kalktı)</label>
      </div>
      <div class="field-error" id="${id('error')}"></div>`;
  }

  function readForm(root, prefix, base) {
    const v = (k) => {
      const el = root.querySelector(`#${prefix}${k}`);
      return el ? (el.type === 'checkbox' ? el.checked : el.value) : undefined;
    };
    const lead = v('teslimSuresi').trim();
    return {
      component: M.normalizeComponent(Object.assign({}, base, {
        kod: v('kod'), ad: v('ad'), kategori: v('kategori'), uretici: v('uretici'), ureticiKodu: v('ureticiKodu'),
        tedarikci: v('tedarikci'), tedarikciKodu: v('tedarikciKodu'), birim: v('birim') || app().settings.varsayilanBirim,
        teslimSuresi: lead === '' ? null : M.parseNumber(lead),
        aciklama: v('aciklama'), aciklamaEn: v('aciklamaEn'), aciklamaDe: v('aciklamaDe'), link: v('link'), favori: v('favori'), pasif: v('pasif')
      })),
      problems: [
        lead !== '' && (M.parseNumber(lead) === null || M.parseNumber(lead) < 0) ? 'Teslim süresi gün sayısı olmalı' : ''
      ].filter(Boolean)
    };
  }

  /**
   * Formdaki fotoğraf alanı: dosya seç, yapıştır (Ctrl+V), sürükle-bırak, büyüt, kaldır. Fotoğraf formla birlikte kaydedilir.
   * @returns { value() data URL ya da '', changed() }
   */
  function photoField(root, prefix, initial, caption) {
    const box = root.querySelector(`#${prefix}photo`);
    let value = initial || '';
    const draw = () => {
      box.innerHTML = `<div class="pf-img${value ? '' : ' empty'}" data-photo="${value ? 'view' : 'pick'}" title="${value ? 'Büyüt' : 'Fotoğraf seç'}">${value ? `<img src="${esc(value)}" alt="">` : '<span>Fotoğraf yok</span>'}</div>
        <div class="pf-side"><div class="pf-actions"><button type="button" class="btn btn-xs" data-photo="pick">${value ? 'Değiştir…' : 'Fotoğraf seç…'}</button>${value ? '<button type="button" class="btn btn-xs btn-ghost" data-photo="remove">Kaldır</button>' : ''}</div>
        <small class="muted">Görseli kopyalayıp form açıkken Ctrl+V ile yapıştırabilir ya da dosyayı buraya sürükleyebilirsiniz. Kenarı 420 px'e küçültülür.</small></div>`;
    };
    const set = async (file) => {
      if (!file) return;
      try {
        value = await U.shrinkImage(file);
        draw();
      } catch (e) {
        U.toast(e.message, 'error');
      }
    };
    box.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-photo]');
      if (!b) return;
      if (b.dataset.photo === 'pick') set(await U.pickFile('image/*'));
      else if (b.dataset.photo === 'remove') {
        value = '';
        draw();
      } else if (b.dataset.photo === 'view' && value) U.lightbox(value, caption || '');
    });
    const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    box.addEventListener('dragover', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      box.classList.add('drop');
    });
    box.addEventListener('dragleave', () => box.classList.remove('drop'));
    box.addEventListener('drop', (e) => {
      box.classList.remove('drop');
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const f = U.imageFrom(e.dataTransfer);
      if (f) set(f);
      else U.toast('Bırakılan dosya görsel değil', 'error');
    });
    // Ctrl+V: odak formdaysa ya da hiçbir yerde değilse (fotoğraf alanına tıklanınca odak gövdeye düşer) görsel bu alana gelir.
    // Dinleyici belgededir; alan ekrandan kalkınca kendini kaldırır (yan form her açılışta yeniden kurulur, birikmez).
    const onPaste = (e) => {
      if (!box.isConnected) {
        document.removeEventListener('paste', onPaste);
        return;
      }
      const t = e.target;
      if (!(root.contains(t) || t === document.body || t === document.documentElement)) return;
      const top = U.topModal();
      if (top && !top.el.contains(box)) return;
      const f = U.imageFrom(e.clipboardData);
      if (!f) return;
      e.preventDefault();
      set(f);
    };
    document.addEventListener('paste', onPaste);
    draw();
    return { value: () => value, changed: () => value !== (initial || '') };
  }

  /** Formun ekranda gösterdiği değerler (açılış anı); kaydederken yalnız değiştirilen alanlar yazılır */
  const formValues = (root, prefix, base) => readForm(root, prefix, base).component;
  const formFieldKeys = M.COMPONENT_FIELDS.map((f) => f.key);

  /**
   * Formu kaydeder. Var olan komponentte yalnız formda değiştirilen alanlar güncel kaydın üstüne yazılır:
   * form açıkken tabloda, yıldızla, toplu işlemle ya da başka cihazdan gelen değişiklik eski değerle ezilmez.
   * @param initial formun açılıştaki değerleri (yeni kayıtta yok)
   * @returns { saved, entry } ya da hata varsa null
   */
  async function submitForm(root, prefix, base, initial, photo) {
    const { component, problems } = readForm(root, prefix, base);
    const errEl = root.querySelector(`#${prefix}error`);
    const current = base && base.id ? app().state.libraryById.get(base.id) : null;
    let next = component;
    if (current && initial) {
      next = Object.assign({}, current);
      for (const k of formFieldKeys) if (!M.sameValue(component[k], initial[k])) next[k] = component[k];
      next = M.normalizeComponent(next);
    }
    const errors = problems.concat(M.validateComponent(next, app().state.library));
    if (errors.length) {
      errEl.textContent = errors.join(' · ');
      return null;
    }
    const res = await saveTracked(current ? `${next.kod} düzenlendi` : `${next.kod} eklendi`, [current], [next]);
    if (!res.ok) {
      errEl.textContent = res.errors.map((e) => e.errors.join(', ')).join(' · ');
      return null;
    }
    const saved = res.saved[0];
    // Fotoğraf komponentle aynı geçmiş kaydına girer: geri alınca ikisi birlikte döner
    const entry = photo && photo.changed() ? await savePhotosTracked(`${saved.kod} fotoğrafı`, [{ id: saved.id, veri: photo.value() }], res.entry) : res.entry;
    return { saved, entry };
  }

  function usageHtml(c) {
    const usage = c.id ? app().usageOf(c.id) : [];
    if (!usage.length) return '<p class="field-help">Henüz bir projede kullanılmıyor.</p>';
    return `<div class="field-label">Kullanıldığı projeler (${usage.length})</div><div class="usage-list">${usage.map((u) => `<button type="button" class="usage-item" data-open="${esc(u.id)}"><span>${esc(u.id)}</span><span>${esc(U.relTime(u.guncelleme))}</span></button>`).join('')}</div>`;
  }

  /** Yan formda kaydedilmemiş değişiklik var mı */
  function drawerDirty() {
    const box = U.$('libDrawer');
    if (!S.drawerOpen || !S.formInitial || !box.querySelector('#ldkod')) return false;
    const now = formValues(box, 'ld', S.draft || {});
    return formFieldKeys.some((k) => !M.sameValue(now[k], S.formInitial[k])) || !!(S.formPhoto && S.formPhoto.changed());
  }

  /**
   * Kütüphane sayfasındaki yan form.
   * @param options.refresh başka yerden gelen değişiklikle tazeleme: odak ve kaydırma yerinde kalır
   */
  function openDrawer(c, isNew, options) {
    const refresh = !!(options && options.refresh);
    S.openId = isNew ? null : c.id;
    S.draft = c;
    S.drawerOpen = true;
    const box = U.$('libDrawer');
    const body = box.querySelector('.drawer-body');
    const scroll = refresh && body ? body.scrollTop : 0;
    box.innerHTML = `
      <div class="drawer-head"><h2>${isNew ? 'Yeni komponent' : `${esc(c.kod)}`}</h2><button type="button" class="icon-btn sm" id="ldClose" title="Kapat (Esc)">×</button></div>
      <form class="drawer-body" id="ldForm" novalidate>${formHtml(c, 'ld')}
        ${isNew ? '' : `<div class="insp-section">Kullanım</div>${usageHtml(c)}<p class="field-help muted">Son değişiklik: ${esc(U.relTime(c.zaman) || '—')} · oluşturma: ${esc(U.formatDate(c.olusturma))}</p>`}
      </form>
      <div class="drawer-foot">
        ${isNew ? '' : '<div class="left"><button type="button" class="btn btn-sm" id="ldDup">Çoğalt</button><button type="button" class="btn btn-sm btn-danger" id="ldDel">Sil</button></div>'}
        <button type="button" class="btn btn-sm" id="ldCancel">Vazgeç</button>
        <button type="button" class="btn btn-sm btn-primary" id="ldSave">Kaydet</button>
      </div>`;
    box.classList.remove('hidden');
    S.formInitial = isNew ? null : formValues(box, 'ld', c);
    // Çoğaltılan komponent kaynağın fotoğrafıyla açılır
    S.formPhoto = photoField(box, 'ld', isNew ? (c.fotoKaynakId ? app().photoOf(c.fotoKaynakId) : '') : app().photoOf(c.id), [c.kod, c.ad].filter(Boolean).join(' · '));
    if (scroll) box.querySelector('.drawer-body').scrollTop = scroll;
    const save = async () => {
      const done = await submitForm(box, 'ld', isNew ? {} : c, S.formInitial, S.formPhoto);
      if (!done) return;
      U.toast(isNew ? `${done.saved.kod} kütüphaneye eklendi` : `${done.saved.kod} kaydedildi`, '', undoButton(done.entry));
      openDrawer(done.saved, false);
    };
    U.$('ldSave').addEventListener('click', save);
    U.$('ldForm').addEventListener('submit', (e) => {
      e.preventDefault();
      save();
    });
    box.querySelectorAll('input').forEach((i) => i.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        save();
      }
    }));
    U.$('ldClose').addEventListener('click', closeDrawer);
    U.$('ldCancel').addEventListener('click', closeDrawer);
    if (!isNew) {
      const latest = () => app().state.libraryById.get(c.id) || c;
      U.$('ldDup').addEventListener('click', () => openDrawer(Object.assign({}, latest(), { id: '', kod: `${c.kod}-2`, olusturma: '', zaman: '', fotoKaynakId: c.id }), true));
      U.$('ldDel').addEventListener('click', () => deleteDialog([latest()]));
    }
    if (!refresh) setTimeout(() => { const f = U.$(isNew ? 'ldkod' : 'ldad'); if (f) f.focus(); }, 0);
    render();
  }

  function closeDrawer() {
    S.openId = null;
    S.draft = null;
    S.formInitial = null;
    S.formPhoto = null;
    S.drawerOpen = false;
    U.$('libDrawer').classList.add('hidden');
    U.$('libDrawer').innerHTML = '';
    render();
  }

  /**
   * Pencere olarak komponent formu (düzenleyiciden).
   * @param options.isNew yeni kayıt; options.offerAdd "listeye de ekle" kutusu; options.onSaved(c, add)
   */
  function openForm(component, options) {
    const o = options || {};
    const isNew = o.isNew || !component.id || !app().state.libraryById.has(component.id);
    const base = isNew ? Object.assign({}, component, { id: '' }) : component;
    let initial = null;
    let photo = null;
    const m = U.modal(`
      <h2>${isNew ? 'Yeni komponent' : `${esc(component.kod)} · kütüphane kaydı`} <button type="button" class="icon-btn sm x" data-close>×</button></h2>
      ${formHtml(base, 'mf')}
      ${!isNew ? `<p class="field-help">Değişiklik kütüphaneye yazılır. Projelerdeki kalemler değişmez; Kontrol sekmesi farkı gösterir, “Kütüphaneden güncelle” ile alınır.</p>` : ''}
      ${o.offerAdd ? `<label class="check-inline"><input type="checkbox" id="mfAdd" checked> Malzeme listesine de ekle (eklenecek bölüme, 1 ${esc(app().settings.varsayilanBirim)})</label>` : ''}
      <div class="modal-actions"><button type="button" class="btn" data-close>Vazgeç</button><button type="submit" class="btn btn-primary">Kaydet</button></div>`, {
      size: 'wide',
      onSubmit: async (e, entry) => {
        const done = await submitForm(entry.el, 'mf', isNew ? {} : component, initial, photo);
        if (!done) return;
        const add = o.offerAdd && entry.el.querySelector('#mfAdd').checked;
        entry.close();
        U.toast(isNew ? `${done.saved.kod} kütüphaneye eklendi` : `${done.saved.kod} kütüphanede güncellendi`);
        if (o.onSaved) o.onSaved(done.saved, add);
      }
    });
    initial = isNew ? null : formValues(m.el, 'mf', base);
    photo = photoField(m.el, 'mf', isNew ? '' : app().photoOf(component.id), [component.kod, component.ad].filter(Boolean).join(' · '));
    setTimeout(() => m.el.querySelector(component.kod ? '#mfad' : '#mfkod').focus(), 0);
  }

  /* ─── Dosya okuma ─────────────────────────────────────── */

  const IMPORT_ACCEPT = '.csv,.txt,.tsv,.xlsx,.xlsm,.xls,.json,.html,.htm,text/csv,text/html';
  const REPORT_KINDS = new Set(['agac', 'kritik', 'sarf']);

  /** ERP'lerin ".xls" diye verdiği dosyaların çoğu HTML tablosudur */
  function looksLikeHtml(bytes) {
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024)).replace(/^﻿/, '').trimStart().toLowerCase();
    return head.startsWith('<') && /<(html|table|!doctype|meta|head|body)/.test(head);
  }

  /** @returns { rows, tables?, kind } tablo | { items, kind } hazır alanlar | { report, kind } HTML raporu */
  async function readImportFile(file) {
    const name = file.name.toLowerCase();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const html = /\.(html?|xhtml)$/.test(name) || ((name.endsWith('.xls') || name.endsWith('.txt')) && looksLikeHtml(bytes));
    if (html) {
      const report = R.readHtml(U.decodeText(bytes), file.name);
      if (REPORT_KINDS.has(report.kind)) return { report, kind: R.SOURCE_LABEL[report.kind] };
      if (report.kind === 'tablo') return { rows: report.tables[0], tables: report.tables, kind: name.endsWith('.xls') ? 'Excel (HTML tablosu)' : 'HTML tablosu' };
      throw new Error('Dosyada tanınan bir rapor ya da komponent tablosu bulunamadı');
    }
    // ERP ürün ağacı (tek ya da çok seviyeli) rapor gibi okunur: elektrikli parçalar ayrılır, raporlarla birleşir
    const asTree = (rows, kind) => {
      const tree = R.readTreeTable(rows, file.name);
      return tree ? { report: tree, kind: 'Ürün ağacı (Excel / CSV)' } : { rows, kind };
    };
    if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) return asTree(await BomxXlsx.readWorkbook(bytes), 'Excel');
    if (name.endsWith('.xls')) throw new Error('Eski Excel biçimi (.xls) okunamaz. Excel\'de "Farklı kaydet → .xlsx" ya da CSV olarak kaydedin.');
    const text = U.decodeText(bytes);
    if (name.endsWith('.json')) {
      const data = JSON.parse(text);
      // P&PX kodlar.json ({kodlar:[{kod, aciklama}]}), BOMX komponent paketi (fotoğraflı) ya da komponent dizisi
      if (data && Array.isArray(data.kodlar)) return { items: M.componentsFromPpx(data.kodlar, []), kind: 'P&PX kod listesi' };
      const items = M.packageItems(data);
      if (!items) throw new Error('JSON dosyasında komponent listesi bulunamadı');
      const photos = items.filter((it) => it.foto).length;
      return { items, classed: items.some((it) => it.meta), kind: data.format === M.PACKAGE_FORMAT ? `BOMX komponent paketi${photos ? ` · ${photos} fotoğraf` : ''}` : 'JSON' };
    }
    return asTree(M.parseCsv(text), 'CSV');
  }

  /** Seçilen ya da bırakılan dosyalar: HTML raporları tek önizlemede birleşir, diğerleri sırayla açılır */
  async function importFiles(files) {
    if (!files || !files.length) return;
    const big = files.length > 1 || files.some((f) => f.size > 1e6);
    const b = big ? U.busy(`${files.length > 1 ? `${files.length} dosya` : files[0].name} okunuyor…`) : null;
    const reports = [];
    const others = [];
    const failed = [];
    for (const f of files) {
      try {
        if (b) b.update(`${f.name} okunuyor…`);
        const res = await readImportFile(f);
        if (res.report) reports.push(res.report);
        else if (res.rows && !res.rows.length) failed.push(`${f.name}: dosyada satır yok`);
        else others.push({ file: f, res });
      } catch (e) {
        failed.push(`${f.name}: ${e.message}`);
      }
    }
    if (b) b.close();
    if (failed.length) U.toast(`Okunamadı: ${failed.join(' · ')}`, 'error', { ms: 10000 });
    const queue = [];
    if (reports.length) queue.push(() => reportDialog(reports));
    for (const { file, res } of others) queue.push(() => importDialog(res, `${file.name} · ${res.kind}`));
    const next = () => {
      const open = queue.shift();
      if (open) open().then(next);
    };
    next();
  }

  async function importFromFile() {
    importFiles(await U.pickFiles(IMPORT_ACCEPT, true));
  }

  async function importFromReports() {
    const files = await U.pickFiles('.html,.htm,text/html', true);
    if (files.length) importFiles(files);
  }

  function reportDialog(reports) {
    const options = { adKaynagi: 'erp', kullanim: true, birimler: app().state.settings.birimler };
    const items = R.importItems(reports, options);
    const title = reports.length === 1 ? `${reports[0].name} · ${R.SOURCE_LABEL[reports[0].kind]}` : `${reports.length} HTML raporu`;
    return importDialog({ items, reports, options }, title);
  }

  /* ─── Aktarma önizlemesi ──────────────────────────────── */

  const STATUS = {
    new: ['Yeni', 'green', 'Kütüphaneye yeni komponent olarak eklenir'],
    update: ['Güncellenecek', 'amber', 'Kod kütüphanede var; değişen alanlar yazılır'],
    same: ['Değişmeyecek', 'gray', 'Kod kütüphanede var; değişen bir şey yok'],
    invalid: ['Hatalı', 'red-soft', 'Düzeltilmeden alınmaz'],
    repeat: ['Tekrar', 'red-soft', 'Aynı kod listede daha önce geçiyor; ilk satır alınır'],
    skip: ['Alınmayacak', 'gray', 'Satır başındaki kutuyla aktarmaya dahil edilir']
  };
  const CLASS_TONES = { elektrik: 'blue', reduktor: 'blue', komple: 'amber', diger: 'gray' };
  const STAGE_FIELDS = ['kod', 'ad', 'kategori', 'uretici', 'ureticiKodu', 'tedarikci', 'tedarikciKodu', 'birim', 'teslimSuresi', 'link', 'aciklama', 'aciklamaEn', 'aciklamaDe'];

  /**
   * Aktarma penceresi: (tablo ise) sütun eşleştirme → düzenlenebilir önizleme → kütüphaneye yaz.
   * @param source { rows, tables? } tablo | { items } alanları hazır | { items, reports, options } HTML raporları
   * @returns pencere kapanınca çözülen söz
   */
  function importDialog(source, title) {
    const lib = () => app().state.library;
    const isReport = !!source.reports;
    // Tür (elektrikli parça, komple…) bilgisi: raporlarda ve hazır pakette; ad kaynağı seçeneği yalnız raporlarda
    const classed = isReport || !!source.classed;
    // Raporların alanları tahmindir: kütüphanede olan (belki elle düzeltilmiş) kodlara varsayılan olarak dokunulmaz
    const state = {
      step: 'review', rows: source.rows || null, tables: source.tables || null, table: 0,
      columns: null, hasHeader: undefined, headers: [], items: [], mode: isReport ? 'add' : 'merge', touched: false,
      f: { status: '', sinif: '', q: '', kategori: '' },
      opts: Object.assign({ adKaynagi: 'erp', kullanim: true }, source.options || {}),
      statusOf: new Map(), plan: null
    };
    let grid2 = null;
    let resolveClose;
    const closed = new Promise((r) => { resolveClose = r; });

    const m = U.modal(`
      <h2>${esc(title || 'Kütüphaneye aktar')} <button type="button" class="icon-btn sm x" data-close title="Kapat">×</button></h2>
      <div class="im-body" id="imBody"></div>
      <div class="modal-actions" id="imActions"></div>`, {
      size: 'import',
      dismissable: false,
      confirmCancel: () => {
        if (!state.touched) return true;
        U.confirmModal('Aktarma bırakılsın mı?', 'Önizlemede yaptığınız düzenlemeler kaybolur; kütüphaneye bir şey yazılmaz.', 'Bırak', { danger: true }).then((ok) => { if (ok) m.close(); });
        return false;
      },
      onSubmit: () => {
        if (state.step === 'map') toReview();
        else apply();
      },
      onClose: () => resolveClose()
    });

    /* ── Satırlar ── */

    function stage(rawItems) {
      state.items = rawItems.map((it, i) => ({
        sid: String(i + 1),
        row: it.row,
        fields: Object.fromEntries(Object.entries(it.fields || {}).map(([k, v]) => [k, v])),
        meta: it.meta || null,
        // Raporda elektrik dışı kalanlar seçilmez; hazır paketteki her kalem seçili gelir
        include: it.meta && it.meta.entry ? R.DEFAULT_CLASSES.includes(it.meta.sinif) : true,
        foto: it.foto || '',
        // Fotoğrafın geldiği yer (rapor adı, "07 16331 fotoğrafı" gibi ödünç, web adresi): önizlemede ipucu
        fotoKaynagi: it.fotoKaynagi || it.fotoKaynak || '',
        edited: new Set()
      }));
    }

    function tableItems() {
      const rows = state.tables ? state.tables[state.table] : state.rows;
      const t = M.tableToComponents(rows, state.columns, state.hasHeader);
      state.columns = t.columns;
      state.hasHeader = t.hasHeader;
      state.headers = t.headers;
      return t;
    }

    function compute() {
      const included = state.items.filter((x) => x.include);
      const plan = M.planImport(included.map((x) => ({ row: x.sid, fields: x.fields })), lib(), state.mode);
      state.plan = plan;
      state.statusOf = new Map(plan.rows.map((r) => [String(r.row), r]));
    }

    const statusOf = (x) => (x.include ? state.statusOf.get(x.sid) || { status: 'invalid', reason: 'Kod yok' } : { status: 'skip' });

    /**
     * Satırın fotoğrafı hangi komponente yazılır (yoksa null): yeni komponent fotoğrafıyla gelir; kütüphanede olanın
     * fotoğrafı yoksa eklenir (her kipte; var olan fotoğrafa dokunulmaz), "değiştir" kipinde dosyadakiyle değişir.
     */
    function photoTarget(x) {
      if (!x.include || !x.foto) return null;
      const r = state.statusOf.get(x.sid);
      if (!r) return null;
      if (r.status === 'new') return r.component.id;
      if (r.status !== 'update' && r.status !== 'same') return null;
      const id = (r.after || r.existing).id;
      const has = app().photoOf(id);
      return (state.mode === 'replace' ? has !== x.foto : !has) ? id : null;
    }

    /** @param savedIds yazılan yeni komponentler (null: önizleme, hepsi yazılacak sayılır) */
    function photoJobs(savedIds) {
      const jobs = [];
      for (const x of state.items) {
        const id = photoTarget(x);
        if (!id) continue;
        if (savedIds && state.statusOf.get(x.sid).status === 'new' && !savedIds.has(id)) continue;
        jobs.push({ id, src: x.foto });
      }
      return jobs;
    }

    function visible() {
      const tokens = M.fold(state.f.q).split(/\s+/).filter(Boolean);
      return state.items.filter((x) => {
        if (state.f.sinif && (!x.meta || x.meta.sinif !== state.f.sinif)) return false;
        if (state.f.kategori && M.clean(x.fields.kategori) !== (state.f.kategori === '__none' ? '' : state.f.kategori)) return false;
        if (state.f.status) {
          const s = statusOf(x).status;
          if (state.f.status === 'invalid' ? s !== 'invalid' && s !== 'repeat' : s !== state.f.status) return false;
        }
        if (tokens.length) {
          const text = M.fold(STAGE_FIELDS.map((k) => x.fields[k]).join(' '));
          if (!tokens.every((t) => text.includes(t))) return false;
        }
        return true;
      });
    }

    const fieldText = (x, k) => {
      const v = x.fields[k];
      if (v === null || v === undefined) return '';
      if (typeof v === 'number') return String(v);
      if (typeof v === 'boolean') return v ? 'evet' : '';
      return String(v);
    };

    /* ── Önizleme sütunları ── */

    function statusChip(x) {
      const s = statusOf(x);
      const [label, tone] = STATUS[s.status] || STATUS.invalid;
      const photo = s.status !== 'new' && photoTarget(x);
      return `<span class="chip ${tone}">${esc(label)}</span>${photo ? '<span class="im-photo" title="Fotoğrafı yazılacak">+foto</span>' : ''}${x.edited.size ? '<span class="im-edited" title="Elle düzeltildi">✎</span>' : ''}`;
    }

    function statusTitle(x) {
      const s = statusOf(x);
      const base = (STATUS[s.status] || STATUS.invalid)[2];
      const photo = s.status !== 'new' && photoTarget(x)
        ? `\nFotoğraf: ${app().photoOf(photoTarget(x)) ? 'kütüphanedeki dosyadakiyle değişir' : 'kütüphanede yok, dosyadaki eklenir'}` : '';
      if (s.status === 'update') return `${base}:\n${s.changes.map((f) => `${LABELS[f] || f}: ${showValue(f, s.before[f])} → ${showValue(f, s.after[f])}`).join('\n')}${photo}`;
      return (s.reason ? `${s.reason}` : base) + photo;
    }

    const showValue = (f, v) => (typeof v === 'boolean' ? (v ? 'evet' : 'hayır') : firstLine(v) || '—');

    function classChip(x) {
      if (!x.meta) return '';
      const warn = x.meta.uyarilar && x.meta.uyarilar.length;
      return `<span class="chip ${CLASS_TONES[x.meta.sinif] || 'gray'}">${esc(R.CLASS_LABELS[x.meta.sinif] || x.meta.sinif)}</span>${warn ? '<span class="im-warn" title="Uyarı var">!</span>' : ''}`;
    }

    function classTitle(x) {
      if (!x.meta) return '';
      return [x.meta.neden, `Kaynak: ${x.meta.kaynaklar.join(', ')}`, ...(x.meta.uyarilar || [])].filter(Boolean).join('\n');
    }

    function reviewColumns() {
      const settings = app().state.settings;
      // Dosyada hiç değeri olmayan sütun gösterilmez (toplu atamayla değer gelince görünür)
      const present = (k) => state.items.some((x) => x.fields[k] !== undefined && x.fields[k] !== null && x.fields[k] !== '');
      const show = (k) => k === 'kod' || k === 'ad' || k === 'kategori' || (classed ? ['uretici', 'ureticiKodu', 'birim', 'aciklama'].includes(k) || present(k) : present(k));
      const photos = state.items.some((x) => x.foto);
      const list = [
        { key: '__durum', width: '118px', label: 'Durum', cell: statusChip, title: statusTitle },
        classed ? { key: '__tur', width: '128px', label: 'Tür', cell: classChip, title: classTitle } : null,
        photos ? { key: '__foto', width: '44px', label: 'Foto', className: 'c-foto', headTitle: 'Fotoğraf komponentle birlikte aktarılır; tıklayınca büyür', title: (x) => (x.foto ? x.fotoKaynagi || 'Fotoğraf' : ''), cell: (x) => (x.foto ? `<img class="gt-thumb" src="${esc(x.foto)}" alt="" loading="lazy" data-act="foto">` : '') } : null,
        { key: 'kod', width: '122px', label: 'Stok Kodu', className: 'c-kod' },
        { key: 'ad', width: 'minmax(220px, 2fr)', label: 'Tanım' },
        { key: 'kategori', width: '130px', label: 'Kategori', list: categories },
        { key: 'uretici', width: '120px', label: 'Üretici', list: () => distinct('uretici') },
        { key: 'ureticiKodu', width: '160px', label: 'Model Kodu' },
        { key: 'tedarikci', width: '120px', label: 'Tedarikçi', list: () => distinct('tedarikci') },
        { key: 'tedarikciKodu', width: '110px', label: 'Tedarikçi Kodu' },
        { key: 'birim', width: '62px', label: 'Birim', list: () => settings.birimler },
        { key: 'teslimSuresi', width: '74px', label: 'Teslim', align: 'right', kind: 'number' },
        { key: 'link', width: '140px', label: 'Bağlantı' },
        { key: 'aciklama', width: 'minmax(220px, 1.6fr)', label: 'Açıklama', kind: 'multiline', className: 'c-muted', cell: (x) => esc(firstLine(fieldText(x, 'aciklama'))) }
      ].filter(Boolean).filter((c) => c.key.startsWith('__') || show(c.key));
      return list.map((c) => (c.key.startsWith('__') ? c : Object.assign({
        editable: true,
        value: (x) => fieldText(x, c.key),
        cell: c.cell || ((x) => esc(fieldText(x, c.key))),
        title: (x) => fieldText(x, c.key)
      }, c)));
    }

    /* ── Çizim ── */

    function renderMap() {
      const t = tableItems();
      const body = state.hasHeader ? (state.tables ? state.tables[state.table] : state.rows).slice(1) : (state.tables ? state.tables[state.table] : state.rows);
      const options = [['', '— alınmaz —'], ...M.COMPONENT_FIELDS.map((f) => [f.key, f.label])];
      const missing = !state.columns.includes('kod') || !state.columns.includes('ad');
      U.$('imBody').innerHTML = `
        <div class="card-head" style="margin:0"><h3>Sütun eşleştirme · ${t.items.length} satır</h3>
          <div class="im-tools">
            ${state.tables && state.tables.length > 1 ? `<select class="field-input" id="imTable">${state.tables.map((tb, i) => `<option value="${i}"${i === state.table ? ' selected' : ''}>Tablo ${i + 1} · ${tb.length} satır</option>`).join('')}</select>` : ''}
            <label class="check-inline"><input type="checkbox" id="imHeader" ${state.hasHeader ? 'checked' : ''}> İlk satır başlık</label>
          </div></div>
        <p class="field-help">Her sütunun hangi alana gideceğini seçin. <b>Stok Kodu</b> ve <b>Tanım</b> gerekli; kod kütüphanede varsa kayıt güncellenir. Sonraki adımda satırları tek tek düzeltebilir, istemediklerinizi çıkarabilirsiniz.</p>
        <div class="map-grid">${state.headers.map((h, i) => {
          const sample = body.slice(0, 3).map((r) => r[i]).filter((v) => v !== '' && v !== undefined).join(' · ');
          return `<div class="map-col${state.columns[i] ? ' on' : ''}"><div class="src" title="${esc(h)}">${esc(h)}</div><div class="sample" title="${esc(sample)}">${esc(sample || '—')}</div>
            <select class="field-input" data-col="${i}">${options.map(([v, label]) => `<option value="${v}"${state.columns[i] === v ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select></div>`;
        }).join('')}</div>`;
      U.$('imActions').innerHTML = `<span class="left ${missing ? 'err-text' : 'muted'}">${missing ? 'Stok Kodu ve Tanım sütunlarını seçin.' : `${t.items.length} satır okunacak`}</span>
        <button type="button" class="btn" data-close>Vazgeç</button>
        <button type="submit" class="btn btn-primary"${missing ? ' disabled' : ''}>Devam: satırları gözden geçir →</button>`;
      m.el.querySelectorAll('#imActions [data-close]').forEach((b) => b.addEventListener('click', () => m.cancel()));
    }

    function chipsHtml() {
      const counts = { all: state.items.length, new: 0, update: 0, same: 0, invalid: 0, skip: 0 };
      for (const x of state.items) {
        const s = statusOf(x).status;
        counts[s === 'repeat' ? 'invalid' : s] += 1;
      }
      const chip = (key, label, n) => `<button type="button" class="chip-filter${state.f.status === key ? ' active' : ''}" data-status="${key}">${esc(label)} <span>${n}</span></button>`;
      let html = `<div class="chips">${chip('', 'Tümü', counts.all)}${chip('new', 'Yeni', counts.new)}${chip('update', 'Güncellenecek', counts.update)}${chip('same', 'Değişmeyecek', counts.same)}${chip('invalid', 'Hatalı', counts.invalid)}${chip('skip', 'Alınmayacak', counts.skip)}</div>`;
      if (classed) {
        const cls = {};
        for (const x of state.items) {
          // Pakette türü yazılmamış kalem sınıf düğmelerine girmez
          const k = x.meta && x.meta.sinif;
          if (!k) continue;
          cls[k] = cls[k] || { n: 0, inc: 0 };
          cls[k].n += 1;
          if (x.include) cls[k].inc += 1;
        }
        html += `<div class="chips">${Object.keys(R.CLASS_LABELS).filter((k) => cls[k]).map((k) => `<button type="button" class="chip-filter im-class${state.f.sinif === k ? ' active' : ''}" data-sinif="${k}" title="${cls[k].inc} / ${cls[k].n} alınacak">${esc(R.CLASS_LABELS[k])} <span>${cls[k].n}</span>${cls[k].inc ? ` <em>${cls[k].inc === cls[k].n ? 'hepsi alınacak' : `${cls[k].inc} alınacak`}</em>` : ''}</button>`).join('')}</div>`;
      }
      return html;
    }

    function renderReview() {
      const cats = [...new Set(state.items.map((x) => M.clean(x.fields.kategori)))].sort(M.compareText);
      const sources = isReport ? `<div class="im-sources">${source.reports.map((r) => `<span><b>${esc(R.SOURCE_LABEL[r.kind])}</b> ${esc(r.name)} · ${esc(r.summary)}</span>`).join('')}<span class="muted">Aynı stok kodu dosyalarda ve makinelerde tek kayıtta birleşti: ${state.items.length} kod. Elektrikli parçalar, redüktörler ve elektrikli kompleler seçili geldi; elektrik dışı kalanlar listede, isterseniz kutusunu işaretleyin.</span></div>` : '';
      U.$('imBody').innerHTML = `${sources}
        <div class="im-chips" id="imChips">${chipsHtml()}</div>
        <div class="im-tools">
          <input type="search" id="imSearch" class="search" placeholder="Önizlemede ara: kod, ad, üretici…" value="${esc(state.f.q)}">
          <select id="imCat" class="field-input"><option value="">Tüm kategoriler</option>${cats.map((k) => `<option value="${esc(k || '__none')}"${state.f.kategori === (k || '__none') ? ' selected' : ''}>${esc(k || 'Kategorisiz')}</option>`).join('')}</select>
          <span class="tb-spacer"></span>
          <span class="muted im-vis" id="imVis"></span>
          <button type="button" class="btn btn-xs" data-im="include" title="Görünen satırların hepsini aktarmaya dahil et">Görünenleri al</button>
          <button type="button" class="btn btn-xs" data-im="exclude" title="Görünen satırları aktarmadan çıkar">Görünenleri alma</button>
          <button type="button" class="btn btn-xs" data-im="kategori">Kategori ata…</button>
          <button type="button" class="btn btn-xs" data-im="uretici">Üretici ata…</button>
          <button type="button" class="btn btn-xs" data-im="tedarikci">Tedarikçi ata…</button>
        </div>
        <div class="im-tools im-opts">
          ${isReport ? `<span class="muted">Ad olarak:</span>
            <label class="check-inline"><input type="radio" name="imAd" value="erp" ${state.opts.adKaynagi === 'erp' ? 'checked' : ''}> ERP stok adı (tam ad açıklamaya)</label>
            <label class="check-inline"><input type="radio" name="imAd" value="tam" ${state.opts.adKaynagi === 'tam' ? 'checked' : ''}> Ürün tam adı (ERP adı açıklamaya)</label>
            <label class="check-inline"><input type="checkbox" id="imUsage" ${state.opts.kullanim ? 'checked' : ''}> Kullanıldığı makineleri açıklamaya yaz</label>
            <span class="tb-spacer"></span>` : '<span class="tb-spacer"></span>'}
          <label class="check-inline">Kütüphanede olan kodlar:
            <select id="imMode" class="field-input">
              <option value="merge"${state.mode === 'merge' ? ' selected' : ''}>dolu alanları güncelle (önerilen)</option>
              <option value="add"${state.mode === 'add' ? ' selected' : ''}>dokunma, yalnız yenileri ekle</option>
              <option value="replace"${state.mode === 'replace' ? ' selected' : ''}>dosyadakiyle değiştir (boşlar da)</option>
            </select></label>
        </div>
        <div class="grid-table im-grid editable" id="imGrid"></div>`;
      grid2 = BomxGrid.create(U.$('imGrid'), {
        get columns() { return reviewColumns(); },
        rows: visible,
        id: (x) => x.sid,
        rowClass: (x) => (x.include ? '' : 'excluded'),
        check: {
          has: (sid) => !!(state.items[Number(sid) - 1] || {}).include,
          setMany: (ids, on) => {
            ids.forEach((sid) => { const x = state.items[Number(sid) - 1]; if (x) x.include = on; });
            state.touched = true;
            compute();
            refreshSummary();
          },
          title: 'Görünenlerin hepsini al / alma',
          // Bir satırı almak ya da bırakmak aynı kodlu öbür satırın durumunu (Yeni / Tekrar) değiştirir
          rerenderAll: true
        },
        editMode: () => true,
        commit: commitStaged,
        onAction: (act, x) => { if (act === 'foto' && x.foto) U.lightbox(x.foto, [x.fields.kod, x.fields.ad].filter(Boolean).join(' · ')); },
        empty: () => 'Filtreye uyan satır yok.',
        limit: 3000
      });
      grid2.render();
      refreshSummary();
    }

    function refreshSummary() {
      if (state.step !== 'review') return;
      const chips = U.$('imChips');
      if (chips) chips.innerHTML = chipsHtml();
      const plan = state.plan;
      const n = plan.add.length + plan.update.length;
      const excluded = state.items.filter((x) => !x.include).length;
      const bad = plan.invalid.length + plan.repeated;
      const vis = U.$('imVis');
      if (vis) {
        const shown = visible().length;
        vis.textContent = shown === state.items.length ? `${shown} satır` : `${shown} / ${state.items.length} satır görünüyor`;
      }
      const photos = photoJobs(null).length;
      const go = n ? `${n} komponenti kütüphaneye aktar` : photos ? `${photos} fotoğrafı kütüphaneye ekle` : 'Aktarılacak değişiklik yok';
      U.$('imActions').innerHTML = `<span class="left muted" id="imNote">${plan.add.length} yeni · ${plan.update.length} güncellenecek · ${plan.same} değişmeyecek${photos ? ` · ${photos} fotoğraf yazılacak` : ''}${bad ? ` · <span class="err-text">${bad} hatalı / tekrar (alınmaz)</span>` : ''}${excluded ? ` · ${excluded} alınmayacak` : ''}</span>
        ${state.rows || state.tables ? '<button type="button" class="btn" id="imBack" title="Sütun eşleştirmeye dön">← Sütunlar</button>' : ''}
        <button type="button" class="btn" data-close>Vazgeç</button>
        <button type="submit" class="btn btn-primary"${n || photos ? '' : ' disabled'}>${go}</button>`;
      m.el.querySelectorAll('#imActions [data-close]').forEach((b) => b.addEventListener('click', () => m.cancel()));
      const back = U.$('imBack');
      if (back) back.addEventListener('click', toMap);
    }

    function rerender() {
      compute();
      if (grid2) grid2.render();
      refreshSummary();
    }

    /* ── Düzenleme ── */

    async function commitStaged(x, key, text) {
      let value = key === 'aciklama' ? M.cleanMultiline(text) : M.clean(text);
      if (key === 'teslimSuresi') {
        if (value !== '' && (M.parseNumber(value) === null || M.parseNumber(value) < 0)) return `"${value}" geçerli bir sayı değil`;
      }
      if (fieldText(x, key) === value) return '';
      x.fields[key] = value;
      x.edited.add(key);
      // Düzeltilen satır aktarmaya girer (kodu yazılan hatalı satır gibi)
      if (!x.include) x.include = true;
      state.touched = true;
      compute();
      if (grid2) grid2.render();
      refreshSummary();
      return '';
    }

    async function bulkField(field, label, values) {
      const list = visible().filter((x) => x.include);
      if (!list.length) {
        U.toast('Görünen ve alınacak satır yok', 'warn');
        return;
      }
      const v = await U.promptModal(`${label} ata`, `${list.length} görünen satıra ${label.toLowerCase()}`, '', 'Uygula', { list: values, required: false, help: 'Boş bırakırsanız alan temizlenir. Yalnız aktarmaya dahil, görünen satırlar değişir.' });
      if (v === null) return;
      list.forEach((x) => {
        x.fields[field] = M.clean(v);
        x.edited.add(field);
      });
      state.touched = true;
      rerender();
    }

    /** Ad kaynağı ya da kullanım bilgisi değişince elle düzeltilmemiş alanlar yeniden kurulur */
    function refreshReportFields() {
      for (const x of state.items) {
        if (!x.meta || !x.meta.entry) continue;
        const f = R.refreshFields(x, state.opts);
        for (const k of ['ad', 'aciklama']) if (!x.edited.has(k)) x.fields[k] = f[k];
      }
      rerender();
    }

    /* ── Adımlar ── */

    function toMap() {
      const go = () => {
        state.step = 'map';
        grid2 = null;
        renderMap();
      };
      if (state.touched) {
        U.confirmModal('Sütun eşleştirmeye dönülsün mü?', 'Önizlemede yaptığınız düzenlemeler sıfırlanır.', 'Dön', { danger: true }).then((ok) => { if (ok) { state.touched = false; go(); } });
      } else go();
    }

    function toReview() {
      if (state.rows || state.tables) {
        const t = tableItems();
        if (!state.columns.includes('kod') || !state.columns.includes('ad')) {
          U.toast('Stok Kodu ve Tanım sütunlarını seçin', 'error');
          return;
        }
        stage(t.items);
      }
      state.step = 'review';
      compute();
      renderReview();
    }

    async function apply() {
      if (grid2) await grid2.flush();
      compute();
      const plan = state.plan;
      const list = [...plan.add, ...plan.update.map((u) => u.after)];
      if (!list.length && !photoJobs(null).length) {
        U.toast('Aktarılacak değişiklik yok', 'warn');
        return;
      }
      m.close();
      const b = U.busy(`${list.length} komponent kaydediliyor…`);
      try {
        const res = list.length
          ? await saveTracked(`İçe aktarma: ${plan.add.length} yeni, ${plan.update.length} güncelleme`, plan.update.map((u) => u.before), list, { skipInvalid: true })
          : { saved: [], errors: [], entry: null };
        // Fotoğraflar küçültülüp yazılır (kenar 420 px); aktarmanın geçmiş kaydına girer
        const jobs = photoJobs(new Set(res.saved.map((c) => c.id)));
        const photos = [];
        for (let i = 0; i < jobs.length; i += 1) {
          if (i % 10 === 0) b.update(`Fotoğraflar hazırlanıyor ${i + 1}/${jobs.length}…`);
          try {
            photos.push({ id: jobs[i].id, veri: await U.shrinkImage(jobs[i].src) });
          } catch { /* okunamayan fotoğraf atlanır */ }
        }
        if (photos.length) {
          b.update(`${photos.length} fotoğraf kaydediliyor…`);
          res.entry = await savePhotosTracked('İçe aktarma fotoğrafları', photos, res.entry);
        }
        b.close();
        rememberImport([...new Set([...res.saved.map((c) => c.id), ...photos.map((p) => p.id)])]);
        S.filter = 'last';
        S.category = '';
        S.query = '';
        const search = U.$('libSearch');
        if (search) search.value = '';
        if (isVisible()) render();
        const github = !!(app().state.status && app().state.status.mode === 'cloud');
        const bad = res.errors.length ? ` · ${res.errors.length} kayıt hatalı olduğu için alınmadı (${res.errors.slice(0, 3).map((x) => `${x.kod}: ${x.errors[0]}`).join('; ')})` : '';
        U.toast(`${plan.add.length} yeni komponent eklendi, ${plan.update.length} güncellendi${photos.length ? `, ${photos.length} fotoğraf eklendi` : ''}${github ? ' · GitHub\'a gönderiliyor' : ''}. Liste "Son aktarılanlar" filtresinde${bad}`, res.errors.length ? 'warn' : '', Object.assign({ ms: 10000 }, undoButton(res.entry)));
        if (github) app().syncNow().catch(() => {});
      } catch (err) {
        b.close();
        U.toast(`Aktarma tamamlanamadı: ${err.message}`, 'error');
      }
    }

    /* ── Olaylar ── */

    m.el.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.col !== undefined) {
        const i = Number(t.dataset.col);
        const value = t.value;
        // Bir alan tek sütuna gider
        state.columns = state.columns.map((c, j) => (j === i ? value : c === value && value ? '' : c));
        renderMap();
      } else if (t.id === 'imHeader') {
        state.hasHeader = t.checked;
        state.columns = null;
        renderMap();
      } else if (t.id === 'imTable') {
        state.table = Number(t.value);
        state.columns = null;
        state.hasHeader = undefined;
        renderMap();
      } else if (t.id === 'imMode') {
        state.mode = t.value;
        rerender();
      } else if (t.id === 'imCat') {
        state.f.kategori = t.value;
        rerender();
      } else if (t.name === 'imAd') {
        state.opts.adKaynagi = t.value;
        refreshReportFields();
      } else if (t.id === 'imUsage') {
        state.opts.kullanim = t.checked;
        refreshReportFields();
      }
    });
    m.el.addEventListener('input', U.debounce((e) => {
      if (e.target.id !== 'imSearch') return;
      state.f.q = e.target.value;
      rerender();
    }, 120));
    m.el.addEventListener('keydown', (e) => {
      // Enter yalnız Aktar düğmesindeyken gönderir: arama kutusu, onay kutusu ya da seçenekte pencereyi göndermez
      if (e.key === 'Enter' && !(e.target.tagName === 'BUTTON' && e.target.type === 'submit')) e.preventDefault();
    });
    m.el.addEventListener('click', (e) => {
      const st = e.target.closest('[data-status]');
      if (st) {
        state.f.status = state.f.status === st.dataset.status ? '' : st.dataset.status;
        rerender();
        return;
      }
      const cl = e.target.closest('[data-sinif]');
      if (cl) {
        state.f.sinif = state.f.sinif === cl.dataset.sinif ? '' : cl.dataset.sinif;
        rerender();
        return;
      }
      const act = e.target.closest('[data-im]');
      if (!act) return;
      const kind = act.dataset.im;
      if (kind === 'include' || kind === 'exclude') {
        const list = visible();
        list.forEach((x) => { x.include = kind === 'include'; });
        state.touched = true;
        rerender();
        U.toast(`${list.length} satır ${kind === 'include' ? 'aktarmaya dahil edildi' : 'aktarmadan çıkarıldı'}`);
      } else if (kind === 'kategori') bulkField('kategori', 'Kategori', categories());
      else if (kind === 'uretici') bulkField('uretici', 'Üretici', distinct('uretici'));
      else if (kind === 'tedarikci') bulkField('tedarikci', 'Tedarikçi', distinct('tedarikci'));
    });

    // Başlangıç: tablo ise eşleştirme (kod ve ad bulunduysa doğrudan önizleme), değilse önizleme
    if (state.rows || state.tables) {
      const t = tableItems();
      if (t.columns.includes('kod') && t.columns.includes('ad')) {
        stage(t.items);
        compute();
        renderReview();
      } else {
        state.step = 'map';
        renderMap();
      }
    } else {
      stage(source.items || []);
      compute();
      renderReview();
    }
    return closed;
  }

  function importFromPaste() {
    const m = U.modal(`
      <h2>Tablodan yapıştır</h2>
      <p class="field-help">Excel'de başlık satırıyla birlikte sütunları seçip kopyalayın, buraya yapıştırın. Sonraki adımda sütunlar eşleştirilir ve satırlar düzenlenir.</p>
      <textarea id="ipText" class="field-input paste-area" placeholder="Stok Kodu&#9;Tanım&#9;Marka&#9;Model Kodu"></textarea>
      <div class="modal-actions"><button type="button" class="btn" data-close>Vazgeç</button><button type="submit" class="btn btn-primary">Devam</button></div>`, {
      size: 'wide',
      onSubmit: (e, entry) => {
        const text = entry.el.querySelector('#ipText').value;
        const rows = M.parseCsv(text, text.includes('\t') ? '\t' : undefined);
        if (!rows.length) {
          U.toast('Yapıştırılan tablo boş', 'error');
          return;
        }
        entry.close();
        importDialog({ rows }, 'Yapıştırılan tablo');
      }
    });
    setTimeout(() => m.el.querySelector('#ipText').focus(), 0);
  }

  async function importFromPpx() {
    const ppx = await app().loadPpx();
    if (!ppx || !ppx.codes.length) {
      U.toast('Bu tarayıcıda P&PX kod listesi bulunamadı. P&PX klasöründeki ML/kayitlar/kodlar.json ya da ML/KODListesi.csv dosyasını "Dosyadan" ile seçin.', 'warn', { ms: 9000 });
      return;
    }
    importDialog({ items: M.componentsFromPpx(ppx.codes, ppx.catalog) }, `P&PX kod listesi · ${ppx.codes.length} kod`);
  }

  function importMenu(x, y) {
    U.contextMenu(x, y, [
      { title: 'Kütüphaneye aktar' },
      { label: 'Dosyadan: paket (JSON, fotoğraflı), CSV, Excel, HTML…', run: importFromFile },
      { label: 'HTML raporlarından: ürün ağacı, kritik parça, sarf listesi…', run: importFromReports },
      { label: 'Excel\'den yapıştır…', run: importFromPaste },
      { label: app().state.ppx ? `P&PX kod listesinden (${app().state.ppx.codes.length} kod)` : 'P&PX kod listesinden', run: importFromPpx },
      '-',
      { label: 'Boş CSV şablonu indir', run: downloadTemplate }
    ]);
  }

  function downloadTemplate() {
    const rows = [M.libraryToRows([])[0]];
    U.download(new Blob([M.toCsv(rows)], { type: 'text/csv;charset=utf-8' }), 'BOMX komponent sablonu.csv');
    U.toast('Şablon indirildi: başlıkları değiştirmeden doldurup İçe aktar ile yükleyin');
  }

  function exportMenu(x, y) {
    const list = filtered();
    const all = app().state.library;
    const csv = (items, name) => U.download(new Blob([M.toCsv(M.libraryToRows(items))], { type: 'text/csv;charset=utf-8' }), name);
    const xlsx = (items, name) => U.download(new Blob([BomxXlsx.libraryWorkbook(items)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name);
    // Paket: alanlar ve fotoğraflar tek JSON dosyasında; başka bir BOMX'e İçe aktar ile fotoğraflarıyla gelir
    const pack = (items, name) => {
      const doc = M.packageDocument(items, (c) => app().photoOf(c.id), { aciklama: `BOMX kütüphanesinden ${items.length} komponent` });
      const photos = doc.komponentler.filter((c) => c.foto).length;
      U.download(new Blob([JSON.stringify(doc, null, 1)], { type: 'application/json' }), name);
      U.toast(`Paket indirildi: ${items.length} komponent, ${photos} fotoğraf`);
    };
    const date = M.today();
    U.contextMenu(x, y, [
      { title: 'Kütüphaneyi dışa aktar' },
      { label: `Excel · tümü (${all.length})`, run: () => xlsx(all, `BOMX kutuphane ${date}.xlsx`) },
      { label: `CSV · tümü (${all.length})`, run: () => csv(all, `BOMX kutuphane ${date}.csv`) },
      { label: `Paket, fotoğraflı (JSON) · tümü (${all.length})`, run: () => pack(all, `BOMX kutuphane paketi ${date}.json`) },
      { label: `Excel · görünenler (${list.length})`, disabled: list.length === all.length, run: () => xlsx(list, `BOMX kutuphane secim ${date}.xlsx`) },
      { label: `CSV · görünenler (${list.length})`, disabled: list.length === all.length, run: () => csv(list, `BOMX kutuphane secim ${date}.csv`) },
      { label: `Paket, fotoğraflı (JSON) · görünenler (${list.length})`, disabled: list.length === all.length, run: () => pack(list, `BOMX kutuphane paketi secim ${date}.json`) }
    ]);
  }

  /* ─── Bağlantılar ─────────────────────────────────────── */

  function init() {
    grid = BomxGrid.create(U.$('libTable'), {
      get columns() { return columns(); },
      rows: filtered,
      id: (c) => c.id,
      rowClass: (c) => [S.openId === c.id ? 'active' : '', S.checked.has(c.id) ? 'checked' : '', c.pasif ? 'pasif' : ''].filter(Boolean).join(' '),
      check: {
        has: (id) => S.checked.has(id),
        setMany: (ids, on) => ids.forEach((id) => (on ? S.checked.add(id) : S.checked.delete(id))),
        title: 'Görünenleri seç'
      },
      editMode: () => S.edit,
      commit: commitCell,
      onRowClick: (c) => openDrawer(c, false),
      onAction: (act, c) => {
        if (act === 'fav') toggleFav(c);
        else if (act === 'foto') U.lightbox(app().photoOf(c.id), `${c.kod} · ${c.ad}`);
      },
      onContext: rowMenu,
      sort: () => S.sort,
      onSort: (key) => {
        S.sort = { key, desc: S.sort.key === key ? !S.sort.desc : false };
        U.setPref('kutuphaneSira', S.sort);
        render();
      },
      onCheck: renderBulk,
      onEmptyClick: (e) => {
        const act = e.target.closest('[data-act]');
        if (!act) return;
        if (act.dataset.act === 'ppx') importFromPpx();
        else if (act.dataset.act === 'template') downloadTemplate();
        else if (act.dataset.act === 'html') importFromReports();
        else if (act.dataset.act === 'file') importFromFile();
      },
      empty: emptyHtml,
      limit: 5000
    });
    const search = U.$('libSearch');
    search.addEventListener('input', U.debounce(() => {
      S.query = search.value;
      render();
    }, 80));
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        search.value = '';
        S.query = '';
        render();
      }
    });
    U.$('libFilter').addEventListener('change', (e) => {
      S.filter = e.target.value;
      render();
    });
    U.$('libNew').addEventListener('click', () => openDrawer({ kategori: S.category && S.category !== '__none' ? S.category : '' }, true));
    U.$('libEdit').addEventListener('click', () => setEditMode(!S.edit));
    U.$('libUndo').addEventListener('click', undo);
    U.$('libRedo').addEventListener('click', redo);
    U.$('libImport').addEventListener('click', (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      importMenu(r.left, r.bottom + 4);
    });
    U.$('libExport').addEventListener('click', (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      exportMenu(r.left, r.bottom + 4);
    });
    U.$('libChips').addEventListener('click', (e) => {
      const chip = e.target.closest('[data-cat]');
      if (!chip) return;
      S.category = S.category === chip.dataset.cat ? '' : chip.dataset.cat;
      render();
    });
    U.$('libBulk').addEventListener('click', (e) => {
      const b = e.target.closest('[data-bulk]');
      if (b) bulk(b.dataset.bulk);
    });
    // Yan formdaki "kullanıldığı projeler" bağlantıları (form her açılışta yeniden kurulur, dinleyici bir kez)
    U.$('libDrawer').addEventListener('click', (e) => {
      const b = e.target.closest('[data-open]');
      if (b) app().openProject(b.dataset.open);
    });
    // Dosya bırakma: CSV, Excel, HTML raporları
    const page = U.$('homeLibrary');
    const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    page.addEventListener('dragover', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      page.classList.add('dropping');
    });
    page.addEventListener('dragleave', (e) => {
      if (!e.relatedTarget || !page.contains(e.relatedTarget)) page.classList.remove('dropping');
    });
    page.addEventListener('drop', (e) => {
      page.classList.remove('dropping');
      if (!hasFiles(e)) return;
      e.preventDefault();
      importFiles([...e.dataTransfer.files]);
    });
    app().on('library', () => {
      const lib = app().state.libraryById;
      for (const id of [...S.checked]) if (!lib.has(id)) S.checked.delete(id);
      // Silinen kayıt açık formda kalmaz. Başka yerden (tablo, yıldız, toplu işlem, başka cihaz) değişen kayıt
      // form temizse yeni hâliyle gösterilir; formda yazılan varsa kayıtta yalnız değiştirilen alanlar yazılır.
      if (S.openId && !lib.has(S.openId)) {
        closeDrawer();
        return;
      }
      if (S.openId && S.draft && lib.get(S.openId).zaman !== S.draft.zaman && !drawerDirty()) {
        openDrawer(lib.get(S.openId), false, { refresh: true });
        return;
      }
      if (isVisible()) render();
    });
    app().on('projects', () => { if (isVisible()) render(); });
    app().on('photos', () => {
      if (S.openId && S.draft && !drawerDirty() && app().state.libraryById.has(S.openId)) {
        openDrawer(app().state.libraryById.get(S.openId), false, { refresh: true });
        return;
      }
      if (isVisible()) render();
    });
    app().on('ppx', () => { if (isVisible() && !app().state.library.length) render(); });
  }

  const isVisible = () => !U.$('homeLibrary').classList.contains('hidden') && !U.$('home').classList.contains('hidden');

  function handleKey(e) {
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (ctrl && key === 'f') {
      e.preventDefault();
      U.$('libSearch').focus();
      U.$('libSearch').select();
      return;
    }
    if (U.isTyping(e.target)) return;
    if (ctrl && !e.shiftKey && key === 'z') {
      e.preventDefault();
      undo();
    } else if (ctrl && (key === 'y' || (e.shiftKey && key === 'z'))) {
      e.preventDefault();
      redo();
    } else if (ctrl && key === 'a') {
      e.preventDefault();
      filtered().forEach((c) => S.checked.add(c.id));
      render();
    } else if (e.key === 'Delete' && S.checked.size) {
      e.preventDefault();
      deleteDialog(checkedList());
    } else if (e.key === 'Escape') {
      if (S.drawerOpen) closeDrawer();
      else if (S.checked.size) {
        S.checked.clear();
        render();
      }
    }
  }

  return { init, render, openForm, openDrawer, closeDrawer, importFromFile, importFromReports, importFiles, importFromPpx, importDialog, undo, redo, handleKey };
})();
