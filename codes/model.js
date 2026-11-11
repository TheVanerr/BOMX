/* BOMX iş kuralları: komponent kütüphanesi, proje, malzeme listesi kalemleri, adet özetleri, kontroller,
   revizyon farkı, iki cihaz arasında kayıt kayıt birleştirme, CSV ve yapıştırarak ekleme.
   Tarayıcıya bağlı değildir; Node testleri aynı kodu çalıştırır.

   Birleştirme kuralı (kütüphane, proje, şablon, ayarlar): her kayıt "zaman" taşır, silinen kaydın
   kimliği "silinen" altında silinme zamanıyla durur. İki cihazın sürümü birleşirken her kayıtta en yeni
   olan kalır; düzenleme silmeden yeniyse kayıt geri gelir. Böylece aynı dosyada farklı kayıtları
   değiştiren iki cihazın hiçbir değişikliği kaybolmaz. */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.BomxModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SCHEMA = 1;
  const ROOT = 'BOM';
  const PATHS = {
    library: `${ROOT}/kutuphane`,
    photos: `${ROOT}/fotograflar`,
    projects: `${ROOT}/projeler`,
    templates: `${ROOT}/sablonlar`,
    settings: `${ROOT}/ayarlar.json`
  };
  const SHARD_CHARS = '0123456789abcdef';
  const TOMBSTONE_MS = 180 * 24 * 3600 * 1000;

  const STATUSES = [
    { id: 'taslak', label: 'Taslak', en: 'Draft', de: 'Entwurf', tone: 'gray' },
    { id: 'inceleme', label: 'İncelemede', en: 'In review', de: 'In Prüfung', tone: 'amber' },
    { id: 'onay', label: 'Onaylandı', en: 'Approved', de: 'Freigegeben', tone: 'green' },
    { id: 'siparis', label: 'Sipariş Verildi', en: 'Ordered', de: 'Bestellt', tone: 'blue' },
    { id: 'tamam', label: 'Tamamlandı', en: 'Completed', de: 'Abgeschlossen', tone: 'red' }
  ];
  const STATUS_IDS = STATUSES.map((s) => s.id);

  /** P&PX kod listesindeki serilerin kategori adı (PE01 → Pompa) */
  const SERIES_CATEGORIES = {
    PE: 'Pompa', FE: 'Fan', VE: 'Vibrasyon Motoru', GE: 'Redüktör', R: 'Rezistans', INV: 'İnvertör',
    BR: 'Brülör', TD: 'Ultrasonik', L: 'Lamba', T: 'Termik / MKŞ', LS: 'Seviye Sensörü', SS: 'Güvenlik',
    PRS: 'Pozisyon Sensörü', SWB: 'Vana Switch Box', SW: 'Switch', PPS: 'Piston Sensörü', F: 'Sigorta',
    FC: 'Kaçak Akım Rölesi', B: 'Buton', ENC: 'Encoder', TC: 'Sıcaklık Sensörü', PS: 'Basınç Sensörü',
    PHS: 'pH Sensörü', CS: 'İletkenlik Sensörü', V: 'Vana'
  };

  const DEFAULT_SETTINGS = {
    kategoriler: ['Elektrik', 'Otomasyon', 'Pnömatik', 'Hidrolik', 'Mekanik', 'Pompa', 'Vana', 'Sensör', 'Motor',
      'Kablo', 'Bağlantı Elemanı', 'Sarf Malzeme', 'Hizmet'],
    birimler: ['Adet', 'Takım', 'Set', 'm', 'm²', 'm³', 'kg', 'L', 'Paket', 'Rulo', 'Saat'],
    varsayilanBirim: 'Adet',
    kisiler: { hazirlayan: 'Fatih GÜRAL', kontrol: 'Furkan BIÇAK', onay: 'Furkan BIÇAK' },
    varsayilanBolumler: ['Genel'],
    firma: 'DOLFIN'
  };
  const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS);
  const DOC_LANGS = [['tr', 'TR', 'Türkçe'], ['en', 'EN', 'English'], ['de', 'DE', 'Deutsch']];
  const BRAND_IDS = ['DOLFIN', 'VICO', 'ENVA', 'KSYSTEM'];

  const META_KEYS = ['seriNo', 'musteri', 'model', 'baslik', 'durum', 'firma', 'dil',
    'rev', 'tarih', 'hazirlayan', 'kontrol', 'onay', 'notlar', 'cikti'];

  /** Komponent alanları: kütüphane formu, CSV ve sütun eşleştirme aynı listeyi kullanır */
  const COMPONENT_FIELDS = [
    { key: 'kod', label: 'Stok Kodu', required: true },
    { key: 'ad', label: 'Tanım', required: true },
    { key: 'kategori', label: 'Kategori' },
    { key: 'uretici', label: 'Üretici / Marka' },
    { key: 'ureticiKodu', label: 'Model Kodu' },
    { key: 'tedarikci', label: 'Tedarikçi' },
    { key: 'tedarikciKodu', label: 'Tedarikçi Kodu' },
    { key: 'birim', label: 'Birim' },
    { key: 'teslimSuresi', label: 'Teslim Süresi (gün)', number: true },
    { key: 'aciklama', label: 'Açıklama / Teknik Özellik' },
    { key: 'aciklamaEn', label: 'Açıklama (EN)' },
    { key: 'aciklamaDe', label: 'Açıklama (DE)' },
    { key: 'link', label: 'Bağlantı (katalog, ürün sayfası)' },
    { key: 'favori', label: 'Favori', flag: true },
    { key: 'pasif', label: 'Pasif (kullanımdan kalktı)', flag: true }
  ];

  const HEADER_ALIASES = {
    kod: ['kod', 'kodu', 'stok kodu', 'stokkodu', 'stok kod', 'stok no', 'malzeme kodu', 'malzeme no', 'urun kodu', 'parca kodu', 'siparis kodu', 'siparis no',
      'code', 'item code', 'item no', 'stock code', 'order code', 'part no', 'part number', 'sku', 'article', 'artikel', 'artikelnummer', 'bestellnummer'],
    ad: ['ad', 'adi', 'isim', 'malzeme adi', 'malzeme', 'urun adi', 'urun', 'stok adi', 'stok tanimi', 'malzeme tanimi', 'urun tanimi', 'parca adi', 'parca',
      'tanim metni', 'kisa metin', 'malzeme kisa metni', 'stok aciklamasi', 'malzeme aciklamasi',
      'bilesen adi', 'bilesen', 'komponent', 'komponent adi', 'tanim', 'tanimi', 'name', 'item name', 'item', 'stock name', 'part', 'part name', 'bezeichnung', 'benennung', 'teil'],
    kategori: ['kategori', 'grup', 'grubu', 'malzeme grubu', 'sinif', 'sinifi', 'tur', 'turu', 'category', 'group', 'type', 'kategorie', 'gruppe'],
    uretici: ['uretici', 'marka', 'imalatci', 'manufacturer', 'brand', 'make', 'hersteller', 'marke'],
    ureticiKodu: ['model kodu', 'tam model kodu', 'uretici kodu', 'uretici parca no', 'uretici parca kodu', 'parca no', 'parca numarasi', 'model', 'model no', 'tip', 'tipi', 'mpn', 'manufacturer part number', 'manufacturer code', 'mfr part', 'mfr no', 'typ', 'herstellernummer'],
    tedarikci: ['tedarikci', 'satici', 'saglayici', 'tedarik', 'supplier', 'vendor', 'lieferant'],
    tedarikciKodu: ['tedarikci kodu', 'satici kodu', 'tedarikci parca no', 'supplier code', 'vendor code', 'supplier part number', 'lieferantennummer'],
    birim: ['birim', 'olcu birimi', 'unit', 'uom', 'einheit', 'me'],
    teslimSuresi: ['teslim', 'teslim suresi', 'termin', 'termin suresi', 'lead time', 'leadtime', 'lieferzeit'],
    aciklama: ['aciklama', 'urun tam adi', 'tam ad', 'tam adi', 'teknik aciklama', 'not', 'notlar', 'teknik ozellik', 'teknik ozellikler', 'ozellik', 'ozellikler', 'detay',
      'full product name', 'full name', 'notes', 'note', 'description', 'spec', 'specification', 'beschreibung', 'bemerkung', 'vollstandiger produktname'],
    aciklamaEn: ['aciklama en', 'aciklama ingilizce', 'ingilizce aciklama', 'description en', 'english description'],
    aciklamaDe: ['aciklama de', 'aciklama almanca', 'almanca aciklama', 'description de', 'german description', 'beschreibung de'],
    link: ['link', 'url', 'baglanti', 'web', 'datasheet', 'katalog', 'dokuman', 'veri sayfasi'],
    favori: ['favori', 'favorite', 'yildiz'],
    pasif: ['pasif', 'inactive', 'obsolete', 'iptal']
  };

  /** Belge (PDF, Excel, CSV) yazıları; program arayüzü Türkçe kalır */
  const DOC_TEXT = {
    tr: {
      title: 'MALZEME LİSTESİ', subtitle: 'Bill of Materials (BOM)', project: 'Proje No', customer: 'Müşteri', model: 'Model',
      desc: 'Açıklama', rev: 'Rev.', date: 'Tarih', prepared: 'Hazırlayan', checked: 'Kontrol', approved: 'Onay', status: 'Durum',
      photo: 'Fotoğraf', code: 'Stok Kodu', name: 'Tanım', category: 'Kategori', maker: 'Üretici', makerCode: 'Model Kodu',
      supplier: 'Tedarikçi', supplierCode: 'Tedarikçi Kodu', ref: 'Referans', qty: 'Adet', unit: 'Birim', note: 'Not', section: 'Bölüm',
      total: 'Toplam', items: 'kalem', page: 'Sayfa', continued: '(devam)', revisions: 'Revizyonlar', purchase: 'SATIN ALMA LİSTESİ',
      summary: 'ÖZET', noSupplier: 'Tedarikçi belirtilmemiş', firstIssue: 'İlk yayın', byCategory: 'Kategoriye göre',
      generated: 'BOMX ile oluşturuldu', notes: 'Notlar', sections: 'bölüm', count: 'Kalem', scope: 'Kapsam',
      uncategorized: 'Kategorisiz', docType: 'Belge Türü', docTypeValue: 'Malzeme Listesi (BOM)', pages: 'Sayfa Sayısı'
    },
    en: {
      title: 'BILL OF MATERIALS', subtitle: 'BOM', project: 'Project No', customer: 'Customer', model: 'Model',
      desc: 'Description', rev: 'Rev.', date: 'Date', prepared: 'Prepared by', checked: 'Checked by', approved: 'Approved by', status: 'Status',
      photo: 'Photo', code: 'Stock Code', name: 'Definition', category: 'Category', maker: 'Manufacturer', makerCode: 'Model Code',
      supplier: 'Supplier', supplierCode: 'Supplier Code', ref: 'Reference', qty: 'Qty', unit: 'Unit', note: 'Note', section: 'Section',
      total: 'Total', items: 'items', page: 'Page', continued: '(continued)', revisions: 'Revisions', purchase: 'PURCHASE LIST',
      summary: 'SUMMARY', noSupplier: 'No supplier', firstIssue: 'First issue', byCategory: 'By category',
      generated: 'Generated with BOMX', notes: 'Notes', sections: 'sections', count: 'Items', scope: 'Scope',
      uncategorized: 'Uncategorized', docType: 'Document Type', docTypeValue: 'Bill of Materials (BOM)', pages: 'Pages'
    },
    de: {
      title: 'STÜCKLISTE', subtitle: 'Bill of Materials (BOM)', project: 'Projekt-Nr.', customer: 'Kunde', model: 'Modell',
      desc: 'Beschreibung', rev: 'Rev.', date: 'Datum', prepared: 'Erstellt', checked: 'Geprüft', approved: 'Freigegeben', status: 'Status',
      photo: 'Foto', code: 'Lagernummer', name: 'Benennung', category: 'Kategorie', maker: 'Hersteller', makerCode: 'Modellcode',
      supplier: 'Lieferant', supplierCode: 'Lieferanten-Nr.', ref: 'Referenz', qty: 'Menge', unit: 'Einheit', note: 'Bemerkung', section: 'Abschnitt',
      total: 'Summe', items: 'Positionen', page: 'Seite', continued: '(Fortsetzung)', revisions: 'Revisionen', purchase: 'BESTELLLISTE',
      summary: 'ZUSAMMENFASSUNG', noSupplier: 'Kein Lieferant', firstIssue: 'Erstausgabe', byCategory: 'Nach Kategorie',
      generated: 'Erstellt mit BOMX', notes: 'Bemerkungen', sections: 'Abschnitte', count: 'Pos.', scope: 'Umfang',
      uncategorized: 'Ohne Kategorie', docType: 'Dokumentart', docTypeValue: 'Stückliste (BOM)', pages: 'Seiten'
    }
  };
  const UNIT_TEXT = {
    en: { adet: 'pcs', takim: 'set', set: 'set', paket: 'pack', rulo: 'roll', saat: 'h', metre: 'm' },
    de: { adet: 'Stk.', takim: 'Satz', set: 'Satz', paket: 'Pck.', rulo: 'Rolle', saat: 'Std.', metre: 'm' }
  };

  /* ─── Zaman ve kimlik ─────────────────────────────────── */

  let clock = () => Date.now();
  /** Testler için saat */
  function setClock(fn) {
    clock = typeof fn === 'function' ? fn : () => Date.now();
  }
  const nowIso = () => new Date(clock()).toISOString();
  const pad2 = (n) => String(n).padStart(2, '0');

  /** Bugün, yerel saatle (toISOString gece yarısından sonra bir önceki günü verir) */
  function today() {
    const d = new Date(clock());
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function uid() {
    const bytes = new Uint8Array(6);
    globalThis.crypto.getRandomValues(bytes);
    return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /* ─── Metin ───────────────────────────────────────────── */

  const clean = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  const cleanMultiline = (v) => String(v == null ? '' : v).replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim();

  /** Aramada büyük/küçük harf ve Türkçe işaretler fark etmez: "Şalter" = "salter", "IŞIK" = "isik" */
  function fold(text) {
    return String(text == null ? '' : text)
      .toLocaleLowerCase('tr-TR')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/ı/g, 'i');
  }

  /** Aynı kod mu: harf büyüklüğü, Türkçe işaret ve boşluk fark etmez */
  const codeKey = (kod) => fold(kod).replace(/\s+/g, '');

  function compareText(a, b) {
    return String(a || '').localeCompare(String(b || ''), 'tr', { numeric: true, sensitivity: 'base' });
  }

  /** Windows sondaki nokta ve boşluğu kabul etmez; proje adlarında temizlenir (P&PX ile aynı) */
  function sanitizeName(name) {
    return String(name || '')
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[. ]+$/, '')
      .replace(/^\.+/, '');
  }

  /* ─── Sayı ────────────────────────────────────────────── */

  /** "1.234,56", "1234,5", "12.5", "12,50 €", 7 → sayı; Türkçe yazımda virgül ondalıktır */
  function parseNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    let s = String(value).trim().replace(/[\s  ']/g, '');
    // Birim ya da yüzde işareti olabilir; başka harf varsa sayı değildir ("YOK1" kod, sayı değil)
    s = s.replace(/^(TL|TRY|EUR|USD|GBP|CHF)|(TL|TRY|EUR|USD|GBP|CHF)$/i, '').replace(/[₺€$£%]/g, '');
    if (!/^[-+]?\(?[\d.,]+\)?$/.test(s)) return null;
    const negative = /^-|^\(.*\)$/.test(s);
    s = s.replace(/[^\d.,]/g, '');
    if (!/\d/.test(s)) return null;
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    if (lastComma >= 0 && lastDot >= 0) {
      const decimal = lastComma > lastDot ? ',' : '.';
      const group = decimal === ',' ? '.' : ',';
      s = s.split(group).join('').replace(decimal, '.');
    } else if (lastComma >= 0) {
      const parts = s.split(',');
      s = parts.length > 2 ? parts.join('') : parts.join('.');
    } else if (lastDot >= 0) {
      const parts = s.split('.');
      // 1.250 ve 12.500 binliktir; 12.5 ve 0.750 ondalık
      const grouped = parts.length > 2 || (parts.length === 2 && parts[1].length === 3 && parts[0] !== '0' && parts[0] !== '');
      if (grouped) s = parts.join('');
    }
    const n = Number(s);
    if (!Number.isFinite(n)) return null;
    return negative ? -n : n;
  }

  function round(n, digits) {
    const k = 10 ** (digits === undefined ? 2 : digits);
    return Math.round((Number(n) + Number.EPSILON) * k) / k;
  }

  const numberFormats = new Map();
  function numberFormat(min, max) {
    const key = `${min}:${max}`;
    if (!numberFormats.has(key)) {
      numberFormats.set(key, new Intl.NumberFormat('tr-TR', { minimumFractionDigits: min, maximumFractionDigits: max }));
    }
    return numberFormats.get(key);
  }

  const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
  const formatQty = (n) => (isNum(n) ? numberFormat(0, 3).format(n) : '');

  /** CSV için: binlik ayırıcı yok, ondalık virgül (Türkçe Excel doğrudan sayı okur) */
  function csvNumber(n, digits) {
    if (!isNum(n)) return '';
    return String(round(n, digits === undefined ? 4 : digits)).replace('.', ',');
  }

  /* ─── JSON ────────────────────────────────────────────── */

  function encodeJson(obj) {
    return new TextEncoder().encode(`${JSON.stringify(obj, null, 1)}\n`);
  }

  function decodeJson(bytes) {
    const text = typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes);
    return JSON.parse(text.replace(/^﻿/, ''));
  }

  /**
   * Değişiklik zamanı, kaydın görülmüş en yeni zamanından sonra olur. Saati geri olan bilgisayarda
   * yapılan yeni düzenleme, öbür cihazın daha eski düzenlemesine kaybetmez (saat kayması).
   */
  function laterStamp(time, latest) {
    if (!latest || time > latest) return time;
    const t = Date.parse(latest);
    return Number.isFinite(t) ? new Date(t + 1).toISOString() : time;
  }

  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const sameValue = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
  const maxStr = (a, b) => ((a || '') >= (b || '') ? a || '' : b || '');
  const plainObject = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

  function sortedObject(obj) {
    const out = {};
    for (const key of Object.keys(obj).sort()) out[key] = obj[key];
    return out;
  }

  /* ─── Ayarlar ─────────────────────────────────────────── */

  function normalizeSettings(raw) {
    const s = plainObject(raw);
    const D = DEFAULT_SETTINGS;
    const list = (v, d) => (Array.isArray(v) ? [...new Set(v.map(clean).filter(Boolean))] : d.slice());
    const people = Object.assign({}, D.kisiler, plainObject(s.kisiler));
    const sections = list(s.varsayilanBolumler, D.varsayilanBolumler);
    const pick = (v, allowed, d) => (allowed.includes(v) ? v : d);
    return {
      format: 'bomx-ayarlar',
      surum: SCHEMA,
      kategoriler: list(s.kategoriler, D.kategoriler),
      birimler: list(s.birimler, D.birimler),
      varsayilanBirim: clean(s.varsayilanBirim) || D.varsayilanBirim,
      kisiler: { hazirlayan: clean(people.hazirlayan), kontrol: clean(people.kontrol), onay: clean(people.onay) },
      varsayilanBolumler: sections.length ? sections : D.varsayilanBolumler.slice(),
      firma: pick(clean(s.firma).toUpperCase(), BRAND_IDS, 'DOLFIN'),
      zaman: Object.assign({}, plainObject(s.zaman))
    };
  }

  /** Ayarın bir anahtarını değiştirir; birleştirmede anahtar başına en yeni kazanır */
  function setSetting(settings, key, value, at) {
    const next = normalizeSettings(Object.assign({}, settings, { [key]: value }));
    if (!sameValue(settings[key], next[key])) next.zaman[key] = laterStamp(at || nowIso(), plainObject(settings.zaman)[key]);
    return next;
  }

  function mergeSettings(a, b) {
    const x = normalizeSettings(a);
    const y = normalizeSettings(b);
    const out = normalizeSettings({});
    out.zaman = {};
    for (const key of SETTINGS_KEYS) {
      const tx = x.zaman[key] || '';
      const ty = y.zaman[key] || '';
      let src;
      if (tx !== ty) src = tx > ty ? x : y;
      else src = JSON.stringify(x[key]) >= JSON.stringify(y[key]) ? x : y;
      out[key] = clone(src[key]);
      if (tx || ty) out.zaman[key] = maxStr(tx, ty);
    }
    return normalizeSettings(out);
  }

  /* ─── Kayıt kümeleri: en yeni kazanır, silme zamanıyla tutulur ── */

  function recordWins(a, b) {
    const ta = a.zaman || '';
    const tb = b.zaman || '';
    if (ta !== tb) return ta > tb;
    return JSON.stringify(a) >= JSON.stringify(b);
  }

  /** @returns { records: Map id→kayıt, dead: { id: silinme zamanı } } */
  function mergeRecordSets(aList, aDead, bList, bDead) {
    const groups = new Map();
    for (const r of [...(aList || []), ...(bList || [])]) {
      if (!r || !r.id) continue;
      if (!groups.has(r.id)) groups.set(r.id, []);
      groups.get(r.id).push(r);
    }
    const da = plainObject(aDead);
    const db = plainObject(bDead);
    const ids = new Set([...groups.keys(), ...Object.keys(da), ...Object.keys(db)]);
    const records = new Map();
    const dead = {};
    for (const id of ids) {
      let best = null;
      for (const r of groups.get(id) || []) if (!best || recordWins(r, best)) best = r;
      const deathAt = maxStr(da[id], db[id]);
      // Eşit zamanda düzenleme kalır: içerik kaybolmaz
      if (deathAt && (!best || deathAt > (best.zaman || ''))) {
        dead[id] = deathAt;
        continue;
      }
      if (best) records.set(id, best);
    }
    return { records, dead };
  }

  /** Sıra birleştirme: yeni sürümün sırası esas, yalnız öbüründe olanlar oradaki komşusunun arkasına girer */
  function mergeOrder(primaryIds, secondaryIds, alive) {
    const out = primaryIds.filter((id) => alive.has(id));
    const seen = new Set(out);
    secondaryIds.forEach((id, i) => {
      if (!alive.has(id) || seen.has(id)) return;
      let at = 0;
      for (let j = i - 1; j >= 0; j -= 1) {
        const k = out.indexOf(secondaryIds[j]);
        if (k >= 0) {
          at = k + 1;
          break;
        }
      }
      out.splice(at, 0, id);
      seen.add(id);
    });
    for (const id of alive.keys()) if (!seen.has(id)) out.push(id);
    return out;
  }

  function pruneDead(dead, nowMs) {
    const limit = new Date((nowMs || clock()) - TOMBSTONE_MS).toISOString();
    const out = {};
    for (const [id, at] of Object.entries(plainObject(dead))) if (at && at >= limit) out[id] = at;
    return sortedObject(out);
  }

  /* ─── Komponentler ────────────────────────────────────── */

  function normalizeComponent(input) {
    const c = plainObject(input);
    const lead = parseNumber(c.teslimSuresi);
    const flag = (v) => v === true || /^(1|evet|e|x|true|yes|ja|var)$/i.test(clean(v));
    return {
      id: clean(c.id) || uid(),
      kod: clean(c.kod),
      ad: clean(c.ad),
      kategori: clean(c.kategori),
      uretici: clean(c.uretici),
      ureticiKodu: clean(c.ureticiKodu),
      tedarikci: clean(c.tedarikci),
      tedarikciKodu: clean(c.tedarikciKodu),
      birim: clean(c.birim) || 'Adet',
      teslimSuresi: lead === null || lead < 0 ? null : Math.round(lead),
      aciklama: cleanMultiline(c.aciklama),
      aciklamaEn: cleanMultiline(c.aciklamaEn),
      aciklamaDe: cleanMultiline(c.aciklamaDe),
      link: clean(c.link),
      favori: flag(c.favori),
      pasif: flag(c.pasif),
      olusturma: c.olusturma || nowIso(),
      zaman: c.zaman || ''
    };
  }

  /** @returns hata yazıları; boşsa kayıt geçerli */
  function validateComponent(c, library) {
    const errors = [];
    if (!c.kod) errors.push('Stok kodu gerekli');
    if (!c.ad) errors.push('Tanım gerekli');
    if (c.kod && library) {
      const key = codeKey(c.kod);
      const other = [...library].find((x) => x.id !== c.id && codeKey(x.kod) === key);
      if (other) errors.push(`"${other.kod}" kodu kütüphanede zaten var (${other.ad})`);
    }
    if (c.link && !/^https?:\/\//i.test(c.link)) errors.push('Bağlantı http:// ya da https:// ile başlamalı');
    return errors;
  }

  function shardOf(id) {
    const text = String(id || '');
    if (/^[0-9a-f]/i.test(text)) return text.charAt(0).toLowerCase();
    let h = 0x811c9dc5;
    for (const ch of text) {
      h ^= ch.codePointAt(0);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return SHARD_CHARS[h % 16];
  }

  const shardPath = (shard) => `${PATHS.library}/k${shard}.json`;
  const isShardPath = (path) => /^BOM\/kutuphane\/k[0-9a-f]\.json$/.test(path);

  function compareComponents(a, b) {
    return compareText(a.kod, b.kod) || compareText(a.id, b.id);
  }

  function shardDocument(components, dead) {
    return {
      format: 'bomx-kutuphane',
      surum: SCHEMA,
      komponentler: components.map(normalizeComponent).sort(compareComponents),
      silinen: pruneDead(dead)
    };
  }

  function parseShard(bytes) {
    const doc = decodeJson(bytes);
    return {
      komponentler: (Array.isArray(doc.komponentler) ? doc.komponentler : []).map(normalizeComponent),
      silinen: plainObject(doc.silinen)
    };
  }

  function mergeShardBytes(mine, theirs) {
    const a = parseShard(mine);
    const b = parseShard(theirs);
    const { records, dead } = mergeRecordSets(a.komponentler, a.silinen, b.komponentler, b.silinen);
    return encodeJson(shardDocument([...records.values()], dead));
  }

  /* ─── Komponent fotoğrafları ──────────────────────────── */

  // Fotoğraf komponentle aynı kimliği taşır, kütüphaneden ayrı 16 parçada durur (BOM/fotograflar/f<ilk hex>.json):
  // kütüphane dosyaları küçük kalır, iki cihazın fotoğraf değişikliği kayıt kayıt birleşir.
  const PHOTO_MAX_CHARS = 600000;
  const PHOTO_DATA = /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/;
  const photoShardPath = (shard) => `${PATHS.photos}/f${shard}.json`;
  const isPhotoShardPath = (path) => /^BOM\/fotograflar\/f[0-9a-f]\.json$/.test(path);
  const isPhotoData = (v) => typeof v === 'string' && v.length <= PHOTO_MAX_CHARS && PHOTO_DATA.test(v);

  function normalizePhoto(input) {
    const p = plainObject(input);
    return { id: clean(p.id), veri: isPhotoData(p.veri) ? p.veri : '', zaman: p.zaman || '' };
  }

  function photoShardDocument(records, dead) {
    return {
      format: 'bomx-fotograflar',
      surum: SCHEMA,
      fotolar: records.map(normalizePhoto).filter((r) => r.id && r.veri).sort((a, b) => compareText(a.id, b.id)),
      silinen: pruneDead(dead)
    };
  }

  function parsePhotoShard(bytes) {
    const doc = decodeJson(bytes);
    return {
      fotolar: (Array.isArray(doc.fotolar) ? doc.fotolar : []).map(normalizePhoto).filter((r) => r.id && r.veri),
      silinen: plainObject(doc.silinen)
    };
  }

  function mergePhotoShardBytes(mine, theirs) {
    const a = parsePhotoShard(mine);
    const b = parsePhotoShard(theirs);
    const { records, dead } = mergeRecordSets(a.fotolar, a.silinen, b.fotolar, b.silinen);
    return encodeJson(photoShardDocument([...records.values()], dead));
  }

  /* ─── Komponent paketi (fotoğraflı JSON) ──────────────── */

  // Kütüphaneyi fotoğraflarıyla taşımak ya da hazır listeyle başlamak için:
  // { format, fotograflar: { f1: data URL, … }, komponentler: [{ kod, ad, …, foto: 'f1', fotoKaynagi, tur }] }.
  // Aynı fotoğrafı kullanan komponentler (bir ailenin boyları) havuzdaki tek kopyayı gösterir; foto doğrudan data URL de olabilir.
  // Kimlik taşınmaz: içe aktarırken kod eşleşir, yeni kayıt yeni kimlik alır.
  const PACKAGE_FORMAT = 'bomx-komponent-paketi';
  const PACKAGE_FIELDS = COMPONENT_FIELDS.map((f) => f.key);
  const PACKAGE_CLASSES = new Set(['elektrik', 'reduktor', 'komple', 'diger']);

  /**
   * @param list komponentler (isteğe bağlı tur, neden, kaynaklar, uyarilar, fotoKaynagi alanlarıyla)
   * @param photoOf (komponent) => data URL
   * @param info pakete eklenecek bilgi (ad, aciklama, kaynaklar)
   */
  function packageDocument(list, photoOf, info) {
    const pool = {};
    const keyOf = new Map();
    const komponentler = list.map((c) => {
      const n = normalizeComponent(c);
      const out = {};
      for (const k of PACKAGE_FIELDS) {
        if (n[k] === '' || n[k] === null || n[k] === false) continue;
        out[k] = n[k];
      }
      const foto = photoOf ? photoOf(c) : '';
      if (isPhotoData(foto)) {
        if (!keyOf.has(foto)) {
          keyOf.set(foto, `f${keyOf.size + 1}`);
          pool[keyOf.get(foto)] = foto;
        }
        out.foto = keyOf.get(foto);
        if (clean(c.fotoKaynagi)) out.fotoKaynagi = clean(c.fotoKaynagi);
      }
      if (PACKAGE_CLASSES.has(c.tur)) out.tur = c.tur;
      if (clean(c.neden)) out.neden = clean(c.neden);
      if (Array.isArray(c.kaynaklar) && c.kaynaklar.length) out.kaynaklar = c.kaynaklar.map(clean).filter(Boolean);
      if (Array.isArray(c.uyarilar) && c.uyarilar.length) out.uyarilar = c.uyarilar.map(clean).filter(Boolean);
      return out;
    });
    return Object.assign({ format: PACKAGE_FORMAT, surum: SCHEMA, olusturma: nowIso() }, plainObject(info), { fotograflar: pool, komponentler });
  }

  /**
   * Paket ya da komponent dizisi (JSON) → aktarma satırları. Tür bilgisi önizlemede sınıf olarak görünür.
   * @returns [{ row, fields, meta, foto }] ya da komponent listesi yoksa null
   */
  function packageItems(data) {
    const list = Array.isArray(data) ? data : data && Array.isArray(data.komponentler) ? data.komponentler : null;
    if (!list) return null;
    const pool = Array.isArray(data) ? {} : plainObject(data.fotograflar);
    const photo = (v) => {
      const src = typeof v === 'string' && Object.prototype.hasOwnProperty.call(pool, v) ? pool[v] : v;
      return isPhotoData(src) ? src : '';
    };
    return list.filter((c) => c && typeof c === 'object' && !Array.isArray(c)).map((c, i) => {
      const fields = {};
      for (const k of PACKAGE_FIELDS) if (k in c) fields[k] = c[k];
      const meta = PACKAGE_CLASSES.has(c.tur) ? {
        sinif: c.tur,
        neden: clean(c.neden),
        kaynaklar: Array.isArray(c.kaynaklar) ? c.kaynaklar.map(clean).filter(Boolean) : [],
        uyarilar: Array.isArray(c.uyarilar) ? c.uyarilar.map(clean).filter(Boolean) : []
      } : null;
      const foto = photo(c.foto);
      return { row: i + 1, fields, meta, foto, fotoKaynagi: foto ? clean(c.fotoKaynagi) : '' };
    });
  }

  function componentSearchText(c) {
    return fold([c.kod, c.ad, c.kategori, c.uretici, c.ureticiKodu, c.tedarikci, c.tedarikciKodu, c.aciklama].join(' '));
  }

  /**
   * Arama: her sözcük kayıtta geçmeli. Sıralama: kod tam eşleşme, kod başı, ad sözcük başı, diğer.
   * @param list komponentler; index verilirse (buildSearchIndex) metin her seferinde yeniden kurulmaz
   */
  function searchComponents(list, query, index) {
    const tokens = fold(query).split(/[\s,;]+/).filter(Boolean);
    if (!tokens.length) return list.slice();
    const scored = [];
    for (const c of list) {
      const text = index ? index.get(c.id) : componentSearchText(c);
      if (!text) continue;
      let score = 0;
      let ok = true;
      const key = codeKey(c.kod);
      const name = fold(c.ad);
      for (const t of tokens) {
        if (!text.includes(t)) {
          ok = false;
          break;
        }
        if (key === t) score += 6;
        else if (key.startsWith(t)) score += 4;
        else if (name.startsWith(t) || name.includes(` ${t}`)) score += 2;
        else score += 1;
      }
      if (ok) scored.push({ c, score });
    }
    scored.sort((a, b) => b.score - a.score || compareComponents(a.c, b.c));
    return scored.map((s) => s.c);
  }

  function buildSearchIndex(list) {
    return new Map(list.map((c) => [c.id, componentSearchText(c)]));
  }

  /** Kategori adları ve kayıt sayıları, ayarlardaki sırayla */
  function categoryCounts(list, settings) {
    const counts = new Map();
    for (const c of list) {
      const k = c.kategori || '';
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    const order = (settings && settings.kategoriler) || [];
    return [...counts.entries()].sort((a, b) => {
      if (!a[0]) return 1;
      if (!b[0]) return -1;
      const ia = order.indexOf(a[0]);
      const ib = order.indexOf(b[0]);
      if (ia >= 0 || ib >= 0) return (ia < 0 ? 1e6 : ia) - (ib < 0 ? 1e6 : ib);
      return compareText(a[0], b[0]);
    });
  }

  /* ─── Proje ───────────────────────────────────────────── */

  function projectId(seriNo, musteri, model) {
    const parts = [seriNo, musteri, model].map(sanitizeName);
    if (parts.some((p) => !p)) return '';
    return parts.join('-');
  }

  const projectPath = (id) => `${PATHS.projects}/${id}/proje.json`;
  const isProjectPath = (path) => /^BOM\/projeler\/[^/]+\/proje\.json$/.test(path);
  const revisionPath = (id, rev) => `${PATHS.projects}/${id}/revizyon/${rev}.json`;

  function normalizeRev(rev) {
    const text = clean(rev).toUpperCase();
    if (/^\d{1,3}$/.test(text)) return pad2(parseInt(text, 10));
    return text || '00';
  }

  function nextRev(rev) {
    const r = normalizeRev(rev);
    if (/^\d+$/.test(r)) return pad2(parseInt(r, 10) + 1);
    if (/^[A-Y]$/.test(r)) return String.fromCharCode(r.charCodeAt(0) + 1);
    return `${r}1`;
  }

  function revNumber(rev) {
    const r = normalizeRev(rev);
    if (/^\d+$/.test(r)) return parseInt(r, 10);
    if (/^[A-Z]$/.test(r)) return 1000 + r.charCodeAt(0);
    return 5000;
  }

  const validDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');

  function normalizeOutput(raw) {
    const o = plainObject(raw);
    const flag = (v, d) => (typeof v === 'boolean' ? v : d);
    return {
      kapak: flag(o.kapak, true),
      satinAlma: flag(o.satinAlma, false),
      ozet: flag(o.ozet, true),
      revizyonlar: flag(o.revizyonlar, true),
      notlar: flag(o.notlar, true)
    };
  }

  function normalizeSection(s) {
    const x = plainObject(s);
    return { id: clean(x.id) || uid(), ad: clean(x.ad) || 'Bölüm', zaman: x.zaman || '' };
  }

  function normalizeLine(l) {
    const x = plainObject(l);
    const qty = parseNumber(x.miktar);
    return {
      id: clean(x.id) || uid(),
      bolum: clean(x.bolum),
      komponentId: clean(x.komponentId) || null,
      kod: clean(x.kod),
      ad: clean(x.ad),
      kategori: clean(x.kategori),
      uretici: clean(x.uretici),
      ureticiKodu: clean(x.ureticiKodu),
      tedarikci: clean(x.tedarikci),
      birim: clean(x.birim) || 'Adet',
      miktar: qty === null ? 0 : qty,
      aciklama: cleanMultiline(x.aciklama),
      aciklamaEn: cleanMultiline(x.aciklamaEn),
      aciklamaDe: cleanMultiline(x.aciklamaDe),
      referans: clean(x.referans),
      not: cleanMultiline(x.not),
      zaman: x.zaman || ''
    };
  }

  function normalizeRevision(r) {
    const x = plainObject(r);
    return {
      id: clean(x.id) || `rev-${normalizeRev(x.rev)}`,
      rev: normalizeRev(x.rev),
      tarih: validDate(x.tarih),
      hazirlayan: clean(x.hazirlayan),
      aciklama: clean(x.aciklama),
      zaman: x.zaman || ''
    };
  }

  function dedupeById(list) {
    const seen = new Map();
    for (const item of list) {
      const prev = seen.get(item.id);
      if (!prev || recordWins(item, prev)) seen.set(item.id, item);
    }
    const out = [];
    const used = new Set();
    for (const item of list) {
      if (used.has(item.id)) continue;
      used.add(item.id);
      out.push(seen.get(item.id));
    }
    return out;
  }

  function normalizeProject(raw) {
    const p = plainObject(raw);
    const dead = plainObject(p.silinen);
    const out = {
      format: 'bomx-proje',
      surum: SCHEMA,
      id: clean(p.id),
      seriNo: clean(p.seriNo),
      musteri: clean(p.musteri),
      model: clean(p.model),
      baslik: clean(p.baslik),
      durum: STATUS_IDS.includes(p.durum) ? p.durum : 'taslak',
      firma: BRAND_IDS.includes(clean(p.firma).toUpperCase()) ? clean(p.firma).toUpperCase() : 'DOLFIN',
      dil: ['tr', 'en', 'de'].includes(p.dil) ? p.dil : 'tr',
      rev: normalizeRev(p.rev),
      tarih: validDate(p.tarih) || today(),
      hazirlayan: clean(p.hazirlayan),
      kontrol: clean(p.kontrol),
      onay: clean(p.onay),
      notlar: cleanMultiline(p.notlar),
      cikti: normalizeOutput(p.cikti),
      bolumler: dedupeById((Array.isArray(p.bolumler) ? p.bolumler : []).filter(Boolean).map(normalizeSection)),
      kalemler: dedupeById((Array.isArray(p.kalemler) ? p.kalemler : []).filter(Boolean).map(normalizeLine)),
      revizyonlar: [],
      silinen: { bolum: plainObject(dead.bolum), kalem: plainObject(dead.kalem), rev: plainObject(dead.rev) },
      alanZaman: Object.assign({}, plainObject(p.alanZaman)),
      olusturma: p.olusturma || nowIso(),
      guncelleme: p.guncelleme || p.olusturma || nowIso()
    };
    // Aynı revizyon numarası iki kez olamaz: en yeni satır kalır
    const revs = new Map();
    for (const r of (Array.isArray(p.revizyonlar) ? p.revizyonlar : []).filter(Boolean).map(normalizeRevision)) {
      const prev = revs.get(r.rev);
      if (!prev || recordWins(r, prev)) revs.set(r.rev, r);
    }
    out.revizyonlar = [...revs.values()].sort((a, b) => revNumber(a.rev) - revNumber(b.rev));
    if (!out.bolumler.length) out.bolumler.push({ id: 'genel', ad: 'Genel', zaman: '' });
    const sectionIds = new Set(out.bolumler.map((s) => s.id));
    for (const line of out.kalemler) if (!sectionIds.has(line.bolum)) line.bolum = out.bolumler[0].id;
    return out;
  }

  /** Yeni proje: Rev. 00 ilk yayın, tarihi bugün; kişiler ayarlardan */
  function createProject(input, settings) {
    const s = normalizeSettings(settings);
    const x = plainObject(input);
    const seriNo = sanitizeName(x.seriNo);
    const musteri = sanitizeName(x.musteri);
    const model = sanitizeName(x.model);
    const at = nowIso();
    const names = Array.isArray(x.bolumler) && x.bolumler.length ? x.bolumler : s.varsayilanBolumler;
    const project = normalizeProject({
      id: projectId(seriNo, musteri, model),
      seriNo,
      musteri,
      model,
      baslik: x.baslik,
      durum: 'taslak',
      firma: x.firma || s.firma,
      dil: x.dil || 'tr',
      rev: '00',
      tarih: today(),
      hazirlayan: x.hazirlayan !== undefined ? x.hazirlayan : s.kisiler.hazirlayan,
      kontrol: x.kontrol !== undefined ? x.kontrol : s.kisiler.kontrol,
      onay: x.onay !== undefined ? x.onay : s.kisiler.onay,
      bolumler: names.map((ad) => ({ id: uid(), ad, zaman: at })),
      kalemler: [],
      revizyonlar: [{ id: uid(), rev: '00', tarih: today(), hazirlayan: x.hazirlayan !== undefined ? x.hazirlayan : s.kisiler.hazirlayan, aciklama: 'İlk yayın', zaman: at }],
      olusturma: at,
      guncelleme: at
    });
    for (const key of META_KEYS) project.alanZaman[key] = at;
    return project;
  }

  /* ─── Kalemler ────────────────────────────────────────── */

  const SNAPSHOT_FIELDS = ['kod', 'ad', 'kategori', 'uretici', 'ureticiKodu', 'tedarikci', 'birim', 'aciklama', 'aciklamaEn', 'aciklamaDe'];

  // Kütüphane açıklamasındaki iç notlar malzeme listesine girmez: kullanıldığı makineler, kompleler, kaynak ve doğrulama notları
  const INTERNAL_NOTE = /^(Kullanım|Komple|Kaynak \(web\)|Not|İlgili kod|Alternatif):/i;

  /** Komponent açıklamasının listede ve belgede görünen kısmı (teknik özellik) */
  function bomDescription(text) {
    return cleanMultiline(text).split('\n').map((l) => l.trim()).filter((l) => l && !INTERNAL_NOTE.test(l)).join('\n');
  }

  const snapshotValue = (component, key) => (key.startsWith('aciklama') ? bomDescription(component[key]) : component[key]);

  /** PDF yazı tipinde (Selawik) olmayan işaretlerin karşılığı: belgede boşluk kalmasın */
  const docSafe = (text) => String(text == null ? '' : text).replace(/\u2212/g, '-').replace(/\u2264/g, '<=').replace(/\u03a9/g, 'ohm');

  /** İlk revizyonun varsayılan açıklaması belgenin diliyle yazılır; elle yazılan açıklamaya dokunulmaz */
  function revisionNote(rev, T) {
    return rev.rev === '00' && (!rev.aciklama || rev.aciklama === DOC_TEXT.tr.firstIssue) ? T.firstIssue : rev.aciklama;
  }

  const LANG_FIELD = { en: 'aciklamaEn', de: 'aciklamaDe' };
  const LANG_NAME = { en: 'İngilizce', de: 'Almanca' };

  /** Kalemin o dildeki çevirisi: kalemde yoksa (çeviri sonradan girildiyse) kütüphanedeki güncel çeviri */
  function translationOf(line, lang, component) {
    const key = LANG_FIELD[lang];
    if (!key) return '';
    return line[key] || (component ? bomDescription(component[key]) : '');
  }

  /** Kalemin istenen dildeki açıklaması; çevirisi yoksa Türkçesi */
  function lineDescription(line, lang, component) {
    return translationOf(line, lang, component) || line.aciklama || '';
  }

  /** Türkçe açıklaması olan kalemin o dilde çevirisi var mı (Türkçede her zaman evet) */
  const hasTranslation = (line, lang, component) => !LANG_FIELD[lang] || !line.aciklama || !!translationOf(line, lang, component);

  function lineFromComponent(component, qty, sectionId) {
    const c = normalizeComponent(component);
    const line = normalizeLine({ id: uid(), bolum: sectionId, komponentId: c.id, miktar: qty === undefined ? 1 : qty });
    for (const key of SNAPSHOT_FIELDS) line[key] = snapshotValue(c, key);
    return line;
  }

  function freeLine(sectionId, fields) {
    return normalizeLine(Object.assign({ birim: 'Adet', miktar: 1 }, plainObject(fields), { id: uid(), bolum: sectionId, komponentId: null }));
  }

  /** Kalemin kütüphanedeki hâlden farklı alanları (tanım, model kodu...) */
  function libraryDiff(line, component) {
    if (!component) return [];
    // Kalemde boş çeviri fark sayılmaz: belgede kütüphanedeki çeviri yazar
    return SNAPSHOT_FIELDS.filter((key) => !((key === 'aciklamaEn' || key === 'aciklamaDe') && !clean(line[key])) && clean(line[key]) !== clean(snapshotValue(component, key)));
  }

  function refreshFromLibrary(line, component, fields) {
    const next = Object.assign({}, line);
    for (const key of fields || SNAPSHOT_FIELDS) next[key] = snapshotValue(component, key);
    next.komponentId = component.id;
    return next;
  }

  const isPieceUnit = (unit) => ['adet', 'ad', 'pcs', 'pc', 'stk'].includes(fold(unit).replace(/\.$/, ''));

  /** Adet sütunundaki yazı: "adet" dışındaki birim (m, kg, takım…) miktarın yanında yazar */
  function qtyText(line, lang) {
    const n = formatQty(line.miktar);
    return isPieceUnit(line.birim) ? n : `${n} ${unitText(line.birim, lang)}`;
  }

  /** Kalem listesinin özeti: kalem sayısı ve "adet" birimindeki toplam */
  function summarize(lines) {
    let pieces = 0;
    for (const line of lines) if (isPieceUnit(line.birim)) pieces += Number(line.miktar) || 0;
    return { count: lines.length, pieces };
  }

  function projectTotals(project) {
    return summarize(project.kalemler);
  }

  function sectionLines(project, sectionId) {
    return project.kalemler.filter((l) => l.bolum === sectionId);
  }

  /** Bölüm sırasıyla kalemler ve numaraları: tek bölümde 1, 2, 3; çok bölümde 1.1, 1.2, 2.1 */
  function numberedLines(project) {
    const multi = project.bolumler.length > 1;
    const out = [];
    project.bolumler.forEach((section, si) => {
      let n = 0;
      for (const line of project.kalemler) {
        if (line.bolum !== section.id) continue;
        n += 1;
        out.push({ line, section, no: multi ? `${si + 1}.${n}` : String(n), sectionIndex: si });
      }
    });
    return out;
  }

  function lineNumbers(project) {
    return new Map(numberedLines(project).map((n) => [n.line.id, n.no]));
  }

  function categoryBreakdown(project) {
    const groups = new Map();
    for (const line of project.kalemler) {
      const key = line.kategori || '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(line);
    }
    const rows = [...groups.entries()].map(([kategori, lines]) => Object.assign({ kategori }, summarize(lines)));
    rows.sort((a, b) => b.count - a.count || compareText(a.kategori, b.kategori));
    return rows;
  }

  /** Satın alma listesinde bir komponentin kalemleri tek satırda toplanır; tedarikçiye göre gruplanır */
  function bomKey(line) {
    return line.komponentId ? `k:${line.komponentId}` : `c:${codeKey(line.kod)}|${fold(line.ad)}`;
  }

  function splitRefs(text) {
    return String(text || '').split(/[\s,;]+/).map((r) => r.trim()).filter(Boolean);
  }

  function purchaseList(project) {
    const numbers = lineNumbers(project);
    const sectionName = new Map(project.bolumler.map((s) => [s.id, s.ad]));
    const items = new Map();
    for (const line of project.kalemler) {
      const key = `${bomKey(line)}|${line.birim}|${line.tedarikci}`;
      if (!items.has(key)) {
        items.set(key, Object.assign({}, line, { miktar: 0, refs: [], bolumler: [], numaralar: [] }));
      }
      const item = items.get(key);
      item.miktar += Number(line.miktar) || 0;
      for (const r of splitRefs(line.referans)) if (!item.refs.includes(r)) item.refs.push(r);
      const sname = sectionName.get(line.bolum);
      if (sname && !item.bolumler.includes(sname)) item.bolumler.push(sname);
      item.numaralar.push(numbers.get(line.id));
    }
    const groups = new Map();
    for (const item of items.values()) {
      item.referans = item.refs.join(', ');
      const supplier = item.tedarikci || '';
      if (!groups.has(supplier)) groups.set(supplier, []);
      groups.get(supplier).push(item);
    }
    return [...groups.entries()]
      .map(([tedarikci, list]) => ({
        tedarikci,
        items: list.sort((a, b) => compareText(a.kod, b.kod))
      }))
      .sort((a, b) => (!a.tedarikci ? 1 : !b.tedarikci ? -1 : compareText(a.tedarikci, b.tedarikci)));
  }

  function referenceIndex(project) {
    const map = new Map();
    for (const line of project.kalemler) {
      for (const ref of splitRefs(line.referans)) {
        const key = ref.toUpperCase();
        if (!map.has(key)) map.set(key, { ref, lines: [] });
        map.get(key).lines.push(line);
      }
    }
    return [...map.values()].sort((a, b) => compareText(a.ref, b.ref));
  }

  /* ─── Kontrol ─────────────────────────────────────────── */

  const FIELD_LABELS = {
    kod: 'stok kodu', ad: 'tanım', kategori: 'kategori', uretici: 'üretici', ureticiKodu: 'model kodu', tedarikci: 'tedarikçi',
    birim: 'birim', aciklama: 'açıklama', aciklamaEn: 'açıklama (EN)', aciklamaDe: 'açıklama (DE)'
  };

  function listCodes(lines, max) {
    const codes = lines.map((l) => l.kod || l.ad || '?');
    const n = max || 6;
    return codes.length > n ? `${codes.slice(0, n).join(', ')} ve ${codes.length - n} kalem daha` : codes.join(', ');
  }

  /**
   * Malzeme listesindeki eksik ve tutarsızlıklar. Her satır: level (error/warn/info), text, lines (kalem kimlikleri),
   * fix (varsa tek tıkla düzeltme: refresh, relink, merge, removeZero).
   * @param library Map komponentId → komponent
   */
  function checkProject(project, library) {
    const out = [];
    const lib = library || new Map();
    const byKey = new Map();
    for (const c of lib.values()) byKey.set(codeKey(c.kod), c);
    const push = (level, text, lines, fix) => out.push({ level, text, lines: (lines || []).map((l) => l.id), fix: fix || null });

    for (const [key, label] of [['seriNo', 'Seri no'], ['musteri', 'Müşteri'], ['model', 'Model']]) {
      if (!project[key]) push('error', `Proje bilgisi eksik: ${label}`);
    }
    if (!project.kalemler.length) {
      push('info', 'Malzeme listesi boş. Soldaki kütüphaneden komponent ekleyin.');
      return out;
    }

    const zero = project.kalemler.filter((l) => !(Number(l.miktar) > 0));
    if (zero.length) push('error', `Adedi girilmemiş kalem: ${listCodes(zero)}`, zero, { kind: 'removeZero' });

    const deleted = [];
    const relink = [];
    const free = [];
    const passive = [];
    const changed = new Map();
    for (const line of project.kalemler) {
      const comp = line.komponentId ? lib.get(line.komponentId) : null;
      if (!comp) {
        const same = line.kod ? byKey.get(codeKey(line.kod)) : null;
        if (same) relink.push(line);
        else if (line.komponentId) deleted.push(line);
        else free.push(line);
        continue;
      }
      if (comp.pasif) passive.push(line);
      for (const field of libraryDiff(line, comp)) {
        if (!changed.has(field)) changed.set(field, []);
        changed.get(field).push(line);
      }
    }
    if (deleted.length) push('warn', `Kütüphanede silinmiş komponent: ${listCodes(deleted)}. Kalem bilgileri listede durur.`, deleted);
    if (relink.length) push('info', `Kütüphanede aynı kodlu kayıt var, bağlanabilir: ${listCodes(relink)}`, relink, { kind: 'relink' });
    if (free.length) push('info', `Kütüphanede olmayan (serbest) kalem: ${listCodes(free)}`, free);
    if (LANG_FIELD[project.dil]) {
      const untranslated = project.kalemler.filter((l) => !hasTranslation(l, project.dil, l.komponentId ? lib.get(l.komponentId) : null));
      if (untranslated.length) push('warn', `${LANG_NAME[project.dil]} açıklaması olmayan ${untranslated.length} kalem (belgede Türkçesi yazar): ${listCodes(untranslated)}. Kütüphanede “Açıklama (${project.dil.toUpperCase()})” alanını doldurun.`, untranslated);
    }
    if (passive.length) push('warn', `Pasif (kullanımdan kalkmış) komponent: ${listCodes(passive)}`, passive);
    const allChanged = new Set();
    for (const [field, lines] of changed) {
      lines.forEach((l) => allChanged.add(l));
      push('warn', `Kütüphaneden farklı ${FIELD_LABELS[field] || field}: ${listCodes(lines)}`, lines, { kind: 'refresh', fields: [field] });
    }
    if (allChanged.size > 1 && changed.size > 1) {
      push('info', `${allChanged.size} kalem kütüphaneden farklı. Hepsini kütüphanedeki hâle getirebilirsiniz.`, [...allChanged], { kind: 'refresh' });
    }

    // Aynı bölümde aynı komponent iki satırda: birleştirilebilir
    const seen = new Map();
    for (const line of project.kalemler) {
      const key = `${line.bolum}|${bomKey(line)}|${line.birim}`;
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key).push(line);
    }
    for (const lines of seen.values()) {
      if (lines.length < 2) continue;
      push('warn', `Aynı bölümde tekrar eden kalem: ${lines[0].kod || lines[0].ad} (${lines.length} satır)`, lines, { kind: 'merge' });
    }

    for (const entry of referenceIndex(project)) {
      if (entry.lines.length > 1) push('warn', `${entry.ref} referansı ${entry.lines.length} kalemde geçiyor`, entry.lines);
    }
    const refMismatch = project.kalemler.filter((l) => {
      const refs = splitRefs(l.referans);
      return refs.length > 1 && isPieceUnit(l.birim) && refs.length !== Number(l.miktar);
    });
    if (refMismatch.length) push('info', `Referans sayısı adetle uyuşmuyor: ${listCodes(refMismatch)}`, refMismatch);

    for (const section of project.bolumler) {
      if (project.bolumler.length > 1 && !project.kalemler.some((l) => l.bolum === section.id)) push('info', `"${section.ad}" bölümü boş`);
    }
    const current = project.revizyonlar.find((r) => r.rev === project.rev);
    if (project.rev !== '00' && (!current || !current.aciklama)) push('warn', `Rev. ${project.rev} açıklaması yazılmamış (Revizyonlar bölümü)`);
    return out;
  }

  /* ─── Revizyon farkı ──────────────────────────────────── */

  function aggregate(lines) {
    const map = new Map();
    for (const line of lines) {
      const key = bomKey(line);
      if (!map.has(key)) map.set(key, { key, kod: line.kod, ad: line.ad, birim: line.birim, miktar: 0 });
      map.get(key).miktar += Number(line.miktar) || 0;
    }
    return map;
  }

  /** Komponent bazında fark: eklenen, çıkarılan, adedi değişen */
  function diffBoms(oldLines, newLines) {
    const before = aggregate(oldLines || []);
    const after = aggregate(newLines || []);
    const added = [];
    const removed = [];
    const changed = [];
    let same = 0;
    for (const [key, b] of after) {
      const a = before.get(key);
      if (!a) {
        added.push(b);
        continue;
      }
      if (round(a.miktar, 6) !== round(b.miktar, 6)) changed.push({ key, kod: b.kod, ad: b.ad, birim: b.birim, eski: a, yeni: b });
      else same += 1;
    }
    for (const [key, a] of before) if (!after.has(key)) removed.push(a);
    const sort = (list) => list.sort((x, y) => compareText(x.kod, y.kod));
    return { added: sort(added), removed: sort(removed), changed: sort(changed), same };
  }

  /* ─── Değişiklik damgası ve proje birleştirme ─────────── */

  const withoutTime = (r) => {
    const copy = Object.assign({}, r);
    delete copy.zaman;
    return JSON.stringify(copy);
  };

  /**
   * Önceki hâle göre değişen kayıtlara zaman, silinenlere silinme zamanı yazar. Düzenleyicinin her
   * değişikliği (geri alma dahil) bundan geçer; birleştirme bu zamanlara bakar.
   * @returns değişiklik var mı
   */
  /** Belgede görülmüş en yeni zaman: kayıtlar, alanlar, silinenler ve son güncelleme */
  function latestStampOf(p) {
    let latest = p.guncelleme || '';
    const see = (t) => {
      if (t && t > latest) latest = t;
    };
    for (const list of [p.bolumler, p.kalemler, p.revizyonlar]) for (const r of list) see(r.zaman);
    for (const t of Object.values(p.alanZaman)) see(t);
    for (const group of Object.values(p.silinen)) for (const t of Object.values(plainObject(group))) see(t);
    return latest;
  }

  function stampChanges(prev, next, at) {
    const p = prev ? normalizeProject(prev) : normalizeProject({});
    const time = prev ? laterStamp(at || nowIso(), latestStampOf(p)) : at || nowIso();
    let changed = false;
    next.silinen = next.silinen || { bolum: {}, kalem: {}, rev: {} };
    const collections = [['bolumler', 'bolum'], ['kalemler', 'kalem'], ['revizyonlar', 'rev']];
    for (const [listKey, deadKey] of collections) {
      const before = new Map((prev ? p[listKey] : []).map((r) => [r.id, r]));
      const nextDead = Object.assign({}, plainObject(next.silinen[deadKey]));
      // Önceki hâlde silinmiş olanlar unutulmaz (geri almada da)
      for (const [id, at2] of Object.entries(plainObject(p.silinen[deadKey]))) nextDead[id] = maxStr(nextDead[id], at2);
      const alive = new Set();
      for (const r of next[listKey]) {
        alive.add(r.id);
        const old = before.get(r.id);
        if (!old || withoutTime(old) !== withoutTime(r)) {
          r.zaman = time;
          changed = true;
        }
        delete nextDead[r.id];
      }
      for (const id of before.keys()) {
        if (!alive.has(id)) {
          nextDead[id] = time;
          changed = true;
        }
      }
      next.silinen[deadKey] = nextDead;
    }
    next.alanZaman = Object.assign({}, plainObject(p.alanZaman), plainObject(next.alanZaman));
    for (const key of META_KEYS) {
      if (prev && !sameValue(p[key], next[key])) {
        next.alanZaman[key] = time;
        changed = true;
      }
    }
    const order = (list) => list.map((r) => r.id).join(',');
    if (prev && (order(p.bolumler) !== order(next.bolumler) || order(p.kalemler) !== order(next.kalemler))) changed = true;
    if (changed || !prev) next.guncelleme = time;
    return changed;
  }

  function mergeProjects(a0, b0) {
    const a = normalizeProject(a0);
    const b = normalizeProject(b0);
    const ga = a.guncelleme || '';
    const gb = b.guncelleme || '';
    const aFirst = ga !== gb ? ga > gb : JSON.stringify(a) >= JSON.stringify(b);
    const primary = aFirst ? a : b;
    const secondary = aFirst ? b : a;
    const out = clone(primary);
    out.alanZaman = {};
    for (const key of META_KEYS) {
      const ta = a.alanZaman[key] || '';
      const tb = b.alanZaman[key] || '';
      let src;
      if (ta !== tb) src = ta > tb ? a : b;
      else src = JSON.stringify(a[key]) >= JSON.stringify(b[key]) ? a : b;
      out[key] = clone(src[key]);
      if (ta || tb) out.alanZaman[key] = maxStr(ta, tb);
    }
    const secs = mergeRecordSets(a.bolumler, a.silinen.bolum, b.bolumler, b.silinen.bolum);
    const lines = mergeRecordSets(a.kalemler, a.silinen.kalem, b.kalemler, b.silinen.kalem);
    const revs = mergeRecordSets(a.revizyonlar, a.silinen.rev, b.revizyonlar, b.silinen.rev);
    // Silinen bölüme öbür cihazda kalem eklenmişse bölüm geri gelir: kalem sahipsiz kalmaz
    for (const line of lines.records.values()) {
      if (secs.records.has(line.bolum) || !secs.dead[line.bolum]) continue;
      const candidates = [...a.bolumler, ...b.bolumler].filter((s) => s.id === line.bolum);
      const rec = candidates.sort((x, y) => (recordWins(x, y) ? -1 : 1))[0];
      if (rec) {
        secs.records.set(rec.id, rec);
        delete secs.dead[rec.id];
      }
    }
    const order = (key, map) => mergeOrder(primary[key].map((r) => r.id), secondary[key].map((r) => r.id), map).map((id) => map.get(id));
    out.bolumler = order('bolumler', secs.records);
    out.kalemler = order('kalemler', lines.records);
    out.revizyonlar = [...revs.records.values()];
    out.silinen = { bolum: pruneDead(secs.dead), kalem: pruneDead(lines.dead), rev: pruneDead(revs.dead) };
    out.guncelleme = maxStr(ga, gb);
    out.olusturma = a.olusturma <= b.olusturma ? a.olusturma : b.olusturma;
    return normalizeProject(out);
  }

  function projectDocument(project) {
    const p = normalizeProject(project);
    p.silinen = { bolum: pruneDead(p.silinen.bolum), kalem: pruneDead(p.silinen.kalem), rev: pruneDead(p.silinen.rev) };
    return p;
  }

  function mergeProjectBytes(mine, theirs) {
    return encodeJson(projectDocument(mergeProjects(decodeJson(mine), decodeJson(theirs))));
  }

  /* ─── Şablonlar (hazır setler) ────────────────────────── */

  const templatePath = (id) => `${PATHS.templates}/${id}.json`;
  const isTemplatePath = (path) => /^BOM\/sablonlar\/[^/]+\.json$/.test(path);

  function normalizeTemplate(raw) {
    const t = plainObject(raw);
    return {
      format: 'bomx-sablon',
      surum: SCHEMA,
      id: clean(t.id) || uid(),
      ad: clean(t.ad) || 'Adsız şablon',
      aciklama: cleanMultiline(t.aciklama),
      kalemler: dedupeById((Array.isArray(t.kalemler) ? t.kalemler : []).filter(Boolean).map((l) => {
        const line = normalizeLine(l);
        delete line.bolum;
        delete line.zaman;
        return line;
      })),
      olusturma: t.olusturma || nowIso(),
      guncelleme: t.guncelleme || t.olusturma || nowIso()
    };
  }

  function templateFromLines(name, lines, description) {
    const at = nowIso();
    return normalizeTemplate({
      id: uid(),
      ad: name,
      aciklama: description,
      kalemler: lines.map((l) => Object.assign({}, l, { id: uid() })),
      olusturma: at,
      guncelleme: at
    });
  }

  /** Şablondaki kalemler kütüphanedeki güncel bilgiyle gelir; kütüphanede yoksa şablondaki hâliyle */
  function linesFromTemplate(template, library, sectionId) {
    const lib = library || new Map();
    return normalizeTemplate(template).kalemler.map((t) => {
      const comp = t.komponentId ? lib.get(t.komponentId) : null;
      const line = comp ? lineFromComponent(comp, t.miktar, sectionId) : freeLine(sectionId, t);
      line.referans = t.referans;
      line.not = t.not;
      if (!comp) line.komponentId = t.komponentId || null;
      return line;
    });
  }

  function mergeTemplateBytes(mine, theirs) {
    const a = normalizeTemplate(decodeJson(mine));
    const b = normalizeTemplate(decodeJson(theirs));
    const winner = a.guncelleme !== b.guncelleme ? (a.guncelleme > b.guncelleme ? a : b) : (JSON.stringify(a) >= JSON.stringify(b) ? a : b);
    return encodeJson(winner);
  }

  function mergeSettingsBytes(mine, theirs) {
    return encodeJson(mergeSettings(decodeJson(mine), decodeJson(theirs)));
  }

  /** Veritabanının birleştirme kancası: BOMX'in bildiği dosyalar kayıt kayıt birleşir */
  function mergeFile(path, mine, theirs) {
    if (isShardPath(path)) return mergeShardBytes(mine, theirs);
    if (isPhotoShardPath(path)) return mergePhotoShardBytes(mine, theirs);
    if (isProjectPath(path)) return mergeProjectBytes(mine, theirs);
    if (isTemplatePath(path)) return mergeTemplateBytes(mine, theirs);
    if (path === PATHS.settings) return mergeSettingsBytes(mine, theirs);
    return null;
  }

  /* ─── CSV ─────────────────────────────────────────────── */

  function detectDelimiter(text) {
    const first = String(text || '').replace(/^﻿/, '').split(/\r?\n/).find((l) => l.trim()) || '';
    const count = (ch) => first.split(ch).length - 1;
    const tab = count('\t');
    const semi = count(';');
    const comma = count(',');
    if (tab && tab >= semi && tab >= comma) return '\t';
    if (semi >= comma && semi > 0) return ';';
    return comma > 0 ? ',' : ';';
  }

  /**
   * Tırnaklı hücre, hücre içinde satır sonu ve "" kaçışı desteklenir.
   * Excel'in "sep=;" ilk satırı ayırıcıyı belirler ve tablodan atılır.
   */
  function parseCsv(text, delimiter) {
    let src = String(text || '').replace(/^﻿/, '');
    const sep = src.match(/^sep=(.)\r?\n/i);
    if (sep) src = src.slice(sep[0].length);
    const d = delimiter || (sep ? sep[1] : detectDelimiter(src));
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    let wasQuoted = false;
    for (let i = 0; i < src.length; i += 1) {
      const ch = src[i];
      if (quoted) {
        if (ch === '"') {
          if (src[i + 1] === '"') {
            cell += '"';
            i += 1;
          } else {
            quoted = false;
          }
        } else {
          cell += ch;
        }
        continue;
      }
      if (ch === '"' && !cell.trim() && !wasQuoted) {
        quoted = true;
        wasQuoted = true;
        cell = '';
        continue;
      }
      if (ch === d) {
        row.push(wasQuoted ? cell : cell.trim());
        cell = '';
        wasQuoted = false;
        continue;
      }
      if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && src[i + 1] === '\n') i += 1;
        row.push(wasQuoted ? cell : cell.trim());
        rows.push(row);
        row = [];
        cell = '';
        wasQuoted = false;
        continue;
      }
      cell += ch;
    }
    if (cell !== '' || row.length || wasQuoted) {
      row.push(wasQuoted ? cell : cell.trim());
      rows.push(row);
    }
    return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
  }

  function csvCell(value, delimiter) {
    const s = value === null || value === undefined ? '' : String(value);
    if (s.includes(delimiter) || /["\r\n]/.test(s) || s !== s.trim()) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function toCsv(rows, delimiter) {
    const d = delimiter || ';';
    return `﻿${rows.map((r) => r.map((c) => csvCell(c, d)).join(d)).join('\r\n')}\r\n`;
  }

  const headerKey = (h) => fold(h).replace(/[^a-z0-9]+/g, ' ').trim();

  /** Başlık satırından sütun → alan eşleşmesi; "açıklama" ad sütunu yoksa ad sayılır (P&PX KODListesi.csv) */
  function guessColumns(headers) {
    const map = headers.map(() => '');
    const used = new Set();
    headers.forEach((h, i) => {
      const key = headerKey(h);
      for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
        if (used.has(field)) continue;
        if (aliases.includes(key)) {
          map[i] = field;
          used.add(field);
          break;
        }
      }
    });
    if (!used.has('ad')) {
      const i = map.indexOf('aciklama');
      if (i >= 0) map[i] = 'ad';
    }
    // SAP: "Malzeme" malzeme numarasıdır, adı "Malzeme kısa metni"; kod sütunu yoksa ve başka ad sütunu varsa "Malzeme" kod olur
    if (!map.includes('kod')) {
      const i = headers.findIndex((h, j) => map[j] === 'ad' && headerKey(h) === 'malzeme');
      const other = headers.findIndex((h, j) => j !== i && !map[j] && HEADER_ALIASES.ad.includes(headerKey(h)));
      if (i >= 0 && other >= 0) {
        map[i] = 'kod';
        map[other] = 'ad';
      }
    }
    return map;
  }

  function looksLikeHeader(cells) {
    return guessColumns(cells).filter(Boolean).length >= 1 && cells.some((c) => HEADER_ALIASES.kod.includes(headerKey(c)) || HEADER_ALIASES.ad.includes(headerKey(c)) || headerKey(c) === 'aciklama');
  }

  /**
   * Tablo (CSV ya da Excel satırları) → komponent taslakları.
   * @param columns her sütunun alanı ('' = alınmaz); verilmezse başlıktan tahmin edilir
   * @returns { headers, columns, hasHeader, items: [{ row, fields }] }
   */
  function tableToComponents(rows, columns, hasHeaderOverride) {
    const table = (rows || []).map((r) => r.map((c) => (c === null || c === undefined ? '' : c)));
    if (!table.length) return { headers: [], columns: [], hasHeader: false, items: [] };
    const hasHeader = hasHeaderOverride === undefined ? looksLikeHeader(table[0].map(String)) : !!hasHeaderOverride;
    const width = hasHeader ? table[0].length : Math.max(...table.map((r) => r.length));
    const headers = hasHeader ? table[0].map(String) : Array.from({ length: width }, (_, i) => `Sütun ${i + 1}`);
    let cols = columns && columns.length ? columns.slice() : hasHeader ? guessColumns(headers) : ['kod', 'ad'];
    while (cols.length < width) cols.push('');
    const body = hasHeader ? table.slice(1) : table;
    const items = body.map((row, i) => {
      // Başlıktan fazla hücre: son sütundaki metinde tırnaksız ayırıcı vardır (P&PX KODListesi.csv), birleştirilir
      let cells = row;
      if (hasHeader && headers.length > 0 && cells.length > headers.length) {
        cells = cells.slice(0, headers.length - 1).concat([cells.slice(headers.length - 1).join('; ')]);
      }
      // Boş hücre de alana girer ('' olarak): "değiştir" kipinde kütüphanedeki değeri temizler, diğer kiplerde yok sayılır
      const fields = {};
      cells.forEach((value, j) => {
        const field = cols[j];
        if (!field) return;
        const v = typeof value === 'number' ? value : String(value).trim();
        if (fields[field] !== undefined && fields[field] !== '') return;
        fields[field] = v;
      });
      for (let j = 0; j < cols.length; j += 1) if (cols[j] && fields[cols[j]] === undefined) fields[cols[j]] = '';
      return { row: i + (hasHeader ? 2 : 1), fields };
    }).filter((it) => Object.values(it.fields).some((v) => v !== ''));
    return { headers, columns: cols.slice(0, width), hasHeader, items };
  }

  /**
   * Aktarma planı. mode: 'merge' (yeniler eklenir, var olanların dolu alanları güncellenir),
   * 'add' (yalnız yeni kodlar), 'replace' (var olanların eşleşen alanları dosyadakiyle değişir, boşlar da),
   * 'ceviri' (yalnız var olan kodların dolu EN / DE açıklaması yazılır; yeni kod eklenmez, başka alana dokunulmaz:
   * ayıklanmış kod geri gelmez, kütüphanede düzeltilen alan dosyadakiyle ezilmez)
   */
  function planImport(items, library, mode) {
    const byKey = new Map();
    for (const c of library) byKey.set(codeKey(c.kod), c);
    // rows: her satırın sonucu (önizlemede satır satır gösterilir); add / update: uygulanacaklar
    const plan = { add: [], update: [], same: 0, absent: 0, invalid: [], repeated: 0, rows: [] };
    const seenInFile = new Map();
    const invalid = (row, reason, kod) => {
      plan.invalid.push({ row, reason: kod ? `${kod}: ${reason}` : reason });
      plan.rows.push({ row, status: 'invalid', reason });
    };
    // Aynı kodun ikinci satırı tekrar sayılır; hatalı satır kodu sahiplenmez (sonraki doğru satır alınır)
    const claim = (key, row) => {
      if (seenInFile.has(key)) {
        plan.repeated += 1;
        plan.rows.push({ row, status: 'repeat', reason: `Aynı kod ${seenInFile.get(key)}. satırda var; ilk satır alınır` });
        return false;
      }
      seenInFile.set(key, row);
      return true;
    };
    const blank = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
    for (const { row, fields } of items) {
      const kod = clean(fields.kod);
      if (!kod) {
        invalid(row, 'Kod yok');
        continue;
      }
      const key = codeKey(kod);
      const existing = byKey.get(key);
      if (!existing && mode === 'ceviri') {
        if (!claim(key, row)) continue;
        plan.absent += 1;
        plan.rows.push({ row, status: 'absent', reason: 'Kod kütüphanede yok; bu kipte eklenmez' });
        continue;
      }
      if (!existing) {
        if (!clean(fields.ad)) {
          invalid(row, 'Ad yok', kod);
          continue;
        }
        const component = normalizeComponent(Object.assign({}, fields, { id: uid() }));
        const problems = validateComponent(component, null);
        if (problems.length) {
          invalid(row, problems[0], kod);
          continue;
        }
        if (!claim(key, row)) continue;
        plan.add.push(component);
        plan.rows.push({ row, status: 'new', component });
        continue;
      }
      if (mode === 'add') {
        if (!claim(key, row)) continue;
        plan.same += 1;
        plan.rows.push({ row, status: 'same', existing, reason: 'Kütüphanede var; dokunulmaz' });
        continue;
      }
      const next = Object.assign({}, existing);
      const changes = [];
      for (const f of COMPONENT_FIELDS) {
        if (f.key === 'kod' || !(f.key in fields)) continue;
        if (mode === 'ceviri' && f.key !== 'aciklamaEn' && f.key !== 'aciklamaDe') continue;
        // "Güncelle" ve "çeviri" kipinde boş hücre atlanır: boş birim "Adet", boş favori "hayır" olmaz
        if ((mode === 'merge' || mode === 'ceviri') && blank(fields[f.key])) continue;
        const incoming = normalizeComponent(Object.assign({}, existing, { [f.key]: fields[f.key] }))[f.key];
        if (!sameValue(existing[f.key], incoming)) {
          next[f.key] = incoming;
          changes.push(f.key);
        }
      }
      const problems = changes.length ? validateComponent(next, null) : [];
      if (problems.length) {
        invalid(row, problems[0], kod);
        continue;
      }
      if (!claim(key, row)) continue;
      if (changes.length) {
        const update = { before: existing, after: next, changes };
        plan.update.push(update);
        plan.rows.push(Object.assign({ row, status: 'update' }, update));
      } else {
        plan.same += 1;
        plan.rows.push({ row, status: 'same', existing, reason: 'Kütüphanedekiyle aynı' });
      }
    }
    return plan;
  }

  const LIBRARY_CSV_HEADERS = ['Stok Kodu', 'Tanım', 'Kategori', 'Üretici', 'Model Kodu', 'Tedarikçi', 'Tedarikçi Kodu', 'Birim', 'Teslim Süresi', 'Açıklama', 'Açıklama (EN)', 'Açıklama (DE)', 'Bağlantı', 'Favori', 'Pasif'];

  function libraryToRows(list) {
    const rows = [LIBRARY_CSV_HEADERS];
    for (const c of list.slice().sort(compareComponents)) {
      rows.push([c.kod, c.ad, c.kategori, c.uretici, c.ureticiKodu, c.tedarikci, c.tedarikciKodu, c.birim,
        c.teslimSuresi === null ? '' : c.teslimSuresi, c.aciklama, c.aciklamaEn, c.aciklamaDe, c.link,
        c.favori ? 'evet' : '', c.pasif ? 'evet' : '']);
    }
    return rows;
  }

  /* ─── Yapıştırarak ekleme ─────────────────────────────── */

  /**
   * Excel'den kopyalanan ya da elle yazılan satırlar: "PE01  2", "2 x PE01", "PE01;3;Not".
   * Kütüphanede eşleşen hücre kod sayılır; kalan ilk pozitif sayı miktardır.
   * @returns [{ text, kod, miktar, component, ad }]
   */
  function parsePasted(text, library) {
    const byKey = new Map();
    for (const c of library) byKey.set(codeKey(c.kod), c);
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);
    const out = [];
    for (const raw of lines) {
      let cells;
      if (raw.includes('\t')) cells = raw.split('\t');
      else if (raw.includes(';')) cells = raw.split(';');
      else if (byKey.has(codeKey(raw))) cells = [raw]; // "M8X20" kütüphanedeki koddur, "M8 × 20" değil
      else {
        // "2 x V31", "2x V31", "PE01 x 4": çarpı işaretinin bir yanında boşluk olmalı; bitişik yazım kod sayılır
        const m = raw.match(/^(\d+(?:[.,]\d+)?)\s*[x×*]\s+(.+)$/i) || raw.match(/^(\d+(?:[.,]\d+)?)\s+[x×*]\s*(.+)$/i) ||
          raw.match(/^(.+?)\s+[x×*]\s*(\d+(?:[.,]\d+)?)$/i) || raw.match(/^(.+?)\s*[x×*]\s+(\d+(?:[.,]\d+)?)$/i);
        if (m) cells = /^\d/.test(m[1]) && !byKey.has(codeKey(m[1])) ? [m[2], m[1]] : [m[1], m[2]];
        else {
          const parts = raw.split(/\s+/);
          const last = parts[parts.length - 1];
          cells = parts.length > 1 && parseNumber(last) !== null && !byKey.has(codeKey(raw)) ? [parts.slice(0, -1).join(' '), last] : [raw];
        }
      }
      cells = cells.map((c) => c.trim());
      if (cells.length && headerKey(cells[0]) && HEADER_ALIASES.kod.includes(headerKey(cells[0]))) continue; // başlık satırı
      let codeIndex = cells.findIndex((c) => c && byKey.has(codeKey(c)));
      const component = codeIndex >= 0 ? byKey.get(codeKey(cells[codeIndex])) : null;
      if (codeIndex < 0) codeIndex = cells.findIndex((c) => c && parseNumber(c) === null);
      if (codeIndex < 0) codeIndex = 0;
      let qty = null;
      cells.forEach((c, i) => {
        if (qty !== null || i === codeIndex) return;
        const n = parseNumber(c);
        if (n !== null && n > 0 && /^[\d\s.,]+$/.test(c)) qty = n;
      });
      const others = cells.filter((c, i) => i !== codeIndex && parseNumber(c) === null && c);
      out.push({
        text: raw,
        kod: component ? component.kod : clean(cells[codeIndex]),
        miktar: qty === null ? 1 : qty,
        component,
        ad: component ? component.ad : clean(others.sort((a, b) => b.length - a.length)[0] || '')
      });
    }
    return out;
  }

  /* ─── P&PX kod listesi ────────────────────────────────── */

  function seriesOf(kod) {
    const m = String(kod || '').toUpperCase().match(/^[A-Z]+/);
    return m ? m[0] : '';
  }

  /** P&PX kodları (kodlar.json) → komponent taslakları; kod.csv'deki uzun açıklama da gelir */
  function componentsFromPpx(codes, catalog) {
    const details = new Map((catalog || []).map((r) => [codeKey(r.kod), r]));
    const seen = new Set();
    const out = [];
    for (const item of codes || []) {
      const kod = clean(item.kod).toUpperCase();
      if (!kod || seen.has(codeKey(kod))) continue;
      seen.add(codeKey(kod));
      const extra = details.get(codeKey(kod));
      out.push({
        row: out.length + 1,
        fields: {
          kod,
          ad: clean(item.aciklama) || (extra && extra.ad) || kod,
          kategori: SERIES_CATEGORIES[seriesOf(kod)] || seriesOf(kod),
          aciklama: extra ? extra.aciklama : ''
        }
      });
    }
    return out;
  }

  /* ─── Proje satırları (CSV ve belge) ──────────────────── */

  /** Malzeme listesinin sütunları; ekranda, PDF'te ve Excel'de aynı */
  const COLUMNS = [
    { key: 'foto', label: 'Fotoğraf', doc: 'photo' },
    { key: 'kod', label: 'Stok Kodu', doc: 'code' },
    { key: 'ad', label: 'Tanım', doc: 'name' },
    { key: 'ureticiKodu', label: 'Model Kodu', doc: 'makerCode' },
    { key: 'miktar', label: 'Adet', doc: 'qty' },
    { key: 'aciklama', label: 'Açıklama', doc: 'desc' }
  ];

  function docText(lang) {
    return DOC_TEXT[lang] || DOC_TEXT.tr;
  }

  function unitText(unit, lang) {
    if (!lang || lang === 'tr') return unit;
    const map = UNIT_TEXT[lang] || {};
    return map[fold(unit)] || unit;
  }

  function statusLabel(id, lang) {
    const s = STATUSES.find((x) => x.id === id) || STATUSES[0];
    return lang === 'en' ? s.en : lang === 'de' ? s.de : s.label;
  }

  /** @param library Map komponentId → komponent (çevirisi kalemde olmayan açıklama için) */
  function projectToCsvRows(project, lang, library) {
    const T = docText(lang);
    const rows = [[T.section, T.code, T.name, T.makerCode, T.qty, T.desc]];
    for (const { line, section } of numberedLines(project)) {
      const qty = isPieceUnit(line.birim) ? csvNumber(line.miktar, 3) : `${csvNumber(line.miktar, 3)} ${unitText(line.birim, lang)}`;
      rows.push([section.ad, line.kod, line.ad, line.ureticiKodu, qty, lineDescription(line, lang, library && line.komponentId ? library.get(line.komponentId) : null).replace(/\n+/g, ' ')]);
    }
    return rows;
  }

  function purchaseToCsvRows(project, lang) {
    const T = docText(lang);
    const rows = [[T.supplier, T.code, T.name, T.maker, T.makerCode, T.qty, T.unit, T.ref]];
    for (const group of purchaseList(project)) {
      for (const item of group.items) {
        rows.push([group.tedarikci || T.noSupplier, item.kod, item.ad, item.uretici, item.ureticiKodu, csvNumber(item.miktar, 3),
          unitText(item.birim, lang), item.referans]);
      }
    }
    return rows;
  }

  return {
    SCHEMA,
    PATHS,
    STATUSES,
    SERIES_CATEGORIES,
    DEFAULT_SETTINGS,
    META_KEYS,
    COMPONENT_FIELDS,
    HEADER_ALIASES,
    DOC_TEXT,
    COLUMNS,
    BRAND_IDS,
    DOC_LANGS,
    SNAPSHOT_FIELDS,
    setClock,
    nowIso,
    today,
    uid,
    clean,
    cleanMultiline,
    fold,
    codeKey,
    compareText,
    sanitizeName,
    parseNumber,
    round,
    isNum,
    formatQty,
    csvNumber,
    encodeJson,
    decodeJson,
    laterStamp,
    clone,
    sameValue,
    normalizeSettings,
    setSetting,
    mergeSettings,
    mergeRecordSets,
    mergeOrder,
    pruneDead,
    normalizeComponent,
    validateComponent,
    shardOf,
    shardPath,
    isShardPath,
    shardDocument,
    parseShard,
    mergeShardBytes,
    photoShardPath,
    isPhotoShardPath,
    isPhotoData,
    normalizePhoto,
    photoShardDocument,
    parsePhotoShard,
    mergePhotoShardBytes,
    PACKAGE_FORMAT,
    packageDocument,
    packageItems,
    searchComponents,
    buildSearchIndex,
    componentSearchText,
    categoryCounts,
    compareComponents,
    projectId,
    projectPath,
    isProjectPath,
    revisionPath,
    normalizeRev,
    nextRev,
    revNumber,
    normalizeProject,
    normalizeLine,
    normalizeSection,
    normalizeOutput,
    createProject,
    lineFromComponent,
    freeLine,
    bomDescription,
    lineDescription,
    translationOf,
    hasTranslation,
    docSafe,
    revisionNote,
    qtyText,
    libraryDiff,
    refreshFromLibrary,
    isPieceUnit,
    summarize,
    projectTotals,
    sectionLines,
    numberedLines,
    lineNumbers,
    categoryBreakdown,
    bomKey,
    splitRefs,
    purchaseList,
    referenceIndex,
    checkProject,
    diffBoms,
    stampChanges,
    mergeProjects,
    projectDocument,
    mergeProjectBytes,
    templatePath,
    isTemplatePath,
    normalizeTemplate,
    templateFromLines,
    linesFromTemplate,
    mergeTemplateBytes,
    mergeSettingsBytes,
    mergeFile,
    detectDelimiter,
    parseCsv,
    toCsv,
    guessColumns,
    tableToComponents,
    planImport,
    libraryToRows,
    parsePasted,
    seriesOf,
    componentsFromPpx,
    docText,
    unitText,
    statusLabel,
    projectToCsvRows,
    purchaseToCsvRows
  };
});
