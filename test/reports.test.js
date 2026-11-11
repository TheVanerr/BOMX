/* HTML raporlarından komponent çıkarma: rapor tanıma (ürün ağacı, kritik parça, sarf listesi, düz tablo),
   kodlara göre birleştirme, elektrik sınıflandırması, üretici ve parça numarası. Örnek dosyalar gerçek
   raporların biçimini taklit eder; sayfa kodu çalıştırılmaz. */

const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../codes/model.js');
const R = require('../codes/reports.js');

const page = (script) => `<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8"><title>Rapor</title>
<style>.x { color: red; }</style></head><body><table id="bom"></table><script>
${script}
function render() { const a = { b: 1 }; return a; }
</script></body></html>`;

const TREE = {
  groups: {
    LYM: [
      { m: 'LYM 950', x: 12, items: [
        { c: '07 00309', n: 'REZİSTANS KOMPLESİ 8250W M TİPİ', q: '1', u: '', p: 'photos/07 00309.jpg' },
        { c: '10 01331', n: 'KONTAKTÖR LC1K0910M7 220V', q: '2', u: 'adet', p: '' },
        { c: '10 12433', n: 'AMORTİSÖR 175N', q: '2', u: '', p: '' },
        { c: '07 08285', n: 'REDÜKTÖR VE MOTOR KOMP YILMAZ LYM 950-1150', q: '1', u: '', p: '' },
        { c: '07 00800', n: 'EMİŞ FİLTRESİ KOMPLESİ (PYM 1)', q: '1', u: '', p: '' }
      ] },
      { m: 'LYM 1150', x: 3, items: [
        { c: '10 01331', n: 'KONTAKTÖR LC1K0910M7 220V', q: '1', u: '', p: '' },
        { c: '10 00694 10', n: 'POMPA GOULDS ESHE 32-160/22 380V/50HZ', q: '1', u: '', p: '' }
      ] }
    ],
    KBN: [
      { m: 'KBN 2B 1650', x: 0, items: [
        { c: '10 03672 99', n: "KBN 2B 1650 OMRON PLC'Lİ ELEKTRİK KUTUSU KOMPLESİ", q: '1', u: '', p: '' },
        { c: '07 08394', n: 'KBN 1B 1850 KURUTMA KOMPLESİ', q: '1', u: '', p: '' }
      ] }
    ]
  },
  flat: {
    LYM: { items: [
      { c: '10 01038', n: "REZİSTANS 220V 8250W 2'' M:162CM BKMLÜ DİKİŞSİZ AISI3", p: '', s: ['REZİSTANS KOMPLESİ 8250W M TİPİ'] },
      { c: '10 01331', n: 'KONTAKTÖR LC1K0910M7 220V', p: '', s: [] },
      { c: '10 00694 10', n: 'POMPA GOULDS ESHE 32-160/22 380V/50HZ', p: '', s: [] },
      { c: '10 00590', n: 'REDÜKTÖR MOTORU 0,37KW 1500D/D', p: '', s: ['REDÜKTÖR VE MOTOR KOMP YILMAZ LYM 950-1150'] },
      { c: '10 02854', n: "FİLTRE 2'' BLOWER 500", p: '', s: [] }
    ], unk: [] },
    KBN: { items: [
      { c: '10 04736', n: 'PLC MODÜL SIMATIC-S7 1200 SIEMENS 6ES7214-1AG40-0X', p: '', s: ["KBN 2B 1650 OMRON PLC'Lİ ELEKTRİK KUTUSU KOMPLESİ"] },
      { c: '10 03164', n: 'LV429338 NSX 100-250', p: '', s: [] },
      { c: '10 00307', n: 'DÜZ FİŞ BEMİS 5*32A ENVERSÖR (BEM45-084)', p: '', s: [] }
    ], unk: [{ c: '07 08394', n: 'KBN 1B 1850 KURUTMA KOMPLESİ', p: '', s: [] }] }
  },
  subs: {
    '07 00309': [{ c: '10 01038', n: "REZİSTANS 220V 8250W 2'' M:162CM BKMLÜ DİKİŞSİZ AISI3", p: '' }],
    '07 08285': [{ c: '10 00590', n: 'REDÜKTÖR MOTORU 0,37KW 1500D/D', p: '' }, { c: '10 01002', n: 'REDÜKTÖR EN:30 I:80 B:05', p: '' }],
    '10 03672 99': [{ c: '10 04736', n: 'PLC MODÜL SIMATIC-S7 1200 SIEMENS 6ES7214-1AG40-0X', p: '' }, { c: '10 03164', n: 'LV429338 NSX 100-250', p: '' }],
    '07 00800': [{ c: '10 05378', n: 'TORBA FİLTRE 200 MİKRON ( 50CM PASL. TEL ÇERÇEVE)', p: '' }]
  },
  full: {
    '10 01331': { tr: 'Schneider TeSys K LC1K0910M7 kontaktör, 9 A, bobin 220 V AC', en: 'Schneider contactor', de: 'Schütz' },
    '10 01038': { tr: 'Daldırma tipi rezistans elemanı, 220 V, 8250 W, 2" bağlantı, M tipi, 162 cm, dikişsiz paslanmaz boru', en: '', de: '' },
    '10 00694 10': { tr: 'Goulds (Xylem) e-SH ESHE 32-160/22 paslanmaz santrifüj pompa, 2,2 kW, 380 V 50 Hz', en: '', de: '' },
    '10 04736': { tr: 'Siemens SIMATIC S7-1200 CPU 1214C DC/DC/DC (6ES7214-1AG40-0XB0)', en: '', de: '' },
    '10 03164': { tr: 'Schneider Compact NSX100-250 için LV429338 uzatılmış kapı tipi döner kol', en: '', de: '' },
    '10 00307': { tr: 'Bemis 32 A 5P (3P+N+E) IP44 CEE enversör düz fiş', en: '', de: '' },
    '10 01002': { tr: 'Yılmaz Redüktör EN 30 sonsuz vidalı (sonsuz dişli) redüktör, motorsuz, i=80, B05 motor girişli (IEC flanş)', en: '', de: '' },
    '10 02854': { tr: 'Blower emiş filtresi, 2" bağlantı (500 tipi)', en: '', de: '' }
  },
  missing: []
};

