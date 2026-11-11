/* Excel (xlsx) yazma ve okuma; dış kütüphane yoktur.
   Zip yazıcı ve okuyucu P&PX'in xlsx.js dosyasından alındı (sıkıştırmasız yazar, okurken
   tarayıcının ve Node'un DecompressionStream'ini kullanır).
   - bomWorkbook: biçimli malzeme listesi (bölümler, hücreye yerleşen fotoğraflar), satın alma ve özet sayfaları
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
    '<cellXfs count="13">' +
    /* 0 */ '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    /* 1 başlık */ '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    /* 2 soluk etiket */ '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    /* 3 kalın değer */ '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    /* 4 tablo başlığı */ '<xf numFmtId="0" fontId="1" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +
    /* 5 bölüm başlığı */ '<xf numFmtId="0" fontId="4" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>' +
    /* 6 metin */ '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
    /* 7 kalın metin (kod) */ '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>' +
    /* 8 adet */ '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>' +
    /* 9 toplam etiketi */ '<xf numFmtId="0" fontId="5" fillId="4" borderId="3" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>' +
    /* 10 toplam sayı */ '<xf numFmtId="0" fontId="5" fillId="4" borderId="3" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>' +
    /* 11 ortalı metin */ '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf>' +
    /* 12 not */ '<xf numFmtId="0" fontId="6" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  const S = { title: 1, muted: 2, bold: 3, head: 4, section: 5, text: 6, code: 7, qty: 8, totalLabel: 9, total: 10, center: 11, note: 12 };

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
          (o.footer ? `<headerFooter><oddFooter>${xml(o.footer)}</oddFooter></headerFooter>` : '') +
          (o.drawing ? '<drawing r:id="rId1"/>' : '');
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

  /* ─── Fotoğraflar ─────────────────────────────────────── */

  const PHOTO_BOX = { colWidth: 11, rowPt: 60, cellW: 82, cellH: 80, size: 72 };
  const EMU = 9525;

  function pngSize(b) {
    if (b.length < 24) return null;
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { width: v.getUint32(16), height: v.getUint32(20) };
  }

  /** JPEG boyutu başlıktaki kare (SOF) bölümünden okunur */
  function jpegSize(b) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i += 1; continue; }
      const m = b[i + 1];
      if (m === 0xff) { i += 1; continue; }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] };
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      i += 2 + ((b[i + 2] << 8) | b[i + 3]);
    }
    return null;
  }

  /** data URL → { key, bytes, ext, width, height }; Excel'e yalnız JPEG ve PNG gömülür */
  function decodePhoto(src) {
    const m = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(src || '');
    if (!m) return null;
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    const size = m[1] === 'png' ? pngSize(bytes) : jpegSize(bytes);
    return size && size.width && size.height ? Object.assign({ key: src, bytes, ext: m[1] }, size) : null;
  }

  /** Bir sayfanın çizim parçası: her fotoğraf hücresinde ortalanır, oranı korunur */
  function drawingXml(images, relOf) {
    const anchors = images.map((im, i) => {
      const k = PHOTO_BOX.size / Math.max(im.photo.width, im.photo.height);
      const w = Math.round(im.photo.width * k);
      const h = Math.round(im.photo.height * k);
      const cx = w * EMU;
      const cy = h * EMU;
      const colOff = Math.round(((PHOTO_BOX.cellW - w) / 2) * EMU);
      const rowOff = Math.round(((PHOTO_BOX.cellH - h) / 2) * EMU);
      return '<xdr:oneCellAnchor>' +
        `<xdr:from><xdr:col>${im.col}</xdr:col><xdr:colOff>${colOff}</xdr:colOff><xdr:row>${im.row - 1}</xdr:row><xdr:rowOff>${rowOff}</xdr:rowOff></xdr:from>` +
        `<xdr:ext cx="${cx}" cy="${cy}"/>` +
        `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${i + 2}" name="Fotoğraf ${i + 1}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>` +
        `<xdr:blipFill><a:blip r:embed="${relOf(im.photo)}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
        `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>` +
        '<xdr:clientData/></xdr:oneCellAnchor>';
    });
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      `${anchors.join('')}</xdr:wsDr>`;
  }

  const REL_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
  const REL_BASE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

  /** Sayfalardaki fotoğrafların zip parçaları; aynı fotoğraf dosyada bir kez durur */
  function imageParts(sheets) {
    const media = new Map();
    const parts = [];
    const drawings = [];
    sheets.forEach((sh, i) => {
      if (!sh.images || !sh.images.length) return;
      const n = i + 1;
      const rels = new Map();
      const relOf = (photo) => {
        if (!media.has(photo.key)) media.set(photo.key, { name: `image${media.size + 1}.${photo.ext}`, bytes: photo.bytes });
        const name = media.get(photo.key).name;
        if (!rels.has(name)) rels.set(name, `rId${rels.size + 1}`);
        return rels.get(name);
      };
      const body = drawingXml(sh.images, relOf);
      parts.push([`xl/drawings/drawing${n}.xml`, body]);
      parts.push([`xl/drawings/_rels/drawing${n}.xml.rels`, `${REL_HEAD}${[...rels.entries()].map(([name, id]) => `<Relationship Id="${id}" Type="${REL_BASE}/image" Target="../media/${name}"/>`).join('')}</Relationships>`]);
      parts.push([`xl/worksheets/_rels/sheet${n}.xml.rels`, `${REL_HEAD}<Relationship Id="rId1" Type="${REL_BASE}/drawing" Target="../drawings/drawing${n}.xml"/></Relationships>`]);
      drawings.push(n);
    });
    for (const m of media.values()) parts.push([`xl/media/${m.name}`, m.bytes]);
    const exts = new Set([...media.values()].map((m) => m.name.split('.').pop()));
    return { parts, drawings, exts };
  }

  function workbook(sheets, definedNames) {
    const entries = [];
    const images = imageParts(sheets);
    entries.push(['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      [...images.exts].map((e) => `<Default Extension="${e}" ContentType="image/${e}"/>`).join('') +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
      images.drawings.map((n) => `<Override PartName="/xl/drawings/drawing${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`).join('') +
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
    entries.push(...images.parts);
    return writeZip(entries);
  }

  /* ─── Malzeme listesi ─────────────────────────────────── */

  const COLUMN_WIDTH = { foto: PHOTO_BOX.colWidth, kod: 15, ad: 36, ureticiKodu: 24, miktar: 9, aciklama: 62 };

  const formatDate = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : iso || '');

  /** Metnin sütuna sığmak için kaç satır tuttuğu (satır yüksekliği için tahmin) */
  const lineCount = (text, perLine) => String(text || '').split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0);

  /**
   * @param project normalize edilmiş proje
   * @param options.lang belge dili, options.photoOf (kalem) => fotoğraf data URL
   * @returns Uint8Array xlsx
   */
  function bomWorkbook(project, options) {
    const o = options || {};
    const lang = o.lang || project.dil || 'tr';
    const T = M.docText(lang);
    const keys = M.COLUMNS.map((c) => c.key);
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
    const headRow = sheet.add(M.COLUMNS.map((c) => ({ value: T[c.doc] || c.label, style: S.head })), { height: 20 });

    const images = [];
    const decoded = new Map();
    const photoFor = (line) => {
      const src = o.photoOf ? o.photoOf(line) : '';
      if (!src) return null;
      if (!decoded.has(src)) decoded.set(src, decodePhoto(src));
      return decoded.get(src);
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
      for (const { line } of items) {
        const photo = photoFor(line);
        const description = M.lineDescription(line, lang);
        const value = {
          foto: { value: '', style: S.text },
          kod: { value: line.kod, style: S.code },
          ad: { value: line.ad, style: S.text },
          ureticiKodu: { value: line.ureticiKodu, style: S.text },
          miktar: { value: M.isPieceUnit(line.birim) ? Number(line.miktar) || 0 : M.qtyText(line, lang), style: S.qty },
          aciklama: { value: description, style: S.text }
        };
        const textPt = 14 * Math.max(lineCount(line.ad, 32), lineCount(line.ureticiKodu, 22), lineCount(description, 62));
        const r = sheet.add(keys.map((k) => value[k]), { height: Math.min(300, Math.max(photo ? PHOTO_BOX.rowPt : 18, textPt)) });
        if (photo) images.push({ row: r, col: keys.indexOf('foto'), photo });
      }
    });

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
        sheet.add([{ value: r.rev, style: S.center }, { value: formatDate(r.tarih), style: S.center }, { value: r.hazirlayan, style: S.text }, { value: M.revisionNote(r, T), style: S.text }]);
      }
    }

    const sheets = [{
      name: lang === 'en' ? 'BOM' : lang === 'de' ? 'Stückliste' : 'Malzeme Listesi',
      xml: sheet.xml({
        widths: keys.map((k) => COLUMN_WIDTH[k] || 12),
        drawing: images.length > 0,
        freezeRow: headRow,
        fit: true,
        tabSelected: true,
        footer: `&L${projectName} · ${T.rev} ${project.rev}&R${T.page} &P / &N`
      }),
      images
    }];
    const defined = [{ name: '_xlnm.Print_Titles', sheet: 0, ref: `'${sheetName(sheets[0].name)}'!$${headRow}:$${headRow}` }];

    if (o.purchase !== false) sheets.push({ name: lang === 'en' ? 'Purchase' : lang === 'de' ? 'Bestellung' : 'Satın Alma', xml: purchaseSheet(project, lang) });
    if (o.summary !== false) sheets.push({ name: lang === 'en' ? 'Summary' : lang === 'de' ? 'Übersicht' : 'Özet', xml: summarySheet(project, lang) });
    sheets.title = `${projectName} ${T.title}`;
    return workbook(sheets, defined);
  }

  function purchaseSheet(project, lang) {
    const T = M.docText(lang);
    const sheet = sheetBuilder();
    const heads = [T.supplier, T.code, T.name, T.maker, T.makerCode, T.qty, T.unit, T.ref];
    sheet.add([{ value: T.purchase, style: S.title }], { height: 24 });
    sheet.add([{ value: M.projectId(project.seriNo, project.musteri, project.model), style: S.bold }]);
    sheet.blank();
    const head = sheet.add(heads.map((h) => ({ value: h, style: S.head })), { height: 20 });
    for (const group of M.purchaseList(project)) {
      for (const item of group.items) {
        sheet.add([
          { value: group.tedarikci || T.noSupplier, style: S.text },
          { value: item.kod, style: S.code },
          { value: item.ad, style: S.text },
          { value: item.uretici, style: S.text },
          { value: item.ureticiKodu, style: S.text },
          { value: M.round(item.miktar, 6), style: S.qty },
          { value: M.unitText(item.birim, lang), style: S.center },
          { value: item.referans, style: S.text }
        ]);
      }
    }
    const lastRow = Math.max(head, sheet.row);
    return sheet.xml({
      widths: [22, 16, 40, 16, 22, 9, 8, 24],
      freezeRow: head,
      fit: true,
      autoFilter: `A${head}:${colName(heads.length - 1)}${lastRow}`
    });
  }

  function summarySheet(project, lang) {
    const T = M.docText(lang);
    const sheet = sheetBuilder();
    sheet.add([{ value: T.summary, style: S.title }], { height: 24 });
    sheet.add([{ value: M.projectId(project.seriNo, project.musteri, project.model), style: S.bold }]);
    sheet.blank();
    const totals = M.projectTotals(project);
    sheet.add([T.category, T.count, T.qty].map((h) => ({ value: h, style: S.head })), { height: 20 });
    for (const row of M.categoryBreakdown(project)) {
      sheet.add([{ value: row.kategori || T.uncategorized, style: S.text }, { value: row.count, style: S.qty }, { value: M.round(row.pieces, 6) || null, style: S.qty }]);
    }
    sheet.add([{ value: T.total, style: S.totalLabel }, { value: totals.count, style: S.total }, { value: M.round(totals.pieces, 6) || null, style: S.total }]);
    return sheet.xml({ widths: [28, 10, 10], portrait: true, fit: true });
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
        { value: c.tedarikciKodu, style: S.text }, { value: c.birim, style: S.center },
        { value: c.teslimSuresi, style: S.qty }, { value: c.aciklama, style: S.text }, { value: c.aciklamaEn, style: S.text }, { value: c.aciklamaDe, style: S.text },
        { value: c.link, style: S.text }, { value: c.favori ? 'evet' : '', style: S.center }, { value: c.pasif ? 'evet' : '', style: S.center }
      ]);
    }
    const xmlSheet = sheet.xml({
      widths: [16, 40, 16, 16, 22, 18, 16, 8, 10, 36, 36, 36, 30, 8, 8],
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

  return { readZip, writeZip, crc32, colName, bomWorkbook, libraryWorkbook, readWorkbook, decodePhoto, STYLES };
});
