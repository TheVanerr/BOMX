/* Çıktılar: Excel, CSV ve PDF. PDF, P&PX'in vektörel PDF motoruyla üretilir (pdf.js, pdf-dom.js):
   sayfalar tarayıcıda dizilir, ölçülür, PDF'e aynı yerde çizilir; yazı tipi gömülür, metin seçilir.
   Belge önizleme penceresi aynı sayfaları gösterir: ne görülüyorsa o basılır. */

const BomxOutput = (() => {
  const M = BomxModel;
  const U = BomxUi;
  const { esc } = U;
  const app = () => BomxApp;
  const ed = () => BomxEditor;

  const MM = 96 / 25.4;
  const CONTENT_W = 273;
  const CONTENT_H = 172;
  const BRANDS = {
    DOLFIN: { type: 'text', name: 'DOLFIN', sub: 'Makine Sanayi', logo: 'dolfin', footer: 'CNK ELEKTRONİK MAKİNE SAN A.Ş.', color: '#ff0000' },
    ENVA: { type: 'logo', logo: 'enva', footer: 'Enva Specialist Waste Ltd', color: '#007938' },
    VICO: { type: 'logo', logo: 'vico', footer: 'vico AB', color: '#C41E3A' },
    KSYSTEM: { type: 'logo', logo: 'ksystem', footer: 'K.SYSTEM GMBH', color: '#1B04AE' }
  };
  const PDF_COLS = {
    foto: { w: 16, cls: 'c photo' },
    kod: { w: 26, cls: 'code' },
    ad: { w: 64 },
    ureticiKodu: { w: 40 },
    miktar: { w: 15, cls: 'r qty' },
    aciklama: { w: 0, cls: 'muted nl' }
  };

  // Önizleme ve PDF her zaman o an açık projeyi kullanır (geri alma, başka cihazdan birleşme sonrası da güncel)
  const S = { open: false, scale: 1 };
  const openProjectNow = () => ed().project;

  /* ─── Excel ve CSV ────────────────────────────────────── */

  function current(options) {
    const o = options || {};
    return o.project || ed().project;
  }

  const lineComponent = (line) => (line.komponentId ? app().state.libraryById.get(line.komponentId) || null : null);
  const linePhoto = (line) => (line.komponentId ? app().photoOf(line.komponentId) : '');

  async function exportExcel(options) {
    const o = options || {};
    const p = current(o);
    if (!p) return;
    if (!o.project) await ed().flush();
    const out = M.normalizeOutput(p.cikti);
    try {
      const bytes = BomxXlsx.bomWorkbook(p, { lang: p.dil, purchase: true, summary: true, revisions: out.revizyonlar, photoOf: linePhoto, componentOf: lineComponent });
      const name = `${U.fileName(p.id)} BOM Rev.${p.rev}${o.purchaseOnly ? ' satin alma' : ''}.xlsx`;
      U.download(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name);
      U.toast(`Excel indirildi: ${name}${o.purchaseOnly ? ' (Satın Alma sayfası ikinci sekmede)' : ''}`);
    } catch (e) {
      U.toast(`Excel oluşturulamadı: ${e.message}`, 'error');
    }
  }

  async function exportCsv(options) {
    const p = current(options);
    if (!p) return;
    const name = `${U.fileName(p.id)} BOM Rev.${p.rev}.csv`;
    U.download(new Blob([M.toCsv(M.projectToCsvRows(p, p.dil, app().state.libraryById))], { type: 'text/csv;charset=utf-8' }), name);
    U.toast(`CSV indirildi: ${name}`);
  }

  /* ─── Sayfalar ────────────────────────────────────────── */

  /** Sütunlar sabittir; kalan genişlik açıklamaya gider */
  function pdfColumns() {
    const cols = M.COLUMNS.map((c) => Object.assign({ key: c.key, doc: c.doc }, PDF_COLS[c.key]));
    cols.find((c) => c.key === 'aciklama').w = CONTENT_W - cols.reduce((n, c) => n + c.w, 0);
    return cols;
  }

  function cellHtml(line, col, lang) {
    switch (col.key) {
      case 'foto': {
        const src = linePhoto(line);
        return `<div class="bp-ph">${src ? `<img class="bp-photo" src="${esc(src)}" alt="">` : ''}</div>`;
      }
      case 'miktar': return esc(col.plain ? M.formatQty(line.miktar) : M.qtyText(line, lang));
      case 'birim': return esc(M.unitText(line.birim, lang));
      case 'aciklama': return esc(M.docSafe(M.lineDescription(line, lang, lineComponent(line))));
      default: return esc(M.docSafe(line[col.key]));
    }
  }

  function colgroup(cols) {
    return `<colgroup>${cols.map((c) => `<col style="width:${c.w}mm">`).join('')}</colgroup>`;
  }

  function headRow(cols, T) {
    const cls = (c) => {
      const parts = (c.cls || '').split(/\s+/);
      return [parts.includes('r') ? 'r' : parts.includes('c') ? 'c' : '', parts.includes('nl') ? 'nl' : ''].filter(Boolean).join(' ');
    };
    return `<tr>${cols.map((c) => `<th class="${cls(c)}">${esc(T[c.doc] || c.doc)}</th>`).join('')}</tr>`;
  }

  /** Belgenin sırası: bilgi, tablo satırları (bölüm başlıklarıyla), notlar, revizyonlar */
  function bomRows(project, cols, lang) {
    const rows = [];
    const multi = project.bolumler.length > 1;
    const numbered = M.numberedLines(project);
    project.bolumler.forEach((s, si) => {
      const items = numbered.filter((n) => n.section.id === s.id);
      if (!items.length && multi) return;
      if (multi) rows.push({ kind: 'sec', section: s, index: si, html: `<tr class="sec"><td colspan="${cols.length}"><span class="n">${si + 1}</span>${esc(s.ad)}</td></tr>` });
      for (const { line } of items) {
        rows.push({ kind: 'line', section: s, index: si, html: `<tr>${cols.map((c) => `<td class="${c.cls || ''}">${cellHtml(line, c, lang)}</td>`).join('')}</tr>` });
      }
    });
    return rows;
  }

  function infoHtml(project, T, lang, totals) {
    const fmt = U.formatDate;
    const row = (a, b, c, d, e, f) => `<tr><td class="k">${esc(a)}</td><td class="v">${esc(b)}</td><td class="k">${esc(c)}</td><td class="v">${esc(d)}</td><td class="k">${esc(e)}</td><td class="v">${esc(f)}</td></tr>`;
    const summary = `${totals.count} ${T.items}${project.bolumler.length > 1 ? ` · ${project.bolumler.length} ${T.sections}` : ''}`;
    return `<table class="bp-info"><colgroup><col style="width:21mm"><col><col style="width:21mm"><col style="width:42mm"><col style="width:23mm"><col style="width:48mm"></colgroup>
      ${row(T.project, project.seriNo, T.rev, project.rev, T.prepared, project.hazirlayan)}
      ${row(T.customer, project.musteri, T.date, fmt(project.tarih), T.checked, project.kontrol)}
      ${row(T.model, project.model, T.status, M.statusLabel(project.durum, lang), T.approved, project.onay)}
      ${project.baslik ? `<tr><td class="k">${esc(T.desc)}</td><td class="v" colspan="3">${esc(project.baslik)}</td><td class="k">${esc(T.scope)}</td><td class="v">${esc(summary)}</td></tr>`
        : `<tr><td class="k">${esc(T.scope)}</td><td class="v" colspan="5">${esc(summary)}</td></tr>`}
    </table>`;
  }

  function revisionsHtml(project, T) {
    return `<table class="bp-table"><colgroup><col style="width:14mm"><col style="width:24mm"><col style="width:45mm"><col></colgroup>
      <thead><tr><th class="c">${esc(T.rev)}</th><th>${esc(T.date)}</th><th>${esc(T.prepared)}</th><th>${esc(T.desc)}</th></tr></thead>
      <tbody>${project.revizyonlar.map((r) => `<tr><td class="c code">${esc(r.rev)}</td><td>${esc(U.formatDate(r.tarih))}</td><td>${esc(r.hazirlayan)}</td><td>${esc(M.revisionNote(r, T))}</td></tr>`).join('')}</tbody></table>`;
  }

  function purchaseRows(project, T, lang) {
    const cols = [
      { key: 'kod', w: 26, cls: 'code', doc: 'code' }, { key: 'ad', w: 0, doc: 'name' }, { key: 'uretici', w: 26, doc: 'maker' }, { key: 'ureticiKodu', w: 40, doc: 'makerCode' },
      { key: 'miktar', w: 16, cls: 'r qty', doc: 'qty', plain: true }, { key: 'birim', w: 13, cls: 'c', doc: 'unit' }, { key: 'referans', w: 34, cls: 'muted', doc: 'ref' }
    ];
    cols.find((c) => c.key === 'ad').w = CONTENT_W - cols.reduce((n, c) => n + c.w, 0);
    const rows = [];
    for (const g of M.purchaseList(project)) {
      rows.push({ kind: 'sec', group: g.tedarikci || T.noSupplier, html: `<tr class="group"><td colspan="${cols.length}">${esc(g.tedarikci || T.noSupplier)} · ${g.items.length} ${esc(T.items)}</td></tr>` });
      for (const it of g.items) {
        rows.push({ kind: 'line', group: g.tedarikci, html: `<tr>${cols.map((c) => `<td class="${c.cls || ''}">${cellHtml(it, c, lang)}</td>`).join('')}</tr>` });
      }
    }
    return { cols, rows };
  }

  function summaryHtml(project, T) {
    const totals = M.projectTotals(project);
    const rows = M.categoryBreakdown(project);
    return `<table class="bp-table"><colgroup><col><col style="width:24mm"><col style="width:24mm"></colgroup>
      <thead><tr><th>${esc(T.category)}</th><th class="r">${esc(T.count)}</th><th class="r">${esc(T.qty)}</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td class="code">${esc(r.kategori || T.uncategorized)}</td><td class="r">${r.count}</td><td class="r">${r.pieces ? esc(M.formatQty(r.pieces)) : ''}</td></tr>`).join('')}
      <tr class="total"><td>${esc(T.total)}</td><td class="r">${totals.count}</td><td class="r">${esc(M.formatQty(totals.pieces))}</td></tr></tbody></table>`;
  }

  function pageShell(project, T, brand, logos) {
    const page = document.createElement('div');
    page.className = 'print-sheet bp-page';
    page.lang = project.dil;
    page.style.setProperty('--accent', brand.color);
    const brandHtml = brand.type === 'logo' && logos && logos[brand.logo]
      ? `<img src="${logos[brand.logo]}" alt="${esc(project.firma)}">`
      : `<span class="bp-brand-name">${esc(brand.name || project.firma)}</span>${brand.sub ? `<span class="bp-brand-sub" lang="tr">${esc(brand.sub)}</span>` : ''}`;
    page.innerHTML = `
      <div class="bp-header"><div class="bp-brand">${brandHtml}</div>
        <div class="bp-doc"><div class="bp-doc-title">${esc(T.title)}</div><div class="bp-doc-sub">${esc(M.projectId(project.seriNo, project.musteri, project.model) || project.id)} · ${esc(T.rev)} ${esc(project.rev)}</div></div></div>
      <div class="bp-content"></div>
      <div class="bp-footer"><span>${esc(brand.footer || '')}</span><span class="mid">${esc(T.generated)} · ${esc(U.formatDate(project.tarih))}</span><span class="pg"></span></div>`;
    return page;
  }

  /** Uzun model adı kapaktaki alanına sığsın (P&PX ile aynı eşikler) */
  function coverTitleSize(text) {
    const n = String(text).length;
    return n <= 10 ? 74 : n <= 16 ? 61 : n <= 24 ? 48 : n <= 34 ? 38 : 31;
  }

  /**
   * Standart kapak: P&PX'te seçili "Kırmızı Bant" tasarımı (A3 yerine belgeyle aynı A4 yatay).
   * @param pages kapak hariç numaralı sayfa sayısı
   */
  function coverPage(project, T, brand, logos, pages) {
    const lang = project.dil;
    const upper = (text) => String(text || '').toLocaleUpperCase(lang === 'tr' ? 'tr' : lang);
    const model = upper(project.model);
    const logo = logos && logos[brand.logo];
    const rows = [
      [T.project, project.seriNo, true],
      [T.customer, project.musteri],
      [T.model, project.model],
      project.baslik ? [T.desc, project.baslik] : null,
      [T.docType, T.docTypeValue],
      [T.rev, project.rev],
      [T.date, U.formatDate(project.tarih)],
      [T.pages, pages]
    ].filter(Boolean);
    const sign = (label, name) => `<div class="pcv-sign-box"><span>${esc(label)}</span><b>${esc(name)}</b></div>`;
    const page = document.createElement('div');
    page.className = 'print-sheet bp-page pcv pcv-bant';
    page.lang = lang;
    page.style.setProperty('--pcv-accent', brand.color);
    page.innerHTML = `
      <aside class="pcv-band"><span class="pcv-band-mark">BOM</span></aside>
      <div class="pcv-main">
        ${logo ? `<img class="pcv-logo" src="${logo}" alt="${esc(project.firma)}">` : `<div class="pcv-logo-text">${esc(brand.name || project.firma)}</div>`}
        <div class="pcv-body">
          <div class="pcv-head">
            <div class="pcv-kicker">${esc(T.title)}</div>
            <h1 class="pcv-title" style="font-size:${coverTitleSize(model)}px">${esc(model)}</h1>
            <div class="pcv-rule"></div>
            <div class="pcv-customer">${esc(upper(project.musteri))}</div>
          </div>
          <dl class="pcv-list">${rows.map(([k, v, strong]) => `<div class="pcv-row"><dt>${esc(k)}</dt><dd${strong ? ' class="strong"' : ''}>${esc(v)}</dd></div>`).join('')}</dl>
        </div>
        <div class="pcv-sign">${sign(T.prepared, project.hazirlayan)}${sign(T.checked, project.kontrol)}${sign(T.approved, project.onay)}</div>
        <div class="pcv-foot">${esc(brand.footer || '')}</div>
      </div>`;
    return page;
  }

  /**
   * Sayfaları kurar: içerik görünmeyen bir ölçü alanında dizilir, satır yükseklikleri ölçülür,
   * sayfalara bölünür. Her sayfada tablo başlığı yinelenir, bölüm başka sayfaya geçerse "(devam)" yazar.
   */
  function buildPages(project, logos, options) {
    const out = M.normalizeOutput(project.cikti);
    const withCover = options && options.cover !== undefined ? options.cover : out.kapak;
    const lang = project.dil;
    const T = M.docText(lang);
    const brand = BRANDS[project.firma] || BRANDS.DOLFIN;
    const cols = pdfColumns();
    const totals = M.projectTotals(project);
    const limit = CONTENT_H * MM - 2;
    const gap = 3.2 * MM;

    const measure = document.createElement('div');
    measure.className = 'bp-page bp-measure';
    measure.style.cssText = `width:${CONTENT_W}mm;height:auto;--accent:${brand.color}`;
    measure.lang = lang;
    document.body.appendChild(measure);
    const heightOf = (html) => {
      measure.innerHTML = html;
      return measure.firstElementChild ? measure.firstElementChild.getBoundingClientRect().height : 0;
    };
    const measureRows = (colsDef, rows) => {
      measure.innerHTML = `<table class="bp-table">${colgroup(colsDef)}<thead>${headRow(colsDef, T)}</thead><tbody>${rows.map((r) => r.html).join('')}</tbody></table>`;
      const trs = measure.querySelectorAll('tbody tr');
      rows.forEach((r, i) => { r.h = trs[i].getBoundingClientRect().height; });
      return measure.querySelector('thead tr').getBoundingClientRect().height;
    };

    const pages = [];
    let page = null;
    let content = null;
    let used = 0;
    const newPage = () => {
      page = pageShell(project, T, brand, logos);
      content = page.querySelector('.bp-content');
      pages.push(page);
      used = 0;
    };
    const addBlock = (html, h, keep) => {
      if (!page || (keep !== false && used > 0 && used + gap + h > limit)) newPage();
      if (used > 0) used += gap;
      content.insertAdjacentHTML('beforeend', html);
      used += h;
    };

    /** Satırları sayfalara böler; sayfa başında başlık, bölüm sürüyorsa "(devam)" satırı */
    const flowTable = (colsDef, rows, contHtml) => {
      if (!rows.length) return;
      const headH = measureRows(colsDef, rows);
      const contRows = new Map();
      let table = null;
      const startTable = (cont) => {
        if (used > 0) used += gap;
        content.insertAdjacentHTML('beforeend', `<table class="bp-table">${colgroup(colsDef)}<thead>${headRow(colsDef, T)}</thead><tbody></tbody></table>`);
        table = content.lastElementChild.querySelector('tbody');
        used += headH;
        if (cont) {
          table.insertAdjacentHTML('beforeend', cont.html);
          used += cont.h;
        }
      };
      if (!page) newPage();
      if (used + gap + headH + (rows[0].h || 0) + (rows[1] ? rows[1].h : 0) > limit && used > 0) newPage();
      startTable(null);
      let lastSec = null;
      rows.forEach((r, i) => {
        // Bölüm başlığı sayfanın son satırı olmasın: altındaki ilk kalemle birlikte geçer
        const need = r.h + (r.kind === 'sec' && rows[i + 1] ? rows[i + 1].h : 0);
        if (used + need > limit) {
          newPage();
          let cont = null;
          if (r.kind !== 'sec' && lastSec) {
            if (!contRows.has(lastSec.key)) {
              const html = contHtml(lastSec.row);
              contRows.set(lastSec.key, { html, h: heightOf(`<table class="bp-table">${colgroup(colsDef)}<tbody>${html}</tbody></table>`) });
            }
            cont = contRows.get(lastSec.key);
          }
          startTable(cont);
        }
        table.insertAdjacentHTML('beforeend', r.html);
        used += r.h;
        if (r.kind === 'sec') lastSec = { key: i, row: r };
      });
    };

    // 1. Bilgi alanı
    newPage();
    addBlock(infoHtml(project, T, lang, totals), heightOf(infoHtml(project, T, lang, totals)));
    // 2. Malzeme listesi
    const rows = bomRows(project, cols, lang);
    const contHtml = (secRow) => secRow.html.replace('</td></tr>', ` <span class="cont">${esc(T.continued)}</span></td></tr>`);
    flowTable(cols, rows, contHtml);
    // 3. Notlar, revizyonlar
    if (out.notlar && project.notlar) {
      const html = `<div class="bp-notes"><b>${esc(T.notes)}</b>${esc(project.notlar)}</div>`;
      addBlock(html, heightOf(html));
    }
    if (out.revizyonlar && project.revizyonlar.length) {
      const html = `<div><div class="bp-h"><span class="t">${esc(T.revisions)}</span></div><div style="margin-top:2mm">${revisionsHtml(project, T)}</div></div>`;
      addBlock(html, heightOf(html));
    }
    // 4. Özet ve satın alma listesi ayrı sayfadan başlar
    // Yazı tipinde olmayan işaret kullanılmaz (Σ, ✚ gibi); başlıklar yalnız yazıdır
    if (out.ozet && project.kalemler.length) {
      newPage();
      const html = `<div><div class="bp-h"><span class="t">${esc(T.summary)}</span><span class="s">${esc(T.byCategory)}</span></div><div style="margin-top:3mm">${summaryHtml(project, T)}</div></div>`;
      addBlock(html, heightOf(html));
    }
    if (out.satinAlma && project.kalemler.length) {
      newPage();
      const h = `<div class="bp-h"><span class="t">${esc(T.purchase)}</span><span class="s">${esc(T.supplier)}</span></div>`;
      addBlock(h, heightOf(h));
      const pr = purchaseRows(project, T, lang);
      flowTable(pr.cols, pr.rows, (secRow) => secRow.html.replace('</td>', ` <span class="cont">${esc(T.continued)}</span></td>`));
    }
    measure.remove();
    pages.forEach((p, i) => {
      p.querySelector('.pg').textContent = `${T.page} ${i + 1} / ${pages.length}`;
    });
    // Kapak numarasızdır; üzerindeki sayfa sayısı numaralı sayfalardır
    return withCover ? [coverPage(project, T, brand, logos, pages.length), ...pages] : pages;
  }

  /* ─── PDF motoru ──────────────────────────────────────── */

  let engineReady = null;
  function loadEngine() {
    if (!engineReady) {
      engineReady = (async () => {
        await U.loadScript('codes/pdf/pdf.js');
        await U.loadScript('codes/pdf/pdf-dom.js');
        await U.loadScript('codes/pdf/fonts.js');
      })().catch((e) => {
        engineReady = null;
        throw e;
      });
    }
    return engineReady;
  }

  let logosReady = null;
  function loadLogos() {
    if (!logosReady) {
      logosReady = U.loadScript('codes/pdf/logos.js').then(() => window.BOMX_LOGOS || {}, () => ({}));
    }
    return logosReady;
  }

  const base64Bytes = (b64) => {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  };

  function nextPaint() {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, 500);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        clearTimeout(timer);
        resolve();
      }));
    });
  }

  function imagesDecoded(root) {
    const images = [...root.querySelectorAll('img')];
    return Promise.race([Promise.all(images.map((img) => (img.decode ? img.decode().catch(() => {}) : null))), new Promise((r) => setTimeout(r, 3000))]);
  }

  let busyPdf = false;

  /** Dil seçimi kalıcıdır (bu tarayıcıda); hiç seçilmediyse belgenin dili */
  function openPdfDialog(projectArg) {
    const project = projectArg || openProjectNow();
    if (!project || busyPdf) return;
    const out = M.normalizeOutput(project.cikti);
    const saved = U.pref('pdfDiller', null);
    const initial = new Set(Array.isArray(saved) && saved.length ? saved : [project.dil]);
    const m = U.modal(`
      <h2>PDF İndir <button type="button" class="icon-btn sm x" data-close title="Kapat">×</button></h2>
      <div class="field-label">Belge dili</div>
      <div class="pdf-langs">${M.DOC_LANGS.map(([id, code, name]) => `<label class="pdf-lang${initial.has(id) ? ' is-on' : ''}" title="${name}"><input type="checkbox" data-lang="${id}"${initial.has(id) ? ' checked' : ''}>${code}</label>`).join('')}</div>
      <label class="switch-row${out.kapak ? ' is-on' : ''}"><span>Kapak</span><input type="checkbox" id="pdfCover"${out.kapak ? ' checked' : ''}></label>
      <p class="field-help">Birden çok dil seçerseniz her dil kapağıyla birlikte tam belge olarak arka arkaya tek PDF'te birleşir (TR, EN, DE sırasıyla). Dosya doğrudan İndirilenler'e iner.</p>
      <div class="field-error" id="pdfError"></div>
      <div class="modal-actions"><button type="button" class="btn" data-close>Vazgeç</button><button type="submit" class="btn btn-primary">PDF İndir</button></div>`, {
      onSubmit: (e, entry) => {
        const langs = M.DOC_LANGS.map(([id]) => id).filter((id) => entry.el.querySelector(`[data-lang="${id}"]`).checked);
        if (!langs.length) {
          entry.el.querySelector('#pdfError').textContent = 'En az bir dil seçin';
          return;
        }
        const cover = entry.el.querySelector('#pdfCover').checked;
        entry.close();
        U.setPref('pdfDiller', langs);
        downloadPdf(project, { langs, cover });
      }
    });
    m.el.addEventListener('change', (e) => {
      const label = e.target.closest('.pdf-lang, .switch-row');
      if (label) label.classList.toggle('is-on', e.target.checked);
    });
  }

  /** @param options.langs belge dilleri (TR, EN, DE sırasıyla tek PDF), options.cover kapak */
  async function downloadPdf(projectArg, options) {
    const o = options || {};
    const project = projectArg || openProjectNow();
    if (!project || busyPdf) return;
    busyPdf = true;
    const b = U.busy('PDF hazırlanıyor…');
    const root = U.$('printRoot');
    let began = false;
    try {
      await ed().flush();
      await loadEngine();
      const logos = await loadLogos();
      await PidPdfDom.loadFonts(async (file) => {
        const b64 = window.BOMX_FONTS && window.BOMX_FONTS[file];
        return b64 ? { ok: true, bytes: base64Bytes(b64) } : { ok: false };
      });
      PidPdfDom.begin();
      began = true;
      await document.fonts.ready;
      root.innerHTML = '';
      // Sayfalar gömülecek yazı tipiyle yeniden dizilir: ölçü ve PDF aynı harf genişliğini kullanır
      const langs = o.langs && o.langs.length ? o.langs : [project.dil];
      for (const lang of langs) {
        buildPages(Object.assign({}, project, { dil: lang }), logos, o.cover === undefined ? undefined : { cover: o.cover }).forEach((p) => root.appendChild(p));
      }
      await imagesDecoded(root);
      await nextPaint();
      const T = M.docText(langs[0]);
      const pdf = await PidPdfDom.render(root, {
        title: `${project.id} ${T.title} Rev.${project.rev}`,
        onProgress: (done, total) => b.update(`PDF hazırlanıyor: ${done} / ${total} sayfa`)
      });
      const tag = langs.length > 1 || langs[0] !== 'tr' ? ` ${langs.map((l) => l.toUpperCase()).join('-')}` : '';
      const name = `${U.fileName(project.id)} BOM Rev.${project.rev}${tag}.pdf`;
      U.download(new Blob([pdf.bytes], { type: 'application/pdf' }), name);
      const notes = [];
      if (pdf.missing.length) notes.push(`yazı tipinde olmayan karakterler: ${pdf.missing.join(' ')}`);
      if (pdf.failedImages) notes.push(`${pdf.failedImages} görsel eklenemedi`);
      U.toast(notes.length ? `PDF indirildi, eksikler var (${notes.join('; ')})` : `PDF indirildi: ${name} (${pdf.pages} sayfa)`, notes.length ? 'warn' : '');
    } catch (e) {
      console.error(e);
      U.toast(`PDF oluşturulamadı: ${e.message}`, 'error');
    } finally {
      root.innerHTML = '';
      if (began) PidPdfDom.end();
      b.close();
      busyPdf = false;
    }
  }

  /* ─── Önizleme penceresi ──────────────────────────────── */

  function renderStudio() {
    const p = openProjectNow();
    const out = M.normalizeOutput(p.cikti);
    const box = U.$('studioRoot');
    const opt = (key, label) => `<label><input type="checkbox" data-opt="${key}" ${out[key] ? 'checked' : ''}> ${esc(label)}</label>`;
    box.querySelector('.studio-opts').innerHTML = `
      ${opt('kapak', 'Kapak')}${opt('ozet', 'Özet sayfası')}${opt('satinAlma', 'Satın alma listesi')}${opt('revizyonlar', 'Revizyonlar')}${opt('notlar', 'Notlar')}
      <div class="lang-seg" title="Belge dili (program arayüzü Türkçe kalır)">${['tr', 'en', 'de'].map((l) => `<button type="button" data-lang="${l}" class="${p.dil === l ? 'active' : ''}">${l.toUpperCase()}</button>`).join('')}</div>
      <select class="field-input" data-brand title="Antet">${M.BRAND_IDS.map((b) => `<option${b === p.firma ? ' selected' : ''}>${b}</option>`).join('')}</select>`;
    drawPages();
  }

  async function drawPages() {
    const holder = U.$('studioPages');
    const logos = await loadLogos();
    const pages = buildPages(openProjectNow(), logos);
    const width = holder.clientWidth - 48;
    const k = Math.min(1.25, Math.max(0.35, width / (297 * MM)));
    S.scale = k;
    holder.innerHTML = '';
    for (const page of pages) {
      const wrap = document.createElement('div');
      wrap.className = 'studio-page';
      wrap.style.width = `${297 * MM * k}px`;
      wrap.style.height = `${210 * MM * k}px`;
      page.style.transform = `scale(${k})`;
      page.style.transformOrigin = '0 0';
      wrap.appendChild(page);
      holder.appendChild(wrap);
    }
    U.$('studioInfo').textContent = `${pages.length} sayfa · A4 yatay · ${openProjectNow().dil.toUpperCase()}`;
  }

  function setOutput(patch) {
    const p = ed().project;
    const next = Object.assign(M.normalizeOutput(p.cikti), patch);
    ed().setMeta('cikti', next, 'Belge seçenekleri');
  }

  async function openStudio() {
    const p = ed().project;
    if (!p) return;
    await ed().flush();
    S.open = true;
    U.$('studioRoot').classList.remove('hidden');
    U.$('studioTitle').textContent = `Belge önizleme · ${p.id}`;
    renderStudio();
  }

  function close() {
    S.open = false;
    U.$('studioRoot').classList.add('hidden');
    U.$('studioPages').innerHTML = '';
  }

  function bindStudio() {
    const box = U.$('studioRoot');
    box.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.opt) setOutput({ [t.dataset.opt]: t.checked });
      else if (t.dataset.brand !== undefined) {
        ed().setMeta('firma', t.value, 'Belge anteti');
      } else return;
      drawPages();
    });
    box.addEventListener('click', (e) => {
      const lang = e.target.closest('[data-lang]');
      if (lang) {
        ed().setLanguage(lang.dataset.lang);
        renderStudio();
        return;
      }
    });
    U.$('studioClose').addEventListener('click', close);
    U.$('studioPdf').addEventListener('click', () => openPdfDialog());
    U.$('studioXlsx').addEventListener('click', () => exportExcel());
    window.addEventListener('resize', U.debounce(() => { if (S.open) drawPages(); }, 200));
  }

  function init() {
    bindStudio();
    U.$('btnPreview').addEventListener('click', openStudio);
    U.$('btnPdf').addEventListener('click', () => openPdfDialog());
    U.$('btnExcel').addEventListener('click', () => exportExcel());
    U.$('btnCsv').addEventListener('click', () => exportCsv());
  }

  return { init, exportExcel, exportCsv, openStudio, close, isOpen: () => S.open, downloadPdf, openPdfDialog, buildPages };
})();