const TREE_HTML = page(`const DATA = ${JSON.stringify(TREE)};
    const IMGS = {"photos/07 00309.jpg": "data:image/jpeg;base64,/9j/AAAA"};
    const UI = { tr: { title:'Ürün Ağaçları', csv:'BOM\\'u indir' } };`);

const CRITICAL_HTML = page(`const COLS = ["Sipariş kodu", "Parça adı"];
    const DATA = {"LYM": [
      {"Sipariş kodu": "10 00236", "Parça adı": "TERMOSTAT DİJİTAL LT 102J GEMO", "Varyant / makine": "Pano", "Önem (A/B/C)": "A", "Aşınma (1/2/3)": "3", "Ulaşılabilirlik (K/O/Z)": "K", "Önerilen stok (adet)": "0", "Birim": "adet", "Not": "Limit termostat"},
      {"Sipariş kodu": "10 01331", "Parça adı": "KONTAKTÖR LC1K0910M7 220V", "Varyant / makine": "Pano", "Önem (A/B/C)": "B", "Aşınma (1/2/3)": "1", "Ulaşılabilirlik (K/O/Z)": "K", "Önerilen stok (adet)": "2", "Birim": "adet", "Not": ""}
    ]};`);

const SPARES = {
  ui: { title: { tr: 'Depo listesi' } },
  data: {
    makine: { model: 'KBN 2B OTO P DS 1650', seri_no: '1326050', musteri: { tr: 'KSY' } },
    gruplar: [{ id: 'pano', ad: { tr: 'Pano & elektrik' } }, { id: 'tahrik', ad: { tr: 'Pompa & tahrik' } }],
    kalemler: [
      { id: 'S21', grup: 'emniyet', kod: '10 04128', n: 1, birim: 'adet', ad: { tr: 'Sensör kablosu Omron XS2F-LM12PVC4S2M (M12 dişi, 4 pin, 2 m) — sepet durdurma sensörü' } },
      { id: 'S20', grup: 'emniyet', kod: '—', alt_kod: 'Trafag ECT 8472', n: 2, birim: 'adet', ad: { tr: 'Basınç transmitteri Trafag ECT 8472 — yıkama / durulama pompa hattı (CP1W-ADB21)' } },
      { id: 'S17', grup: 'pano', kod: '10 04736 · 10 01331', n: 1, birim: 'adet', ad: { tr: 'PLC ve kontaktör (birleşik kalem)' } },
      { id: 'S18', grup: 'pano', kod: '—', alt_kod: '10 16319 (Delta, sepet)', n: 3, birim: 'adet', ad: { tr: 'İnvertörler — Omron 3G3M1-A4075, Delta VFD004EL21W-1' } },
      { id: 'B3', grup: 'isitma', kod: '—', n: 1, birim: 'adet', ad: { tr: 'Kurutma ısıtıcısı 11 kW, özel imalat — Leister kurutma komplesi (07 18481)' } },
      { id: 'B2', grup: 'isitma', kod: '07 00604', n: 4, birim: 'adet', ad: { tr: 'Rezistans klingrit contası 2" — rezistansla birlikte' } },
      { id: 'S1', grup: 'tahrik', kod: '10 00694 15', n: 2, birim: 'adet', ad: { tr: 'Yıkama / durulama pompası — GOULDS (Xylem) e-SH ESHE 32-250/75, 7,5 kW, 380 V 50 Hz' } },
      { id: 'S3', grup: 'isitma', kod: '07 16791', alt_kod: '10 05820 (SG51.XXSGHTPK)', n: 4, birim: 'set', ad: { tr: 'Seviye şalteri VEGASWING 51' } }
    ]
  },
  built: '2026-11-01'
};

