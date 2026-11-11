/* HTML raporlarından komponent çıkarma: ürün ağacı (makine bazlı BOM, alt kırılımlar, ürün tam adları),
   kritik parça listesi ve yıllık sarf / depo listesi. Sayfaların kodu çalıştırılmaz: betikteki
   "const DATA = {...}" gibi JSON değişmezleri metin olarak okunur. Bunların dışındaki HTML dosyalarında
   (ERP'nin HTML ya da .xls olarak verdiği tablolar) <table> satırları okunur ve sütun eşleştirmeye gider.

   Aynı stok kodu birden çok dosyada ve makinede geçer; kayıtlar koda göre birleşir. Her kod için
   elektrikli olup olmadığı (sensör, şalter, termokupl, pompa, motor, redüktör, pano malzemesi…),
   kategori, üretici ve üretici parça numarası tahmin edilir. Tahmin aktarmadan önce düzenlenir.

   Tarayıcıya bağlı değildir; Node testleri aynı kodu çalıştırır. */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./model.js'));
  else root.BomxReports = factory(root.BomxModel);
})(typeof self !== 'undefined' ? self : this, function (M) {
  'use strict';

  const { clean, fold, codeKey } = M;

  /* ─── Metin yardımcıları ──────────────────────────────── */

  /** Adlı karakter başvuruları: ERP çıktılarında görülenler. Tarayıcıda tabloda olmayanı belge çözer. */
  const ENTITIES = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', shy: '',
    Ccedil: 'Ç', ccedil: 'ç', Ouml: 'Ö', ouml: 'ö', Uuml: 'Ü', uuml: 'ü', Auml: 'Ä', auml: 'ä', Euml: 'Ë', euml: 'ë', Iuml: 'Ï', iuml: 'ï',
    Aacute: 'Á', aacute: 'á', Eacute: 'É', eacute: 'é', Iacute: 'Í', iacute: 'í', Oacute: 'Ó', oacute: 'ó', Uacute: 'Ú', uacute: 'ú',
    Agrave: 'À', agrave: 'à', Egrave: 'È', egrave: 'è', Igrave: 'Ì', igrave: 'ì', Ograve: 'Ò', ograve: 'ò', Ugrave: 'Ù', ugrave: 'ù',
    Acirc: 'Â', acirc: 'â', Ecirc: 'Ê', ecirc: 'ê', Icirc: 'Î', icirc: 'î', Ocirc: 'Ô', ocirc: 'ô', Ucirc: 'Û', ucirc: 'û',
    Atilde: 'Ã', atilde: 'ã', Ntilde: 'Ñ', ntilde: 'ñ', Otilde: 'Õ', otilde: 'õ', Aring: 'Å', aring: 'å', AElig: 'Æ', aelig: 'æ',
    Oslash: 'Ø', oslash: 'ø', szlig: 'ß', Scaron: 'Š', scaron: 'š', Zcaron: 'Ž', zcaron: 'ž', Yacute: 'Ý', yacute: 'ý', yuml: 'ÿ',
    deg: '°', plusmn: '±', times: '×', divide: '÷', micro: 'µ', middot: '·', bull: '•', hellip: '…', ndash: '–', mdash: '—', minus: '−',
    lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„', laquo: '«', raquo: '»', prime: '′', Prime: '″',
    frac12: '½', frac14: '¼', frac34: '¾', sup1: '¹', sup2: '²', sup3: '³', ordm: 'º', ordf: 'ª', permil: '‰',
    euro: '€', pound: '£', yen: '¥', cent: '¢', copy: '©', reg: '®', trade: '™', sect: '§', para: '¶',
    Omega: 'Ω', ohm: 'Ω', alpha: 'α', beta: 'β', mu: 'μ', Delta: 'Δ', delta: 'δ', empty: '∅', infin: '∞', le: '≤', ge: '≥', ne: '≠', asymp: '≈'
  };
  let entityBox = null;

  function decodeEntities(text) {
    return String(text || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, name) => {
      if (name[0] === '#') {
        const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
      }
      const v = ENTITIES[name] !== undefined ? ENTITIES[name] : ENTITIES[name.toLowerCase()];
      if (v !== undefined) return v;
      // Tarayıcıda: tabloda olmayan adlı başvuruyu belge çözer (textarea içeriği çalıştırılmaz)
      if (typeof document !== 'undefined' && document.createElement) {
        if (!entityBox) entityBox = document.createElement('textarea');
        entityBox.innerHTML = m;
        return entityBox.value;
      }
      return m;
    });
  }

  /** Hücre metni: etiketler atılır, <br> satır sonu olur, boşluklar sadeleşir */
  function cellText(html) {
    return decodeEntities(String(html || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<[^>]+>/g, ''))
      .replace(/[ \t ]+/g, ' ')
      .split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
  }

  /** Kod karşılaştırma anahtarı: yalnız harf ve rakam, büyük harf, Türkçe harfler sade */
  const alnum = (text) => fold(text).replace(/[^a-z0-9]+/g, '').toUpperCase();

  /** ERP stok kodu biçimi: "10 00243", "07 00309", "10 00694 12" */
  const STOCK_CODE = /^\d{2} \d{5}(?: \d{2})?$/;
  const STOCK_CODE_IN = /\b\d{2} \d{5}(?: \d{2})?\b/g;

  /* ─── Betikteki JSON değişmezleri ─────────────────────── */

  const BS = String.fromCharCode(92);

  /** JSON metninin kapanış ayracı (yalnız çift tırnaklı dizgi bilir); bulunamazsa -1 */
  function jsonEnd(src, start) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < src.length; i += 1) {
      const ch = src[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === BS) escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{' || ch === '[') depth += 1;
      else if (ch === '}' || ch === ']') {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  /**
   * "const|let|var AD = {...}" ya da "[...]" değişmezlerini çalıştırmadan okur. Yalnız JSON'a benzeyenin sonu aranır
   * (tırnaklı anahtarla başlayan nesne ya da dizi); JSON olmayan kod (yorum, düzenli ifade, fonksiyon) atlanmaz,
   * arama hemen ardından sürer: yorumdaki bir kesme işareti sonraki veriyi yutamaz.
   * @param skip okunmayacak ad (fotoğraf gibi büyük veri) için sınama
   * @returns { AD: değer }
   */
  function scriptLiterals(text, skip) {
    const src = String(text || '');
    const out = {};
    const re = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([[{])/g;
    let m;
    while ((m = re.exec(src))) {
      const name = m[1];
      const start = m.index + m[0].length - 1;
      re.lastIndex = start + 1;
      if (skip && skip(name)) continue;
      const head = src.slice(start, start + 40);
      if (src[start] === '{' ? !/^\{\s*("|\})/.test(head) : !/^\[\s*(["{[\]\d-]|true|false|null)/.test(head)) continue;
      const end = jsonEnd(src, start);
      if (end < 0) continue;
      try {
        out[name] = JSON.parse(src.slice(start, end + 1));
        re.lastIndex = end + 1;
      } catch { /* JSON değil: arama ayraçtan sonra sürer */ }
    }
    return out;
  }

  /* ─── HTML tabloları ──────────────────────────────────── */

  /**
   * @returns her tablo bir satır dizisi (hücre metinleri); boş satır ve tablolar atılır.
   * colspan yanındaki sütunları boş geçer; rowspan değeri alttaki satırların aynı sütununa iner.
   */
  function htmlTables(text) {
    const src = String(text || '').replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
    const tables = [];
    const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
    const span = (attrs, name, max) => Math.max(1, Math.min(Number((attrs.match(new RegExp(`${name}\\s*=\\s*["']?(\\d+)`, 'i')) || [])[1]) || 1, max));
    let t;
    while ((t = tableRe.exec(src))) {
      const body = `${t[1]}</table>`;
      const rows = [];
      const carry = []; // sütun → { value, left } üst satırdan inen birleşik hücre
      const rowRe = /<tr\b[^>]*>([\s\S]*?)(?=<tr\b|<\/table>)/gi;
      let r;
      while ((r = rowRe.exec(body))) {
        const cells = [];
        const fillCarried = () => {
          while (carry[cells.length] && carry[cells.length].left > 0) {
            const down = carry[cells.length];
            down.left -= 1;
            cells.push(down.value);
          }
        };
        const cellRe = /<t([dh])\b([^>]*)>([\s\S]*?)(?=<t[dh]\b|<\/tr>|$)/gi;
        let c;
        while ((c = cellRe.exec(r[1]))) {
          const value = cellText(c[3].replace(/<\/t[dh]>[\s\S]*$/i, ''));
          const cols = span(c[2], 'colspan', 50);
          const down = span(c[2], 'rowspan', 1000);
          for (let k = 0; k < cols; k += 1) {
            fillCarried();
            const v = k === 0 ? value : '';
            if (down > 1) carry[cells.length] = { value: v, left: down - 1 };
            cells.push(v);
          }
        }
        fillCarried();
        if (cells.some((x) => x !== '')) rows.push(cells);
      }
      if (rows.length) tables.push(rows);
    }
    return tables;
  }

  /* ─── Rapor biçimleri ─────────────────────────────────── */

  const SOURCE_LABEL = { agac: 'Ürün ağacı', kritik: 'Kritik parça listesi', sarf: 'Sarf / depo listesi' };

  const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const objects = (list) => (Array.isArray(list) ? list.filter(isObject) : []);

  /**
   * Ürün ağacı: groups (grup → makineler → üst kalemler) zorunlu; subs (komple → alt kalemler),
   * flat (raporun elektrik listesi) ve full (ürün tam adı) varsa okunur.
   */
  function isProductTree(d) {
    return isObject(d) && isObject(d.groups) &&
      Object.values(d.groups).some((list) => objects(list).some((m) => Array.isArray(m.items)));
  }

  function readProductTree(d) {
    const machines = [];
    const photoOf = new Map(); // kod → raporun fotoğraf yolu ("photos/10 00243.jpg"); benzer parça aynı fotoğrafı paylaşabilir
    const notePhoto = (it) => {
      const kod = clean(it.c);
      const p = clean(it.p);
      if (kod && p && !photoOf.has(kod)) photoOf.set(kod, p);
    };
    for (const [group, list] of Object.entries(d.groups)) {
      for (const m of objects(list)) {
        objects(m.items).forEach(notePhoto);
        machines.push({
          grup: group,
          ad: clean(m.m) || clean(m.ad) || group,
          gizli: Number(m.x) || 0,
          kalemler: objects(m.items).map((it) => ({
            kod: clean(it.c), ad: clean(it.n), miktar: M.parseNumber(it.q), birim: clean(it.u)
          })).filter((it) => it.kod)
        });
      }
    }
    const subs = {};
    for (const [parent, list] of Object.entries(isObject(d.subs) ? d.subs : {})) {
      if (!clean(parent)) continue;
      objects(list).forEach(notePhoto);
      subs[clean(parent)] = objects(list).map((s) => ({ kod: clean(s.c), ad: clean(s.n), miktar: M.parseNumber(s.q), birim: clean(s.u) })).filter((s) => s.kod);
    }
    const electric = new Map(); // kod → gruplar (raporun kendi elektrik listesi)
    const unknownSubs = new Set();
    for (const [group, f] of Object.entries(isObject(d.flat) ? d.flat : {})) {
      if (!isObject(f)) continue;
      for (const it of objects(f.items)) {
        const kod = clean(it.c);
        if (!kod) continue;
        notePhoto(it);
        if (!electric.has(kod)) electric.set(kod, { gruplar: new Set(), ad: clean(it.n) });
        electric.get(kod).gruplar.add(group);
      }
      for (const it of objects(f.unk)) {
        notePhoto(it);
        if (clean(it.c)) unknownSubs.add(clean(it.c));
      }
    }
    const full = {};
    for (const [kod, v] of Object.entries(isObject(d.full) ? d.full : {})) {
      if (v && typeof v === 'object') full[clean(kod)] = { tr: clean(v.tr), en: clean(v.en), de: clean(v.de) };
      else if (typeof v === 'string') full[clean(kod)] = { tr: clean(v), en: '', de: '' };
    }
    return { machines, subs, electric, unknownSubs, full, photoOf };
  }

  /* ─── ERP ürün ağacı tablosu (Excel / CSV) ────────────── */

  const tableKey = (v) => fold(String(v == null ? '' : v)).replace(/[^a-z0-9]+/g, ' ').trim();
  const TIME_UNITS = /^(saat|dk|dakika|sn|saniye|sa)$/;

  /**
   * ERP'nin verdiği ürün ağacı: "Kaynak Kodu" ve "Kaynak Adı" ya da "Açıklama" sütunlu; "Seviye" sütunu varsa çok seviyeli
   * (üst-alt ilişkisi seviyeden kurulur). Operasyon satırları (OP, süre birimli) ve kodsuz satırlar atlanır.
   * @param rows tablo satırları; @param name dosya adı
   * @returns rapor (kind 'agac') ya da ürün ağacı değilse null
   */
  function readTreeTable(rows, name) {
    const table = Array.isArray(rows) ? rows : [];
    for (let h = 0; h < Math.min(table.length, 15); h += 1) {
      const head = (table[h] || []).map(tableKey);
      const code = head.findIndex((x) => x === 'kaynak kodu' || x === 'bilesen kodu');
      const nameCol = head.findIndex((x) => x === 'kaynak adi' || x === 'aciklama' || x === 'bilesen adi');
      if (code < 0 || nameCol < 0) continue;
      const level = head.findIndex((x) => x === 'seviye');
      const qty = head.findIndex((x) => x.startsWith('hammadde miktari') || x === 'miktar');
      const unit = head.findIndex((x) => x === 'birim');
      const body = table.slice(h + 1);
      // Kalem türü sütunu (SU kök, AS yarı mamul, HM hammadde, OP operasyon): başlığı ".." olabilir, değerinden bulunur
      let typeCol = -1;
      for (let c = 0; c < head.length && typeCol < 0; c += 1) {
        const vals = body.slice(0, 80).map((r) => String((r || [])[c] == null ? '' : r[c]).trim()).filter(Boolean);
        if (vals.length >= 3 && vals.every((v) => /^(SU|AS|HM|OP|YU|YM|MM|TM)$/.test(v)) && vals.some((v) => v === 'AS' || v === 'HM')) typeCol = c;
      }
      const cell = (r, c) => (c < 0 ? '' : clean((r || [])[c] == null ? '' : r[c]));
      // Dosya adı: "KSY ÇOK SEVİYELİ ÜRÜN AĞACI.xlsm" → "KSY ÜRÜN AĞACI" (\b Türkçe harfte çalışmadığı için harf komşuluğuna bakılır)
      const fileMachine = clean(String(name || '').replace(/\.[^.]+$/, '').replace(/(?<![\p{L}\p{N}])(?:[çc]ok|tek) sev[iİı]yel[iİı](?![\p{L}\p{N}])/giu, ' ')) || 'Ürün ağacı';
      let machine = '';
      const top = [];
      const subs = {};
      const stack = [];
      for (const r of body) {
        const kod = cell(r, code);
        const ad = cell(r, nameCol);
        const type = cell(r, typeCol).toUpperCase();
        const u = cell(r, unit);
        if (!kod || type === 'OP' || TIME_UNITS.test(fold(u))) continue;
        const lv = level >= 0 ? M.parseNumber(cell(r, level)) : 1;
        if (level >= 0 && (lv === null || lv < 0)) continue;
        if (lv === 0 || type === 'SU') {
          // Kök: makinenin kendisi ("KBN 2B 1650 PARÇA YIKAMA MAKİNESİ KSYS")
          machine = clean(ad.replace(/(?<![\p{L}\p{N}])(?:par[cç]a )?y[iı]kama mak[iİı]nes[iİı](?![\p{L}\p{N}])/giu, ' ')) || ad;
          stack.length = 0;
          stack[0] = kod;
          continue;
        }
        const item = { c: kod, n: ad, q: cell(r, qty), u };
        if (level < 0 || lv === 1 || !stack[lv - 1]) {
          top.push(item);
        } else {
          const parent = stack[lv - 1];
          subs[parent] = subs[parent] || [];
          if (!subs[parent].some((s) => s.c === kod)) subs[parent].push(item);
        }
        if (level >= 0) {
          stack.length = lv + 1;
          stack[lv] = kod;
        }
      }
      if (!top.length) return null;
      const data = readProductTree({ groups: { [machine || fileMachine]: [{ m: machine || fileMachine, items: top }] }, subs });
      const codes = new Set([...top.map((t) => t.c), ...Object.keys(subs), ...Object.values(subs).flat().map((s) => s.c)]);
      return { kind: 'agac', name: name || '', title: machine || fileMachine, data, tables: [], photos: {}, summary: `${level >= 0 ? 'çok seviyeli' : 'tek seviyeli'} · ${machine || fileMachine} · ${codes.size} kod` };
    }
    return null;
  }

  /** Kritik parça listesi: DATA = { grup: [ { "Sipariş kodu", "Parça adı", … } ] } */
  function isCriticalList(d) {
    if (!isObject(d)) return false;
    const lists = Object.values(d).filter(Array.isArray);
    return lists.length > 0 && lists.some((l) => objects(l).some((r) => 'Sipariş kodu' in r || 'Parça adı' in r));
  }

  function readCriticalList(d) {
    const rows = [];
    for (const [group, list] of Object.entries(d)) {
      if (!Array.isArray(list)) continue;
      for (const r of list) {
        if (!r || typeof r !== 'object') continue;
        const kod = clean(r['Sipariş kodu']);
        rows.push({
          grup: group,
          kod,
          ad: clean(r['Parça adı']),
          makine: clean(r['Varyant / makine']),
          sinif: [r['Önem (A/B/C)'], r['Aşınma (1/2/3)'], r['Ulaşılabilirlik (K/O/Z)']].map(clean).join(''),
          birim: clean(r.Birim),
          not: clean(r.Not),
          foto: clean(r['Fotoğraf'])
        });
      }
    }
    return { rows: rows.filter((r) => r.kod || r.ad) };
  }

  /** Sarf / depo listesi: P.data = { makine, gruplar, kalemler: [ { kod, alt_kod, ad: {tr}, grup, birim, n } ] } */
  function isSparesList(p) {
    return isObject(p) && isObject(p.data) && Array.isArray(p.data.kalemler);
  }

  const tr = (v) => clean(v && typeof v === 'object' ? v.tr || v.en || '' : v);

  function readSparesList(p) {
    const d = p.data;
    const mk = isObject(d.makine) ? d.makine : {};
    const machine = [clean(mk.model), mk.seri_no ? `SN ${clean(mk.seri_no)}` : ''].filter(Boolean).join(' ');
    const groups = new Map(objects(d.gruplar).map((g) => [g.id, tr(g.ad)]));
    return {
      makine: machine,
      musteri: tr(mk.musteri),
      kalemler: objects(d.kalemler).map((it) => ({
        kod: clean(it.kod),
        altKod: clean(it.alt_kod),
        ad: tr(it.ad),
        grup: clean(it.grup),
        grupAd: groups.get(it.grup) || clean(it.grup),
        birim: clean(it.birim),
        adet: Number(it.n) || null,
        durum: clean(it.durum),
        foto: isImageData(it.foto_b64) ? it.foto_b64 : ''
      }))
    };
  }

  /** Gömülü fotoğraf: "data:image/jpeg;base64,…" */
  const isImageData = (v) => typeof v === 'string' && v.length < 4e6 && /^data:image\/(jpeg|jpg|png|webp|gif);base64,[A-Za-z0-9+/=\s]+$/.test(v);

  /**
   * HTML dosyasını tanır.
   * @returns { kind: 'agac'|'kritik'|'sarf'|'tablo'|null, name, title, data, tables, summary }
   */
  function readHtml(text, name) {
    const src = String(text || '');
    const title = cellText((src.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
    const report = { kind: null, name: name || '', title, data: null, tables: [], photos: {}, summary: '' };
    if (/<script\b/i.test(src)) {
      const lit = scriptLiterals(src);
      // Fotoğraflar: yol → "data:image/…" (ürün ağacı ve kritik parça raporlarında IMGS)
      for (const [k, v] of Object.entries(lit)) {
        if (!/^(IMGS?|FOTO(GRAF)?LAR|PHOTOS?|IMAGES?)$/i.test(k) || !isObject(v)) continue;
        for (const [path, data] of Object.entries(v)) if (isImageData(data)) report.photos[path] = data;
        delete lit[k];
      }
      // Değişken adı DATA olmasa da biçimden tanınır
      const values = [lit.DATA, ...Object.values(lit)];
      const tree = values.find(isProductTree);
      const critical = values.find(isCriticalList);
      if (tree) {
        report.kind = 'agac';
        report.data = readProductTree(tree);
        const codes = new Set();
        report.data.machines.forEach((m) => m.kalemler.forEach((it) => codes.add(it.kod)));
        Object.entries(report.data.subs).forEach(([p, list]) => { codes.add(p); list.forEach((s) => codes.add(s.kod)); });
        report.summary = `${report.data.machines.length} makine · ${codes.size} kod · ${report.data.electric.size} elektrikli malzeme`;
        return report;
      }
      if (critical) {
        report.kind = 'kritik';
        report.data = readCriticalList(critical);
        report.summary = `${report.data.rows.length} satır`;
        return report;
      }
      const spares = Object.values(lit).find(isSparesList);
      if (spares) {
        report.kind = 'sarf';
        report.data = readSparesList(spares);
        report.summary = `${report.data.makine || 'makine'} · ${report.data.kalemler.length} kalem`;
        return report;
      }
    }
    report.tables = htmlTables(src).filter((rows) => rows.length >= 2 && Math.max(...rows.map((r) => r.length)) >= 2);
    if (report.tables.length) {
      report.kind = 'tablo';
      report.tables.sort((a, b) => b.length * Math.max(...b.map((r) => r.length)) - a.length * Math.max(...a.map((r) => r.length)));
      report.summary = `${report.tables.length} tablo · ${report.tables[0].length} satır`;
    }
    return report;
  }

  /* ─── Kodlara göre birleştirme ────────────────────────── */

  function entryFor(map, kod) {
    const key = codeKey(kod);
    if (!map.has(key)) {
      map.set(key, {
        kod, erpAdlar: new Map(), tamAd: null, sarf: [], kritik: [], elektrikListesi: new Set(),
        makineler: new Set(), ustler: new Set(), altlar: [], komple: false, altKirilimEksik: false,
        kaynaklar: new Set(), dosyalar: new Set(), birim: '', ilgili: new Set(), alternatif: new Set(), uyarilar: [],
        foto: '', fotoKaynak: ''
      });
    }
    return map.get(key);
  }

  const addName = (e, name) => {
    const n = clean(name);
    if (n) e.erpAdlar.set(n, (e.erpAdlar.get(n) || 0) + 1);
  };

  /** Stok kodu yoksa üretici kodu: marka sözcükleri atılır ("SMC IS10E-40-F04-6L-D" → "IS10E-40-F04-6L-D") */
  function codeFromMakerRef(ref) {
    let text = clean(ref).replace(/\(.*?\)/g, ' ').replace(/\s*\+.*$/, '');
    const brand = brandOf(text);
    if (brand) {
      const words = brand.match.split(/\s+/).length;
      const tokens = text.split(/\s+/);
      const at = tokens.findIndex((t, i) => fold(tokens.slice(i, i + words).join(' ')).replace(/[^a-z0-9 ]/g, '') === fold(brand.match).replace(/[^a-z0-9 ]/g, ''));
      if (at >= 0) tokens.splice(at, words);
      text = tokens.join(' ');
    }
    return clean(text);
  }

  /**
   * Raporlardaki tüm kodları birleştirir.
   * @returns Map codeKey → kayıt (adlar, tam ad, makineler, üst kompleler, kaynaklar…)
   */
  function collect(reports) {
    const map = new Map();
    const trees = reports.filter((r) => r.kind === 'agac');
    // Önce ürün ağaçları: makine üyeliği alt kırılımlara da yayılır
    for (const rep of trees) {
      const d = rep.data;
      const subsOf = (kod) => d.subs[kod] || [];
      for (const [parent, list] of Object.entries(d.subs)) {
        const p = entryFor(map, parent);
        p.komple = true;
        p.kaynaklar.add('agac');
        p.dosyalar.add(rep.name);
        for (const s of list) {
          const e = entryFor(map, s.kod);
          addName(e, s.ad);
          e.ustler.add(parent);
          e.kaynaklar.add('agac');
          e.dosyalar.add(rep.name);
          if (!p.altlar.includes(s.kod)) p.altlar.push(s.kod);
        }
      }
      const spread = (kod, machine, seen) => {
        if (seen.has(kod)) return;
        seen.add(kod);
        entryFor(map, kod).makineler.add(machine);
        for (const s of subsOf(kod)) spread(s.kod, machine, seen);
      };
      for (const m of d.machines) {
        for (const it of m.kalemler) {
          const e = entryFor(map, it.kod);
          addName(e, it.ad);
          e.kaynaklar.add('agac');
          e.dosyalar.add(rep.name);
          if (it.birim && !e.birim) e.birim = it.birim;
          spread(it.kod, m.ad, new Set());
        }
      }
      for (const [kod, info] of d.electric) {
        const e = entryFor(map, kod);
        addName(e, info.ad);
        info.gruplar.forEach((g) => e.elektrikListesi.add(g));
        e.kaynaklar.add('agac');
        e.dosyalar.add(rep.name);
      }
      for (const kod of d.unknownSubs) {
        const e = entryFor(map, kod);
        e.komple = true;
        e.altKirilimEksik = true;
      }
      for (const [kod, f] of Object.entries(d.full)) {
        const key = codeKey(kod);
        if (map.has(key) && f.tr) map.get(key).tamAd = f;
      }
      // Ürün ağacının fotoğrafı (raporda benzer parçalar aynı fotoğrafı paylaşabilir)
      for (const [kod, path] of d.photoOf || []) {
        const e = map.get(codeKey(kod));
        const data = rep.photos && rep.photos[path];
        if (e && data && !e.foto) {
          e.foto = data;
          e.fotoKaynak = rep.name;
        }
      }
    }
    for (const rep of reports.filter((r) => r.kind === 'kritik')) {
      for (const r of rep.data.rows) {
        if (!r.kod) continue;
        const e = entryFor(map, r.kod);
        if (r.ad) addName(e, r.ad);
        e.kritik.push(r);
        e.kaynaklar.add('kritik');
        e.dosyalar.add(rep.name);
        if (r.birim && !e.birim) e.birim = r.birim;
        const data = r.foto && rep.photos && rep.photos[r.foto];
        if (data && !e.foto) {
          e.foto = data;
          e.fotoKaynak = rep.name;
        }
      }
    }
    for (const rep of reports.filter((r) => r.kind === 'sarf')) {
      for (const it of rep.data.kalemler) {
        const codes = (it.kod.match(STOCK_CODE_IN) || []);
        const altCodes = (it.altKod.match(STOCK_CODE_IN) || []);
        const altText = clean(it.altKod.replace(STOCK_CODE_IN, ' ').replace(/[()]/g, ' '));
        const record = Object.assign({ makine: rep.data.makine }, it);
        if (codes.length) {
          // Birden çok kod tek kalemde ("10 04538 · 10 17185 · 10 16496"): ad yalnız tek kodluda alınır
          for (const kod of codes) {
            const e = entryFor(map, kod);
            e.sarf.push(Object.assign({ tekKod: codes.length === 1 }, record));
            e.kaynaklar.add('sarf');
            e.dosyalar.add(rep.name);
            if (it.birim && !e.birim) e.birim = it.birim;
            // Birleşik kalemin fotoğrafı tek parçayı göstermez: yalnız tek kodlu kalemden alınır
            if (codes.length === 1 && it.foto && !e.foto) {
              e.foto = it.foto;
              e.fotoKaynak = rep.name;
            }
            altCodes.forEach((c) => e.ilgili.add(it.altKod.includes(`${c} (`) ? it.altKod.slice(it.altKod.indexOf(c)).split(/[·,]/)[0].trim() : c));
            if (!altCodes.length && altText) e.alternatif.add(altText);
          }
          continue;
        }
        if (altCodes.length) {
          // Kodsuz kalemin alt kodu stok kodu: o kodun kullanımına eklenir. Başka kaynakta adı geçmeyen kod üretilmez
          // (kalemin adı birden çok parçayı anlatıyor olabilir: "İnvertörler — Omron …, Delta …")
          for (const kod of altCodes) {
            if (!map.has(codeKey(kod))) continue;
            const e = entryFor(map, kod);
            e.sarf.push(Object.assign({ tekKod: false }, record));
            e.kaynaklar.add('sarf');
            e.dosyalar.add(rep.name);
          }
          continue;
        }
        const ref = altText ? codeFromMakerRef(altText) : '';
        const e = entryFor(map, ref || `—${it.ad}`);
        if (!ref) e.kod = '';
        else e.uyarilar.push('Stok kodu yok: üretici kodu kod olarak yazıldı');
        if (!ref) e.uyarilar.push('Stok kodu yok: aktarmadan önce kod yazın');
        e.sarf.push(Object.assign({ tekKod: true }, record));
        e.kaynaklar.add('sarf');
        e.dosyalar.add(rep.name);
        e.kodsuz = true;
        if (it.birim && !e.birim) e.birim = it.birim;
        if (it.foto && !e.foto) {
          e.foto = it.foto;
          e.fotoKaynak = rep.name;
        }
      }
    }
    return map;
  }

  /* ─── Üretici ve parça numarası ───────────────────────── */

  /** [görünen ad, katlanmış metinde düzenli ifade, metindeki yazımı] */
  const BRANDS = [
    ['Schneider', /\bschneider\b|\bmerlin gerin\b|\bm\.gerin\b/],
    ['Telemecanique', /\btelemecanique\b/],
    ['Siemens', /\bsiemens\b/],
    ['Omron', /\bomron\b/],
    ['Delta', /\bdelta\b/],
    ['SICK', /\bsick\b/],
    ['Panasonic', /\bpanasonic\b/],
    ['Mean Well', /\bmean ?well\b/],
    ['Weidmüller', /\bweidmuller\b/],
    ['Emas', /\bemas\b/],
    ['Opaş', /\bopas\b/],
    ['Entes', /\bentes\b/],
    ['Enda', /\benda\b/],
    ['GEMO', /\bgemo\b/],
    ['Ordel', /\bordel\b/],
    ['Theben', /\btheben\b/],
    ['Cata', /\bcata\b/],
    ['Bemis', /\bbemis\b/],
    ['Airtac', /\bairtac\b/],
    ['SMC', /\bsmc\b/],
    ['Pnomek', /\bpnomek\b/],
    ['VEGA', /\bvega\b|\bvegaswing\b/],
    ['Trafag', /\btrafag\b/],
    ['Goulds (Xylem)', /\bgoulds\b/],
    ['Atlantis', /\batlantis\b/],
    ['Water Sound', /\bwater sound\b/],
    ['Yılmaz Redüktör', /\byilmaz\b/],
    ['SEW', /\bsew\b/],
    ['ERF Group', /\berf\b/],
    ['ENA Fan', /\bena\b/],
    ['Filtermist', /\bfiltermist\b/],
    ['Dosatron', /\bdosatron\b/],
    ['RTS VAC', /\brts ?vac\b/],
    ['Leister', /\bleister\b/],
    ['Lechler', /\blechler\b/],
    ['ORS', /\bors\b/],
    ['PMX', /\bpmx\b/],
    ['Lowara', /\blowara\b/],
    ['Grundfos', /\bgrundfos\b/],
    ['ABB', /\babb\b/],
    ['Festo', /\bfesto\b/],
    ['Phoenix Contact', /\bphoenix\b/],
    ['Klemsan', /\bklemsan\b/],
    ['Eaton', /\beaton\b/],
    ['Mitsubishi', /\bmitsubishi\b/],
    ['IFM', /\bifm\b/],
    ['Pepperl+Fuchs', /\bpepperl\b/],
    ['Balluff', /\bballuff\b/],
    ['Autonics', /\bautonics\b/]
  ];

  /** Parça numarasının başından marka (ad metinde yazmıyorsa) */
  const PREFIX_BRANDS = [
    [/^(LC1|LR2|GV2|GV3|GVAE|LA1K|LADN|A9[A-Z]|RXM|RXZ|RSB|RSZ|LV4\d|LV5\d|CVS|NSX|ATV|XB[4-7])/, 'Schneider'],
    [/^XU[A-Z]|^XUZ/, 'Telemecanique'],
    [/^(6ES7|6AV2|3LD|3RT|3RV|3SU)/, 'Siemens'],
    [/^(G9S|D4N|CP1W|CP2E|CP1E|NB[57]W|3G3|XS2F|E2E|E3Z|H3CR|MY[24]N)/, 'Omron'],
    [/^(VFD|DVP|DOP)/, 'Delta'],
    [/^IME\d/, 'SICK'],
    [/^(SF4D|APF\d)/, 'Panasonic'],
    [/^(MDR|LRS|NDR|HDR|EDR)-/, 'Mean Well'],
    [/^ETB\d/, 'Enda'],
    [/^(B10\d|B20\d|S14\d?|S22\d|L5K|LK20|BPR|IK5\d|RS1P)/, 'Emas'],
    [/^YKL/, 'Opaş'],
    [/^([34]V\d{3}|CS1)/, 'Airtac'],
    [/^DS1/, 'Pnomek']
  ];

  /** @returns { name, match } metindeki ilk marka */
  function brandOf(text) {
    const f = fold(text);
    let best = null;
    for (const [name, re] of BRANDS) {
      const m = re.exec(f);
      if (m && (!best || m.index < best.index)) best = { name, index: m.index, match: String(text).substr(m.index, m[0].length) };
    }
    return best ? { name: best.name, match: best.match } : null;
  }

  /** Seri ya da ürün ailesi adları parça numarası sayılmaz */
  const SERIES_WORDS = new Set(['TESYS', 'ACTI9', 'IC60N', 'IK60N', 'IID', 'IOF', 'ZELIO', 'SIMATIC', 'SENTRON', 'EASYPACT', 'COMPACT',
    'TERMSERIES', 'VFD-EL', 'VFD-E', 'E-SH', 'S7-1200', 'S7-1500', 'KTP700', 'KTP400', 'BASIC', 'AISI', 'DIN', 'CEE', 'LED', 'PNP', 'NPN',
    'TFT', 'HMI', 'CPU', 'PLC', 'MCB', 'RCCB', 'TMŞ', 'TMS', 'AC', 'DC', 'AC/DC', 'DC/DC/DC', 'G/Ç', 'I/O', 'NO', 'NC', 'NA', 'NK', 'CO', 'IEC',
    'RS-485', 'RS485', 'USB', 'ETHERNET', 'IP20', 'IP40', 'IP44', 'IP54', 'IP65', 'IP66', 'IP67', 'IP68', 'IE2', 'IE3']);

  /** Makine serileri (ürün ağacındaki makine adlarının ilk sözcüğü) parça numarası sayılmaz */
  const MACHINE_SERIES = new Set(['LYM', 'KBN', 'VDL', 'PYM', 'ULT', 'KNV', 'MST', 'NS', 'KKO']);

  /** Ölçü, gerilim, akım, güç, koruma sınıfı gibi teknik değerler */
  function isMeasure(token) {
    const t = token.toUpperCase();
    return /^[-+±]?\d+([.,]\d+)?([-–/]\d+([.,]\d+)?)?(V|VAC|VDC|W|KW|A|MA|KA|HP|MM|CM|M|HZ|BAR|MBAR|D\/D|DK|K|L|LT|N|NM|S|SN|MIKRON|ΜM|M3|M³|M3\/H|KΩ|Ω|°|°C|C|P|PIN|POL|KUTUP)$/.test(t) ||
      /^\d+V\/\d+HZ$/.test(t) || /^(IP|M|B|IE|DN|PN|G|R|SN)\d+$/.test(t) || /^\d+(NO|NC|NA|NK|CO)(\+\d+(NO|NC|NA|NK|CO))*$/.test(t) ||
      /^\d+([.,]\d+)?[X×*]\d+/.test(t) || /^\d+P\d*[DN]?$/.test(t) || /^\d+C\/O$/.test(t) || /^Ø/.test(t) || /^%/.test(t) ||
      /^\d+([.,]\d+)?-\d+([.,]\d+)?A$/.test(t) || /^\d+'+$/.test(t) || /^\d+"$/.test(t) || /^\d+\/\d+"?$/.test(t) || /^AISI\d*L?$/.test(t);
  }

  /** Harf ve rakam içeren, parça numarasına benzeyen sözcük (LC1D09M7, VFD007EL21W-1, 6ES7214-1AG40-0XB0) */
  function codeLike(token) {
    if (token.length < 3 || token.length > 32) return false;
    if (!/^[A-Za-z0-9][A-Za-z0-9\-/._]*[A-Za-z0-9]$/.test(token)) return false;
    if (!/\d/.test(token) || !/[A-Za-z]/.test(token)) return false;
    if ((token.match(/[A-Z]/g) || []).length < 1) return false;
    if (SERIES_WORDS.has(token.toUpperCase()) || isMeasure(token)) return false;
    return token.length >= 4 || /^[A-Z]{1,2}\d{2,}$/.test(token);
  }

  /** Sözcükler; ondalık virgül ("7,5T") bölünmez, parantez içi işaretlenir */
  function tokensOf(text) {
    const out = [];
    let depth = 0;
    for (const raw of String(text || '').split(/\s+|[,;](?=\s|$)/)) {
      if (!raw) continue;
      const opens = (raw.match(/\(/g) || []).length;
      const closes = (raw.match(/\)/g) || []).length;
      const inParen = depth > 0 || opens > 0;
      depth = Math.max(0, depth + opens - closes);
      const t = raw.replace(/^[("'[]+|[)"'\]:.]+$/g, '');
      if (t) out.push({ t, paren: inParen });
    }
    return out;
  }

  /**
   * Üretici parça numarası: tam addaki adaylar ERP adında da geçiyorsa güçlü sayılır (ikisi aynı parçayı anlatır).
   * "ESHE 32-160/22" gibi harf + sayı grupları ERP adında art arda geçtiği sürece birleşir.
   */
  function partNumber(fullName, erpName) {
    const erp = alnum(erpName);
    const toks = tokensOf(fullName);
    const brand = brandOf(fullName);
    const brandWords = new Set(brand ? fold(brand.match).toUpperCase().split(/\s+/) : []);
    const cands = [];
    toks.forEach((tok, i) => {
      if (MACHINE_SERIES.has(tok.t.toUpperCase())) return;
      const upperAlpha = /^[A-Z]{2,10}$/.test(tok.t) && !brandWords.has(tok.t) && !SERIES_WORDS.has(tok.t);
      if (!codeLike(tok.t) && !upperAlpha) return;
      let text = tok.t;
      let key = alnum(text);
      let j = i + 1;
      // ERP adında art arda geçen kod parçaları eklenir ("DS1 A3 012", "TRS 24VDC 1CO"); küçük harfli sözcük eklenmez
      while (erp && j < toks.length && j <= i + 3) {
        const piece = toks[j].t;
        if (!/\d/.test(piece) && !/^[A-Z]{1,4}$/.test(piece)) break;
        if (MACHINE_SERIES.has(piece.toUpperCase())) break;
        // Ölçü ("1/4", "24VDC") yalnız parça numarasının devamı olabilir, harf grubuna eklenmez ("YKS 1/4" değil)
        if (upperAlpha && j === i + 1 && isMeasure(piece)) break;
        const next = `${key}${alnum(piece)}`;
        if (!alnum(piece) || !erp.includes(next)) break;
        text = `${text} ${toks[j].t}`;
        key = next;
        j += 1;
      }
      // ERP adı yoksa harf grubu yalnız rakamla başlayan sözcükle birleşir ("ECT 8472")
      if (!erp && upperAlpha && j === i + 1 && toks[j] && /^\d/.test(toks[j].t) && !isMeasure(toks[j].t)) {
        text = `${text} ${toks[j].t}`;
        key = alnum(text);
        j += 1;
      }
      if (!/\d/.test(key) || !/[A-Z]/.test(key)) return;
      if (upperAlpha && j === i + 1) return;
      const inErp = erp ? (erp.includes(key) || (key.length >= 10 && erp.includes(key.slice(0, 10)))) : false;
      const pos = inErp ? Math.max(0, erp.indexOf(key.slice(0, Math.min(key.length, 10)))) : 0;
      cands.push({ text, key, paren: tok.paren, inErp, pos, order: i });
    });
    const score = (c) => (c.inErp ? 100 : 0) + (c.paren && c.key.length >= 8 ? 20 : 0) + (c.key.length >= 8 ? 10 : 0) - c.pos * 0.5 - c.order * 0.01;
    cands.sort((a, b) => score(b) - score(a));
    if (cands.length && (cands[0].inErp || !erp)) return cands[0].text;
    if (cands.length) {
      const paren = cands.find((c) => c.paren && c.key.length >= 8);
      return (paren || cands.slice().sort((a, b) => a.order - b.order)[0]).text;
    }
    // Tam adda yoksa ERP adındaki ilk parça numarası ("KONTAKTÖR LC1D09M7")
    const fromErp = tokensOf(erpName).find((t) => codeLike(t.t) && !/^\d/.test(t.t));
    return fromErp ? fromErp.t : '';
  }

  /* ─── Sınıflandırma ───────────────────────────────────── */

  /**
   * [kategori, sınıf, düzenli ifade, keep]. sınıf: 'elektrik' | 'reduktor' | 'diger'.
   * Aynı yerde eşleşen kurallarda listedeki sıra kazanır: özel kural genelden önce yazılır.
   * keep: adın asıl sözcüğü elektrikli olsa da geçerli kalan özel ad ("diyaframlı pompa" pnömatiktir).
   */
  const TYPE_RULES = [
    ['Pnömatik', 'diger', /\bdiyaframli pompa|\bcift diyaframli/, true],
    ['Mekanik', 'diger', /\bbaglanti elemanlari|\bbaglanti parcalari|\bmontaj elemanlari/, true],
    ['Kablo', 'elektrik', /\bsensor kablosu|\bbaglanti kablosu|\bkablo seti|\bm12 kablo|\bkumanda kablosu/],
    // Kablo tesisatı: rakor, kanal, spiral, klemens, kablo pabucu ("KABLO RAKORU" rakor ama elektrik malzemesidir)
    ['Kablo Aksesuarı', 'elektrik', /\bkablo rakoru|\bkablo kanali\b|\bspiral\b|\bkablo bagi|\bkablo pabucu|\bmakaron\b|\bdin ray|\bklemens/, true],
    ['Elektrik Panosu', 'elektrik', /\bpano cp\b|\bbuat\b|\bklemens kutusu/, true],
    ['Kaçak Akım Rölesi', 'elektrik', /\b(sigorta )?kacak akim/],
    ['Redüktör', 'elektrik', /\breduktor (ve motor|motoru|motorlu)|\breduktorlu motor|\bmotor ?redukt/],
    ['Redüktör', 'reduktor', /\breduktor\b/],
    ['Termik / MKŞ', 'elektrik', /\bmotor koruma|\btermik (role|asiri)|\bfaz koruma|\bfaz (sirasi|yoklugu)/],
    ['Güvenlik', 'elektrik', /\bemniyet (role|kontrolor)|\bisik (perdesi|bariyeri)|\blazer isin|\binterlock\b|\bemniyet kapi salteri|\bemniyet salteri/],
    ['Zaman Rölesi', 'elektrik', /\bzaman (rolesi|role|saati)|\bzamanlayici/],
    ['Operatör Paneli', 'elektrik', /\bplc ekran|\boperator panel|\bhmi\b|\bdokunmatik/],
    ['PLC', 'elektrik', /\bplc\b|\bsimatic\b|\bcpu\b/],
    ['Röle', 'elektrik', /\brole (soketi|modulu)|\bminyatur role|\byaprak role|\bguc rolesi|\bsoketli role|\brole\b/],
    ['Kontaktör', 'elektrik', /\bkontaktor|\byardimci kontak/],
    ['Sigorta', 'elektrik', /\bsigorta|\btms\b|\bkompakt guc salteri|\bguc salteri|\bdoner kol|\bmcb\b/],
    ['Şalter', 'elektrik', /\bpako|\bana salter|\byuk ayirici/],
    ['İnvertör', 'elektrik', /\binvertor|\binverter|\bfrekans (konvertor|invertor)|\bsurucu\b/],
    ['Güç Kaynağı', 'elektrik', /\bguc kaynagi|\bpower supply/],
    ['Sıcaklık Sensörü', 'elektrik', /\btermokup|\bthermocouple|\bpt ?100\b|\bsicaklik sensor/],
    ['Termostat', 'elektrik', /\btermostat|\bsicaklik kontrol|\bfirin kontrol|\bfir\.kon/],
    ['Seviye Sensörü', 'elektrik', /\bseviye|\bvegaswing|\bsamandirali seviye/],
    ['Basınç Sensörü', 'elektrik', /\bbasinc (salter|transmit|sensor)|\bpresostat|\bbasinc transduser/],
    ['Vana Switch Box', 'elektrik', /\bswitch ?box|\bkonum bildirim/],
    ['Switch', 'elektrik', /\bsinir salteri|\blimit switch|\bswitch\b|\bswitch'?i\b|\bmini sinir/],
    ['Piston Sensörü', 'elektrik', /\breed\b|\bsilindir sensor|\bsilindir konum/],
    ['Pozisyon Sensörü', 'diger', /\breflektor/],
    ['Pozisyon Sensörü', 'elektrik', /\bsensor|\bfotosel|\bfotoelektrik|\bendukt|\bkapasitif|\bencoder/],
    ['Selenoid Valf', 'elektrik', /\bselenoid|\bsolenoid|\bp\.valf|\bvalf bobin|\bbobin\b|\bbobinli/],
    ['Buton', 'elektrik', /\bacil stop|\bbuton|\bsecici (salter|anahtar)|\bkontak blo|\bpotansiyometre/],
    ['Lamba', 'elektrik', /\bsinyal lamba|\btepe lamba|\bisik blogu|\bikaz lamba/],
    ['Aydınlatma', 'elektrik', /\baydinlatma|\bpano lamba|\bled (bant|lamba)|\bcalisma lambasi|\barmatur/],
    ['Fiş / Priz', 'elektrik', /\bfis\b|\bpriz|\bkonnektor/],
    ['Elektrik Panosu', 'elektrik', /\belektrik (kutusu|kut\.|panosu)|\bkumanda (panosu|kutusu)/],
    ['Kablo', 'elektrik', /\bkablo(su)?\b/],
    ['Fan', 'elektrik', /\bfan\b|\bfani\b|\bblower|\byag buhari toplama|\bvantilator|\baspirator/],
    ['Pompa', 'elektrik', /\bpompa/],
    ['Rezistans', 'elektrik', /\brezistans|\bisitici/],
    ['Motor', 'elektrik', /\bmotor\b|\bmotoru\b/],
    // Elektrik dışı
    ['Mekanik', 'diger', /\byag kecesi|\byag ayirma/],
    ['Mekanik', 'diger', /\bamortisor|\bgaz yayi|\brulman|\bkece|\bo-?ring|\bzincir|\bteker|\bdelrin|\bflans|\bpinyon|\bmafsal|\bkizak|\bpleksi|\bconta|\bsalmastra|\bpiston lastigi|\bmil\b|\bkapak|\bteflon|\bsac(i)?\b|\bparca(si)?\b|\bborusu\b|\badaptor|\bsehpa|\blama(si)?\b|\bbraket|\bprofil|\bplaka|\btutucu|\bkelepce|\bcivata|\bsomun|\bpul\b|\bvida|\bsaplama|\bmentese|\bkulp\b|\bgovde|\bsase|\biskelet/],
    ['Nozzle', 'diger', /\bnozzle|\bhava (taragi|bicagi)|\bmeme\b/],
    ['Pnömatik', 'diger', /\btas filtre|\bsusturucu|\bregulator|\bhava valfi|\baktuator|\bventil|\bhortum|\bpilotlu|\brakor|\bsilindir\b/],
    ['Filtre', 'diger', /\bfiltre/],
    ['Vana', 'diger', /\bvana/],
    ['Sarf Malzeme', 'diger', /\byagi\b|\bgres\b|\bsentetik yag/],
    ['Etiket', 'diger', /\betiket/],
    ['Ambalaj', 'diger', /\bambalaj|\bsandik/]
  ];

  /**
   * Adın asıl sözcüğü (Türkçe tamlamada asıl sözcük sondadır ve iyelik eki alır):
   * "filtre pompası" pompadır, "pompa emiş filtresi" filtredir, "kapak sensörü" sensördür, "sensör kablosu" kablodur.
   * Eksiz yazılan ERP adlarında tür başa yazılır: "FİLTRE 2'' BLOWER 500" filtredir. "-li / -siz" eki niteler:
   * "filtreli fan" fandır, "motorsuz redüktör" motor değildir.
   * e: elektrikli, n: elektrik dışı. MODIFIER: eksiz hâli başka sözcüğü niteler ("yağ sıyırıcı", "vana switch box");
   * iyelik ekiyle asıl sözcüktür ("redüktör yağı"), adda yalnız o varsa zayıf ipucudur.
   */
  const HEAD_WORDS = {
    e: ['pompa', 'motor', 'fan', 'blower', 'sensor', 'salter', 'switch', 'role', 'kontaktor', 'sigorta', 'rezistans', 'isitici', 'termokupl',
      'termokupul', 'termostat', 'bobin', 'buton', 'lamba', 'kablo', 'fis', 'priz', 'invertor', 'inverter', 'plc', 'soket', 'transmitter',
      'transmiter', 'fotosel', 'encoder', 'enkoder', 'zamanlayici', 'armatur', 'konnektor', 'vantilator', 'aspirator', 'presostat', 'trafo',
      'transformator'],
    n: ['filtre', 'conta', 'pleksi', 'salmastra', 'gres', 'kece', 'rulman', 'oring', 'nozzle', 'amortisor', 'flans', 'pinyon', 'mafsal', 'kizak',
      'delrin', 'zincir', 'teker', 'tekerlek', 'susturucu', 'hortum', 'rakor',
      // ERP ürün ağacındaki imal parçalar ve bağlantı elemanları ("SWITCH ALT BAĞLANTI SACI", "SENSÖR BORUSU", "MOTOR KAPAĞI SACI")
      'sac', 'parca', 'boru', 'adaptor', 'sehpa', 'lama', 'kanal', 'braket', 'profil', 'plaka', 'tutucu', 'kelepce', 'civata', 'somun',
      'pul', 'vida', 'saplama', 'etiket', 'sandik', 'cam', 'mentese', 'kulp', 'tabanca', 'govde', 'sase', 'iskelet']
  };
  /** Asıl sözcüğü bunlardan biriyse ad türü söylemez ("TANK DOLUM ÜNİTESİ", "SENSÖR KOMPLESİ"): karar alt parçalara kalır */
  const NEUTRAL_HEADS = new Set(['komple', 'unite', 'sistem', 'set', 'takim', 'grup', 'kit', 'kaskat', 'modul']);
  const NEUTRAL_FORMS = new Set([...NEUTRAL_HEADS].flatMap((w) => [w, `${w}i`, `${w}si`, `${w}u`, `${w}su`, `${w}leri`, `${w}lari`]));
  /** Taşıyıcı komple ("ALT GÖVDE KOMPLESİ", "ÜST SEPET KOMPLESİ"): içinde kablo olsa da elektrikli komple sayılmaz */
  const STRUCTURAL = /\b(govde|sase|kabin|iskelet|sepet|araba|platform|cerceve|kasa|hazne|tabla)\s+(komplesi|komple|komp\b|montaj)/;
  const MODIFIER = { yag: 'n', kapak: 'n', vana: 'n', teflon: 'n', aydinlatma: 'e' };
  const STEMS = [...HEAD_WORDS.e.map((s) => [s, 'e', false]), ...HEAD_WORDS.n.map((s) => [s, 'n', false]),
    ...Object.entries(MODIFIER).map(([s, c]) => [s, c, true])].sort((a, b) => b[0].length - a[0].length);
  const POSSESSIVE = new Set(['i', 'u', 'si', 'su', 'leri', 'lari']);
  const ADJECTIVE = new Set(['li', 'lu', 'siz', 'suz']);

  /** Sözcüğün türü ve biçimi: base (yalın), poss (iyelik ekli, asıl sözcük), adj (niteleyici ek) */
  function wordForm(word) {
    for (const [stem, cls, modifier] of STEMS) {
      let tail = null;
      if (word.startsWith(stem)) tail = word.slice(stem.length);
      // Ünsüz yumuşaması: kapak → kapağı, kızak → kızağı
      else if (stem.endsWith('k') && word.startsWith(`${stem.slice(0, -1)}g`)) tail = word.slice(stem.length);
      if (tail === null) continue;
      if (tail === '' || tail === 'ler' || tail === 'lar') return { stem, cls, modifier, form: 'base' };
      if (POSSESSIVE.has(tail)) return { stem, cls, modifier, form: 'poss' };
      if (ADJECTIVE.has(tail)) return { stem, cls, modifier, form: 'adj' };
    }
    return null;
  }

  /** @returns { cls: 'e'|'n', stem, weak } adın asıl sözcüğü; yoksa null */
  function headOf(name) {
    // ERP adlarının makine öneki uzun olabilir ("KBN 2B P DS OTO 1500 KABLO KANAL BAĞLANTI NO.2 SAC"): 12 sözcüğe bakılır
    const words = fold(name).replace(/\bo[\s-]?ring/g, 'oring').replace(/'/g, '').split(/[^a-z0-9]+/).filter(Boolean).slice(0, 12);
    // "… KOMPLESİ", "… ÜNİTESİ": asıl sözcük türü söylemez
    const neutral = words.findIndex((w) => NEUTRAL_FORMS.has(w));
    const scan = neutral >= 0 ? words.slice(0, neutral) : words;
    const found = scan.map(wordForm).filter(Boolean);
    const poss = found.filter((f) => f.form === 'poss');
    if (neutral >= 0 && !poss.length) return null;
    if (poss.length) {
      const h = poss[poss.length - 1];
      return { cls: h.cls, stem: h.stem, weak: false };
    }
    const base = found.filter((f) => f.form === 'base');
    // Eki düşmüş tamlama: son tür sözcüğü elektrik dışı bir parçaysa asıl sözcüktür ("REZİSTANS DELRİN KAPAK",
    // "AYDINLATMA PLEKSİ", ERP'de kesilmiş "… BAĞLANTI SAC"). Son sözcük elektrikliyse ERP'nin tür-başta yazımı geçerlidir.
    const last = base[base.length - 1];
    if (last && last.cls === 'n' && base.length > 1) return { cls: 'n', stem: last.stem, weak: false };
    const strong = base.find((f) => !f.modifier);
    if (strong) return { cls: strong.cls, stem: strong.stem, weak: false };
    return base.length ? { cls: base[0].cls, stem: base[0].stem, weak: true } : null;
  }

  /** Kompleyi elektrikli yapan sözcükler (tam ad ya da ERP adı) */
  const ELECTRIC_HINT = /\bmotor|\bpompa|\bfan|\bblower|\bsensor|\bseviye|\bselenoid|\bsolenoid|\bled\b|\baydinlatma|\bsalter|\belektrik|\brezistans|\bisitici|\bfotosel|\blazer|\binterlock|\bisik bariyer|\bbasinc salter|\bvalfli|\baktuatorlu vana \+ seviye/;
  /** Alt kırılımı bilinmeyen komplede zayıf ipucu: kurutma kompleleri fan / blower / ısıtıcı taşır */
  const WEAK_HINT = /\bkurutma (komplesi|unitesi)/;

  /**
   * @param only 'elektrik' ya da 'diger' verilirse yalnız o sınıfın kuralları; 'keep' yalnız özel adlar
   * @returns { kategori, sinif, keep, at } metindeki en erken tür sözcüğü; aynı yerde listedeki ilk kural
   */
  function typeOf(text, only) {
    const f = fold(text);
    let best = null;
    TYPE_RULES.forEach(([kategori, sinif, re, keep], order) => {
      if (only === 'diger' && sinif !== 'diger') return;
      if (only === 'elektrik' && sinif === 'diger') return;
      if (only === 'keep' && !keep) return;
      const m = re.exec(f);
      if (m && (!best || m.index < best.at || (m.index === best.at && order < best.order))) best = { kategori, sinif, keep: !!keep, at: m.index, order };
    });
    return best;
  }

  /** Parça numarasının başına göre aksesuar kategorisi (GVAE → MKŞ yardımcı kontağı, A9A → sigorta yardımcı kontağı) */
  const PREFIX_CATEGORY = [[/^GVAE/, 'Termik / MKŞ'], [/^A9A/, 'Sigorta'], [/^LA1K|^LADN/, 'Kontaktör']];

  const isAssemblyName = (text) => /\bkomple|\bkomp\b|\bkomp\.|\bunitesi\b|\bsistemi\b|\bkaskat\b|\belektrik kut/.test(fold(text));

  /** Kompleyi temsil eden parça türü: "REZİSTANS KOMPLESİ" rezistans, "REDÜKTÖR VE MOTOR KOMP" redüktör, elektrik kutusu pano */
  const ASSEMBLY_CATEGORIES = new Set(['Redüktör', 'Rezistans', 'Elektrik Panosu']);
  const PANEL = /\belektrik (kutusu|kut\.|panosu)|\bkumanda (panosu|kutusu)/;

  /** Alt parça elektrikli mi: asıl sözcüğü belirleyicidir; yoksa raporun elektrik listesi ve tür kuralları */
  function electricPart(s) {
    const name = longestName(s) || (s.tamAd && s.tamAd.tr) || sarfDescription(s);
    const t = typeOf(name);
    if (t && t.keep) return t.sinif === 'elektrik';
    const noun = headOf(name.split(' — ')[0]);
    if (noun && !noun.weak) return noun.cls === 'e';
    if (s.elektrikListesi.size) return true;
    return !!t && t.sinif === 'elektrik';
  }

  /** Alt kırılımdaki toplam kalem sayısı (makinenin ana grubunu ayırmak için) */
  function descendantCount(e, all, seen) {
    let n = 0;
    for (const k of e.altlar) {
      const key = codeKey(k);
      if (seen.has(key)) continue;
      seen.add(key);
      n += 1;
      const s = all.get(key);
      if (s) n += descendantCount(s, all, seen);
      if (n > 500) break;
    }
    return n;
  }

  /**
   * Elektrikli mi, kategori ne?
   * @param e collect() kaydı; @param all tüm kayıtlar (komplenin alt parçalarına bakmak için)
   * @returns { sinif: 'elektrik'|'reduktor'|'komple'|'diger', kategori, neden }
   */
  function classify(e, all) {
    const erp = longestName(e);
    const full = e.tamAd ? e.tamAd.tr : '';
    const sarfName = sarfDescription(e);
    const names = [erp, full, sarfName].filter(Boolean);
    const primary = erp || sarfName || full;
    const head = fold(primary).split(/\s+/).slice(0, 3).join(' ');
    const noun = headOf(primary.split(' — ')[0]);
    let t = (head && typeOf(head)) || (erp && typeOf(erp)) || (full && typeOf(full)) || (sarfName && typeOf(sarfName)) || null;
    const flat = e.elektrikListesi.size > 0;
    // Özel ad, adın neresinde geçerse geçsin asıl sözcükten önce gelir: "KABLO RAKORU" kablo aksesuarıdır,
    // "DİYAFRAMLI POMPA" pnömatiktir, "POMPA BAĞLANTI ELEMANLARI" mekaniktir
    const special = typeOf(primary.split(' — ')[0], 'keep');
    if (special) {
      return special.sinif === 'diger' ? { sinif: 'diger', kategori: special.kategori, neden: 'Elektrik dışı parça' } : { sinif: special.sinif, kategori: special.kategori, neden: 'Adı elektrik malzemesi' };
    }
    // "Filtre pompası", "kapak sensörü", "zincir motoru": baştaki elektrik dışı sözcük asıl sözcük değildir
    if (noun && noun.cls === 'e' && !noun.weak && t && t.sinif === 'diger') {
      t = typeOf(primary, 'elektrik') || (full && typeOf(full, 'elektrik')) || t;
    }
    // Sarf listesinde " — " sonrası kullanım yeridir ("… — Leister kurutma komplesi"): komple sayılmaz
    const assembly = e.komple || isAssemblyName(primary.split(' — ')[0]);
    const subs = assembly ? e.altlar.map((k) => all.get(codeKey(k))).filter(Boolean) : [];
    const electricSubs = subs.filter(electricPart);
    const headType = head && typeOf(head);
    const panel = PANEL.test(fold(primary));
    const assemblyCategory = () => (panel ? 'Elektrik Panosu'
      : headType && headType.at === 0 && ASSEMBLY_CATEGORIES.has(headType.kategori) ? headType.kategori : 'Komple');
    // Raporun elektrik listesindeki parça, kendi adı elektrikli parçaysa alt kırılımı olsa da parçadır
    // ("SEVİYE SENSÖRÜ VEGASWING" diş açılmış sensör, içinde sensörün kendisi)
    if (flat && noun && noun.cls === 'e' && !noun.weak) {
      return { sinif: 'elektrik', kategori: t && t.sinif !== 'diger' ? t.kategori : 'Elektrik', neden: 'Ürün ağacının elektrikli malzeme listesinde' };
    }
    if (assembly && electricSubs.length) {
      // Taşıyıcı komple (gövde, şasi, sepet) ve makinenin ana grubu, içinde kablo, sensör olsa da elektrikli komple değildir
      if (!panel && (STRUCTURAL.test(fold(primary)) || descendantCount(e, all, new Set()) > 60)) {
        return { sinif: 'diger', kategori: 'Komple', neden: `Taşıyıcı komple ya da ana grup; içindeki ${electricSubs.length} elektrikli parça ayrı satırlarda` };
      }
      // İçinde elektrikli parça olan komple, adı ne olursa olsun ("pompalı filtre komplesi") elektrikli kompledir
      return { sinif: 'komple', kategori: assemblyCategory(), neden: `Komple; içinde ${electricSubs.length} elektrikli parça var (${electricSubs.slice(0, 3).map((s) => s.kod).join(', ')}${electricSubs.length > 3 ? '…' : ''})` };
    }
    // "Pompa emiş filtresi", "aydınlatma pleksi", "redüktör yağı", "switch bağlantı sacı": asıl sözcük elektrik dışıysa
    // elektrikli sözcük kazanmaz, raporun elektrik listesinde olsa da ("FİLTRE 2'' BLOWER 500")
    if (noun && noun.cls === 'n' && !noun.weak) {
      const n = typeOf(head, 'diger') || typeOf(primary, 'diger');
      return { sinif: 'diger', kategori: n ? n.kategori : 'Mekanik', neden: flat ? 'Ürün ağacının elektrik listesinde, ama asıl sözcüğü elektrik dışı bir parça (filtre, conta…)' : assembly ? 'Komple; asıl sözcüğü elektrik dışı, içinde elektrikli parça görünmüyor' : 'Elektrik dışı parça' };
    }
    if (flat && (!assembly || !e.altlar.length)) {
      const kategori = t && t.sinif !== 'diger' ? t.kategori : ((full && typeOf(full, 'elektrik')) || {}).kategori || (t && t.kategori) || 'Elektrik';
      return { sinif: 'elektrik', kategori, neden: 'Ürün ağacının elektrikli malzeme listesinde' };
    }
    if (assembly) {
      const kategori = assemblyCategory();
      // Elektrikli parça bir alt seviyede olabilir ("BLOWER KURUTMA KOMPLESİ" → blower ünitesi → blower): ad ipucu sayılır
      const hint = names.some((n) => ELECTRIC_HINT.test(fold(n)));
      if (hint) return { sinif: 'komple', kategori, neden: e.altKirilimEksik ? 'Komple; alt kırılımı raporda yok, adı elektrikli parça içerdiğini gösteriyor' : 'Komple; adı elektrikli parça içerdiğini gösteriyor' };
      if (names.some((n) => WEAK_HINT.test(fold(n)))) return { sinif: 'komple', kategori, neden: 'Komple; alt kırılımı raporda yok, kurutma kompleleri genelde fan / blower / ısıtıcı içerir' };
      if (t && t.sinif === 'elektrik' && headType && headType.at === 0) return { sinif: 'komple', kategori, neden: 'Komple' };
      return { sinif: 'diger', kategori: (t && t.sinif === 'diger' && t.kategori) || 'Komple', neden: 'Komple; elektrikli parça görünmüyor' };
    }
    if (t && t.sinif === 'elektrik') return { sinif: 'elektrik', kategori: t.kategori, neden: 'Adı elektrikli parça' };
    if (t && t.sinif === 'reduktor') return { sinif: 'reduktor', kategori: t.kategori, neden: 'Redüktör (motorsuz)' };
    if (t) return { sinif: 'diger', kategori: t.kategori, neden: 'Elektrik dışı parça' };
    return { sinif: 'diger', kategori: '', neden: 'Türü anlaşılamadı' };
  }

  /** ERP stok adı: birden çok yazım varsa en uzunu (en çok bilgi); yoksa kritik listedeki parça adı */
  function longestName(e) {
    let best = '';
    for (const n of e.erpAdlar.keys()) if (n.length > best.length) best = n;
    if (best) return best;
    const named = e.kritik.find((k) => k.ad);
    return named ? named.ad : '';
  }

  /* ─── Komponent alanları ──────────────────────────────── */

  /** "LYM 950, LYM 1150, KBN 1B 1650" → "LYM 950, 1150 · KBN 1B 1650" */
  function machineList(names) {
    const groups = new Map();
    for (const n of names) {
      const [series, ...rest] = String(n).split(/\s+/);
      if (!groups.has(series)) groups.set(series, []);
      groups.get(series).push(rest.join(' '));
    }
    return [...groups.entries()].map(([s, list]) => `${s} ${list.sort((a, b) => M.compareText(a, b)).join(', ')}`.trim()).join(' · ');
  }

  const UNIT_NAMES = { adet: 'Adet', ad: 'Adet', pcs: 'Adet', set: 'Set', takim: 'Takım', kg: 'kg', m: 'm', mt: 'm', metre: 'm', l: 'L', lt: 'L', litre: 'L', paket: 'Paket', rulo: 'Rulo' };

  function unitOf(e, units) {
    const raw = fold(e.birim || '').replace(/[^a-z]/g, '');
    const name = UNIT_NAMES[raw] || '';
    if (!name) return 'Adet';
    const match = (units || []).find((u) => fold(u) === fold(name));
    return match || name;
  }

  /**
   * Sarf listesindeki ad "ürün — makinedeki görevi" ya da "görevi — ürün" biçimindedir.
   * Marka ya da parça numarası olan yarı ürünü anlatır; ikisinde de yoksa ad bütün kalır.
   */
  function sarfParts(e) {
    const s = e.sarf.find((x) => x.tekKod);
    if (!s) return { urun: '', gorev: '' };
    const [before, ...rest] = s.ad.split(' — ');
    const after = rest.join(' — ');
    const product = (t) => !!brandOf(t) || tokensOf(t).some((x) => codeLike(x.t));
    if (!after) return { urun: before, gorev: '' };
    if (product(before)) return { urun: before, gorev: after };
    return { urun: s.ad, gorev: '' };
  }

  const sarfDescription = (e) => sarfParts(e).urun;

  /**
   * Kayıttan komponent alanları.
   * @param options.adKaynagi 'erp' (ERP stok adı, tam ad açıklamaya) | 'tam' (ürün tam adı, ERP adı açıklamaya)
   * @param options.kullanim kullanıldığı makineleri açıklamaya yazar
   */
  function fieldsOf(e, cls, options) {
    const o = options || {};
    const erp = longestName(e);
    const full = e.tamAd ? e.tamAd.tr : '';
    const sarfText = sarfDescription(e);
    const description = full || sarfText;
    const useFull = o.adKaynagi === 'tam' && description;
    const ad = useFull ? description : erp || sarfText || full;
    // Kendi imalatı komplelerin (kurutma ünitesi, elektrik kutusu…) parça numarası yoktur; markası yalnız redüktör komplesinde anlamlı
    const assembly = cls.sinif === 'komple' || (cls.sinif === 'diger' && e.komple);
    const brand = assembly && cls.kategori !== 'Redüktör' ? null
      : brandOf(full) || brandOf(sarfText) || brandOf(erp) || (e.sarf[0] && brandOf(e.sarf[0].altKod));
    // Stok kodu olmayan kalemde kod zaten üretici kodudur; açıklamadaki başka parça numarası (takıldığı ünite) alınmaz
    let part = e.kodsuz ? e.kod : assembly ? '' : partNumber(full || sarfText, erp);
    if (!part && !assembly && !e.kodsuz && e.alternatif.size) part = codeFromMakerRef([...e.alternatif][0]);
    let uretici = brand ? brand.name : '';
    if (!uretici && part) {
      const hit = PREFIX_BRANDS.find(([re]) => re.test(alnum(part)));
      if (hit) uretici = hit[1];
    }
    let kategori = cls.kategori;
    if (part) {
      const hit = PREFIX_CATEGORY.find(([re]) => re.test(alnum(part)));
      if (hit && cls.sinif === 'elektrik') kategori = hit[1];
    }
    const lines = [];
    if (useFull) {
      if (erp && erp !== ad) lines.push(`ERP adı: ${erp}`);
    } else if (description && description !== ad) {
      lines.push(description);
    }
    if (o.kullanim !== false) {
      const machines = [...e.makineler];
      const gorev = sarfParts(e).gorev;
      if (machines.length) lines.push(`Kullanım: ${machineList(machines)}`);
      else if (e.sarf.length) lines.push(`Kullanım: ${[...new Set(e.sarf.map((s) => s.makine).filter(Boolean))].join(', ')}${gorev ? ` (${gorev})` : ''}`);
      else if (e.kritik.length) lines.push(`Kullanım: ${[...new Set(e.kritik.map((k) => `${k.grup} (${k.makine})`))].join(' · ')}`);
      if (e.ustler.size) {
        const parents = [...e.ustler];
        lines.push(`Komple: ${parents.slice(0, 4).join(', ')}${parents.length > 4 ? ` ve ${parents.length - 4} komple daha` : ''}`);
      }
    }
    if (e.ilgili.size) lines.push(`İlgili kod: ${[...e.ilgili].join(', ')}`);
    if (e.alternatif.size && ![...e.alternatif].some((a) => part && alnum(a).includes(alnum(part)))) lines.push(`Alternatif: ${[...e.alternatif].join(', ')}`);
    return {
      kod: e.kod,
      ad,
      kategori,
      uretici,
      ureticiKodu: part && alnum(part) !== alnum(e.kod) ? part : (e.kodsuz ? part : ''),
      birim: unitOf(e, o.birimler),
      aciklama: lines.join('\n'),
      aciklamaEn: e.tamAd ? e.tamAd.en : '',
      aciklamaDe: e.tamAd ? e.tamAd.de : ''
    };
  }

  const CLASS_LABELS = { elektrik: 'Elektrikli parça', reduktor: 'Redüktör', komple: 'Elektrikli komple', diger: 'Elektrik dışı' };
  /** Varsayılan olarak aktarılan sınıflar */
  const DEFAULT_CLASSES = ['elektrik', 'reduktor', 'komple'];

  /**
   * Raporlardan aktarılacak satırlar.
   * @returns [{ row, fields, meta: { sinif, neden, kaynaklar, makineler, uyarilar, adlar } }]
   */
  function importItems(reports, options) {
    const all = collect(reports);
    const items = [];
    for (const e of all.values()) {
      const cls = classify(e, all);
      const fields = fieldsOf(e, cls, options);
      if (!fields.kod && !fields.ad) continue;
      items.push({
        row: items.length + 1,
        fields,
        meta: {
          sinif: cls.sinif,
          kategori: cls.kategori,
          neden: cls.neden,
          kaynaklar: [...e.kaynaklar].map((k) => SOURCE_LABEL[k]),
          dosyalar: [...e.dosyalar],
          makineler: [...e.makineler],
          komple: e.komple,
          uyarilar: e.uyarilar.slice(),
          entry: e
        },
        foto: e.foto || '',
        fotoKaynak: e.foto ? e.fotoKaynak : ''
      });
    }
    assignPhotos(items, all);
    items.sort((a, b) => order(a.meta.sinif) - order(b.meta.sinif) || M.compareText(a.fields.kategori, b.fields.kategori) || M.compareText(a.fields.kod, b.fields.kod));
    items.forEach((it, i) => { it.row = i + 1; });
    return items;
  }

  /**
   * Ad biçimi: rakam ve işaretler atılır ("MAKİNA PRİZİ 1*4 KONTAKLI DİŞİ" ile "1*5 …" aynı ailedir).
   * "ERKEK" yazılmayabilir: erkek konnektör adında genelde cinsiyet yazmaz, dişi yazar.
   */
  const familyShape = (name) => fold(name).replace(/[^a-z]+/g, ' ').replace(/\berkek\b/g, ' ').replace(/\s+/g, ' ').trim();

  /**
   * Fotoğrafı olmayan kalem: aynı kategorideki tek üst komplenin fotoğrafı ("VEGASWING" sensörün kendisi, diş açılmış
   * sensör komplesinin fotoğrafını alır) ya da adı yalnız rakamlarla ayrılan aynı aile parçasının fotoğrafı
   * ("MAKİNA PRİZİ 1*4" ↔ "1*5"; ürün ağacı raporu da benzer parçalara aynı fotoğrafı koyar).
   */
  function assignPhotos(items, all) {
    const byKey = new Map(items.map((it) => [codeKey(it.fields.kod || it.meta.entry.kod), it]));
    for (const it of items) {
      if (it.foto) continue;
      let e = it.meta.entry;
      for (let depth = 0; depth < 3 && e && e.ustler.size === 1; depth += 1) {
        const parentKey = codeKey([...e.ustler][0]);
        const parent = byKey.get(parentKey);
        if (!parent || parent.fields.kategori !== it.fields.kategori) break;
        if (parent.foto) {
          it.foto = parent.foto;
          it.fotoKaynak = `${parent.fields.kod} fotoğrafı`;
          break;
        }
        e = all.get(parentKey);
      }
    }
    const family = new Map();
    for (const it of items) {
      if (!it.foto || it.fotoKaynak.endsWith('fotoğrafı')) continue;
      const k = `${it.fields.kategori}|${familyShape(it.fields.ad)}`;
      if (!family.has(k)) family.set(k, it);
    }
    for (const it of items) {
      if (it.foto) continue;
      const same = family.get(`${it.fields.kategori}|${familyShape(it.fields.ad)}`);
      if (same) {
        it.foto = same.foto;
        it.fotoKaynak = `${same.fields.kod} fotoğrafı`;
      }
    }
  }

  const order = (s) => ['elektrik', 'reduktor', 'komple', 'diger'].indexOf(s);

  /** Seçenek değişince (ad kaynağı, kullanım bilgisi) alanlar yeniden kurulur; elle düzeltilen alanlara çağıran dokunmaz */
  function refreshFields(item, options) {
    return fieldsOf(item.meta.entry, { sinif: item.meta.sinif, kategori: item.meta.kategori }, options || {});
  }

  return {
    SOURCE_LABEL,
    CLASS_LABELS,
    DEFAULT_CLASSES,
    STOCK_CODE,
    decodeEntities,
    cellText,
    scriptLiterals,
    htmlTables,
    readHtml,
    readTreeTable,
    isImageData,
    collect,
    classify,
    typeOf,
    brandOf,
    partNumber,
    codeFromMakerRef,
    machineList,
    fieldsOf,
    importItems,
    refreshFields
  };
});
