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
    DOLFIN: { type: 'text', name: 'DOLFIN', sub: 'Makine Sanayi', footer: 'CNK ELEKTRONİK MAKİNE SAN A.Ş.', color: '#ff0000' },
    ENVA: { type: 'logo', logo: 'enva', footer: 'Enva Specialist Waste Ltd', color: '#007938' },
    VICO: { type: 'logo', logo: 'vico', footer: 'vico AB', color: '#C41E3A' },
    KSYSTEM: { type: 'logo', logo: 'ksystem', footer: 'K.SYSTEM GMBH', color: '#1B04AE' }
  };
  const PDF_COLS = {
    no: { w: 11, cls: 'c muted' },
    kod: { w: 25, cls: 'code' },
    ad: { w: 0 },
    kategori: { w: 22, cls: 'muted' },
    uretici: { w: 22 },
    ureticiKodu: { w: 28 },
    tedarikci: { w: 24 },
    referans: { w: 24 },
    miktar: { w: 14, cls: 'r qty' },
    birim: { w: 12, cls: 'c' },
    fiyat: { w: 23, cls: 'r' },
    iskonto: { w: 11, cls: 'r' },
    tutar: { w: 26, cls: 'r' },
    not: { w: 32, cls: 'muted nl' }
  };

  // Önizleme ve PDF her zaman o an açık projeyi kullanır (geri alma, başka cihazdan birleşme sonrası da güncel)
  const S = { open: false, scale: 1 };
  const openProjectNow = () => ed().project;

  /* ─── Excel ve CSV ────────────────────────────────────── */

  function current(options) {
    const o = options || {};
    return o.project || ed().project;
  }

  function columnsFor(project) {
    return (project.cikti && project.cikti.sutunlar) || U.pref('sutunlar', M.DEFAULT_COLUMNS);
  }

  async function exportExcel(options) {
    const o = options || {};
    const p = current(o);
    if (!p) return;
    if (!o.project) await ed().flush();
    const out = M.normalizeOutput(p.cikti);
    try {
      const bytes = BomxXlsx.bomWorkbook(p, {
        columns: columnsFor(p),
        prices: out.fiyat,
        lang: p.dil,
        purchase: true,
        summary: true,
        subtotals: out.araToplam,
        revisions: out.revizyonlar
      });
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
    U.download(new Blob([M.toCsv(M.projectToCsvRows(p, p.dil))], { type: 'text/csv;charset=utf-8' }), name);
    U.toast(`CSV indirildi: ${name}`);
  }

  /* ─── Sayfalar ────────────────────────────────────────── */

  function pdfColumns(project, out) {
    const keys = new Set(columnsFor(project));
    const cols = M.COLUMNS.filter((c) => (keys.has(c.key) || c.always) && (!c.price || out.fiyat)).map((c) => Object.assign({ key: c.key, doc: c.doc }, PDF_COLS[c.key]));
    const fixed = cols.reduce((n, c) => n + c.w, 0);
    let rest = CONTENT_W - fixed;
    if (rest < 55) {
      // Çok sütunda ad sütunu en az 55 mm kalır, diğerleri oranla daralır
      const k = (CONTENT_W - 55) / fixed;
      cols.forEach((c) => { c.w = Math.round(c.w * k * 10) / 10; });
      rest = CONTENT_W - cols.reduce((n, c) => n + c.w, 0);
    }
    const ad = cols.find((c) => c.key === 'ad');
    if (ad) ad.w = rest;
    return cols;
  }

  const money = (n, cur) => (M.isNum(n) ? `${M.formatAmount(n)} ${cur}` : '');
  const priceText = (n, cur) => (M.isNum(n) ? `${M.formatPrice(n)} ${cur}` : '—');

  function totalsText(sums) {
    if (sums.converted !== null && sums.converted !== undefined) return money(sums.converted, sums.currency);
    return Object.keys(sums.byCurrency).sort().map((c) => money(sums.byCurrency[c], c)).join(' + ');
  }

  function cellHtml(line, no, col, lang) {
    switch (col.key) {
      case 'no': return esc(no);
      case 'miktar': return esc(M.formatQty(line.miktar));
      case 'birim': return esc(M.unitText(line.birim, lang));
      case 'fiyat': return esc(priceText(line.fiyat, line.paraBirimi));
      case 'iskonto': return line.iskonto ? `%${esc(M.formatQty(line.iskonto))}` : '';
      case 'tutar': {
        const a = M.lineAmount(line);
        return a === null ? '—' : esc(money(a, line.paraBirimi));
      }
      default: return esc(line[col.key] || '');
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

  /** Belgenin sırası: bilgi, tablo satırları (bölüm başlıkları ve ara toplamlar), toplam, notlar, revizyonlar */
  function bomRows(project, cols, out, T, lang) {
    const rows = [];
    const multi = project.bolumler.length > 1;
    const numbered = M.numberedLines(project);
    project.bolumler.forEach((s, si) => {
      const items = numbered.filter((n) => n.section.id === s.id);
      if (!items.length && multi) return;
      if (multi) rows.push({ kind: 'sec', section: s, index: si, html: `<tr class="sec"><td colspan="${cols.length}"><span class="n">${si + 1}</span>${esc(s.ad)}</td></tr>` });
      for (const { line, no } of items) {
        rows.push({ kind: 'line', section: s, index: si, html: `<tr>${cols.map((c) => `<td class="${c.cls || ''}">${cellHtml(line, no, c, lang)}</td>`).join('')}</tr>` });
      }
      if (multi && out.fiyat && out.araToplam && items.length) {
        const sums = M.summarize(items.map((n) => n.line), project.paraBirimi, project.kurlar);
        rows.push({ kind: 'sub', section: s, index: si, html: `<tr class="sub"><td colspan="${cols.length - 1}" class="r">${esc(T.subtotal)} · ${esc(s.ad)}</td><td class="r">${esc(totalsText(sums))}</td></tr>` });
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

  function totalsHtml(project, T, totals) {
    const rows = Object.keys(totals.byCurrency).sort().map((c) => `<tr><td>${esc(T.total)} (${esc(c)})</td><td class="r">${esc(money(totals.byCurrency[c], c))}</td></tr>`);
    const currencies = Object.keys(totals.byCurrency);
    const conv = currencies.some((c) => c !== project.paraBirimi) || !currencies.length;
    if (totals.converted !== null && (conv || currencies.length !== 1)) rows.push(`<tr class="grand"><td>${esc(T.convertedTotal)} (${esc(project.paraBirimi)})</td><td class="r">${esc(money(totals.converted, project.paraBirimi))}</td></tr>`);
    else if (currencies.length === 1 && !conv) rows[rows.length - 1] = rows[rows.length - 1].replace('<tr>', '<tr class="grand">');
    const rated = [...new Set([...currencies, project.paraBirimi])].filter((c) => c !== 'TRY' && M.rateOf(c, project.kurlar));
    const notes = [];
    if (rated.length && conv) notes.push(`${T.ratesNote}: ${rated.map((c) => `1 ${c} = ${M.formatPrice(project.kurlar[c])} TRY`).join(' · ')}${project.kurTarihi ? ` (${U.formatDate(project.kurTarihi)})` : ''}`);
    if (totals.missingPrice) notes.push(`${totals.missingPrice} ${T.missingPrice}`);
    return `<div class="bp-totals"><table>${rows.join('')}</table></div>${notes.length ? `<div class="bp-note" style="text-align:right">${notes.map(esc).join('<br>')}</div>` : ''}`;
  }

  function revisionsHtml(project, T) {
    return `<table class="bp-table"><colgroup><col style="width:14mm"><col style="width:24mm"><col style="width:45mm"><col></colgroup>
      <thead><tr><th class="c">${esc(T.rev)}</th><th>${esc(T.date)}</th><th>${esc(T.prepared)}</th><th>${esc(T.desc)}</th></tr></thead>
      <tbody>${project.revizyonlar.map((r) => `<tr><td class="c code">${esc(r.rev)}</td><td>${esc(U.formatDate(r.tarih))}</td><td>${esc(r.hazirlayan)}</td><td>${esc(r.aciklama || (r.rev === '00' ? T.firstIssue : ''))}</td></tr>`).join('')}</tbody></table>`;
  }

  function purchaseRows(project, out, T, lang) {
    const cols = [
      { key: 'kod', w: 26, cls: 'code' }, { key: 'ad', w: 0 }, { key: 'uretici', w: 26 }, { key: 'ureticiKodu', w: 32 },
      { key: 'miktar', w: 16, cls: 'r qty' }, { key: 'birim', w: 13, cls: 'c' }
    ];
    if (out.fiyat) cols.push({ key: 'fiyat', w: 25, cls: 'r' }, { key: 'tutar', w: 28, cls: 'r' });
    cols.push({ key: 'referans', w: 34, cls: 'muted' });
    cols.find((c) => c.key === 'ad').w = CONTENT_W - cols.reduce((n, c) => n + c.w, 0);
    const docKey = { kod: 'code', ad: 'name', uretici: 'maker', ureticiKodu: 'makerCode', miktar: 'qty', birim: 'unit', fiyat: 'price', tutar: 'amount', referans: 'ref' };
    cols.forEach((c) => { c.doc = docKey[c.key]; });
    const rows = [];
    for (const g of M.purchaseList(project)) {
      rows.push({ kind: 'sec', group: g.tedarikci || T.noSupplier, html: `<tr class="group"><td colspan="${out.fiyat ? cols.length - 2 : cols.length}">${esc(g.tedarikci || T.noSupplier)} · ${g.items.length} ${esc(T.items)}</td>${out.fiyat ? `<td class="r">${esc(totalsText(g.totals))}</td><td></td>` : ''}</tr>` });
      for (const it of g.items) {
        rows.push({ kind: 'line', group: g.tedarikci, html: `<tr>${cols.map((c) => `<td class="${c.cls || ''}">${c.key === 'tutar' ? (it.tutar === null ? '—' : esc(money(it.tutar, it.paraBirimi))) : cellHtml(it, '', c, lang)}</td>`).join('')}</tr>` });
      }
    }
    return { cols, rows };
  }

  function summaryHtml(project, T, out) {
    const totals = M.projectTotals(project);
    const rows = M.categoryBreakdown(project);
    const max = Math.max(...rows.map((r) => r.partial || 0), 0);
    return `<table class="bp-table"><colgroup><col><col style="width:20mm"><col style="width:22mm">${out.fiyat ? '<col style="width:40mm"><col style="width:52mm">' : ''}</colgroup>
      <thead><tr><th>${esc(T.category)}</th><th class="r">${esc(T.count)}</th><th class="r">${esc(T.qty)}</th>${out.fiyat ? `<th class="r">${esc(T.amount)} (${esc(project.paraBirimi)})</th><th>${esc(T.share)}</th>` : ''}</tr></thead>
      <tbody>${rows.map((r) => `<tr><td class="code">${esc(r.kategori || T.uncategorized)}</td><td class="r">${r.count}</td><td class="r">${r.pieces ? esc(M.formatQty(r.pieces)) : ''}</td>
        ${out.fiyat ? `<td class="r">${esc(r.converted === null ? totalsText(r) : money(r.converted, project.paraBirimi))}</td><td><span class="bp-share"><i style="width:${max ? (100 * (r.partial || 0)) / max : 0}%"></i></span>${totals.partial ? `%${esc(M.formatAmount((100 * (r.partial || 0)) / totals.partial))}` : ''}</td>` : ''}</tr>`).join('')}
      <tr class="total"><td>${esc(T.total)}</td><td class="r">${totals.count}</td><td class="r">${esc(M.formatQty(totals.pieces))}</td>${out.fiyat ? `<td class="r">${esc(totalsText(totals))}</td><td></td>` : ''}</tr></tbody></table>`;
  }

  function pageShell(project, T, brand, logos) {
    const page = document.createElement('div');
    page.className = 'print-sheet bp-page';
    page.lang = project.dil;
    page.style.setProperty('--accent', brand.color);
    const brandHtml = brand.type === 'logo' && logos && logos[brand.logo]
      ? `<img src="${logos[brand.logo]}" alt="${esc(project.firma)}">`
      : `<span class="bp-brand-name">${esc(brand.name || project.firma)}</span>${brand.sub ? `<span class="bp-brand-sub">${esc(brand.sub)}</span>` : ''}`;
    page.innerHTML = `
      <div class="bp-header"><div class="bp-brand">${brandHtml}</div>
        <div class="bp-doc"><div class="bp-doc-title">${esc(T.title)}</div><div class="bp-doc-sub">${esc(M.projectId(project.seriNo, project.musteri, project.model) || project.id)} · ${esc(T.rev)} ${esc(project.rev)}</div></div></div>
      <div class="bp-content"></div>
      <div class="bp-footer"><span>${esc(brand.footer || '')}</span><span class="mid">${esc(T.generated)} · ${esc(U.formatDate(project.tarih))}</span><span class="pg"></span></div>`;
    return page;
  }

  /**
   * Sayfaları kurar: içerik görünmeyen bir ölçü alanında dizilir, satır yükseklikleri ölçülür,
   * sayfalara bölünür. Her sayfada tablo başlığı yinelenir, bölüm başka sayfaya geçerse "(devam)" yazar.
   */
  function buildPages(project, logos) {
    const out = M.normalizeOutput(project.cikti);
    const lang = project.dil;
    const T = M.docText(lang);
    const brand = BRANDS[project.firma] || BRANDS.DOLFIN;
    const cols = pdfColumns(project, out);
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
    const rows = bomRows(project, cols, out, T, lang);
    const contHtml = (secRow) => secRow.html.replace('</td></tr>', ` <span class="cont">${esc(T.continued)}</span></td></tr>`);
    flowTable(cols, rows, contHtml);
    // 3. Toplam, notlar, revizyonlar
    if (out.fiyat && project.kalemler.length) {
      const html = totalsHtml(project, T, totals);
      addBlock(`<div>${html}</div>`, heightOf(`<div>${html}</div>`));
    }
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
      const html = `<div><div class="bp-h"><span class="t">${esc(T.summary)}</span><span class="s">${esc(T.byCategory)}</span></div><div style="margin-top:3mm">${summaryHtml(project, T, out)}</div></div>`;
      addBlock(html, heightOf(html));
      if (out.fiyat) {
        const t = totalsHtml(project, T, totals);
        addBlock(`<div>${t}</div>`, heightOf(`<div>${t}</div>`));
      }
    }
    if (out.satinAlma && project.kalemler.length) {
      newPage();
      const h = `<div class="bp-h"><span class="t">${esc(T.purchase)}</span><span class="s">${esc(T.supplier)}</span></div>`;
      addBlock(h, heightOf(h));
      const pr = purchaseRows(project, out, T, lang);
      flowTable(pr.cols, pr.rows, (secRow) => secRow.html.replace('</td>', ` <span class="cont">${esc(T.continued)}</span></td>`));
    }
    measure.remove();
    pages.forEach((p, i) => {
      p.querySelector('.pg').textContent = `${T.page} ${i + 1} / ${pages.length}`;
    });
    return pages;
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

  async function downloadPdf(projectArg) {
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
      const pages = buildPages(project, logos);
      pages.forEach((p) => root.appendChild(p));
      await imagesDecoded(root);
      await nextPaint();
      const T = M.docText(project.dil);
      const pdf = await PidPdfDom.render(root, {
        title: `${project.id} ${T.title} Rev.${project.rev}`,
        onProgress: (done, total) => b.update(`PDF hazırlanıyor: ${done} / ${total} sayfa`)
      });
      const name = `${U.fileName(project.id)} BOM Rev.${project.rev}${project.dil !== 'tr' ? ` ${project.dil.toUpperCase()}` : ''}.pdf`;
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
      ${opt('fiyat', 'Fiyatlar')}${opt('araToplam', 'Ara toplamlar')}${opt('ozet', 'Özet sayfası')}${opt('satinAlma', 'Satın alma listesi')}${opt('revizyonlar', 'Revizyonlar')}${opt('notlar', 'Notlar')}
      <div class="lang-seg" title="Belge dili (program arayüzü Türkçe kalır)">${['tr', 'en', 'de'].map((l) => `<button type="button" data-lang="${l}" class="${p.dil === l ? 'active' : ''}">${l.toUpperCase()}</button>`).join('')}</div>
      <select class="field-input" data-brand title="Antet">${M.BRAND_IDS.map((b) => `<option${b === p.firma ? ' selected' : ''}>${b}</option>`).join('')}</select>
      <button type="button" class="btn btn-sm" data-cols>Sütunlar ▾</button>`;
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
        ed().setMeta('dil', lang.dataset.lang, 'Belge dili');
        renderStudio();
        return;
      }
      const cols = e.target.closest('[data-cols]');
      if (cols) {
        const r = cols.getBoundingClientRect();
        const keys = new Set(columnsFor(openProjectNow()));
        U.contextMenu(r.left, r.bottom + 4, [
          { title: 'Belgedeki sütunlar' },
          ...M.COLUMNS.filter((c) => !c.always).map((c) => ({
            label: `${keys.has(c.key) ? '✓ ' : ' '}${c.label}`,
            run: () => {
              const next = new Set(keys);
              if (next.has(c.key)) next.delete(c.key);
              else next.add(c.key);
              setOutput({ sutunlar: M.COLUMNS.map((x) => x.key).filter((k) => next.has(k) || M.COLUMNS.find((z) => z.key === k).always) });
              drawPages();
            }
          })),
          '-',
          { label: 'Ekrandaki sütunlarla aynı', run: () => { setOutput({ sutunlar: null }); drawPages(); } }
        ]);
      }
    });
    U.$('studioClose').addEventListener('click', close);
    U.$('studioPdf').addEventListener('click', () => downloadPdf());
    U.$('studioXlsx').addEventListener('click', () => exportExcel());
    window.addEventListener('resize', U.debounce(() => { if (S.open) drawPages(); }, 200));
  }

  function init() {
    bindStudio();
    U.$('btnPreview').addEventListener('click', openStudio);
    U.$('btnPdf').addEventListener('click', () => downloadPdf());
    U.$('btnExcel').addEventListener('click', () => exportExcel());
    U.$('btnCsv').addEventListener('click', () => exportCsv());
  }

  return { init, exportExcel, exportCsv, openStudio, close, isOpen: () => S.open, downloadPdf, buildPages };
})();