const SPARES_HTML = page(`const P = ${JSON.stringify(SPARES)};`);

const reports = () => [
  R.readHtml(TREE_HTML, 'urun-agaci.html'),
  R.readHtml(CRITICAL_HTML, 'kritik.html'),
  R.readHtml(SPARES_HTML, 'sarf.html')
];

const byCode = (items) => new Map(items.map((it) => [it.fields.kod, it]));

test('betikteki JSON değişmezleri çalıştırılmadan okunur; JSON olmayan ve fotoğraf verisi atlanır', () => {
  const lit = R.scriptLiterals(TREE_HTML, (n) => n === 'IMGS');
  assert.ok(lit.DATA && lit.DATA.groups, 'DATA okunur');
  assert.equal(lit.IMGS, undefined, 'fotoğraf verisi atlanır');
  assert.equal(lit.UI, undefined, 'tırnaksız anahtarlı nesne JSON değildir, atlanır');
  const tricky = R.scriptLiterals('const A = {"t": "parantez } ve ] dizgide", "u": "kaçış \\" tırnak"}; const B = [1, 2];');
  assert.equal(tricky.A.t, 'parantez } ve ] dizgide');
  assert.equal(tricky.A.u, 'kaçış " tırnak');
  assert.deepEqual(tricky.B, [1, 2]);
});

test('üç rapor biçimi tanınır ve özetlenir', () => {
  const [tree, critical, spares] = reports();
  assert.equal(tree.kind, 'agac');
  assert.equal(tree.data.machines.length, 3);
  assert.match(tree.summary, /3 makine/);
  assert.equal(critical.kind, 'kritik');
  assert.equal(critical.data.rows.length, 2);
  assert.equal(spares.kind, 'sarf');
  assert.equal(spares.data.makine, 'KBN 2B OTO P DS 1650 SN 1326050');
  assert.equal(R.readHtml('<html><body><p>boş</p></body></html>', 'x.html').kind, null);
});

