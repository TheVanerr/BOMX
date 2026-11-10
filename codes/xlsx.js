/* Excel (xlsx) yazma ve okuma; dış kütüphane yoktur.
   Zip yazıcı ve okuyucu P&PX'in xlsx.js dosyasından alındı (sıkıştırmasız yazar, okurken
   tarayıcının ve Node'un DecompressionStream'ini kullanır).
   - bomWorkbook: biçimli malzeme listesi (bölümler, formüllü tutar ve ara toplamlar), satın alma ve özet sayfaları
   - libraryWorkbook: komponent kütüphanesi
   - readWorkbook: ilk sayfanın satırları (kütüphane aktarımı için) */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./model.js'));
  else root.BomxXlsx = factory(root.BomxModel);
})(typeof self !== 'undefined' ? self : this, function (M) {
  'use strict';

  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const xml = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    // XML 1.0'da yasak denetim karakterleri Excel'in dosyayı onarmasına yol açar
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

  /* ─── Zip ─────────────────────────────────────────────── */

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  async function inflate(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /** Zip içeriği: ad -> bayt */
  async function readZip(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i -= 1) {
      if (view.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('Excel dosyası okunamadı (zip sonu yok)');
    const count = view.getUint16(eocd + 10, true);
    let p = view.getUint32(eocd + 16, true);
    const files = new Map();
    for (let i = 0; i < count; i += 1) {
      if (view.getUint32(p, true) !== 0x02014b50) throw new Error('Excel dosyası bozuk');
      const method = view.getUint16(p + 10, true);
      const size = view.getUint32(p + 20, true);
      const nameLen = view.getUint16(p + 28, true);
      const extraLen = view.getUint16(p + 30, true);
      const commentLen = view.getUint16(p + 32, true);
      const local = view.getUint32(p + 42, true);
      const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const data = bytes.subarray(start, start + size);
      files.set(name, method === 8 ? await inflate(data) : data.slice());
      p += 46 + nameLen + extraLen + commentLen;
    }
    return files;
  }

  /** Sıkıştırmasız zip (Excel kabul eder) */
  function writeZip(entries) {
    const parts = [];
    const central = [];
    let offset = 0;
    for (const [name, content] of entries) {
      const nameBytes = enc.encode(name);
      const data = typeof content === 'string' ? enc.encode(content) : content;
      const crc = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true); // UTF-8 ad
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, nameBytes.length, true);
      parts.push(new Uint8Array(local.buffer), nameBytes, data);
      const head = new DataView(new ArrayBuffer(46));
      head.setUint32(0, 0x02014b50, true);
      head.setUint16(4, 20, true);
      head.setUint16(6, 20, true);
      head.setUint16(8, 0x0800, true);
      head.setUint32(16, crc, true);
      head.setUint32(20, data.length, true);
      head.setUint32(24, data.length, true);
      head.setUint16(28, nameBytes.length, true);
      head.setUint32(42, offset, true);
      central.push(new Uint8Array(head.buffer), nameBytes);
      offset += 30 + nameBytes.length + data.length;
    }
    const centralSize = central.reduce((n, b) => n + b.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, entries.length, true);
    end.setUint16(10, entries.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    const all = [...parts, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((n, b) => n + b.length, 0));
    let at = 0;
    for (const b of all) {
      out.set(b, at);
      at += b.length;
    }
    return out;
  }

  /* ─── Biçimler ────────────────────────────────────────── */

  const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00##"/></numFmts>' +
    '<fonts count="7">' +
    '<font><sz val="10"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><b/><sz val="10"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><b/><sz val="16"/><color rgb="FFD40000"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><sz val="9"/><color rgb="FF6B7280"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><b/><sz val="10"/><color rgb="FFB00000"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><b/><sz val="11"/><color rgb="FF15171C"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><i/><sz val="9"/><color rgb="FF6B7280"/><name val="Calibri"/><family val="2"/></font>' +
    '</fonts>' +
    '<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFF1F2F5"/><bgColor indexed="64"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFFDECEC"/><bgColor indexed="64"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFEEF0F4"/><bgColor indexed="64"/></patternFill></fill>' +
    '</fills>' +
    '<borders count="4"><border><left/><right/><top/><bottom/><diagonal/></border>' +
    '<border><left style="thin"><color rgb="FFD7DBE2"/></left><right style="thin"><color rgb="FFD7DBE2"/></right><top style="thin"><color rgb="FFD7DBE2"/></top><bottom style="thin"><color rgb="FFD7DBE2"/></bottom><diagonal/></border>' +
    '<border><left style="thin"><color rgb="FFD7DBE2"/></left><right style="thin"><color rgb="FFD7DBE2"/></right><top style="thin"><color rgb="FFD7DBE2"/></top><bottom style="medium"><color rgb="FF15171C"/></bottom><diagonal/></border>' +
    '<border><left/><right/><top style="thin"><color rgb="FF15171C"/></top><bottom style="thin"><color rgb="FF15171C"/></bottom><diagonal/></border>' +
    '</borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="18">' +
    /* 0 */ '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    /* 1 başlık */ '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    /* 2 soluk etiket */ '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    /* 3 kalın değer */ '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    /* 4 tablo başlığı */ '<xf numFmtId="0" fontId="1" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +
    /* 5 bölüm başlığı */ '<xf numFmtId="0" fontId="4" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>' +
    /* 6 metin */ '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
    /* 7 kalın metin (kod) */ '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>' +
    /* 8 miktar */ '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>' +
    /* 9 birim fiyat */ '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>' +
    /* 10 tutar */ '<xf numFmtId="4" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>' +
    /* 11 toplam etiketi */ '<xf numFmtId="0" fontId="5" fillId="4" borderId="3" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>' +
    /* 12 toplam tutar */ '<xf numFmtId="4" fontId="5" fillId="4" borderId="3" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>' +
    /* 13 ara toplam etiketi */ '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>' +
    /* 14 ara toplam tutar */ '<xf numFmtId="4" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>' +
    /* 15 ortalı metin */ '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf>' +
    /* 16 not */ '<xf numFmtId="0" fontId="6" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>' +
    /* 17 kur */ '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  const S = { title: 1, muted: 2, bold: 3, head: 4, section: 5, text: 6, code: 7, qty: 8, price: 9, amount: 10,
    totalLabel: 11, total: 12, subLabel: 13, sub: 14, center: 15, note: 16, rate: 17 };

  /* ─── Hücreler ────────────────────────────────────────── */

  function colName(index) {
    let n = index + 1;
    let s = '';
    while (n > 0) {
      const r = (n - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  function cellXml(ref, value, style) {
    const s = style ? ` s="${style}"` : '';
    if (value === undefined || value === null || value === '') return `<c r="${ref}"${s}/>`;
    if (typeof value === 'number') return Number.isFinite(value) ? `<c r="${ref}"${s}><v>${value}</v></c>` : `<c r="${ref}"${s}/>`;
    if (typeof value === 'object' && value.f) {
      const v = Number.isFinite(value.v) ? `<v>${value.v}</v>` : '';
      return `<c r="${ref}"${s}><f>${xml(value.f)}</f>${v}</c>`;
    }
    return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
  }

  /** Sayfa yazıcı: satır satır hücre ekler, birleştirme ve yükseklik tutar */
  function sheetBuilder() {
    const rows = [];
    const merges = [];
    let r = 0;
    return {
      get row() { return r; },
      add(cells, opts) {
        r += 1;
        const o = opts || {};
        const ht = o.height ? ` ht="${o.height}" customHeight="1"` : '';
        const xmlCells = [];
        cells.forEach((cell, i) => {
          if (cell === undefined) return;
          const c = cell && typeof cell === 'object' && 'value' in cell ? cell : { value: cell, style: o.style };
          xmlCells.push(cellXml(`${colName(i)}${r}`, c.value, c.style || o.style));
        });
        rows.push(`<row r="${r}"${ht}>${xmlCells.join('')}</row>`);
        return r;
      },
      blank() {
        r += 1;
        rows.push(`<row r="${r}"/>`);
        return r;
      },
      merge(ref) { merges.push(ref); },
      xml(options) {
        const o = options || {};
        const cols = o.widths ? `<cols>${o.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
        const pane = o.freezeRow
          ? `<pane ySplit="${o.freezeRow}" topLeftCell="A${o.freezeRow + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${o.freezeRow + 1}" sqref="A${o.freezeRow + 1}"/>`
          : '';
        const sheetPr = o.fit ? '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' : '';
        const filter = o.autoFilter ? `<autoFilter ref="${o.autoFilter}"/>` : '';
        const mergeXml = merges.length ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
        const setup = `<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.6" header="0.2" footer="0.25"/>` +
          `<pageSetup paperSize="9" orientation="${o.portrait ? 'portrait' : 'landscape'}"${o.fit ? ' fitToWidth="1" fitToHeight="0"' : ''}/>` +
          (o.footer ? `<headerFooter><oddFooter>${xml(o.footer)}</oddFooter></headerFooter>` : '');
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
          `${sheetPr}<sheetViews><sheetView workbookViewId="0" showGridLines="0"${o.tabSelected ? ' tabSelected="1"' : ''}>${pane}</sheetView></sheetViews>` +
          `<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rows.join('')}</sheetData>${filter}${mergeXml}${setup}</worksheet>`;
      }
    };
  }

  /** Excel sayfa adı: en çok 31 karakter, yasak işaretler yok */
  function sheetName(text) {
    return String(text || 'Sayfa').replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Sayfa';
  }

  function workbook(sheets, definedNames) {
    const entries = [];
    entries.push(['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '</Types>']);
    entries.push(['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '</Relationships>']);
    const names = (definedNames || []).map((d) => `<definedName name="${d.name}"${d.sheet !== undefined ? ` localSheetId="${d.sheet}"` : ''}>${xml(d.ref)}</definedName>`).join('');
    entries.push(['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<bookViews><workbookView activeTab="0"/></bookViews>' +
      `<sheets>${sheets.map((sh, i) => `<sheet name="${xml(sheetName(sh.name))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>` +
      (names ? `<definedNames>${names}</definedNames>` : '') +
      '<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>']);
    const rels = sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`);
    rels.push(`<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`);
    entries.push(['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`]);
    entries.push(['xl/styles.xml', STYLES]);
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    entries.push(['docProps/core.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      `<dc:title>${xml(sheets.title || '')}</dc:title><dc:creator>BOMX</dc:creator>` +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>` +
      '</cp:coreProperties>']);
    sheets.forEach((sh, i) => entries.push([`xl/worksheets/sheet${i + 1}.xml`, sh.xml]));
    return writeZip(entries);
  }

  /* ─── Malzeme listesi ─────────────────────────────────── */

  const COLUMN_WIDTH = { no: 6, kod: 16, ad: 42, kategori: 16, uretici: 16, ureticiKodu: 20, tedarikci: 18, referans: 16, miktar: 9,
    birim: 8, fiyat: 13, paraBirimi: 8, iskonto: 8, tutar: 15, not: 28 };

  const formatDate = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : iso || '');

  /** Excel sütunları: ekrandaki seçim; fiyatlar istenmişse para birimi sütunu da gelir (tutar formülü için) */
  function excelColumns(keys, withPrices) {
    const out = [];
    // Sütunlar seçim sırasıyla değil belgedeki sabit sırayla dizilir
    for (const col of M.COLUMNS) {
      const key = col.key;
      if (!keys.includes(key) || (col.price && !withPrices)) continue;
      out.push(key);
      if (key === 'fiyat') out.push('paraBirimi');
    }
    // Tutar var, birim fiyat yoksa para birimi tutarın önüne girer
    if (withPrices && out.includes('tutar') && !out.includes('paraBirimi')) out.splice(out.indexOf('tutar'), 0, 'paraBirimi');
    return out;
  }

  function headerLabel(key, T) {
    if (key === 'paraBirimi') return T.currency;
    const col = M.COLUMNS.find((c) => c.key === key);
    return T[col.doc] || col.label;
  }

  /**
   * @param project normalize edilmiş proje
   * @param options.columns sütun anahtarları (M.COLUMNS), options.prices fiyatlar, options.lang belge dili
   * @returns Uint8Array xlsx
   */
  function bomWorkbook(project, options) {
    const o = options || {};
    const lang = o.lang || project.dil || 'tr';
    const T = M.docText(lang);
    const withPrices = o.prices !== false;
    const keys = excelColumns(o.columns && o.columns.length ? o.columns : M.DEFAULT_COLUMNS, withPrices);
    const idx = (key) => keys.indexOf(key);
    const L = (key) => colName(idx(key));
    const width = keys.length;
    const last = colName(width - 1);
    const sheet = sheetBuilder();
    const projectName = M.projectId(project.seriNo, project.musteri, project.model) || project.id;

    sheet.add([{ value: `${T.title} (BOM)`, style: S.title }], { height: 24 });
    sheet.merge(`A1:${last}1`);
    sheet.add([{ value: `${projectName}${project.baslik ? ` · ${project.baslik}` : ''}`, style: S.bold }]);
    sheet.merge(`A2:${last}2`);
    sheet.blank();
    const info = [
      [T.project, project.seriNo, T.rev, project.rev, T.prepared, project.hazirlayan],
      [T.customer, project.musteri, T.date, formatDate(project.tarih), T.checked, project.kontrol],
      [T.model, project.model, T.status, M.statusLabel(project.durum, lang), T.approved, project.onay]
    ];
    // Bilgi alanı sütun sayısına göre üç gruba yayılır
    const g = Math.max(2, Math.floor(width / 3));
    for (const row of info) {
      const cells = new Array(width).fill(undefined);
      cells[0] = { value: row[0], style: S.muted };
      cells[1] = { value: row[1], style: S.bold };
      if (g < width) cells[g] = { value: row[2], style: S.muted };
      if (g + 1 < width) cells[g + 1] = { value: row[3], style: S.bold };
      if (2 * g < width) cells[2 * g] = { value: row[4], style: S.muted };
      if (2 * g + 1 < width) cells[2 * g + 1] = { value: row[5], style: S.bold };
      sheet.add(cells);
    }
    sheet.blank();
    const headRow = sheet.add(keys.map((k) => ({ value: headerLabel(k, T), style: S.head })), { height: 20 });

    const lineRows = [];
    // İskonto sütunu belgede yoksa oran formüle sabit yazılır: Excel yeniden hesaplayınca da tutar uygulamayla aynı kalır
    const amountFormula = (r, line) => {
      const q = `${L('miktar')}${r}`;
      const p = `${L('fiyat')}${r}`;
      const d = idx('iskonto') >= 0 ? `*(1-${L('iskonto')}${r}/100)` : line.iskonto ? `*(1-${line.iskonto}/100)` : '';
      return `IF(${p}="","",${q}*${p}${d})`;
    };
    const numbered = M.numberedLines(project);
    project.bolumler.forEach((section, si) => {
      const items = numbered.filter((n) => n.section.id === section.id);
      if (!items.length && project.bolumler.length > 1 && o.skipEmpty !== false) return;
      if (project.bolumler.length > 1) {
        const cells = new Array(width).fill(undefined).map(() => ({ value: '', style: S.section }));
        cells[0] = { value: `${si + 1}. ${section.ad}`, style: S.section };
        const r = sheet.add(cells, { height: 18 });
        sheet.merge(`A${r}:${last}${r}`);
      }
      const first = sheet.row + 1;
      for (const { line, no } of items) {
        const r = sheet.row + 1;
        const amount = M.lineAmount(line);
        const value = {
          no: { value: no, style: S.center },
          kod: { value: line.kod, style: S.code },
          ad: { value: line.ad, style: S.text },
          kategori: { value: line.kategori, style: S.text },
          uretici: { value: line.uretici, style: S.text },
          ureticiKodu: { value: line.ureticiKodu, style: S.text },
          tedarikci: { value: line.tedarikci, style: S.text },
          referans: { value: line.referans, style: S.text },
          miktar: { value: Number(line.miktar) || 0, style: S.qty },
          birim: { value: M.unitText(line.birim, lang), style: S.center },
          fiyat: { value: M.isNum(line.fiyat) ? line.fiyat : null, style: S.price },
          paraBirimi: { value: line.paraBirimi, style: S.center },
          iskonto: { value: line.iskonto ? line.iskonto : null, style: S.qty },
          tutar: idx('fiyat') >= 0 && idx('miktar') >= 0
            ? { value: amount === null ? null : { f: amountFormula(r, line), v: M.round(amount, 6) }, style: S.amount }
            : { value: amount === null ? null : M.round(amount, 2), style: S.amount },
          not: { value: line.not, style: S.text }
        };
        sheet.add(keys.map((k) => value[k]));
        lineRows.push(r);
      }
      const lastRow = sheet.row;
      if (withPrices && o.subtotals !== false && project.bolumler.length > 1 && items.length && idx('tutar') >= 0) {
        const sums = M.summarize(items.map((n) => n.line), project.paraBirimi, project.kurlar);
        for (const cur of Object.keys(sums.byCurrency).sort()) {
          const cells = new Array(width).fill(undefined).map(() => ({ value: '', style: S.subLabel }));
          cells[Math.max(0, idx('tutar') - 1)] = { value: `${T.subtotal} (${cur})`, style: S.subLabel };
          const range = (k) => `${L(k)}${first}:${L(k)}${lastRow}`;
          cells[idx('tutar')] = {
            value: idx('paraBirimi') >= 0 ? { f: `SUMIF(${range('paraBirimi')},"${cur}",${range('tutar')})`, v: M.round(sums.byCurrency[cur], 6) } : M.round(sums.byCurrency[cur], 2),
            style: S.sub
          };
          sheet.add(cells);
        }
      }
    });

    const totals = M.projectTotals(project);
    if (withPrices && idx('tutar') >= 0 && lineRows.length) {
      sheet.blank();
      const firstLine = Math.min(...lineRows);
      const lastLine = Math.max(...lineRows);
      const range = (k) => `$${L(k)}$${firstLine}:$${L(k)}$${lastLine}`;
      const label = Math.max(0, idx('tutar') - 1);
      const currencies = Object.keys(totals.byCurrency).sort();
      const sumCells = new Map();
      for (const cur of currencies) {
        const cells = new Array(width).fill(undefined).map(() => ({ value: '', style: S.totalLabel }));
        cells[label] = { value: `${T.total} (${cur})`, style: S.totalLabel };
        cells[idx('tutar')] = {
          value: idx('paraBirimi') >= 0 ? { f: `SUMIF(${range('paraBirimi')},"${cur}",${range('tutar')})`, v: M.round(totals.byCurrency[cur], 6) } : M.round(totals.byCurrency[cur], 2),
          style: S.total
        };
        sumCells.set(cur, `${L('tutar')}${sheet.add(cells)}`);
      }
      // Başka para birimi varsa rapor para birimine çevrilmiş toplam; kurlar hücrededir, değişince toplam da değişir
      if (currencies.some((c) => c !== project.paraBirimi)) {
        const rateCells = new Map();
        sheet.blank();
        sheet.add([{ value: `${T.rates} (1 = TRY)`, style: S.muted }]);
        for (const cur of [...new Set([...currencies, project.paraBirimi])].filter((c) => c !== 'TRY')) {
          const r = sheet.add([{ value: cur, style: S.center }, { value: M.rateOf(cur, project.kurlar), style: S.rate }]);
          rateCells.set(cur, `$B$${r}`);
        }
        const rate = (cur) => (cur === 'TRY' ? '1' : rateCells.get(cur));
        const formula = `(${currencies.map((cur) => `${sumCells.get(cur)}*${rate(cur)}`).join('+')})/${rate(project.paraBirimi)}`;
        const cells = new Array(width).fill(undefined).map(() => ({ value: '', style: S.totalLabel }));
        cells[label] = { value: `${T.convertedTotal} (${project.paraBirimi})`, style: S.totalLabel };
        cells[idx('tutar')] = { value: totals.converted === null ? null : { f: formula, v: M.round(totals.converted, 6) }, style: S.total };
        sheet.add(cells);
        if (project.kurTarihi) sheet.add([{ value: `${T.date}: ${formatDate(project.kurTarihi)}`, style: S.muted }]);
      }
      if (totals.missingPrice) sheet.add([{ value: `${totals.missingPrice} ${T.missingPrice}`, style: S.note }]);
    }
    if (project.notlar) {
      sheet.blank();
      sheet.add([{ value: T.notes, style: S.bold }]);
      const r = sheet.add([{ value: project.notlar, style: S.note }], { height: Math.min(200, 15 * (project.notlar.split('\n').length + 1)) });
      sheet.merge(`A${r}:${last}${r}`);
    }
    if (o.revisions !== false && project.revizyonlar.length) {
      sheet.blank();
      sheet.add([{ value: T.revisions, style: S.bold }]);
      sheet.add([{ value: T.rev, style: S.head }, { value: T.date, style: S.head }, { value: T.prepared, style: S.head }, { value: T.desc, style: S.head }]);
      for (const r of project.revizyonlar) {
        sheet.add([{ value: r.rev, style: S.center }, { value: formatDate(r.tarih), style: S.center }, { value: r.hazirlayan, style: S.text }, { value: r.aciklama || (r.rev === '00' ? T.firstIssue : ''), style: S.text }]);
      }
    }

    const sheets = [{
      name: lang === 'en' ? 'BOM' : lang === 'de' ? 'Stückliste' : 'Malzeme Listesi',
      xml: sheet.xml({
        widths: keys.map((k) => COLUMN_WIDTH[k] || 12),
        freezeRow: headRow,
        fit: true,
        tabSelected: true,
        footer: `&L${projectName} · ${T.rev} ${project.rev}&R${T.page} &P / &N`
      })
    }];
    const defined = [{ name: '_xlnm.Print_Titles', sheet: 0, ref: `'${sheetName(sheets[0].name)}'!$${headRow}:$${headRow}` }];

    if (o.purchase !== false) sheets.push({ name: lang === 'en' ? 'Purchase' : lang === 'de' ? 'Bestellung' : 'Satın Alma', xml: purchaseSheet(project, lang, withPrices) });
    if (o.summary !== false) sheets.push({ name: lang === 'en' ? 'Summary' : lang === 'de' ? 'Übersicht' : 'Özet', xml: summarySheet(project, lang, withPrices) });
    sheets.title = `${projectName} ${T.title}`;
    return workbook(sheets, defined);
  }

  function purchaseSheet(project, lang, withPrices) {
    const T = M.docText(lang);
    const sheet = sheetBuilder();
    const heads = [T.supplier, T.code, T.name, T.maker, T.makerCode, T.qty, T.unit].concat(withPrices ? [T.price, T.currency, T.amount] : []).concat([T.ref]);
    sheet.add([{ value: T.purchase, style: S.title }], { height: 24 });
    sheet.add([{ value: M.projectId(project.seriNo, project.musteri, project.model), style: S.bold }]);
    sheet.blank();
    const head = sheet.add(heads.map((h) => ({ value: h, style: S.head })), { height: 20 });
    for (const group of M.purchaseList(project)) {
      for (const item of group.items) {
        const r = sheet.row + 1;
        const cells = [
          { value: group.tedarikci || T.noSupplier, style: S.text },
          { value: item.kod, style: S.code },
          { value: item.ad, style: S.text },
          { value: item.uretici, style: S.text },
          { value: item.ureticiKodu, style: S.text },
          { value: M.round(item.miktar, 6), style: S.qty },
          { value: M.unitText(item.birim, lang), style: S.center }
        ];
        if (withPrices) {
          cells.push({ value: M.isNum(item.fiyat) ? item.fiyat : null, style: S.price });
          cells.push({ value: item.paraBirimi, style: S.center });
          const d = item.iskonto ? `*(1-${item.iskonto}/100)` : '';
          cells.push({ value: item.tutar === null ? null : { f: `F${r}*H${r}${d}`, v: M.round(item.tutar, 6) }, style: S.amount });
        }
        cells.push({ value: item.referans, style: S.text });
        sheet.add(cells);
      }
    }
    const lastRow = Math.max(head, sheet.row);
    return sheet.xml({
      widths: [22, 16, 40, 16, 20, 9, 8].concat(withPrices ? [13, 8, 15] : []).concat([24]),
      freezeRow: head,
      fit: true,
      autoFilter: `A${head}:${colName(heads.length - 1)}${lastRow}`
    });
  }

  function summarySheet(project, lang, withPrices) {
    const T = M.docText(lang);
    const sheet = sheetBuilder();
    sheet.add([{ value: T.summary, style: S.title }], { height: 24 });
    sheet.add([{ value: M.projectId(project.seriNo, project.musteri, project.model), style: S.bold }]);
    sheet.blank();
    const totals = M.projectTotals(project);
    const heads = [T.category, T.count, T.qty].concat(withPrices ? [`${T.amount} (${project.paraBirimi})`, T.share] : []);
    sheet.add(heads.map((h) => ({ value: h, style: S.head })), { height: 20 });
    for (const row of M.categoryBreakdown(project)) {
      const cells = [{ value: row.kategori || T.uncategorized, style: S.text }, { value: row.count, style: S.qty }, { value: M.round(row.pieces, 6) || null, style: S.qty }];
      if (withPrices) {
        cells.push({ value: row.converted === null ? null : M.round(row.converted, 2), style: S.amount });
        cells.push({ value: row.converted !== null && totals.converted ? `%${M.formatAmount((row.converted / totals.converted) * 100)}` : '', style: S.center });
      }
      sheet.add(cells);
    }
    const cells = [{ value: T.total, style: S.totalLabel }, { value: totals.count, style: S.total }, { value: M.round(totals.pieces, 6) || null, style: S.total }];
    if (withPrices) {
      cells.push({ value: totals.converted === null ? null : M.round(totals.converted, 2), style: S.total });
      cells.push({ value: '', style: S.totalLabel });
    }
    sheet.add(cells);
    return sheet.xml({ widths: [28, 10, 10, 20, 10], portrait: true, fit: true });
  }

  /* ─── Kütüphane ───────────────────────────────────────── */

  function libraryWorkbook(components) {
    const rows = M.libraryToRows(components);
    const sheet = sheetBuilder();
    const head = sheet.add(rows[0].map((h) => ({ value: h, style: S.head })), { height: 20 });
    for (const c of components.slice().sort(M.compareComponents)) {
      sheet.add([
        { value: c.kod, style: S.code }, { value: c.ad, style: S.text }, { value: c.kategori, style: S.text },
        { value: c.uretici, style: S.text }, { value: c.ureticiKodu, style: S.text }, { value: c.tedarikci, style: S.text },
        { value: c.tedarikciKodu, style: S.text }, { value: c.birim, style: S.center }, { value: M.isNum(c.fiyat) ? c.fiyat : null, style: S.price },
        { value: c.paraBirimi, style: S.center }, { value: c.teslimSuresi, style: S.qty }, { value: c.aciklama, style: S.text },
        { value: c.link, style: S.text }, { value: c.favori ? 'evet' : '', style: S.center }, { value: c.pasif ? 'evet' : '', style: S.center }
      ]);
    }
    const xmlSheet = sheet.xml({
      widths: [16, 40, 16, 16, 20, 18, 16, 8, 13, 8, 10, 36, 30, 8, 8],
      freezeRow: head,
      fit: true,
      autoFilter: `A${head}:O${Math.max(head, sheet.row)}`
    });
    const sheets = [{ name: 'Komponentler', xml: xmlSheet }];
    sheets.title = 'BOMX Komponent Kütüphanesi';
    return workbook(sheets);
  }

  /* ─── Okuma ───────────────────────────────────────────── */

  function unescapeXml(text) {
    return String(text)
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  }

  const textOf = (fragment) => [...fragment.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1])).join('');

  function colIndex(ref) {
    const letters = (ref.match(/^[A-Z]+/) || ['A'])[0];
    let n = 0;
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  /** İlk sayfanın satırları (dizi dizisi); sayılar sayı, diğerleri metin */
  async function readWorkbook(bytes) {
    const files = await readZip(bytes);
    const book = files.get('xl/workbook.xml');
    if (!book) throw new Error('Bu dosya Excel çalışma kitabı değil');
    const bookXml = dec.decode(book);
    const first = bookXml.match(/<sheet\b[^>]*\br:id="([^"]+)"/);
    let target = 'worksheets/sheet1.xml';
    const relsFile = files.get('xl/_rels/workbook.xml.rels');
    if (first && relsFile) {
      const rels = dec.decode(relsFile);
      const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((r) => r.includes(`Id="${first[1]}"`));
      const t = rel && rel.match(/Target="([^"]+)"/);
      if (t) target = t[1].replace(/^\/?xl\//, '').replace(/^\//, '');
    }
    const sheetFile = files.get(`xl/${target}`);
    if (!sheetFile) throw new Error('Excel dosyasında sayfa bulunamadı');
    const shared = [];
    const sst = files.get('xl/sharedStrings.xml');
    if (sst) for (const m of dec.decode(sst).matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1]));
    const rows = [];
    for (const rm of dec.decode(sheetFile).matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const row = [];
      for (const cm of (rm[1] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cm[1];
        const body = cm[2] || '';
        const ref = (attrs.match(/\br="([A-Z]+\d+)"/) || [])[1];
        const type = (attrs.match(/\bt="(\w+)"/) || [])[1] || 'n';
        const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        let value = '';
        if (type === 's') value = v === undefined ? '' : shared[parseInt(v, 10)] || '';
        else if (type === 'inlineStr') value = textOf(body);
        else if (type === 'b') value = v === '1' ? 'evet' : '';
        else if (type === 'str' || type === 'e') value = v === undefined ? '' : unescapeXml(v);
        else value = v === undefined || v === '' ? '' : Number(v);
        const i = ref ? colIndex(ref) : row.length;
        while (row.length < i) row.push('');
        row[i] = value;
      }
      rows.push(row);
    }
    return rows.filter((r) => r.some((c) => c !== '' && c !== null && c !== undefined));
  }

  return { readZip, writeZip, crc32, colName, bomWorkbook, libraryWorkbook, readWorkbook, excelColumns, STYLES };
});
