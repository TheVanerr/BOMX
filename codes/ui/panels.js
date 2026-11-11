/* Düzenleyici panelleri.
   Sol: komponent kütüphanesi (arama, kategori, miktar kutusu ile hızlı ekleme), şablonlar, başka projeden alma.
   Sağ: özellikler (proje, kalem, çoklu seçim) ve kontrol. Alt: özet, satın alma, revizyon farkı, referanslar.
   En alt: bölüm sekmeleri ve adet özeti. */

const BomxPanels = (() => {
  const M = BomxModel;
  const U = BomxUi;
  const { esc } = U;
  const app = () => BomxApp;
  const ed = () => BomxEditor;

  const L = { query: '', category: '', filter: 'aktif', cursor: -1, results: [], groups: false, libVersion: -1, renderedFor: '' };
  // Alt panelin ilk yüksekliği ekrana göre: dizüstünde liste için yer kalsın
  const defaultDock = () => Math.max(130, Math.min(250, Math.round(window.innerHeight * 0.24)));
  const P = { left: 'components', right: 'props', dock: U.pref('dock', 'summary'), dockOpen: U.pref('dockAcik', true), dockHeight: U.pref('dockYukseklik', defaultDock()), diffRev: null, revisions: [], otherProject: null };

  /* ─── Sol panel: komponentler ─────────────────────────── */

  function quantities() {
    const p = ed().project;
    const sec = ed().activeSection;
    const here = new Map();
    const all = new Map();
    if (p) {
      for (const l of p.kalemler) {
        if (!l.komponentId) continue;
        all.set(l.komponentId, (all.get(l.komponentId) || 0) + (Number(l.miktar) || 0));
        if (l.bolum === sec) here.set(l.komponentId, (here.get(l.komponentId) || 0) + (Number(l.miktar) || 0));
      }
    }
    return { here, all };
  }

  function computeResults() {
    const st = app().state;
    const { all } = quantities();
    let list = L.query ? M.searchComponents(st.library, L.query, st.libraryIndex) : st.library;
    if (L.category) list = list.filter((c) => (c.kategori || '') === (L.category === '__none' ? '' : L.category));
    switch (L.filter) {
      case 'fav': list = list.filter((c) => c.favori); break;
      case 'used': list = list.filter((c) => all.has(c.id)); break;
      case 'unused': list = list.filter((c) => !all.has(c.id) && !c.pasif); break;
      case 'aktif': list = list.filter((c) => !c.pasif || all.has(c.id)); break;
      default: break;
    }
    L.groups = !L.query && !L.category && L.filter !== 'fav';
    if (L.groups) {
      // Sorgu yokken favoriler üstte, sonra ayarlardaki kategori sırası
      const order = M.categoryCounts(list, app().settings).map(([k]) => k);
      const rank = new Map(order.map((k, i) => [k, i]));
      list = list.slice().sort((a, b) => (b.favori - a.favori) || ((rank.get(a.kategori || '') || 0) - (rank.get(b.kategori || '') || 0)) || M.compareComponents(a, b));
    }
    L.results = list;
    return list;
  }

  function rowHtml(c, i, q) {
    const here = q.here.get(c.id);
    const total = q.all.get(c.id) || 0;
    const elsewhere = total - (here || 0);
    const sub = [c.uretici, c.ureticiKodu, c.kategori].filter(Boolean).join(' · ');
    const photo = app().photoOf(c.id);
    return `<div class="lp-row${here ? ' in-bom' : ''}${i === L.cursor ? ' cursor' : ''}${c.pasif ? ' pasif' : ''}${photo ? ' has-photo' : ''}" data-id="${esc(c.id)}" data-i="${i}" draggable="true" title="Çift tık ya da + : ekle · sürükle: tabloda istediğin yere bırak">
      <button type="button" class="star${c.favori ? ' on' : ''}" data-act="fav" title="Favori">★</button>
      ${photo ? `<img class="lp-thumb" src="${esc(photo)}" alt="" loading="lazy" draggable="false">` : ''}
      <div class="lp-main">
        <div class="lp-top"><span class="lp-kod">${U.highlight(c.kod, L.query)}</span></div>
        <div class="lp-name">${U.highlight(c.ad, L.query)}</div>
        ${sub ? `<div class="lp-sub">${U.highlight(sub, L.query)}</div>` : ''}
      </div>
      <div class="lp-qty">
        <button type="button" data-act="minus" title="Bir azalt">−</button>
        <input data-act="qty" value="${here ? esc(M.formatQty(here)) : ''}" placeholder="0" inputmode="decimal" title="Bu bölümdeki adet; yazıp Enter">
        <button type="button" class="plus" data-act="plus" title="Bir ekle">+</button>
      </div>
      ${elsewhere > 0 ? `<div class="lp-elsewhere">Diğer bölümlerde ${esc(M.formatQty(elsewhere))} ${esc(c.birim)}</div>` : ''}
    </div>`;
  }

  function renderLeftList(keepCursor) {
    const box = U.$('lpList');
    const lib = app().state.library;
    if (!lib.length) {
      box.innerHTML = `<div class="lp-empty">Komponent kütüphanesi boş.<br>Ana ekrandaki <b>Komponentler</b> sekmesinden ekleyin, CSV ya da Excel yükleyin.
        <br><button type="button" class="btn btn-sm btn-primary" data-act="new">+ Yeni komponent</button></div>`;
      U.$('lpCount').textContent = '';
      renderDetail();
      return;
    }
    const list = computeResults();
    if (!keepCursor) L.cursor = L.query ? 0 : -1;
    if (L.cursor >= list.length) L.cursor = list.length - 1;
    const q = quantities();
    const parts = [];
    let group = null;
    const limit = 2500;
    list.slice(0, limit).forEach((c, i) => {
      if (L.groups) {
        const g = c.favori ? '★ Favoriler' : c.kategori || 'Kategorisiz';
        if (g !== group) {
          group = g;
          parts.push(`<div class="lp-group">${esc(g)}</div>`);
        }
      }
      parts.push(rowHtml(c, i, q));
    });
    if (!list.length) {
      parts.push(`<div class="lp-empty">Aramaya uyan komponent yok.${L.query ? `<br><button type="button" class="btn btn-sm" data-act="new-from-query">“${esc(L.query)}” kodlu yeni komponent</button>` : ''}</div>`);
    } else if (list.length > limit) {
      parts.push(`<div class="lp-empty">${list.length - limit} komponent daha var; aramayı daraltın.</div>`);
    }
    box.innerHTML = parts.join('');
    U.$('lpCount').textContent = L.query || L.category || L.filter !== 'aktif'
      ? `${list.length} / ${lib.length} komponent`
      : `${lib.length} komponent`;
    L.libVersion = app().state.libVersion;
    renderDetail();
  }

  /** Değişiklikten sonra liste yeniden kurulmaz; yalnız miktar kutuları ve işaretler güncellenir */
  function updateQuantities() {
    const box = U.$('lpList');
    if (!box) return;
    if (L.filter === 'used' || L.filter === 'unused' || L.libVersion !== app().state.libVersion) {
      renderLeftList(true);
      return;
    }
    const q = quantities();
    box.querySelectorAll('.lp-row').forEach((row) => {
      const id = row.dataset.id;
      const here = q.here.get(id);
      row.classList.toggle('in-bom', !!here);
      const input = row.querySelector('input[data-act=qty]');
      if (input && document.activeElement !== input) input.value = here ? M.formatQty(here) : '';
      const total = q.all.get(id) || 0;
      const elsewhere = total - (here || 0);
      let note = row.querySelector('.lp-elsewhere');
      if (elsewhere > 0) {
        const c = app().state.libraryById.get(id);
        if (!note) {
          note = document.createElement('div');
          note.className = 'lp-elsewhere';
          row.appendChild(note);
        }
        note.textContent = `Diğer bölümlerde ${M.formatQty(elsewhere)} ${c ? c.birim : ''}`;
      } else if (note) {
        note.remove();
      }
    });
  }

  function setCursor(i, scroll) {
    const list = L.results;
    if (!list.length) return;
    L.cursor = Math.max(0, Math.min(list.length - 1, i));
    const box = U.$('lpList');
    box.querySelectorAll('.lp-row.cursor').forEach((r) => r.classList.remove('cursor'));
    const row = box.querySelector(`.lp-row[data-i="${L.cursor}"]`);
    if (row) {
      row.classList.add('cursor');
      if (scroll) row.scrollIntoView({ block: 'nearest' });
    }
    renderDetail();
  }

  function cursorComponent() {
    return L.cursor >= 0 ? L.results[L.cursor] || null : null;
  }

  function flashRow(id) {
    const row = U.$('lpList').querySelector(`.lp-row[data-id="${CSS.escape(id)}"]`);
    if (!row) return;
    row.classList.remove('flash');
    void row.offsetWidth;
    row.classList.add('flash');
  }

  function addFromList(c, qty) {
    if (!c) return;
    ed().addComponent(c, qty || 1);
    flashRow(c.id);
  }

  function renderDetail() {
    const box = U.$('lpDetail');
    const c = cursorComponent();
    if (!c || !U.pref('detayAcik', true)) {
      box.classList.add('hidden');
      return;
    }
    const usage = app().usageOf(c.id).filter((p) => p.id !== ed().currentId());
    const rows = [
      ['Kategori', c.kategori],
      ['Üretici', c.uretici],
      ['Model kodu', c.ureticiKodu],
      ['Tedarikçi', [c.tedarikci, c.tedarikciKodu].filter(Boolean).join(' · ')],
      ['Birim', c.birim],
      ['Teslim', c.teslimSuresi !== null ? `${c.teslimSuresi} gün` : ''],
      ['Kullanım', usage.length ? `${usage.length} başka projede` : '']
    ].filter(([, v]) => v);
    const photo = app().photoOf(c.id);
    box.innerHTML = `
      ${photo ? `<img class="lp-photo" src="${esc(photo)}" alt="${esc(c.kod)}" data-detail="photo" title="Büyüt">` : ''}
      <h4>${esc(c.kod)} <span>${c.pasif ? 'PASİF · ' : ''}${c.favori ? '★' : ''}</span></h4>
      <div>${esc(c.ad)}</div>
      <dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      ${c.aciklama ? `<p>${esc(c.aciklama)}</p>` : ''}
      <div class="actions">
        <button type="button" class="btn btn-sm btn-primary" data-detail="add">+ Ekle</button>
        <button type="button" class="btn btn-sm" data-detail="edit">Düzenle</button>
        ${c.link ? `<a class="btn btn-sm" href="${esc(c.link)}" target="_blank" rel="noopener">Bağlantı ↗</a>` : ''}
        <button type="button" class="btn btn-sm btn-ghost" data-detail="close" title="Bilgi kartını gizle">Gizle</button>
      </div>`;
    box.classList.remove('hidden');
  }

  function bindLeft() {
    const search = U.$('lpSearch');
    const rerender = U.debounce(() => renderLeftList(), 70);
    search.addEventListener('input', () => {
      L.query = search.value;
      rerender();
    });
    search.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setCursor((L.cursor < 0 ? -1 : L.cursor) + (e.key === 'ArrowDown' ? 1 : -1), true);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const c = cursorComponent() || L.results[0];
        if (!c) return;
        if (e.shiftKey) {
          const input = U.$('lpList').querySelector(`.lp-row[data-id="${CSS.escape(c.id)}"] input[data-act=qty]`);
          if (input) {
            input.focus();
            input.select();
          }
          return;
        }
        addFromList(c, 1);
      } else if (e.key === 'Escape') {
        e.stopPropagation();
        if (search.value) {
          search.value = '';
          L.query = '';
          renderLeftList();
        } else {
          search.blur();
        }
      } else if (e.key === 'PageDown' || e.key === 'PageUp') {
        e.preventDefault();
        setCursor(L.cursor + (e.key === 'PageDown' ? 10 : -10), true);
      }
    });
    U.$('lpCategory').addEventListener('change', (e) => {
      L.category = e.target.value;
      renderLeftList();
    });
    U.$('lpFilter').addEventListener('change', (e) => {
      L.filter = e.target.value;
      renderLeftList();
    });
    U.$('lpTarget').addEventListener('change', (e) => ed().setActiveSection(e.target.value));
    U.$('lpNew').addEventListener('click', () => newComponent(''));
    const list = U.$('lpList');
    list.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]');
      const row = e.target.closest('.lp-row');
      if (act && !row) {
        if (act.dataset.act === 'new') newComponent('');
        if (act.dataset.act === 'new-from-query') newComponent(L.query);
        return;
      }
      if (!row) return;
      const c = app().state.libraryById.get(row.dataset.id);
      if (!c) return;
      const a = act ? act.dataset.act : null;
      if (a === 'fav') {
        app().toggleFavorite(c.id);
        return;
      }
      if (a === 'plus' || a === 'minus') {
        const here = quantities().here.get(c.id) || 0;
        if (a === 'plus') addFromList(c, 1);
        else if (here > 0) ed().setComponentQty(c, Math.max(0, here - 1));
        return;
      }
      if (a === 'qty') return;
      setCursor(Number(row.dataset.i));
    });
    list.addEventListener('dblclick', (e) => {
      if (e.target.closest('[data-act]')) return;
      const row = e.target.closest('.lp-row');
      if (row) addFromList(app().state.libraryById.get(row.dataset.id), 1);
    });
    const commitQty = (input) => {
      const row = input.closest('.lp-row');
      const c = row && app().state.libraryById.get(row.dataset.id);
      if (!c) return;
      const raw = input.value.trim();
      const n = raw === '' ? 0 : M.parseNumber(raw);
      if (n === null || n < 0) {
        U.toast(`"${raw}" geçerli bir miktar değil`, 'error');
        updateQuantities();
        return;
      }
      ed().setComponentQty(c, n);
      flashRow(c.id);
    };
    list.addEventListener('change', (e) => {
      if (e.target.dataset.act === 'qty') commitQty(e.target);
    });
    // Odaklanırken değer saklanır: Esc yazılanı bırakır, blur'daki change de tetiklenmez
    list.addEventListener('focusin', (e) => {
      if (e.target.dataset.act === 'qty') e.target.dataset.orig = e.target.value;
    });
    list.addEventListener('keydown', (e) => {
      if (e.target.dataset.act !== 'qty') return;
      if (e.key === 'Enter') {
        e.preventDefault();
        e.target.blur();
        U.$('lpSearch').focus();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        e.target.value = e.target.dataset.orig || '';
        e.target.blur();
      }
    });
    list.addEventListener('dragstart', (e) => {
      const row = e.target.closest('.lp-row');
      if (!row) return;
      e.dataTransfer.setData(ed().DRAG_COMPONENT, row.dataset.id);
      const c = app().state.libraryById.get(row.dataset.id);
      e.dataTransfer.setData('text/plain', c ? `${c.kod}\t1` : '');
      e.dataTransfer.effectAllowed = 'copy';
    });
    list.addEventListener('contextmenu', (e) => {
      const row = e.target.closest('.lp-row');
      if (!row) return;
      e.preventDefault();
      const c = app().state.libraryById.get(row.dataset.id);
      setCursor(Number(row.dataset.i));
      const sections = ed().project ? ed().project.bolumler : [];
      U.contextMenu(e.clientX, e.clientY, [
        { title: `${c.kod} · ${c.ad}` },
        { label: 'Ekle (1)', run: () => addFromList(c, 1) },
        { label: 'Miktar girerek ekle…', run: async () => {
          const v = await U.promptModal(`${c.kod} ekle`, `Miktar (${c.birim})`, '1', 'Ekle', { validate: (t) => (M.parseNumber(t) > 0 ? '' : 'Sıfırdan büyük bir sayı yazın') });
          if (v) addFromList(c, M.parseNumber(v));
        } },
        { label: 'Bölüme ekle', disabled: sections.length < 2, items: sections.map((s) => ({ label: s.ad, run: () => ed().addComponent(c, 1, { sectionId: s.id }) })) },
        '-',
        { label: c.favori ? 'Favorilerden çıkar' : 'Favorilere ekle', run: () => app().toggleFavorite(c.id) },
        { label: 'Kütüphanede düzenle', run: () => BomxLibrary.openForm(c) },
        { label: 'Kopyasından yeni komponent', run: () => BomxLibrary.openForm(Object.assign({}, c, { id: '', kod: `${c.kod}-2` }), { isNew: true }) }
      ]);
    });
    U.$('lpDetail').addEventListener('click', (e) => {
      const b = e.target.closest('[data-detail]');
      if (!b) return;
      const c = cursorComponent();
      if (b.dataset.detail === 'add') addFromList(c, 1);
      else if (b.dataset.detail === 'photo' && c) U.lightbox(app().photoOf(c.id), `${c.kod} · ${c.ad}`);
      else if (b.dataset.detail === 'edit' && c) BomxLibrary.openForm(c);
      else if (b.dataset.detail === 'close') {
        U.setPref('detayAcik', false);
        renderDetail();
        U.toast('Bilgi kartı gizlendi. Sol panel başlığındaki ⓘ ile yeniden açılır.');
      }
    });
    U.$('lpInfoToggle').addEventListener('click', () => {
      U.setPref('detayAcik', !U.pref('detayAcik', true));
      renderDetail();
    });
  }

  function newComponent(code) {
    BomxLibrary.openForm({ kod: code || '' }, {
      isNew: true,
      offerAdd: true,
      onSaved: (c, add) => {
        if (add) ed().addComponent(c, 1);
        L.query = c.kod;
        U.$('lpSearch').value = c.kod;
        renderLeftList();
      }
    });
  }

  function renderLeftHeader() {
    const st = app().state;
    const sel = U.$('lpCategory');
    const current = L.category;
    const counts = M.categoryCounts(st.library, st.settings);
    sel.innerHTML = `<option value="">Tüm kategoriler</option>${counts.map(([k, n]) => `<option value="${esc(k || '__none')}">${esc(k || 'Kategorisiz')} (${n})</option>`).join('')}`;
    sel.value = counts.some(([k]) => (k || '__none') === current) ? current : '';
    L.category = sel.value;
    renderTarget();
  }

  function renderTarget() {
    const p = ed().project;
    if (!p) return;
    const sel = U.$('lpTarget');
    const active = ed().activeSection;
    sel.innerHTML = p.bolumler.map((s, i) => `<option value="${esc(s.id)}"${s.id === active ? ' selected' : ''}>${i + 1}. ${esc(s.ad)}</option>`).join('');
    U.$('lpTargetWrap').classList.toggle('hidden', p.bolumler.length < 2);
  }

  /* ─── Sol panel: şablonlar ────────────────────────────── */

  function renderTemplates() {
    const box = U.$('ltList');
    const templates = app().state.templates;
    const has = ed().selection.size > 0;
    U.$('ltFromSel').disabled = !has;
    if (!templates.length) {
      box.innerHTML = `<div class="lp-empty">Henüz şablon yok.<br>Sık kullanılan setleri (ör. pompa grubu, pano standart malzemeleri) şablon yapın: tabloda kalemleri seçip <b>Seçilenlerden şablon</b> deyin ya da bölüm başlığına sağ tıklayın.</div>`;
      return;
    }
    const library = app().state.libraryById;
    box.innerHTML = templates.map((t) => {
      return `<div class="lt-item" data-id="${esc(t.id)}">
        <h4>${esc(t.ad)} <span>${t.kalemler.length} kalem</span></h4>
        ${t.aciklama ? `<p>${esc(t.aciklama)}</p>` : ''}
        <div class="lt-actions">
          <button type="button" class="btn btn-xs btn-primary" data-act="add">Bölüme ekle</button>
          <button type="button" class="btn btn-xs" data-act="section">Yeni bölüm olarak</button>
          <button type="button" class="btn btn-xs btn-ghost" data-act="toggle">İçerik ▾</button>
        </div>
        <div class="lt-lines hidden">${t.kalemler.map((l) => `<div class="lt-line"><span></span><strong>${esc(l.kod)}</strong><span>${esc(l.ad)}</span><em>${esc(M.formatQty(l.miktar))} ${esc(l.birim)}</em></div>`).join('')}</div>
      </div>`;
    }).join('');
  }

  function bindTemplates() {
    U.$('ltList').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      const item = e.target.closest('.lt-item');
      if (!b || !item) return;
      const t = app().state.templates.find((x) => x.id === item.dataset.id);
      if (!t) return;
      if (b.dataset.act === 'toggle') {
        item.querySelector('.lt-lines').classList.toggle('hidden');
        return;
      }
      const lines = M.linesFromTemplate(t, app().state.libraryById, ed().activeSection);
      if (b.dataset.act === 'add') ed().addLines(lines, `"${t.ad}" şablonu eklendi`);
      else ed().addLines(lines, `"${t.ad}" yeni bölüm olarak eklendi`, { newSection: t.ad });
      U.toast(`"${t.ad}": ${lines.length} kalem eklendi`);
    });
    U.$('ltFromSel').addEventListener('click', () => templateFromLines(ed().displayOrder().filter((l) => ed().selection.has(l.id)).map((l) => l.id)));
    U.$('ltManage').addEventListener('click', () => app().showHome('templates'));
  }

  async function templateFromLines(ids, suggested) {
    const lines = ids.map((id) => ed().lineById(id)).filter(Boolean);
    if (!lines.length) {
      U.toast('Önce tabloda kalem seçin', 'error');
      return;
    }
    const name = await U.promptModal('Şablon oluştur', `Şablon adı (${lines.length} kalem)`, suggested || '', 'Oluştur', { placeholder: 'Pompa grubu, Pano standart malzemeleri…' });
    if (!name) return;
    const t = await app().saveTemplate(M.templateFromLines(name, lines));
    U.toast(`"${t.ad}" şablonu oluşturuldu: ${t.kalemler.length} kalem`);
    renderTemplates();
  }

  /* ─── Sol panel: başka projeden ───────────────────────── */

  function renderOtherProjects() {
    const sel = U.$('lprSelect');
    const current = ed().currentId();
    const others = app().state.projects.filter((p) => p.id !== current);
    const value = P.otherProject && others.some((p) => p.id === P.otherProject.id) ? P.otherProject.id : '';
    sel.innerHTML = `<option value="">Proje seçin…</option>${others.map((p) => `<option value="${esc(p.id)}">${esc(p.id)} (${p.kalemSayisi} kalem)</option>`).join('')}`;
    sel.value = value;
    if (!value) {
      P.otherProject = null;
      U.$('lprBody').innerHTML = others.length
        ? '<div class="lp-empty">Benzer bir makinenin listesinden kalem almak için proje seçin. Kalemler o projedeki bilgilerle gelir; kaynak proje değişmez.</div>'
        : '<div class="lp-empty">Başka proje yok.</div>';
      return;
    }
    renderOtherLines();
  }

  function renderOtherLines() {
    const p = P.otherProject;
    if (!p) return;
    const numbers = M.lineNumbers(p);
    const html = p.bolumler.map((s) => {
      const lines = p.kalemler.filter((l) => l.bolum === s.id);
      if (!lines.length) return '';
      return `<div class="lt-sec"><input type="checkbox" data-sec="${esc(s.id)}"> ${esc(s.ad)} <span class="muted">(${lines.length})</span></div>
        ${lines.map((l) => `<label class="lt-line"><input type="checkbox" data-line="${esc(l.id)}" data-of="${esc(s.id)}"><strong title="${esc(numbers.get(l.id))}">${esc(l.kod)}</strong><span title="${esc(l.ad)}">${esc(l.ad)}</span><em>${esc(M.formatQty(l.miktar))}</em></label>`).join('')}`;
    }).join('');
    U.$('lprBody').innerHTML = `
      <div class="lt-actions" style="margin-bottom:6px">
        <button type="button" class="btn btn-xs" data-act="all">Tümünü seç</button>
        <button type="button" class="btn btn-xs" data-act="none">Temizle</button>
      </div>
      <div class="lt-lines" style="max-height:none">${html || '<div class="lp-empty">Bu projede kalem yok.</div>'}</div>
      <div class="lt-actions" style="margin-top:8px">
        <button type="button" class="btn btn-sm btn-primary" data-act="add">Seçilenleri ekle</button>
        <button type="button" class="btn btn-sm" data-act="sections">Bölümleriyle ekle</button>
      </div>
      <p class="field-help" style="margin-top:6px">Kalemler kaynak projedeki bilgilerle gelir. Güncel bilgi için Kontrol sekmesindeki “Kütüphaneden güncelle” kullanılır.</p>`;
  }

  function bindOtherProjects() {
    U.$('lprSelect').addEventListener('change', async (e) => {
      const id = e.target.value;
      P.otherProject = id ? await app().store.readProject(id) : null;
      renderOtherProjects();
    });
    U.$('lprBody').addEventListener('change', (e) => {
      if (e.target.dataset.sec) {
        U.$('lprBody').querySelectorAll(`input[data-of="${CSS.escape(e.target.dataset.sec)}"]`).forEach((b) => { b.checked = e.target.checked; });
      }
    });
    U.$('lprBody').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b || !P.otherProject) return;
      const boxes = [...U.$('lprBody').querySelectorAll('input[data-line]')];
      if (b.dataset.act === 'all' || b.dataset.act === 'none') {
        U.$('lprBody').querySelectorAll('input[type=checkbox]').forEach((x) => { x.checked = b.dataset.act === 'all'; });
        return;
      }
      const chosen = new Set(boxes.filter((x) => x.checked).map((x) => x.dataset.line));
      const lines = P.otherProject.kalemler.filter((l) => chosen.has(l.id));
      if (!lines.length) {
        U.toast('Önce eklenecek kalemleri işaretleyin', 'error');
        return;
      }
      if (b.dataset.act === 'add') {
        ed().addLines(lines, `${P.otherProject.id} projesinden ${lines.length} kalem`);
        U.toast(`${lines.length} kalem eklendi`);
        return;
      }
      // Bölümleriyle: aynı adlı bölüm varsa ona, yoksa yeni bölüme
      const p = ed().project;
      let total = 0;
      for (const s of P.otherProject.bolumler) {
        const part = lines.filter((l) => l.bolum === s.id);
        if (!part.length) continue;
        const same = p.bolumler.find((x) => M.fold(x.ad) === M.fold(s.ad));
        if (same) ed().addLines(part, `${s.ad}: ${part.length} kalem`, { sectionId: same.id });
        else ed().addLines(part, `${s.ad}: ${part.length} kalem`, { newSection: s.ad });
        total += part.length;
      }
      U.toast(`${total} kalem bölümleriyle eklendi`);
    });
  }

  /* ─── Sağ panel: özellikler ───────────────────────────── */

  const field = (id, label, value, opts) => {
    const o = opts || {};
    const attrs = `id="${id}" class="field-input"${o.placeholder ? ` placeholder="${esc(o.placeholder)}"` : ''}${o.list ? ` list="${o.list}"` : ''}${o.type ? ` type="${o.type}"` : ''} autocomplete="off" spellcheck="false"`;
    const input = o.multiline ? `<textarea ${attrs} rows="${o.rows || 3}">${esc(value || '')}</textarea>` : `<input ${attrs} value="${esc(value == null ? '' : value)}">`;
    return `<div class="field"><label for="${id}">${esc(label)}</label>${input}${o.help ? `<p class="field-help">${o.help}</p>` : ''}</div>`;
  };

  const select = (id, label, options, value) => `<div class="field"><label for="${id}">${esc(label)}</label><select id="${id}" class="field-input">${options.map(([v, t]) => `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></div>`;

  /** Odaktaki alan ve yazılmış ama henüz kaydedilmemiş metin yeniden çizimde korunur */
  function captureInspectorFocus() {
    const el = document.activeElement;
    if (!el || !U.$('inspector').contains(el)) return null;
    const key = el.id || (el.dataset.rev ? `rev:${el.dataset.rev}:${el.dataset.rf}` : '');
    if (!key) return null;
    return { key, start: el.selectionStart, end: el.selectionEnd, value: el.value, dirty: el.dataset.dirty === '1' };
  }

  function restoreInspectorFocus(f) {
    if (!f) return;
    const box = U.$('inspector');
    let el = null;
    if (f.key.startsWith('rev:')) {
      const [, id, rf] = f.key.split(':');
      el = box.querySelector(`[data-rev="${CSS.escape(id)}"][data-rf="${CSS.escape(rf)}"]`);
    } else {
      el = document.getElementById(f.key);
    }
    if (!el) return;
    if (f.dirty && 'value' in el) {
      el.value = f.value;
      el.dataset.dirty = '1';
    }
    el.focus({ preventScroll: true });
    try {
      el.setSelectionRange(f.start, f.end);
    } catch { /* seçim alanı yok */ }
  }

  function projectInspector(p) {
    const totals = M.projectTotals(p);
    const nameDiffers = M.projectId(p.seriNo, p.musteri, p.model) !== p.id;
    const revs = p.revizyonlar.slice().reverse();
    return `
      <div class="insp-head"><div class="insp-icon">BOM</div><div><div class="insp-title">${esc(p.id)}</div><div class="insp-sub">Proje bilgileri · tabloda kalem seçince kalem bilgileri görünür</div></div></div>
      <div class="insp-stats">
        <div class="stat"><b>${p.kalemler.length}</b><span>kalem · ${p.bolumler.length} bölüm</span></div>
        <div class="stat"><b>${M.formatQty(totals.pieces)}</b><span>adet</span></div>
      </div>
      <div class="insp-section">Proje</div>
      <div class="field-row three">${field('ipSeri', 'Seri no', p.seriNo)}${field('ipMusteri', 'Müşteri', p.musteri)}${field('ipModel', 'Model', p.model)}</div>
      ${nameDiffers ? `<div class="field-help warn">Proje adı bu bilgilerden farklı. <button type="button" class="btn btn-xs" id="ipRename">Proje adını güncelle</button></div>` : ''}
      ${field('ipBaslik', 'Açıklama', p.baslik, { placeholder: 'Örn: 3 tanklı ultrasonik yıkama, opsiyonlu' })}
      <div class="field-row">${select('ipDurum', 'Durum', M.STATUSES.map((s) => [s.id, s.label]), p.durum)}${select('ipFirma', 'Belge anteti', M.BRAND_IDS.map((b) => [b, b]), p.firma)}</div>
      <div class="insp-section">Revizyon <span><button type="button" class="btn btn-xs" id="ipRevUp">+ Rev.</button> ${p.rev !== '00' ? '<button type="button" class="btn btn-xs btn-ghost" id="ipRevDown">Rev. sil</button>' : ''}</span></div>
      <div class="field-row">${field('ipRev', 'Rev.', p.rev)}${field('ipTarih', 'Tarih', p.tarih, { type: 'date' })}</div>
      <div class="field-row three">${field('ipHaz', 'Hazırlayan', p.hazirlayan)}${field('ipKon', 'Kontrol', p.kontrol)}${field('ipOnay', 'Onay', p.onay)}</div>
      ${revs.map((r) => `<div class="rev-item${r.rev === p.rev ? ' current' : ''}">
        <div class="rev-head"><strong>Rev. ${esc(r.rev)}</strong><span>${esc(U.formatDate(r.tarih))}${r.hazirlayan ? ` · ${esc(r.hazirlayan)}` : ''}</span>${r.rev === p.rev ? '<em>GEÇERLİ</em>' : ''}</div>
        <input class="field-input" data-rev="${esc(r.id)}" data-rf="aciklama" value="${esc(r.aciklama)}" placeholder="${r.rev === '00' ? 'İlk yayın' : 'Bu revizyonda ne değişti?'}">
      </div>`).join('')}
      <div class="insp-section">Notlar</div>
      ${field('ipNotlar', 'Belgenin sonunda yazar', p.notlar, { multiline: true, rows: 4 })}
      <div class="insp-section">Proje</div>
      <div class="insp-actions">
        <button type="button" class="btn btn-sm" id="ipDuplicate">Projeyi çoğalt</button>
        <button type="button" class="btn btn-sm btn-danger" id="ipDelete">Projeyi sil</button>
      </div>`;
  }

  /**
   * Kalem bilgisi. Kütüphaneden gelen kalemde yalnız adet (ve bölüm) değişir; ürün bilgisi kütüphanede düzenlenir.
   * Kütüphanede olmayan serbest kalemin alanları burada yazılır.
   */
  function lineInspector(line) {
    const p = ed().project;
    const st = app().state;
    const comp = line.komponentId ? st.libraryById.get(line.komponentId) : null;
    const free = !line.komponentId;
    const diffs = M.libraryDiff(line, comp);
    const no = M.lineNumbers(p).get(line.id);
    const status = free ? ['free', 'Serbest kalem · kütüphanede yok'] : !comp ? ['gone', 'Kütüphanede silinmiş'] : comp.pasif ? ['', 'Kütüphanede · PASİF'] : ['', 'Kütüphaneden'];
    const labels = { kod: 'Stok kodu', ad: 'Tanım', kategori: 'Kategori', uretici: 'Üretici', ureticiKodu: 'Model kodu', tedarikci: 'Tedarikçi', birim: 'Birim', aciklama: 'Açıklama', aciklamaEn: 'Açıklama (EN)', aciklamaDe: 'Açıklama (DE)' };
    const libValue = (f) => (f.startsWith('aciklama') ? M.bomDescription(comp[f]) : comp[f]);
    const usage = comp ? app().usageOf(comp.id).filter((x) => x.id !== p.id) : [];
    const photo = line.komponentId ? app().photoOf(line.komponentId) : '';
    const info = [['Stok kodu', line.kod], ['Tanım', line.ad], ['Model kodu', line.ureticiKodu], ['Açıklama', M.lineDescription(line, p.dil, comp)]].filter(([, v]) => v);
    return `
      <div class="insp-head"><div class="insp-icon ${status[0]}">${esc((line.kod || '?').slice(0, 4))}</div><div><div class="insp-title">${esc(line.kod)} · ${esc(line.ad)}</div><div class="insp-sub">${esc(no)} · ${esc(status[1])}</div></div></div>
      ${photo ? `<img class="insp-photo" src="${esc(photo)}" alt="${esc(line.kod)}" data-insp="photo" title="Büyüt">` : ''}
      <div class="field-row">${field('ilMiktar', M.isPieceUnit(line.birim) ? 'Adet' : `Adet (${line.birim})`, M.formatQty(line.miktar))}${free ? field('ilBirim', 'Birim', line.birim, { list: 'unitList' }) : ''}</div>
      ${p.bolumler.length > 1 ? select('ilBolum', 'Bölüm', p.bolumler.map((s) => [s.id, s.ad]), line.bolum) : ''}
      ${free ? `
        ${field('ilKod', 'Stok kodu', line.kod)}
        ${field('ilAd', 'Tanım', line.ad)}
        ${field('ilUreticiKodu', 'Model kodu', line.ureticiKodu)}
        ${field('ilAciklama', 'Açıklama', line.aciklama, { multiline: true, rows: 3 })}
        ${field('ilAciklamaEn', 'Açıklama (EN)', line.aciklamaEn, { multiline: true, rows: 2 })}
        ${field('ilAciklamaDe', 'Açıklama (DE)', line.aciklamaDe, { multiline: true, rows: 2 })}`
        : `<div class="insp-section">Ürün bilgisi <span class="muted" style="font-weight:400">kütüphaneden</span></div><dl class="kv">${info.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`}
      <div class="insp-section">Kütüphane</div>
      ${comp ? `
        ${diffs.length ? `<div class="libdiff"><b>Kütüphaneden farklı</b><table>${diffs.map((f) => `<tr><td>${esc(labels[f] || f)}</td><td class="old">${esc(line[f] || '—')}</td><td>→</td><td class="new">${esc(libValue(f) || '—')}</td></tr>`).join('')}</table>
          <div class="insp-actions"><button type="button" class="btn btn-xs" id="ilRefresh">Kütüphaneden güncelle</button></div></div>`
          : '<div class="field-help">Kalem kütüphanedeki kayıtla aynı.</div>'}
        ${comp.teslimSuresi !== null ? `<div class="field-help">Teslim süresi: ${comp.teslimSuresi} gün</div>` : ''}
        <div class="insp-actions"><button type="button" class="btn btn-sm" id="ilEditComp">Kütüphanede düzenle</button>${comp.link ? `<a class="btn btn-sm" href="${esc(comp.link)}" target="_blank" rel="noopener">Bağlantı ↗</a>` : ''}</div>
        ${usage.length ? `<div class="field-label">Kullanıldığı diğer projeler (${usage.length})</div><div class="usage-list">${usage.slice(0, 12).map((u) => `<button type="button" class="usage-item" data-open="${esc(u.id)}"><span>${esc(u.id)}</span><span>${esc(U.relTime(u.guncelleme))}</span></button>`).join('')}</div>` : ''}`
        : line.komponentId
          ? '<div class="field-help warn">Bu komponent kütüphaneden silinmiş. Kalem bilgileri listede durur.</div>'
          : '<div class="field-help">Bu kalem kütüphanede yok.</div><div class="insp-actions"><button type="button" class="btn btn-sm" id="ilToLibrary">Kütüphaneye ekle</button></div>'}
      <div class="insp-section">İşlem</div>
      <div class="insp-actions">
        <button type="button" class="btn btn-sm" id="ilDuplicate">Çoğalt</button>
        <button type="button" class="btn btn-sm" id="ilTemplate">Şablon yap</button>
        <button type="button" class="btn btn-sm btn-danger" id="ilDelete">Sil</button>
      </div>`;
  }

  function multiInspector(lines) {
    const p = ed().project;
    const t = M.summarize(lines);
    return `
      <div class="insp-head"><div class="insp-icon multi">${lines.length}</div><div><div class="insp-title">${lines.length} kalem seçili</div><div class="insp-sub">${t.pieces ? `${M.formatQty(t.pieces)} adet` : ''}</div></div></div>
      ${p.bolumler.length > 1 ? `<div class="field"><label for="imBolum">Bölüme taşı</label><div class="input-group"><select id="imBolum" class="field-input">${p.bolumler.map((s) => `<option value="${esc(s.id)}">${esc(s.ad)}</option>`).join('')}</select><button type="button" class="btn btn-sm" id="imMove">Taşı</button></div></div>` : ''}
      <div class="field-row">
        <div class="field"><label for="imMul">Adedi çarp</label><div class="input-group"><input id="imMul" class="field-input" placeholder="2"><button type="button" class="btn btn-sm" id="imMulGo">×</button></div></div>
        <div class="field"><label for="imSet">Adet yap</label><div class="input-group"><input id="imSet" class="field-input" placeholder="1"><button type="button" class="btn btn-sm" id="imSetGo">=</button></div></div>
      </div>
      <div class="insp-section">İşlem</div>
      <div class="insp-actions">
        <button type="button" class="btn btn-sm" id="imRefresh">Kütüphaneden güncelle</button>
        <button type="button" class="btn btn-sm" id="imMerge">Tekrar edenleri birleştir</button>
      </div>
      <div class="insp-actions">
        <button type="button" class="btn btn-sm" id="imDuplicate">Çoğalt</button>
        <button type="button" class="btn btn-sm" id="imTemplate">Şablon yap</button>
        <button type="button" class="btn btn-sm" id="imCopy">Kopyala</button>
      </div>
      <div class="insp-actions"><button type="button" class="btn btn-sm btn-danger" id="imDelete">${lines.length} kalemi sil</button></div>`;
  }

  function renderInspector() {
    const box = U.$('inspector');
    const p = ed().project;
    if (!p) {
      box.innerHTML = '';
      return;
    }
    const focus = captureInspectorFocus();
    const sel = ed().displayOrder().filter((l) => ed().selection.has(l.id));
    box.dataset.mode = sel.length === 0 ? 'project' : sel.length === 1 ? 'line' : 'multi';
    box.dataset.key = sel.map((l) => l.id).join(',');
    box.innerHTML = sel.length === 0 ? projectInspector(p) : sel.length === 1 ? lineInspector(sel[0]) : multiInspector(sel);
    restoreInspectorFocus(focus);
  }

  const renderInspectorSoon = U.debounce(renderInspector, 30);

  function focusInspector() {
    renderInspector();
    const el = U.$('ilMiktar');
    if (el) {
      el.focus();
      el.select();
    }
  }

  function bindInspector() {
    const box = U.$('inspector');
    const metaMap = { ipSeri: 'seriNo', ipMusteri: 'musteri', ipModel: 'model', ipBaslik: 'baslik', ipDurum: 'durum', ipFirma: 'firma', ipTarih: 'tarih', ipHaz: 'hazirlayan', ipKon: 'kontrol', ipOnay: 'onay', ipNotlar: 'notlar' };
    const lineMap = { ilBirim: 'birim', ilKod: 'kod', ilAd: 'ad', ilUreticiKodu: 'ureticiKodu', ilAciklama: 'aciklama', ilAciklamaEn: 'aciklamaEn', ilAciklamaDe: 'aciklamaDe' };
    box.addEventListener('input', (e) => {
      if (e.target.matches('input, textarea')) e.target.dataset.dirty = '1';
    });
    box.addEventListener('change', (e) => {
      const t = e.target;
      const p = ed().project;
      if (!p) return;
      t.dataset.dirty = '';
      if (metaMap[t.id]) {
        const key = metaMap[t.id];
        let value = t.value;
        if (['seriNo', 'musteri', 'model'].includes(key)) value = M.sanitizeName(value);
        else if (key !== 'notlar') value = M.clean(value);
        if (key === 'tarih' && !value) value = M.today();
        ed().setMeta(key, value, 'Proje bilgisi değişti');
        if (key === 'hazirlayan') {
          // Geçerli revizyon satırının hazırlayanı da güncellenir
          ed().mutate('Hazırlayan', (x) => {
            const r = x.revizyonlar.find((rv) => rv.rev === x.rev);
            if (r) r.hazirlayan = value;
          });
        }
        if (key === 'tarih') {
          ed().mutate('Tarih', (x) => {
            const r = x.revizyonlar.find((rv) => rv.rev === x.rev);
            if (r) r.tarih = value;
          });
        }
        return;
      }
      if (t.id === 'ipRev') {
        const rev = M.normalizeRev(t.value);
        ed().mutate(`Rev. ${rev}`, (x) => {
          const r = x.revizyonlar.find((rv) => rv.rev === x.rev);
          if (r && !x.revizyonlar.some((rv) => rv.rev === rev && rv !== r)) r.rev = rev;
          x.rev = rev;
        });
        return;
      }
      if (t.dataset.rev) {
        ed().mutate('Revizyon açıklaması', (x) => {
          const r = x.revizyonlar.find((rv) => rv.id === t.dataset.rev);
          if (r) r[t.dataset.rf] = M.clean(t.value);
        });
        return;
      }
      const sel = [...ed().selection];
      if (sel.length === 1) {
        const id = sel[0];
        const line = ed().lineById(id);
        if (!line) return;
        if (t.id === 'ilMiktar') {
          const raw = t.value.trim();
          const n = raw === '' ? 0 : M.parseNumber(raw);
          if (n === null || n < 0) {
            U.toast('Geçerli bir sayı yazın', 'error');
            renderInspector();
            return;
          }
          ed().updateLine(id, { miktar: n }, `${line.kod}: Adet ${M.formatQty(n)}`);
          return;
        }
        if (t.id === 'ilBolum') {
          ed().moveLines([id], { sectionId: t.value });
          return;
        }
        // Alan yalnız serbest kalemde vardır; kütüphaneden gelen kalemde ürün bilgisi burada değişmez
        if (lineMap[t.id] && !line.komponentId) {
          const key = lineMap[t.id];
          const value = key.startsWith('aciklama') ? t.value.trim() : M.clean(t.value);
          if (key === 'kod' && !value) {
            U.toast('Stok kodu boş olamaz', 'error');
            renderInspector();
            return;
          }
          ed().updateLine(id, { [key]: value || (key === 'birim' ? 'Adet' : '') }, `${line.kod}: ${key}`);
        }
      }
    });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
        e.preventDefault();
        e.target.blur();
        const go = { imMul: 'imMulGo', imSet: 'imSetGo' }[e.target.id];
        if (go) U.$(go).click();
      }
    });
    box.addEventListener('click', async (e) => {
      if (e.target.dataset.insp === 'photo') {
        U.lightbox(e.target.src, e.target.alt);
        return;
      }
      const b = e.target.closest('button');
      if (!b) return;
      const open = b.dataset.open;
      if (open) {
        await app().openProject(open);
        return;
      }
      const sel = ed().displayOrder().filter((l) => ed().selection.has(l.id)).map((l) => l.id);
      const num = (id) => M.parseNumber(U.$(id).value);
      switch (b.id) {
        case 'ipRename': ed().renameProject(); break;
        case 'ipRevUp': ed().bumpRevision(); break;
        case 'ipRevDown': ed().dropRevision(); break;
        case 'ipDuplicate': BomxHome.duplicateProjectDialog(ed().currentId()); break;
        case 'ipDelete': BomxHome.deleteProjectDialog(ed().currentId()); break;
        case 'ilRefresh': ed().refreshFromLibrary(sel); break;
        case 'ilEditComp': {
          const line = ed().lineById(sel[0]);
          const comp = line && app().state.libraryById.get(line.komponentId);
          if (comp) BomxLibrary.openForm(comp);
          break;
        }
        case 'ilToLibrary': ed().addLineToLibrary(sel[0]); break;
        case 'ilDuplicate': case 'imDuplicate': ed().duplicateLines(sel); break;
        case 'ilTemplate': case 'imTemplate': templateFromLines(sel); break;
        case 'ilDelete': case 'imDelete': ed().removeLines(sel); break;
        case 'imMove': ed().moveLines(sel, { sectionId: U.$('imBolum').value }); break;
        case 'imMulGo': {
          const k = num('imMul');
          if (!(k > 0)) return U.toast('Çarpan sıfırdan büyük olmalı', 'error');
          ed().updateLines(sel, (l) => { l.miktar = M.round(l.miktar * k, 6); }, `Adet ×${M.formatQty(k)}`);
          break;
        }
        case 'imSetGo': {
          const k = num('imSet');
          if (k === null || k < 0) return U.toast('Geçerli bir adet yazın', 'error');
          ed().updateLines(sel, (l) => { l.miktar = k; }, `Adet ${M.formatQty(k)}`);
          break;
        }
        case 'imRefresh': ed().refreshFromLibrary(sel); break;
        case 'imMerge': ed().mergeDuplicates(sel); break;
        case 'imCopy': ed().copySelection(); break;
        default: break;
      }
      return undefined;
    });
  }

  /* ─── Sağ panel: kontrol ──────────────────────────────── */

  let lastChecks = [];

  function renderChecks() {
    const p = ed().project;
    if (!p) return;
    const checks = M.checkProject(p, app().state.libraryById);
    lastChecks = checks;
    const serious = checks.filter((c) => c.level === 'error' || c.level === 'warn').length;
    const badge = U.$('checkBadge');
    badge.textContent = serious || '';
    badge.className = `badge${checks.some((c) => c.level === 'error') ? '' : ' warn'}${serious ? '' : ' hidden'}`;
    const box = U.$('checkList');
    if (!checks.length) {
      box.innerHTML = '<div class="check-ok">✓ Liste tutarlı: eksik adet ya da kütüphane farkı yok.</div>';
      return;
    }
    const fixLabel = { refresh: 'Güncelle', relink: 'Bağla', merge: 'Birleştir', removeZero: 'Sil' };
    const order = { error: 0, warn: 1, info: 2 };
    box.innerHTML = checks.map((c, i) => ({ c, i })).sort((a, b) => order[a.c.level] - order[b.c.level]).map(({ c, i }) => `<button type="button" class="check-row${c.lines.length ? '' : ' static'}" data-i="${i}">
      <span class="check-dot ${c.level}"></span><span class="grow">${esc(c.text)}</span>
      ${c.fix ? `<span class="btn btn-xs fix" data-fix="${i}">${esc(fixLabel[c.fix.kind] || 'Düzelt')}</span>` : ''}
    </button>`).join('');
  }

  function bindChecks() {
    U.$('checkList').addEventListener('click', (e) => {
      const fix = e.target.closest('[data-fix]');
      const row = e.target.closest('.check-row');
      if (!row) return;
      const c = lastChecks[Number(row.dataset.i)];
      if (!c) return;
      if (fix && c.fix) {
        if (c.fix.kind === 'refresh') ed().refreshFromLibrary(c.lines, c.fix.fields);
        else if (c.fix.kind === 'relink') ed().relinkLines(c.lines);
        else if (c.fix.kind === 'merge') ed().mergeDuplicates(c.lines);
        else if (c.fix.kind === 'removeZero') ed().removeZero();
        return;
      }
      if (c.lines.length) {
        ed().setSelection(c.lines);
        ed().reveal(c.lines[0]);
      }
    });
  }

  /* ─── Alt panel ───────────────────────────────────────── */

  function dockSummary(p) {
    const totals = M.projectTotals(p);
    const rows = M.categoryBreakdown(p);
    return `<table class="dk-table"><thead><tr><th>Kategori</th><th class="r">Kalem</th><th class="r">Adet</th></tr></thead><tbody>
      ${rows.map((r) => `<tr class="dk-row" data-cat="${esc(r.kategori)}"><td class="b">${esc(r.kategori || 'Kategorisiz')}</td><td class="r">${r.count}</td><td class="r">${M.formatQty(r.pieces) || ''}</td></tr>`).join('') || '<tr><td colspan="3" class="dk-empty">Kalem yok</td></tr>'}
      ${rows.length ? `<tr class="total"><td>Toplam</td><td class="r">${totals.count}</td><td class="r">${M.formatQty(totals.pieces)}</td></tr>` : ''}
    </tbody></table>`;
  }

  function dockPurchase(p) {
    const groups = M.purchaseList(p);
    if (!p.kalemler.length) return '<div class="dk-empty">Kalem yok</div>';
    return `<div class="dk-actions"><button type="button" class="btn btn-xs" data-dock-act="copy-purchase">Metin olarak kopyala</button><button type="button" class="btn btn-xs" data-dock-act="xlsx-purchase">Excel</button><span class="dk-actions-note">Aynı komponent bölümler arasında toplanır; tedarikçiye göre gruplanır.</span></div>
      <table class="dk-table"><thead><tr><th>Stok Kodu</th><th>Tanım</th><th>Üretici / model kodu</th><th class="r">Adet</th><th>Birim</th><th>Referans</th><th>Bölüm</th></tr></thead><tbody>
      ${groups.map((g) => `<tr class="group"><td colspan="7">${esc(g.tedarikci || 'Tedarikçi belirtilmemiş')} · ${g.items.length} kalem</td></tr>
        ${g.items.map((it) => `<tr><td class="b">${esc(it.kod)}</td><td>${esc(it.ad)}</td><td>${esc([it.uretici, it.ureticiKodu].filter(Boolean).join(' · '))}</td><td class="r b">${esc(M.formatQty(it.miktar))}</td><td>${esc(it.birim)}</td><td>${esc(it.referans)}</td><td class="muted">${esc(it.bolumler.join(', '))}</td></tr>`).join('')}`).join('')}
      </tbody></table>`;
  }

  function dockDiff(p) {
    const revs = P.revisions;
    if (!revs.length) {
      return `<div class="dk-empty">Henüz revizyon yok. Sağ paneldeki <b>+ Rev.</b> ile revizyon oluşturunca o anki liste saklanır; sonraki değişiklikler burada ona göre görünür.</div>`;
    }
    const chosen = revs.includes(P.diffRev) ? P.diffRev : revs[revs.length - 1];
    P.diffRev = chosen;
    const d = P.diffCache && P.diffCache.rev === chosen ? P.diffCache.diff : null;
    const head = `<div class="dk-actions">Karşılaştır: <select class="field-input" data-dock-act="diff-rev" style="width:auto">${revs.map((r) => `<option value="${esc(r)}"${r === chosen ? ' selected' : ''}>Rev. ${esc(r)} hâli</option>`).join('')}</select> → şimdiki liste (Rev. ${esc(p.rev)})
      ${d ? `<span class="dk-actions-note"><span class="diff-add">+${d.added.length} eklenen</span> · <span class="diff-del">−${d.removed.length} çıkarılan</span> · <span class="diff-chg">${d.changed.length} değişen</span> · ${d.same} aynı</span>` : ''}</div>`;
    if (!d) {
      loadDiff(chosen);
      return `${head}<div class="dk-empty">Yükleniyor…</div>`;
    }
    const rows = [
      ...d.added.map((x) => `<tr><td class="diff-add">Eklendi</td><td class="b">${esc(x.kod)}</td><td>${esc(x.ad)}</td><td class="r">—</td><td class="r diff-add">${esc(M.formatQty(x.miktar))} ${esc(x.birim)}</td></tr>`),
      ...d.removed.map((x) => `<tr><td class="diff-del">Çıkarıldı</td><td class="b">${esc(x.kod)}</td><td>${esc(x.ad)}</td><td class="r diff-del">${esc(M.formatQty(x.miktar))} ${esc(x.birim)}</td><td class="r">—</td></tr>`),
      ...d.changed.map((x) => `<tr><td class="diff-chg">Değişti</td><td class="b">${esc(x.kod)}</td><td>${esc(x.ad)}</td><td class="r">${esc(M.formatQty(x.eski.miktar))}</td><td class="r diff-chg">${esc(M.formatQty(x.yeni.miktar))} ${esc(x.birim)}</td></tr>`)
    ];
    return `${head}<table class="dk-table"><thead><tr><th>Değişiklik</th><th>Stok Kodu</th><th>Tanım</th><th class="r">Rev. ${esc(chosen)}</th><th class="r">Şimdi</th></tr></thead><tbody>${rows.join('') || '<tr><td colspan="5" class="dk-empty">Rev. ' + esc(chosen) + ' hâlinden bu yana komponent ya da adet değişmedi.</td></tr>'}</tbody></table>`;
  }

  async function loadDiff(rev) {
    const p = ed().project;
    if (!p) return;
    const snap = await app().store.readRevision(p.id, rev);
    P.diffCache = { rev, diff: M.diffBoms(snap ? snap.kalemler : [], ed().project ? ed().project.kalemler : []) };
    if (P.dock === 'diff') renderDock();
  }

  function dockRefs(p) {
    const refs = M.referenceIndex(p);
    if (!refs.length) return '<div class="dk-empty">Referans yok. P&PX makine kaydından açılan projelerde kalemlerin P&ID kodları burada listelenir.</div>';
    const numbers = M.lineNumbers(p);
    return `<table class="dk-table"><thead><tr><th>Referans</th><th>Sıra</th><th>Kod</th><th>Ad</th><th>Üretici kodu</th></tr></thead><tbody>
      ${refs.map((r) => r.lines.map((l, i) => `<tr class="dk-row" data-line="${esc(l.id)}"><td class="b${r.lines.length > 1 ? ' warn-text' : ''}">${i ? '' : esc(r.ref)}${!i && r.lines.length > 1 ? ' ⚑' : ''}</td><td class="muted">${esc(numbers.get(l.id))}</td><td class="b">${esc(l.kod)}</td><td>${esc(l.ad)}</td><td>${esc(l.ureticiKodu)}</td></tr>`).join('')).join('')}
    </tbody></table>`;
  }

  function renderDock() {
    const p = ed().project;
    if (!p) return;
    const dock = U.$('dock');
    dock.classList.toggle('collapsed', !P.dockOpen);
    U.$('dockBody').style.height = `${P.dockHeight}px`;
    document.querySelectorAll('.dock-tab').forEach((t) => t.classList.toggle('active', t.dataset.dock === P.dock));
    U.$('dockToggle').textContent = P.dockOpen ? '▾' : '▴';
    U.$('dockToggle').title = P.dockOpen ? 'Alt paneli kapat' : 'Alt paneli aç';
    const refs = M.referenceIndex(p);
    U.$('dcSummary').textContent = M.categoryBreakdown(p).length || '';
    U.$('dcPurchase').textContent = M.purchaseList(p).length || '';
    U.$('dcRefs').textContent = refs.length || '';
    U.$('dcDiff').textContent = P.revisions.length ? `Rev. ${P.revisions[P.revisions.length - 1]}` : '';
    if (!P.dockOpen) return;
    const body = U.$('dockBody');
    const top = body.scrollTop;
    if (P.dock === 'summary') body.innerHTML = dockSummary(p);
    else if (P.dock === 'purchase') body.innerHTML = dockPurchase(p);
    else if (P.dock === 'diff') body.innerHTML = dockDiff(p);
    else body.innerHTML = dockRefs(p);
    body.scrollTop = top;
  }

  async function revisionsChanged() {
    const id = ed().currentId();
    P.revisions = id ? await app().store.listRevisions(id) : [];
    P.diffCache = null;
    renderDock();
  }

  function purchaseText(p) {
    const lines = [`${p.id} · Satın alma listesi`, ''];
    for (const g of M.purchaseList(p)) {
      lines.push(`${g.tedarikci || 'Tedarikçi belirtilmemiş'}:`);
      for (const it of g.items) lines.push(`  ${M.formatQty(it.miktar)} ${it.birim}  ${it.kod}  ${it.ad}${it.ureticiKodu ? ` (${it.ureticiKodu})` : ''}`);
      lines.push('');
    }
    return lines.join('\n');
  }

  function bindDock() {
    document.querySelectorAll('.dock-tab').forEach((t) => t.addEventListener('click', () => {
      if (P.dock === t.dataset.dock && P.dockOpen) {
        P.dockOpen = false;
      } else {
        P.dock = t.dataset.dock;
        P.dockOpen = true;
      }
      U.setPref('dock', P.dock);
      U.setPref('dockAcik', P.dockOpen);
      renderDock();
    }));
    U.$('dockToggle').addEventListener('click', () => {
      P.dockOpen = !P.dockOpen;
      U.setPref('dockAcik', P.dockOpen);
      renderDock();
    });
    const handle = U.$('dockResize');
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const startY = e.clientY;
      const startH = P.dockHeight;
      const move = (ev) => {
        P.dockHeight = Math.max(90, Math.min(window.innerHeight * 0.65, startH + startY - ev.clientY));
        U.$('dockBody').style.height = `${P.dockHeight}px`;
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        U.setPref('dockYukseklik', P.dockHeight);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
    U.$('dockBody').addEventListener('change', (e) => {
      if (e.target.dataset.dockAct === 'diff-rev') {
        P.diffRev = e.target.value;
        P.diffCache = null;
        renderDock();
      }
    });
    U.$('dockBody').addEventListener('click', async (e) => {
      const act = e.target.closest('[data-dock-act]');
      if (act && act.tagName === 'BUTTON') {
        const p = ed().project;
        if (act.dataset.dockAct === 'copy-purchase') {
          await U.copyText(purchaseText(p));
          U.toast('Satın alma listesi metin olarak kopyalandı (e-postaya yapıştırılır)');
        } else if (act.dataset.dockAct === 'xlsx-purchase') {
          BomxOutput.exportExcel({ purchaseOnly: true });
        }
        return;
      }
      const row = e.target.closest('.dk-row');
      if (!row) return;
      if (row.dataset.line) {
        ed().setSelection([row.dataset.line]);
        ed().reveal(row.dataset.line);
      } else if (row.dataset.cat !== undefined) {
        const ids = ed().displayOrder().filter((l) => (l.kategori || '') === row.dataset.cat).map((l) => l.id);
        ed().setSelection(ids);
        if (ids[0]) ed().reveal(ids[0]);
      }
    });
  }

  /* ─── Alt çubuk: bölüm sekmeleri ve adet özeti ────────── */

  let tabsHeld = false;

  function renderSectionTabs() {
    if (tabsHeld) return;
    const p = ed().project;
    if (!p) return;
    const view = ed().view;
    const active = ed().activeSection;
    const counts = new Map();
    for (const l of p.kalemler) counts.set(l.bolum, (counts.get(l.bolum) || 0) + 1);
    U.$('secTabs').innerHTML = `<button type="button" class="sec-tab${view === 'all' ? ' active' : ''}" data-view="all" title="Bütün bölümler (PageUp / PageDown)">Tümü <span class="n">${p.kalemler.length}</span></button>
      ${p.bolumler.map((s, i) => `<button type="button" class="sec-tab${view === s.id ? ' active' : ''}${s.id === active && p.bolumler.length > 1 ? ' target' : ''}" data-view="${esc(s.id)}" data-drop title="${esc(s.ad)} · çift tık: adını değiştir · kalem ya da komponent sürükleyip bırakın">${i + 1}. ${esc(s.ad)} <span class="n">${counts.get(s.id) || 0}</span></button>`).join('')}
      <button type="button" class="sec-add" id="secAdd" title="Yeni bölüm (alt montaj, pano, pnömatik…)">+ Bölüm</button>`;
    const current = U.$('secTabs').querySelector('.sec-tab.active');
    if (current) current.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function renderTotals() {
    const p = ed().project;
    if (!p) return;
    const t = M.projectTotals(p);
    const sel = ed().displayOrder().filter((l) => ed().selection.has(l.id));
    const selSum = M.summarize(sel);
    const selText = sel.length > 1 ? `<span>Seçili ${sel.length}${selSum.pieces ? `: <b>${esc(M.formatQty(selSum.pieces))} adet</b>` : ''}</span>` : '';
    U.$('totals').innerHTML = `${selText}<span>${t.count} kalem${t.pieces ? ` · <strong>${esc(M.formatQty(t.pieces))} adet</strong>` : ''}</span>`;
  }

  function bindBottom() {
    const tabs = U.$('secTabs');
    const release = () => {
      if (!tabsHeld) return;
      setTimeout(() => {
        tabsHeld = false;
        renderSectionTabs();
      });
    };
    tabs.addEventListener('pointerdown', () => { tabsHeld = true; });
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    tabs.addEventListener('click', (e) => {
      if (e.target.closest('#secAdd')) {
        ed().addSection();
        return;
      }
      const tab = e.target.closest('.sec-tab');
      if (tab) ed().setView(tab.dataset.view);
    });
    tabs.addEventListener('dblclick', (e) => {
      const tab = e.target.closest('.sec-tab');
      if (tab && tab.dataset.view !== 'all') ed().renameSection(tab.dataset.view);
    });
    tabs.addEventListener('contextmenu', (e) => {
      const tab = e.target.closest('.sec-tab');
      if (!tab || tab.dataset.view === 'all') return;
      e.preventDefault();
      const id = tab.dataset.view;
      const p = ed().project;
      U.contextMenu(e.clientX, e.clientY, [
        { title: ed().sectionById(id).ad },
        { label: 'Eklenecek bölüm yap', run: () => ed().setActiveSection(id) },
        { label: 'Yeniden adlandır', run: () => ed().renameSection(id) },
        { label: 'Sola taşı', disabled: p.bolumler[0].id === id, run: () => ed().moveSection(id, -1) },
        { label: 'Sağa taşı', disabled: p.bolumler[p.bolumler.length - 1].id === id, run: () => ed().moveSection(id, 1) },
        '-',
        { label: 'Bölümü sil', danger: true, disabled: p.bolumler.length < 2, run: () => ed().deleteSection(id) }
      ]);
    });
    tabs.addEventListener('dragover', (e) => {
      const tab = e.target.closest('.sec-tab[data-drop]');
      const types = [...e.dataTransfer.types];
      if (!tab || !(types.includes(ed().DRAG_LINES) || types.includes(ed().DRAG_COMPONENT))) return;
      e.preventDefault();
      tabs.querySelectorAll('.sec-tab.drop').forEach((t) => t.classList.remove('drop'));
      tab.classList.add('drop');
    });
    tabs.addEventListener('dragleave', () => tabs.querySelectorAll('.sec-tab.drop').forEach((t) => t.classList.remove('drop')));
    tabs.addEventListener('drop', (e) => {
      const tab = e.target.closest('.sec-tab[data-drop]');
      tabs.querySelectorAll('.sec-tab.drop').forEach((t) => t.classList.remove('drop'));
      if (!tab) return;
      e.preventDefault();
      ed().handleDrop(e.dataTransfer, { sectionId: tab.dataset.view, beforeId: null });
    });
  }

  /* ─── Sekmeler ve yenileme ────────────────────────────── */

  function selectLeftTab(tab) {
    P.left = tab;
    document.querySelectorAll('#leftTabs .panel-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    U.$('lpComponents').classList.toggle('hidden', tab !== 'components');
    U.$('lpTemplates').classList.toggle('hidden', tab !== 'templates');
    U.$('lpProjects').classList.toggle('hidden', tab !== 'projects');
    if (tab === 'templates') renderTemplates();
    if (tab === 'projects') renderOtherProjects();
  }

  function selectRightTab(tab) {
    P.right = tab;
    document.querySelectorAll('#rightTabs .panel-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    U.$('rpProps').classList.toggle('hidden', tab !== 'props');
    U.$('rpChecks').classList.toggle('hidden', tab !== 'checks');
  }

  const heavySoon = U.debounce(() => {
    if (!ed().project) return;
    renderChecks();
    P.diffCache = null;
    renderDock();
    if (P.left === 'templates') renderTemplates();
  }, 160);

  /** Düzenleyicideki her değişiklikte: hafif kısımlar hemen, kontrol ve alt panel kısa gecikmeyle */
  function refresh(options) {
    const o = options || {};
    if (!ed().project) return;
    updateQuantities();
    renderTarget();
    renderSectionTabs();
    renderTotals();
    if (o.selection) renderInspector();
    else renderInspectorSoon();
    if (P.left === 'templates') U.$('ltFromSel').disabled = !ed().selection.size;
    if (!o.light) heavySoon();
  }

  async function onOpen() {
    L.query = '';
    U.$('lpSearch').value = '';
    renderLeftHeader();
    renderLeftList();
    selectRightTab('props');
    P.otherProject = null;
    selectLeftTab(P.left);
    renderInspector();
    renderSectionTabs();
    renderTotals();
    renderChecks();
    await revisionsChanged();
  }

  function focusSearch() {
    selectLeftTab('components');
    U.$('lpSearch').focus();
    U.$('lpSearch').select();
  }

  function init() {
    bindLeft();
    bindTemplates();
    bindOtherProjects();
    bindInspector();
    bindChecks();
    bindDock();
    bindBottom();
    document.querySelectorAll('#leftTabs .panel-tab').forEach((b) => b.addEventListener('click', () => selectLeftTab(b.dataset.tab)));
    document.querySelectorAll('#rightTabs .panel-tab').forEach((b) => b.addEventListener('click', () => selectRightTab(b.dataset.tab)));
    U.$('lpFilter').value = L.filter;
    app().on('library', () => {
      if (!ed().project) return;
      renderLeftHeader();
      renderLeftList(true);
      ed().render();
      refresh();
    });
    app().on('photos', () => {
      if (!ed().project) return;
      renderLeftList(true);
      renderDetail();
      ed().render();
      renderInspector();
    });
    app().on('templates', () => {
      if (ed().project && P.left === 'templates') renderTemplates();
    });
    app().on('projects', () => {
      if (ed().project && P.left === 'projects' && !P.otherProject) renderOtherProjects();
    });
    app().on('settings', () => {
      if (!ed().project) return;
      renderLeftHeader();
      renderInspector();
      updateLists();
    });
    updateLists();
  }

  /** Birim ve kategori önerileri (datalist) */
  function updateLists() {
    const s = app().settings;
    const cats = [...new Set([...s.kategoriler, ...app().state.library.map((c) => c.kategori).filter(Boolean)])];
    U.$('unitList').innerHTML = s.birimler.map((u) => `<option value="${esc(u)}">`).join('');
    U.$('categoryList').innerHTML = cats.map((u) => `<option value="${esc(u)}">`).join('');
  }

  return {
    init,
    onOpen,
    refresh,
    renderInspector,
    focusInspector,
    selectLeftTab,
    selectRightTab,
    focusSearch,
    revisionsChanged,
    templateFromLines,
    updateLists
  };
})();