test('rapor olmayan HTML dosyasındaki tablo satırlara çevrilir (ERP\'nin .xls diye verdiği HTML de)', () => {
  const html = `<html><head><meta charset="utf-8"></head><body><table border=1>
    <tr><th>Stok Kodu</th><th>Stok Adı</th><th colspan="2">Fiyat</th></tr>
    <tr><td>10 00001</td><td>A &amp; B <b>kalın</b></td><td>12,50</td><td>EUR</td></tr>
    <tr><td>10 00002</td><td>&quot;Tırnak&quot;&nbsp;ve&#39;&#x41;</td><td></td><td></td></tr>
    </table><table><tr><td>tek</td></tr></table></body></html>`;
  const rep = R.readHtml(html, 'erp.xls');
  assert.equal(rep.kind, 'tablo');
  assert.deepEqual(rep.tables[0], [['Stok Kodu', 'Stok Adı', 'Fiyat', ''], ['10 00001', 'A & B kalın', '12,50', 'EUR'], ['10 00002', '"Tırnak" ve\'A', '', '']]);
  const t = M.tableToComponents(rep.tables[0]);
  assert.deepEqual(t.columns.slice(0, 3), ['kod', 'ad', '']);
});

test('kodlar dosyalar ve makineler arasında birleşir; makine üyeliği alt kırılıma yayılır', () => {
  const all = R.collect(reports());
  const kontaktor = all.get(M.codeKey('10 01331'));
  assert.deepEqual([...kontaktor.makineler].sort(), ['LYM 1150', 'LYM 950']);
  assert.deepEqual([...kontaktor.kaynaklar].sort(), ['agac', 'kritik', 'sarf']);
  const element = all.get(M.codeKey('10 01038'));
  assert.deepEqual([...element.makineler], ['LYM 950'], 'kompledeki alt parça kompleyi kullanan makinede sayılır');
  assert.deepEqual([...element.ustler], ['07 00309']);
  assert.equal(all.get(M.codeKey('07 08394')).altKirilimEksik, true);
});

test('elektrikli parçalar, redüktör ve elektrikli kompleler ayrılır; elektrik dışı kalanlar seçilmez', () => {
  const items = byCode(R.importItems(reports(), {}));
  const cls = (kod) => items.get(kod).meta.sinif;
  assert.equal(cls('10 01331'), 'elektrik');
  assert.equal(cls('10 01038'), 'elektrik');
  assert.equal(cls('10 00694 10'), 'elektrik');
  assert.equal(cls('10 00590'), 'elektrik', 'redüktör motoru');
  assert.equal(cls('10 01002'), 'reduktor', 'motorsuz redüktör de alınır');
  assert.equal(cls('07 00309'), 'komple', 'rezistans komplesi');
  assert.equal(cls('07 08285'), 'komple', 'redüktör ve motor komplesi');
  assert.equal(cls('10 03672 99'), 'komple');
  assert.equal(cls('07 08394'), 'komple', 'alt kırılımı olmayan kurutma komplesi');
  assert.equal(cls('10 12433'), 'diger', 'amortisör');
  assert.equal(cls('07 00800'), 'diger', 'filtre komplesi');
  assert.equal(cls('10 02854'), 'diger', 'raporun elektrik listesinde olsa da "FİLTRE … BLOWER" filtredir');
  assert.equal(cls('07 00604'), 'diger', 'rezistans contası');
  assert.equal(cls('10 00236'), 'elektrik', 'yalnız kritik listede geçen termostat');
  assert.deepEqual(R.DEFAULT_CLASSES, ['elektrik', 'reduktor', 'komple']);
});

