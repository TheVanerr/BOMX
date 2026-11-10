/* Hücreleri düzenlenebilen tablo (div ızgara): kütüphane sayfası ve içe aktarma önizlemesi kullanır.
   Tek düzenleyici vardır: düzenlenen hücreye kutu konur; Enter alttaki, Tab sağdaki hücreye geçer,
   Esc vazgeçer (Excel gibi). Tablo başka bir nedenle yeniden çizilse de açık düzenleyici yazılanla
   yerinde kalır. Satır başındaki kutular Shift ile aralık seçer. */

const BomxGrid = (() => {
  const U = BomxUi;
  const { esc } = U;
  let listSeq = 0;

  // Fare basılıyken düzenleyici odağı kaybederse kayıt tık bitince yapılır: kaydın tetiklediği yeniden çizim
  // tıklanan öğeyi (başka hücre, Aktar düğmesi) fare bırakılmadan silerse tarayıcı tıklamayı göndermez.
  let pointerDown = false;
  document.addEventListener('mousedown', () => { pointerDown = true; }, true);
  document.addEventListener('mouseup', () => { pointerDown = false; }, true);

  /** Fare bırakılıp tıklama işlendikten sonra çalıştırır (en geç 2 sn) */
  function afterClick(fn) {
    let done = false;
    const run = () => {
      if (done) return;
      done = true;
      document.removeEventListener('mouseup', onUp, true);
      clearTimeout(timer);
      setTimeout(fn, 0);
    };
    const onUp = () => run();
    document.addEventListener('mouseup', onUp, true);
    const timer = setTimeout(run, 2000);
  }

  /**
   * @param root kap (.grid-table)
   * @param o.columns [{ key, label, width, align: 'right', sort, editable: bool | (row) => bool,
   *   kind: 'text'|'number'|'select'|'multiline', options: (row) => [değer | [değer, etiket]], list: () => [öneri],
   *   cell: (row) => html, value: (row) => düzenleyicideki ilk metin, title: (row) => ipucu, className }]
   * @param o.rows () => görünen satırlar (sırasıyla); o.id (row) => kimlik; o.rowClass (row) => sınıflar
   * @param o.check { has(id), setMany(ids, on), disabled?(row), title?, rerenderAll? } satır başı kutuları
   * @param o.editMode () => tek tıkla düzenleme (kapalıyken çift tık düzenler)
   * @param o.commit async (row, key, text) => hata metni ya da boş
   * @param o.onRowClick, o.onContext (row, event), o.onAction (act, row, event, el), o.onSort (key), o.sort () => { key, desc }
   * @param o.onCheck () seçim değişince; o.empty () => html; o.limit çizilen en çok satır
   */
  function create(root, o) {
    let editor = null;
    let lastCheck = null;
    let clickTimer = null;
    let rows = [];
    let byId = new Map();

    const columns = () => (o.check ? [{ key: '__check', width: '30px' }] : []).concat(o.columns);
    const colByKey = (k) => o.columns.find((c) => c.key === k);
    const editable = (c, row) => !!c && (typeof c.editable === 'function' ? c.editable(row) : !!c.editable);
    const textOf = (c, row) => (c.value ? c.value(row) : row[c.key] == null ? '' : String(row[c.key]));
    const checkable = (row) => !(o.check && o.check.disabled && o.check.disabled(row));

    function refresh() {
      rows = o.rows();
      byId = new Map(rows.map((r) => [String(o.id(r)), r]));
    }

    const rowById = (id) => byId.get(String(id)) || null;
    const rowEl = (id) => root.querySelector(`.gt-row[data-id="${CSS.escape(String(id))}"]`);
    const cellEl = (id, key) => {
      const r = rowEl(id);
      return r ? r.querySelector(`.gt-c[data-k="${CSS.escape(key)}"]`) : null;
    };

    /* ── Çizim ── */

    function headHtml(cols, tpl) {
      return `<div class="gt-head" style="grid-template-columns:${tpl}">${cols.map((c) => {
        if (c.key === '__check') {
          const list = rows.filter(checkable);
          const all = list.length > 0 && list.every((r) => o.check.has(o.id(r)));
          return `<div class="gt-check"><input type="checkbox" data-act="checkAll" ${all ? 'checked' : ''} title="${esc(o.check.title || 'Görünenleri seç')}"></div>`;
        }
        const s = o.sort ? o.sort() : null;
        const sorted = s && s.key === c.key;
        return `<div class="${c.sort ? 'sortable' : ''}${sorted ? ` sorted${s.desc ? ' desc' : ''}` : ''}"${c.sort ? ` data-sort="${esc(c.key)}"` : ''}${c.align === 'right' ? ' style="text-align:right"' : ''}${c.headTitle ? ` title="${esc(c.headTitle)}"` : ''}>${esc(c.label || '')}</div>`;
      }).join('')}</div>`;
    }

    function cellHtml(row, c) {
      if (c.key === '__check') {
        return `<div class="gt-c gt-check"><input type="checkbox" data-act="check" tabindex="-1" ${o.check.has(o.id(row)) ? 'checked' : ''}${checkable(row) ? '' : ' disabled'}></div>`;
      }
      const ed = editable(c, row);
      const title = c.title ? c.title(row) : '';
      const extra = typeof c.className === 'function' ? c.className(row) : c.className || '';
      return `<div class="gt-c${ed ? ' ed' : ''}${c.align === 'right' ? ' c-num' : ''}${extra ? ` ${extra}` : ''}" data-k="${esc(c.key)}"${title ? ` title="${esc(title)}"` : ''}>${c.cell ? c.cell(row) : esc(textOf(c, row))}</div>`;
    }

    function rowHtml(row, cols, tpl) {
      const cls = o.rowClass ? o.rowClass(row) : '';
      return `<div class="gt-row${cls ? ` ${cls}` : ''}" data-id="${esc(o.id(row))}" style="grid-template-columns:${tpl}">${cols.map((c) => cellHtml(row, c)).join('')}</div>`;
    }

    /** Açık düzenleyicinin yazılanı (yeniden çizimden sonra aynı hücrede açılır) */
    function capture() {
      if (!editor || editor.busy) return null;
      const el = editor.el;
      const keep = { id: editor.id, key: editor.key, value: el.value, initial: editor.initial, focused: document.activeElement === el,
        selStart: typeof el.selectionStart === 'number' ? el.selectionStart : null, selEnd: typeof el.selectionEnd === 'number' ? el.selectionEnd : null };
      editor.closed = true;
      editor = null;
      return keep;
    }

    /** Yeniden çizimden sonra düzenleyici yerine konur; odağı başka yere geçmişse (tık bekleyen kayıt) değeri kaydedilir */
    function restore(keep) {
      if (!keep || !rowById(keep.id)) return;
      if (keep.focused) {
        startEdit(keep.id, keep.key, keep);
        return;
      }
      if (keep.value === keep.initial) return;
      Promise.resolve().then(async () => {
        const row = rowById(keep.id);
        if (!row) return;
        let error = '';
        try {
          error = (await o.commit(row, keep.key, keep.value)) || '';
        } catch (err) {
          error = (err && err.message) || String(err);
        }
        if (error) U.toast(error, 'error');
        renderRow(keep.id);
      });
    }

    /** Sütunların en küçük toplamı: her satır aynı genişlikte çizilir, kesirli sütunlar satırdan satıra kaymaz */
    function minWidth(cols) {
      return cols.reduce((sum, c) => {
        const m = String(c.width).match(/^(\d+)px$/) || String(c.width).match(/^minmax\((\d+)px/);
        return sum + (m ? Number(m[1]) : 80);
      }, 0);
    }

    function render() {
      const keep = capture();
      refresh();
      const cols = columns();
      const tpl = cols.map((c) => c.width).join(' ');
      root.style.setProperty('--gt-min', `${minWidth(cols)}px`);
      const limit = o.limit || 5000;
      const body = rows.length
        ? rows.slice(0, limit).map((r) => rowHtml(r, cols, tpl)).join('') + (rows.length > limit ? `<div class="gt-more">İlk ${limit} satır gösteriliyor; aramayı ya da filtreyi daraltın.</div>` : '')
        : `<div class="gt-empty">${o.empty ? o.empty() : 'Kayıt yok.'}</div>`;
      root.innerHTML = headHtml(cols, tpl) + body;
      root.classList.toggle('editable', !!(o.editMode && o.editMode()));
      restore(keep);
    }

    /** Tek satırı yeniden çizer (satırdaki açık düzenleyici korunur). Düzenleme sonrası filtreden çıkan satır, tablo yeniden çizilene dek yerinde güncel hâliyle kalır. */
    function renderRow(id) {
      const el = rowEl(id);
      const before = byId.get(String(id));
      refresh();
      const row = rowById(id) || before;
      if (!el || !row) return;
      const keep = editor && editor.id === String(id) ? capture() : null;
      const cols = columns();
      const tpl = cols.map((c) => c.width).join(' ');
      el.outerHTML = rowHtml(row, cols, tpl);
      updateHead();
      restore(keep);
    }

    function updateHead() {
      const box = root.querySelector('[data-act="checkAll"]');
      if (!box) return;
      const list = rows.filter(checkable);
      box.checked = list.length > 0 && list.every((r) => o.check.has(o.id(r)));
    }

    /* ── Düzenleyici ── */

    function makeInput(c, row, value) {
      let el;
      if (c.kind === 'select') {
        el = document.createElement('select');
        const opts = (c.options ? c.options(row) : []).map((x) => (Array.isArray(x) ? x : [x, x]));
        if (!opts.some(([v]) => String(v) === value)) opts.unshift([value, value || '—']);
        el.innerHTML = opts.map(([v, label]) => `<option value="${esc(v)}"${String(v) === value ? ' selected' : ''}>${esc(label)}</option>`).join('');
      } else if (c.kind === 'multiline') {
        el = document.createElement('textarea');
        el.rows = 3;
        el.value = value;
      } else {
        el = document.createElement('input');
        el.type = 'text';
        el.autocomplete = 'off';
        el.spellcheck = false;
        if (c.kind === 'number') el.inputMode = 'decimal';
        el.value = value;
      }
      el.className = `gt-editor${c.kind === 'number' ? ' num' : ''}`;
      return el;
    }

    /** @returns açıldı mı */
    function startEdit(id, key, init) {
      const sid = String(id);
      const row = rowById(sid);
      const c = colByKey(key);
      if (!row || !editable(c, row)) return false;
      if (editor) {
        if (editor.id === sid && editor.key === key && !editor.closed) return true;
        const prev = editor;
        editor = null;
        if (!prev.busy) finish(prev, null);
      }
      const cell = cellEl(sid, key);
      if (!cell) return false;
      const value = init && init.value !== undefined ? init.value : textOf(c, row);
      const el = makeInput(c, row, value);
      cell.classList.add('editing');
      cell.closest('.gt-row').classList.add('editing-row');
      cell.innerHTML = '';
      cell.appendChild(el);
      if (c.list && el.tagName === 'INPUT') {
        const values = c.list(row) || [];
        if (values.length) {
          const dl = document.createElement('datalist');
          listSeq += 1;
          dl.id = `gtList${listSeq}`;
          dl.innerHTML = values.map((v) => `<option value="${esc(v)}">`).join('');
          cell.appendChild(dl);
          el.setAttribute('list', dl.id);
        }
      }
      const ed = { id: sid, key, el, initial: init && init.initial !== undefined ? init.initial : textOf(c, row), closed: false, busy: false, kind: c.kind };
      editor = ed;
      bind(ed);
      if (!init || init.focused !== false) {
        el.focus({ preventScroll: true });
        if (init && init.selStart !== null && init.selStart !== undefined && el.setSelectionRange) el.setSelectionRange(init.selStart, init.selEnd);
        else if (el.select) el.select();
      }
      cell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      return true;
    }

    function bind(ed) {
      const { el } = ed;
      el.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          cancel(ed);
          return;
        }
        if (e.key === 'Enter') {
          if (ed.kind === 'multiline' && (e.shiftKey || e.altKey)) return; // kutu içinde yeni satır
          e.preventDefault();
          finish(ed, e.shiftKey ? 'up' : 'down');
          return;
        }
        if (e.key === 'Tab') {
          e.preventDefault();
          finish(ed, e.shiftKey ? 'left' : 'right');
          return;
        }
        if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && ed.kind !== 'select' && ed.kind !== 'multiline' && !e.altKey) {
          e.preventDefault();
          finish(ed, e.key === 'ArrowDown' ? 'down' : 'up');
        }
      });
      el.addEventListener('input', () => el.classList.remove('bad'));
      el.addEventListener('blur', () => {
        if (ed.closed || ed.busy || !el.isConnected) return;
        if (pointerDown) afterClick(() => finish(ed, null));
        else finish(ed, null);
      });
      if (ed.kind === 'select') el.addEventListener('change', () => finish(ed, null));
    }

    function close(ed) {
      ed.closed = true;
      if (editor === ed) editor = null;
      if (ed.el.isConnected) renderRow(ed.id);
    }

    function cancel(ed) {
      const row = rowEl(ed.id);
      close(ed);
      if (row && o.onCancel) o.onCancel();
    }

    /** Sonraki hücre: aşağı/yukarı aynı sütun, sağ/sol aynı satırın düzenlenebilen hücresi (satır sonunda alta geçer) */
    function neighbor(id, key, nav) {
      const ids = rows.map((r) => String(o.id(r)));
      const i = ids.indexOf(id);
      if (i < 0) return null;
      if (nav === 'down' || nav === 'up') {
        const step = nav === 'down' ? 1 : -1;
        for (let j = i + step; j >= 0 && j < ids.length; j += step) {
          if (editable(colByKey(key), rowById(ids[j]))) return { id: ids[j], key };
        }
        return null;
      }
      const cols = o.columns;
      const step = nav === 'right' ? 1 : -1;
      let ci = cols.findIndex((c) => c.key === key);
      let ri = i;
      for (let guard = 0; guard < cols.length * 2 + 2; guard += 1) {
        ci += step;
        if (ci >= cols.length) {
          ci = 0;
          ri += 1;
        } else if (ci < 0) {
          ci = cols.length - 1;
          ri -= 1;
        }
        if (ri < 0 || ri >= ids.length) return null;
        if (editable(cols[ci], rowById(ids[ri]))) return { id: ids[ri], key: cols[ci].key };
      }
      return null;
    }

    async function finish(ed, nav) {
      if (ed.closed || ed.busy) return;
      const value = ed.el.value;
      const row = rowById(ed.id);
      const target = nav ? neighbor(ed.id, ed.key, nav) : null;
      if (!row || value === ed.initial) {
        close(ed);
        if (target && !editor) startEdit(target.id, target.key);
        return;
      }
      ed.busy = true;
      let error = '';
      try {
        error = (await o.commit(row, ed.key, value)) || '';
      } catch (err) {
        error = (err && err.message) || String(err);
      }
      ed.busy = false;
      if (error) {
        U.toast(error, 'error');
        // Enter / Tab ile: kutu açık kalır, düzeltilir. Başka yere tıklanınca: eski değer geri gelir
        if (nav && ed.el.isConnected && !ed.closed && (!editor || editor === ed)) {
          ed.el.classList.add('bad');
          ed.el.focus();
          if (ed.el.select) ed.el.select();
          return;
        }
        close(ed);
        renderRow(ed.id);
        return;
      }
      close(ed);
      refresh();
      renderRow(ed.id);
      if (target && !editor) startEdit(target.id, target.key);
    }

    /* ── Olaylar ── */

    function toggleCheck(row, on, shift) {
      const id = String(o.id(row));
      let ids = [id];
      if (shift && lastCheck !== null) {
        const order = rows.map((r) => String(o.id(r)));
        const a = order.indexOf(lastCheck);
        const b = order.indexOf(id);
        if (a >= 0 && b >= 0) ids = order.slice(Math.min(a, b), Math.max(a, b) + 1).filter((x) => checkable(rowById(x)));
      }
      o.check.setMany(ids, on);
      lastCheck = id;
      // Seçim başka satırları da etkiliyorsa (önizlemede tekrar eden kodun durumu) tablo bütün çizilir
      if (ids.length > 1 || o.check.rerenderAll) render();
      else renderRow(id);
      if (o.onCheck) o.onCheck();
    }

    root.addEventListener('click', (e) => {
      if (e.target.closest('.gt-editor')) return;
      const all = e.target.closest('[data-act="checkAll"]');
      if (all) {
        o.check.setMany(rows.filter(checkable).map((r) => String(o.id(r))), all.checked);
        render();
        if (o.onCheck) o.onCheck();
        return;
      }
      const sort = e.target.closest('[data-sort]');
      if (sort && o.onSort) {
        o.onSort(sort.dataset.sort);
        return;
      }
      const r = e.target.closest('.gt-row');
      if (!r) {
        if (o.onEmptyClick) o.onEmptyClick(e);
        return;
      }
      const row = rowById(r.dataset.id);
      if (!row) return;
      const box = e.target.closest('[data-act="check"]');
      if (box) {
        toggleCheck(row, box.checked, e.shiftKey);
        return;
      }
      const act = e.target.closest('[data-act]');
      if (act && o.onAction) {
        o.onAction(act.dataset.act, row, e, act);
        return;
      }
      const cell = e.target.closest('.gt-c');
      if (cell && cell.classList.contains('ed') && o.editMode && o.editMode()) {
        startEdit(r.dataset.id, cell.dataset.k);
        return;
      }
      if (!o.onRowClick) return;
      // Düzenlenebilen hücrede çift tık düzenler: tek tık kısa bekleyip satırı açar, çift tık bunu iptal eder
      clearTimeout(clickTimer);
      if (cell && cell.classList.contains('ed')) {
        clickTimer = setTimeout(() => {
          clickTimer = null;
          o.onRowClick(row, e);
        }, 240);
      } else {
        o.onRowClick(row, e);
      }
    });
    // Shift ile aralık seçerken metin seçilmesin
    root.addEventListener('mousedown', (e) => {
      if (e.shiftKey && e.target.closest('.gt-check')) e.preventDefault();
    });
    root.addEventListener('dblclick', (e) => {
      if (e.target.closest('.gt-editor')) return;
      const cell = e.target.closest('.gt-c.ed');
      const r = e.target.closest('.gt-row');
      if (cell && r) {
        e.preventDefault();
        clearTimeout(clickTimer);
        clickTimer = null;
        startEdit(r.dataset.id, cell.dataset.k);
      }
    });
    root.addEventListener('contextmenu', (e) => {
      if (e.target.closest('.gt-editor') || !o.onContext) return;
      const r = e.target.closest('.gt-row');
      const row = r && rowById(r.dataset.id);
      if (!row) return;
      e.preventDefault();
      o.onContext(row, e);
    });

    return {
      render,
      renderRow,
      updateHead,
      edit: startEdit,
      isEditing: () => !!editor,
      /** Açık düzenleyiciyi kaydeder (pencere kapanmadan, aktarmadan önce) */
      async flush() {
        if (editor && !editor.busy) await finish(editor, null);
      },
      cancel() {
        if (editor) cancel(editor);
      }
    };
  }

  return { create };
})();