test('kategori, üretici ve üretici parça numarası çıkarılır', () => {
  const items = byCode(R.importItems(reports(), {}));
  const f = (kod) => items.get(kod).fields;
  assert.deepEqual([f('10 01331').kategori, f('10 01331').uretici, f('10 01331').ureticiKodu], ['Kontaktör', 'Schneider', 'LC1K0910M7']);
  assert.deepEqual([f('10 00694 10').kategori, f('10 00694 10').uretici, f('10 00694 10').ureticiKodu], ['Pompa', 'Goulds (Xylem)', 'ESHE 32-160/22']);
  assert.equal(f('10 04736').ureticiKodu, '6ES7214-1AG40-0XB0', 'sipariş numarası ERP adında kesik olsa da tam addan bütün alınır');
  assert.equal(f('10 04736').kategori, 'PLC');
  assert.equal(f('10 03164').ureticiKodu, 'LV429338', 'ERP adında önce gelen parça numarası');
  assert.equal(f('10 03164').kategori, 'Sigorta');
  assert.equal(f('10 00307').ureticiKodu, 'BEM45-084', '"3P+N+E" ve IP44 parça numarası değildir');
  assert.equal(f('10 01038').ureticiKodu, '', 'AISI malzeme sınıfıdır');
  assert.equal(f('10 01002').ureticiKodu, 'EN 30');
  assert.equal(f('10 01002').uretici, 'Yılmaz Redüktör');
  assert.equal(f('10 04128').kategori, 'Kablo', '"sensör kablosu" kablodur');
  assert.equal(f('10 04128').ureticiKodu, 'XS2F-LM12PVC4S2M');
  assert.equal(f('10 03672 99').kategori, 'Elektrik Panosu');
  assert.equal(f('10 03672 99').ureticiKodu, '', 'kendi imalatı komplenin parça numarası yoktur');
  assert.equal(f('07 16791').birim, 'Set');
});

test('açıklamada ürün tam adı, kullanıldığı makineler ve kompleler yazar; ad kaynağı değiştirilebilir', () => {
  const items = R.importItems(reports(), {});
  const element = byCode(items).get('10 01038');
  assert.match(element.fields.aciklama, /^Daldırma tipi rezistans elemanı/);
  assert.match(element.fields.aciklama, /Kullanım: LYM 950/);
  assert.match(element.fields.aciklama, /Komple: 07 00309/);
  const kontaktor = byCode(items).get('10 01331');
  assert.match(kontaktor.fields.aciklama, /Kullanım: LYM 950, 1150/, 'makineler sayı sırasıyla');
  const full = R.refreshFields(kontaktor, { adKaynagi: 'tam', kullanim: false });
  assert.equal(full.ad, 'Schneider TeSys K LC1K0910M7 kontaktör, 9 A, bobin 220 V AC');
  assert.equal(full.aciklama, 'ERP adı: KONTAKTÖR LC1K0910M7 220V');
  const vega = byCode(items).get('07 16791');
  assert.match(vega.fields.aciklama, /İlgili kod: 10 05820 \(SG51\.XXSGHTPK\)/);
});

test('sarf listesi: stok kodu olmayan kalem üretici koduyla gelir ve uyarır; birleşik kalem yalnız kullanım ekler', () => {
  const items = R.importItems(reports(), {});
  const map = byCode(items);
  const trafag = map.get('ECT 8472');
  assert.ok(trafag, 'üretici kodu kod olur');
  assert.equal(trafag.fields.uretici, 'Trafag');
  assert.equal(trafag.fields.kategori, 'Basınç Sensörü');
  assert.match(trafag.meta.uyarilar[0], /Stok kodu yok/);
  const heater = items.find((it) => /Kurutma ısıtıcısı/.test(it.fields.ad));
  assert.equal(heater.fields.kod, '', 'kodu olmayan kalem aktarmadan önce kod ister');
  assert.equal(heater.meta.sinif, 'elektrik');
  assert.equal(map.get('10 04736').fields.ad, 'PLC MODÜL SIMATIC-S7 1200 SIEMENS 6ES7214-1AG40-0X', 'birleşik kalemin adı tek kodlara yazılmaz');
  assert.ok(!map.has('10 16319'), 'yalnız alt kodda geçen ve başka yerde olmayan kod üretilmez');
  const pump = map.get('10 00694 15');
  assert.equal(pump.fields.ureticiKodu, 'ESHE 32-250/75');
  assert.equal(pump.fields.uretici, 'Goulds (Xylem)');
  assert.match(pump.fields.aciklama, /Kullanım: KBN 2B OTO P DS 1650 SN 1326050/);
  const cable = map.get('10 04128');
  assert.equal(cable.fields.ad, 'Sensör kablosu Omron XS2F-LM12PVC4S2M (M12 dişi, 4 pin, 2 m)');
  assert.match(cable.fields.aciklama, /\(sepet durdurma sensörü\)/);
});

test('aktarma planı satır satır sonuç verir: yeni, güncellenecek, aynı, hatalı, tekrar', () => {
  const library = [M.normalizeComponent({ id: 'a', kod: '10 01331', ad: 'KONTAKTÖR', kategori: 'Kontaktör' })];
  const items = [
    { row: 1, fields: { kod: '10 01331', ad: 'KONTAKTÖR', kategori: 'Pano' } },
    { row: 2, fields: { kod: '10 00001', ad: 'Yeni parça' } },
    { row: 3, fields: { kod: '', ad: 'Kodsuz' } },
    { row: 4, fields: { kod: '10 00001', ad: 'Tekrar' } },
    { row: 5, fields: { kod: '10 00002', ad: '' } },
    { row: 6, fields: { kod: '10 01331', ad: 'KONTAKTÖR' } }
  ];
  const plan = M.planImport(items.filter((it) => it.row !== 6), library, 'merge');
  assert.deepEqual(plan.rows.map((r) => [r.row, r.status]), [[1, 'update'], [2, 'new'], [3, 'invalid'], [4, 'repeat'], [5, 'invalid']]);
  assert.deepEqual(plan.rows[0].changes, ['kategori']);
  assert.equal(plan.add.length, 1);
  const same = M.planImport([items[5]], library, 'merge');
  assert.equal(same.rows[0].status, 'same');
  const addOnly = M.planImport([items[0]], library, 'add');
  assert.equal(addOnly.rows[0].status, 'same', 'yalnız yeni kipinde var olan koda dokunulmaz');
});

test('CSV: Excel\'in "sep=;" satırı ayırıcıyı belirler; raporların başlıkları tanınır', () => {
  const rows = M.parseCsv('﻿sep=;\n"Sipariş kodu";"Parça";"Not"\n"10 01331";"KONTAKTÖR, 9 A";"yedek"\n');
  assert.deepEqual(rows, [['Sipariş kodu', 'Parça', 'Not'], ['10 01331', 'KONTAKTÖR, 9 A', 'yedek']]);
  assert.deepEqual(M.guessColumns(['Sipariş kodu', 'Parça', 'Not']), ['kod', 'ad', 'aciklama']);
  assert.deepEqual(M.guessColumns(['Sıra', 'Stok kodu', 'Stok adı', 'Ürün tam adı', 'Adet', 'Birim', 'Üst komple']), ['', 'kod', 'ad', 'aciklama', '', 'birim', '']);
  assert.deepEqual(M.guessColumns(['Order code', 'Part', 'Note']), ['kod', 'ad', 'aciklama']);
  assert.deepEqual(M.guessColumns(['Malzeme', 'Malzeme kısa metni', 'Miktar']), ['kod', 'ad', ''], 'SAP: Malzeme numarası koddur');
  assert.deepEqual(M.guessColumns(['Kod', 'Malzeme']), ['kod', 'ad'], 'kod sütunu varsa Malzeme addır');
  assert.deepEqual(M.guessColumns(['Malzeme No', 'Tanım Metni']), ['kod', 'ad']);
});

test('marka ve makine listesi yardımcıları', () => {
  assert.equal(R.brandOf('Telemecanique XUK1ARCNL2 reflektörlü fotoelektrik sensör').name, 'Telemecanique');
  assert.equal(R.brandOf('Schneider (Merlin Gerin) C120N A9N18367').name, 'Schneider');
  assert.equal(R.brandOf('pirinç küresel vana'), null);
  assert.equal(R.machineList(['LYM 950', 'KBN 1B 1650', 'LYM 1150', 'KBN 2B 1650']), 'LYM 950, 1150 · KBN 1B 1650, 2B 1650');
  assert.equal(R.codeFromMakerRef('SMC IS10E-40-F04-6L-D'), 'IS10E-40-F04-6L-D');
  assert.equal(R.codeFromMakerRef('RTS VAC RTSVAC71TS22'), 'RTSVAC71TS22');
  assert.equal(R.partNumber('Atlantis Blu CA 65-40/7,5T flanşlı pompa', 'POMPA ATLANTİS CA 65-40/7,5T'), 'CA 65-40/7,5T', 'ondalık virgül bölünmez');
});

test('Türkçe tamlamanın asıl sözcüğü türü belirler: "filtre pompası" pompa, "pompa emiş filtresi" filtredir', () => {
  const names = {
    'FİLTRE POMPASI 0,75KW': ['elektrik', 'Pompa'],
    'PANO FİLTRELİ FAN': ['elektrik', 'Fan'],
    'TEFLON REZİSTANS 3000W': ['elektrik', 'Rezistans'],
    'ZİNCİR MOTORU': ['elektrik', 'Motor'],
    'KAPAK SENSÖRÜ': ['elektrik', 'Pozisyon Sensörü'],
    'KAPAK SWITCH': ['elektrik', 'Switch'],
    'VANA SWITCH BOX': ['elektrik', 'Vana Switch Box'],
    'YAĞ SIYIRICI MOTORU': ['elektrik', 'Motor'],
    'POMPA EMİŞ FİLTRESİ': ['diger', 'Filtre'],
    'REZİSTANS CONTASI': ['diger', 'Mekanik'],
    "FİLTRE 2'' BLOWER 500": ['diger', 'Filtre'],
    'PYM-MST-KBN AYDINLATMA PLEKSİ': ['diger', 'Mekanik'],
    'DİYAFRAMLI POMPA 200514': ['diger', 'Pnömatik'],
    'KÜRESEL VANA 1/2': ['diger', 'Vana'],
    'MOTORSUZ REDÜKTÖR EN 40': ['reduktor', 'Redüktör']
  };
  const items = Object.keys(names).map((n, i) => ({ c: `10 ${10000 + i}`, n, q: '1' }));
  const html = page(`const DATA = ${JSON.stringify({ groups: { G: [{ m: 'G 1', items }] } })};`);
  const rep = R.readHtml(html, 'x.html');
  assert.equal(rep.kind, 'agac', 'subs ve flat olmayan ürün ağacı da tanınır');
  for (const it of R.importItems([rep], {})) {
    assert.deepEqual([it.meta.sinif, it.fields.kategori], names[it.fields.ad], it.fields.ad);
  }
});

test('içinde elektrikli parça olan komple adı elektrik dışı olsa da elektrikli kompledir', () => {
  const data = {
    groups: { G: [{ m: 'G 1', items: [{ c: '07 00001', n: 'POMPALI FİLTRE KOMPLESİ', q: '1' }, { c: '07 00002', n: 'HASSAS FİLTRE KOMPLESİ', q: '1' }] }] },
    subs: {
      '07 00001': [{ c: '10 00001', n: 'POMPA GOULDS ESHE 32-160/22' }, { c: '10 00002', n: 'TORBA FİLTRE 200 MİKRON' }],
      '07 00002': [{ c: '10 00002', n: 'TORBA FİLTRE 200 MİKRON' }]
    }
  };
  const items = byCode(R.importItems([R.readHtml(page(`const DATA = ${JSON.stringify(data)};`), 'x.html')], {}));
  assert.equal(items.get('07 00001').meta.sinif, 'komple');
  assert.equal(items.get('07 00002').meta.sinif, 'diger');
});

test('betik okuma yorum, düzenli ifade, let/var ve boş girdilerle bozulmaz', () => {
  const tree = { groups: { G: [null, { m: 'G 1', items: [null, { c: '10 00001', n: 'KONTAKTÖR LC1D09M7' }] }] }, subs: { '10 00001': [null] }, flat: { G: null } };
  const html = `<html><script>
    // kullanıcı'nın notu: ' tek tırnak ve { ayraç
    const UI = { tr: { a: 'x' }, re: /'/g, f(x) { return x.replace(/[{]/, ''); } };
    /* blok yorum ' " { [ */
    let DATA = ${JSON.stringify(tree)};
  </script></html>`;
  const rep = R.readHtml(html, 'x.html');
  assert.equal(rep.kind, 'agac');
  assert.equal(rep.data.machines.length, 1);
  assert.deepEqual(rep.data.machines[0].kalemler.map((k) => k.kod), ['10 00001']);
  const spares = R.readHtml(`<script>var P = ${JSON.stringify({ data: { kalemler: [null, { kod: '10 00001', ad: { tr: 'Kontaktör' } }], gruplar: [null] } })};</script>`, 's.html');
  assert.equal(spares.kind, 'sarf');
  assert.equal(spares.data.kalemler.length, 1);
});

test('HTML tablosu: adlı karakterler çözülür, birleşik hücreler doğru sütuna iner, büyük tablo hızlı okunur', () => {
  const html = `<table><tr><th>Kod</th><th>Ad</th><th>Grup</th></tr>
    <tr><td>10 1</td><td>&Ouml;l&ccedil;er 90&deg; &frac12;" &Oslash;6</td><td rowspan="2">Pano</td></tr>
    <tr><td>10 2</td><td>R&ouml;le</td></tr></table>`;
  assert.deepEqual(R.htmlTables(html)[0], [['Kod', 'Ad', 'Grup'], ['10 1', 'Ölçer 90° ½" Ø6', 'Pano'], ['10 2', 'Röle', 'Pano']]);
  const rows = Array.from({ length: 8000 }, (_, i) => `<tr><td>${i}</td><td>Parça ${i}</td></tr>`).join('');
  const t0 = Date.now();
  const big = R.htmlTables(`<table><tr><th>Kod</th><th>Ad</th></tr>${rows}</table>`)[0];
  assert.equal(big.length, 8001);
  assert.ok(Date.now() - t0 < 1500, `8000 satır ${Date.now() - t0} ms`);
});

test('güncelle kipinde boş hücre var olan değeri (birim, favori, pasif) varsayılanla ezmez', () => {
  const library = [M.normalizeComponent({ id: 'a', kod: 'PE01', ad: 'Pompa', kategori: 'Eski', birim: 'm', favori: true, pasif: true })];
  const rows = [['Kod', 'Ad', 'Kategori', 'Birim', 'Favori', 'Pasif'], ['PE01', 'Pompa', 'Yeni', '', '', '']];
  const plan = M.planImport(M.tableToComponents(rows).items, library, 'merge');
  assert.equal(plan.update.length, 1);
  const after = plan.update[0].after;
  assert.deepEqual([after.kategori, after.birim, after.favori, after.pasif], ['Yeni', 'm', true, true]);
  assert.deepEqual(plan.update[0].changes, ['kategori']);
  // "Değiştir" kipinde boş hücre değeri temizler (varsayılana döner)
  const replaced = M.planImport(M.tableToComponents(rows).items, library, 'replace').update[0].after;
  assert.deepEqual([replaced.birim, replaced.favori], ['Adet', false]);
});

test('hatalı ilk satır kodu sahiplenmez: aynı kodun sonraki doğru satırı alınır', () => {
  const items = [
    { row: 1, fields: { kod: 'A1', ad: '' } },
    { row: 2, fields: { kod: 'A1', ad: 'Tam kayıt' } },
    { row: 3, fields: { kod: 'A1', ad: 'Üçüncü' } },
    { row: 4, fields: { kod: 'B1', ad: 'Bağlantılı', link: 'ftp://x' } },
    { row: 5, fields: { kod: 'B1', ad: 'Doğru bağlantı', link: 'https://x' } }
  ];
  const plan = M.planImport(items, [], 'merge');
  assert.deepEqual(plan.rows.map((r) => [r.row, r.status]), [[1, 'invalid'], [2, 'new'], [3, 'repeat'], [4, 'invalid'], [5, 'new']]);
  assert.deepEqual(plan.add.map((c) => c.ad), ['Tam kayıt', 'Doğru bağlantı']);
});
