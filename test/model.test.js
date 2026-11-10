/* İş kuralları: sayı okuma, arama, toplamlar, kontroller, satın alma listesi, revizyon farkı,
   değişiklik damgası ve birleştirme, CSV ve yapıştırarak ekleme. */

const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../codes/model.js');

// Testlerdeki sabit zamanlar (2026-01-…) "şimdi"den sonra olsun: varsayılan güncelleme zamanı bunlardan önce kalır
M.setClock(() => Date.parse('2025-12-31T00:00:00.000Z'));

const lib = (list) => new Map(list.map((c) => [c.id, M.normalizeComponent(c)]));

function project(lines, extra) {
  const p = M.normalizeProject(Object.assign({
    id: '1-A-B', seriNo: '1', musteri: 'A', model: 'B',
    bolumler: [{ id: 's1', ad: 'Elektrik' }, { id: 's2', ad: 'Pnömatik' }],
    kalemler: lines
  }, extra));
  return p;
}

/* ─── Sayı ve metin ─────────────────────────────────────── */

test('sayılar Türkçe ve İngilizce yazımla okunur', () => {
  const cases = [
    ['1.234,56', 1234.56], ['1234,5', 1234.5], ['12.5', 12.5], ['12,50 €', 12.5], ['1.250', 1250], ['12.500', 12500],
    ['0.750', 0.75], ['1,234.50', 1234.5], ['₺ 2.000', 2000], ['-3', -3], ['%15', 15], [7, 7], ['', null], ['abc', null], [null, null],
    ['1 234,5', 1234.5], ['1.234.567', 1234567]
  ];
  for (const [input, expected] of cases) assert.equal(M.parseNumber(input), expected, String(input));
});

test('sayılar Türkçe biçimde yazılır', () => {
  assert.equal(M.formatAmount(1234.5), '1.234,50');
  assert.equal(M.formatQty(2), '2');
  assert.equal(M.formatQty(2.5), '2,5');
  assert.equal(M.formatPrice(0.0125), '0,0125');
  assert.equal(M.formatMoney(12.5, 'EUR'), '12,50 €');
  assert.equal(M.formatMoney(12.5, 'TRY', { code: true }), '12,50 TRY');
  assert.equal(M.csvNumber(1234.5), '1234,5');
});

test('aramada Türkçe işaretler ve büyük harf fark etmez', () => {
  assert.equal(M.fold('IŞIK Şalter Göğüs'), 'isik salter gogus');
  assert.equal(M.fold('İnvertör'), 'invertor');
  assert.equal(M.codeKey('pe 01'), M.codeKey('PE01'));
});

test('proje adı seri no-müşteri-model olur, dosya adında yasak işaretler temizlenir', () => {
  assert.equal(M.projectId('0626051', 'DÜNYA', 'ULT M200 3B'), '0626051-DÜNYA-ULT M200 3B');
  assert.equal(M.projectId('06/26', 'A:B', 'X. '), '06 26-A B-X');
  assert.equal(M.projectId('', 'A', 'B'), '');
});

/* ─── Komponentler ──────────────────────────────────────── */

test('komponent alanları temizlenir, kod tekrarı ve hatalı bağlantı bildirilir', () => {
  const c = M.normalizeComponent({ kod: ' PE01 ', ad: 'Pompa  Motoru', fiyat: '1.250,00', paraBirimi: 'tl', favori: 'evet', teslimSuresi: '14' });
  assert.equal(c.kod, 'PE01');
  assert.equal(c.ad, 'Pompa Motoru');
  assert.equal(c.fiyat, 1250);
  assert.equal(c.paraBirimi, 'TRY');
  assert.equal(c.favori, true);
  assert.equal(c.teslimSuresi, 14);
  assert.match(c.id, /^[0-9a-f]{12}$/);
  const other = M.normalizeComponent({ id: 'x', kod: 'pe01', ad: 'Başka' });
  assert.match(M.validateComponent(c, [other]).join(), /zaten var/);
  assert.match(M.validateComponent(Object.assign({}, c, { link: 'ftp://x' }), []).join(), /http/);
  assert.deepEqual(M.validateComponent(c, [c]), []);
});

test('arama kod eşleşmesini öne alır, her sözcük geçmeli', () => {
  const list = [
    M.normalizeComponent({ id: '1', kod: 'V31', ad: 'Sepet Aç Valfi', uretici: 'Festo' }),
    M.normalizeComponent({ id: '2', kod: 'PE01', ad: 'Ön Yıkama Pompa Motoru', uretici: 'Grundfos' }),
    M.normalizeComponent({ id: '3', kod: 'PE02', ad: 'Yıkama Pompa Motoru', uretici: 'Grundfos' }),
    M.normalizeComponent({ id: '4', kod: 'X1', ad: 'PE01 için bağlantı' })
  ];
  assert.deepEqual(M.searchComponents(list, 'pe01').map((c) => c.kod), ['PE01', 'X1']);
  assert.deepEqual(M.searchComponents(list, 'yikama pompa').map((c) => c.kod), ['PE01', 'PE02']);
  assert.deepEqual(M.searchComponents(list, 'festo').map((c) => c.kod), ['V31']);
  assert.equal(M.searchComponents(list, '').length, 4);
  const index = M.buildSearchIndex(list);
  assert.deepEqual(M.searchComponents(list, 'grundfos', index).map((c) => c.kod), ['PE01', 'PE02']);
});

test('komponent kimliği 16 parçadan birine düşer; parça birleşmesi kayıt kayıt yapılır', () => {
  assert.equal(M.shardOf('a1b2c3'), 'a');
  assert.ok('0123456789abcdef'.includes(M.shardOf('kimlik-yok')));
  assert.equal(M.shardPath('a'), 'BOM/kutuphane/ka.json');
  assert.ok(M.isShardPath('BOM/kutuphane/k0.json'));
  assert.ok(!M.isShardPath('BOM/kutuphane/k0.json.catisma-20261110-101010'));
  const base = { id: 'a1', kod: 'A', ad: 'A', zaman: '2026-01-01T00:00:00.000Z' };
  const mine = M.encodeJson(M.shardDocument([Object.assign({}, base, { ad: 'A mine', zaman: '2026-01-02T00:00:00.000Z' })], {}));
  const theirs = M.encodeJson(M.shardDocument([base, { id: 'a2', kod: 'B', ad: 'B', zaman: '2026-01-03T00:00:00.000Z' }], {}));
  const merged = M.parseShard(M.mergeShardBytes(mine, theirs));
  assert.deepEqual(merged.komponentler.map((c) => `${c.kod}:${c.ad}`), ['A:A mine', 'B:B']);
  assert.deepEqual([...M.mergeShardBytes(mine, theirs)], [...M.mergeShardBytes(mine, theirs)], 'aynı girdi aynı çıktıyı verir');
});

/* ─── Kalemler ve toplamlar ─────────────────────────────── */

test('kalem kütüphaneden alınır, tutar miktar × fiyat × (1 - iskonto) olur', () => {
  const line = M.lineFromComponent({ id: 'c1', kod: 'PE01', ad: 'Pompa', fiyat: 100, paraBirimi: 'EUR', birim: 'Adet' }, 3, 's1');
  assert.equal(line.komponentId, 'c1');
  assert.equal(line.kod, 'PE01');
  assert.equal(M.lineAmount(line), 300);
  assert.equal(M.lineAmount(Object.assign({}, line, { iskonto: 10 })), 270);
  assert.equal(M.lineAmount(Object.assign({}, line, { fiyat: null })), null);
});

test('toplam para birimi başına tutulur, kurla rapor para birimine çevrilir', () => {
  const p = project([
    { id: 'l1', bolum: 's1', kod: 'A', ad: 'A', miktar: 2, fiyat: 100, paraBirimi: 'EUR' },
    { id: 'l2', bolum: 's1', kod: 'B', ad: 'B', miktar: 1, fiyat: 500, paraBirimi: 'TRY' },
    { id: 'l3', bolum: 's2', kod: 'C', ad: 'C', miktar: 4, fiyat: null, paraBirimi: 'TRY', birim: 'm' }
  ], { paraBirimi: 'TRY', kurlar: { EUR: 36 } });
  const t = M.projectTotals(p);
  assert.deepEqual(t.byCurrency, { EUR: 200, TRY: 500 });
  assert.equal(t.converted, 200 * 36 + 500);
  assert.equal(t.missingPrice, 1);
  assert.equal(t.pieces, 3, 'metre adetle toplanmaz');
  const eur = M.summarize(p.kalemler, 'EUR', { EUR: 36 });
  assert.equal(M.round(eur.converted, 4), M.round(200 + 500 / 36, 4));
  const noRate = M.summarize(p.kalemler, 'TRY', {});
  assert.equal(noRate.converted, null);
  assert.deepEqual(noRate.missingRates, ['EUR']);
});

test('numaralar bölüm sırasıyla verilir: tek bölümde 1, 2; çok bölümde 1.1, 2.1', () => {
  const p = project([
    { id: 'l1', bolum: 's2', kod: 'A', ad: 'A', miktar: 1 },
    { id: 'l2', bolum: 's1', kod: 'B', ad: 'B', miktar: 1 },
    { id: 'l3', bolum: 's1', kod: 'C', ad: 'C', miktar: 1 }
  ]);
  assert.deepEqual(M.numberedLines(p).map((n) => `${n.no}:${n.line.kod}`), ['1.1:B', '1.2:C', '2.1:A']);
  const single = M.normalizeProject({ bolumler: [{ id: 's', ad: 'G' }], kalemler: [{ id: 'x', bolum: 's', kod: 'X', ad: 'X' }] });
  assert.deepEqual(M.numberedLines(single).map((n) => n.no), ['1']);
});

test('bilinmeyen bölümdeki kalem ilk bölüme geçer, bölümsüz projeye Genel bölümü eklenir', () => {
  const p = M.normalizeProject({ kalemler: [{ id: 'x', bolum: 'yok', kod: 'X', ad: 'X' }] });
  assert.equal(p.bolumler.length, 1);
  assert.equal(p.bolumler[0].ad, 'Genel');
  assert.equal(p.kalemler[0].bolum, p.bolumler[0].id);
});

test('satın alma listesi aynı komponenti bölümler arasında toplar, tedarikçiye göre gruplar', () => {
  const p = project([
    { id: 'l1', bolum: 's1', komponentId: 'c1', kod: 'A', ad: 'A', miktar: 2, fiyat: 10, tedarikci: 'Festo', referans: 'V31' },
    { id: 'l2', bolum: 's2', komponentId: 'c1', kod: 'A', ad: 'A', miktar: 3, fiyat: 10, tedarikci: 'Festo', referans: 'V32, V31' },
    { id: 'l3', bolum: 's2', kod: 'B', ad: 'B', miktar: 1, fiyat: 5 }
  ]);
  const groups = M.purchaseList(p);
  assert.deepEqual(groups.map((g) => g.tedarikci), ['Festo', '']);
  assert.equal(groups[0].items.length, 1);
  assert.equal(groups[0].items[0].miktar, 5);
  assert.equal(groups[0].items[0].referans, 'V31, V32');
  assert.deepEqual(groups[0].items[0].bolumler, ['Elektrik', 'Pnömatik']);
  assert.equal(groups[0].totals.byCurrency.TRY, 50);
});

/* ─── Kontrol ───────────────────────────────────────────── */

test('kontrol eksik miktarı, fiyatı, kuru, kütüphane farkını, tekrarı ve referansı bulur', () => {
  const library = lib([
    { id: 'c1', kod: 'PE01', ad: 'Pompa', fiyat: 120, paraBirimi: 'EUR' },
    { id: 'c2', kod: 'V31', ad: 'Vana', fiyat: 5, pasif: true },
    { id: 'c3', kod: 'LS01', ad: 'Seviye' }
  ]);
  const p = project([
    { id: 'l1', bolum: 's1', komponentId: 'c1', kod: 'PE01', ad: 'Pompa', miktar: 2, fiyat: 100, paraBirimi: 'EUR', referans: 'PE01' },
    { id: 'l2', bolum: 's1', komponentId: 'c1', kod: 'PE01', ad: 'Pompa', miktar: 1, fiyat: 100, paraBirimi: 'EUR', referans: 'PE01' },
    { id: 'l3', bolum: 's1', komponentId: 'c2', kod: 'V31', ad: 'Vana', miktar: 0, fiyat: 5 },
    { id: 'l4', bolum: 's1', komponentId: 'silindi', kod: 'X9', ad: 'Eski', miktar: 1, fiyat: 1 },
    { id: 'l5', bolum: 's1', kod: 'LS01', ad: 'Seviye', miktar: 1 },
    { id: 'l6', bolum: 's1', kod: 'İŞÇİLİK', ad: 'Montaj', miktar: 1, fiyat: 1000 }
  ], { kurlar: {} });
  const checks = M.checkProject(p, library);
  const find = (re) => checks.find((c) => re.test(c.text));
  assert.equal(find(/Miktarı girilmemiş/).level, 'error');
  assert.deepEqual(find(/Miktarı girilmemiş/).lines, ['l3']);
  assert.equal(find(/Miktarı girilmemiş/).fix.kind, 'removeZero');
  assert.ok(find(/Fiyatı girilmemiş 1 kalem/));
  assert.equal(find(/EUR kuru girilmemiş/).level, 'error');
  assert.deepEqual(find(/Kütüphaneden farklı fiyat/).lines, ['l1', 'l2']);
  assert.equal(find(/Kütüphaneden farklı fiyat/).fix.kind, 'refresh');
  assert.ok(find(/Pasif/));
  assert.deepEqual(find(/silinmiş/).lines, ['l4']);
  assert.deepEqual(find(/bağlanabilir/).lines, ['l5']);
  assert.deepEqual(find(/serbest/).lines, ['l6']);
  assert.equal(find(/tekrar eden/).fix.kind, 'merge');
  assert.ok(find(/PE01 referansı 2 kalemde/));
  assert.ok(find(/"Pnömatik" bölümü boş/));
  assert.ok(find(/Fiyatı girilmemiş/).level === 'warn');
});

test('boş liste ve revizyon açıklaması kontrolü', () => {
  const empty = project([]);
  assert.match(M.checkProject(empty, new Map())[0].text, /boş/);
  const p = project([{ id: 'l', bolum: 's1', kod: 'A', ad: 'A', miktar: 1, fiyat: 1 }], { rev: '01', revizyonlar: [{ rev: '00', aciklama: 'İlk yayın' }, { rev: '01' }] });
  assert.ok(M.checkProject(p, new Map()).some((c) => /Rev\. 01 açıklaması/.test(c.text)));
});

/* ─── Revizyon farkı ────────────────────────────────────── */

test('revizyon farkı komponent bazında eklenen, çıkarılan ve değişeni bulur', () => {
  const old = [
    { kod: 'A', ad: 'A', komponentId: 'a', miktar: 2, fiyat: 10 },
    { kod: 'B', ad: 'B', komponentId: 'b', miktar: 1, fiyat: 5 },
    { kod: 'C', ad: 'C', komponentId: 'c', miktar: 1, fiyat: 5 }
  ].map(M.normalizeLine);
  const now = [
    { kod: 'A', ad: 'A', komponentId: 'a', miktar: 1, fiyat: 10 },
    { kod: 'A', ad: 'A', komponentId: 'a', miktar: 2, fiyat: 10 },
    { kod: 'B', ad: 'B', komponentId: 'b', miktar: 1, fiyat: 6 },
    { kod: 'D', ad: 'D', miktar: 1, fiyat: 1 }
  ].map(M.normalizeLine);
  const d = M.diffBoms(old, now);
  assert.deepEqual(d.added.map((x) => x.kod), ['D']);
  assert.deepEqual(d.removed.map((x) => x.kod), ['C']);
  assert.deepEqual(d.changed.map((x) => `${x.kod}:${x.qty}:${x.price}`), ['A:true:false', 'B:false:true']);
  assert.equal(d.changed[0].yeni.miktar, 3);
});

test('revizyon numarası iki haneli ilerler', () => {
  assert.equal(M.nextRev('00'), '01');
  assert.equal(M.nextRev('9'), '10');
  assert.equal(M.normalizeRev('3'), '03');
  assert.equal(M.nextRev('A'), 'B');
});

/* ─── Damga ve birleştirme ──────────────────────────────── */

test('değişiklik damgası yalnız değişen kayda zaman, silinene silinme zamanı yazar', () => {
  const prev = project([
    { id: 'l1', bolum: 's1', kod: 'A', ad: 'A', miktar: 1, zaman: 't0' },
    { id: 'l2', bolum: 's1', kod: 'B', ad: 'B', miktar: 1, zaman: 't0' }
  ]);
  const next = M.clone(prev);
  next.kalemler[0].miktar = 5;
  next.kalemler.splice(1, 1);
  next.musteri = 'Yeni';
  assert.equal(M.stampChanges(prev, next, 'T1'), true);
  assert.equal(next.kalemler[0].zaman, 'T1');
  assert.equal(next.silinen.kalem.l2, 'T1');
  assert.equal(next.alanZaman.musteri, 'T1');
  assert.equal(next.guncelleme, 'T1');
  const same = M.clone(next);
  assert.equal(M.stampChanges(next, same, 'T2'), false, 'değişiklik yoksa damga yok');
});

test('geri alınan silme yeniden canlanır ve öbür cihazın eski silmesini yener', () => {
  const v0 = project([{ id: 'l1', bolum: 's1', kod: 'A', ad: 'A', miktar: 1, zaman: '2026-01-01T00:00:00.000Z' }]);
  const v1 = M.clone(v0);
  v1.kalemler = [];
  M.stampChanges(v0, v1, '2026-01-02T00:00:00.000Z');
  assert.ok(v1.silinen.kalem.l1);
  // Geri al: v0'ın içeriği yeni zamanla geri gelir
  const undo = M.clone(v0);
  M.stampChanges(v1, undo, '2026-01-03T00:00:00.000Z');
  assert.equal(undo.kalemler[0].zaman, '2026-01-03T00:00:00.000Z');
  assert.equal(undo.silinen.kalem.l1, undefined);
  const merged = M.mergeProjects(undo, v1);
  assert.deepEqual(merged.kalemler.map((l) => l.id), ['l1']);
});

test('proje birleştirme: iki taraftaki yeni kalemler sıralarıyla kalır, silinen geri gelmez', () => {
  const base = project([
    { id: 'a', bolum: 's1', kod: 'A', ad: 'A', miktar: 1, zaman: '2026-01-01T00:00:00.000Z' },
    { id: 'b', bolum: 's1', kod: 'B', ad: 'B', miktar: 1, zaman: '2026-01-01T00:00:00.000Z' }
  ], { guncelleme: '2026-01-01T00:00:00.000Z' });
  const mine = M.clone(base);
  mine.kalemler.splice(1, 0, M.normalizeLine({ id: 'm', bolum: 's1', kod: 'M', ad: 'M', miktar: 1 }));
  M.stampChanges(base, mine, '2026-01-02T00:00:00.000Z');
  const theirs = M.clone(base);
  theirs.kalemler = theirs.kalemler.filter((l) => l.id !== 'a');
  theirs.kalemler.push(M.normalizeLine({ id: 't', bolum: 's2', kod: 'T', ad: 'T', miktar: 1 }));
  M.stampChanges(base, theirs, '2026-01-03T00:00:00.000Z');
  const merged = M.mergeProjects(mine, theirs);
  assert.deepEqual(merged.kalemler.map((l) => l.id), ['m', 'b', 't']);
  const again = M.mergeProjects(theirs, mine);
  assert.deepEqual(again.kalemler.map((l) => l.id), merged.kalemler.map((l) => l.id), 'iki yönde aynı sonuç');
});

test('silinen bölüme öbür cihazda kalem eklenirse bölüm geri gelir', () => {
  const base = project([], { guncelleme: '2026-01-01T00:00:00.000Z' });
  const mine = M.clone(base);
  mine.bolumler = mine.bolumler.filter((s) => s.id !== 's2');
  M.stampChanges(base, mine, '2026-01-02T00:00:00.000Z');
  const theirs = M.clone(base);
  theirs.kalemler.push(M.normalizeLine({ id: 'x', bolum: 's2', kod: 'X', ad: 'X', miktar: 1 }));
  M.stampChanges(base, theirs, '2026-01-03T00:00:00.000Z');
  const merged = M.mergeProjects(mine, theirs);
  assert.deepEqual(merged.bolumler.map((s) => s.id), ['s1', 's2']);
  assert.equal(merged.kalemler[0].bolum, 's2');
});

test('saati geri olan cihazın yeni düzenlemesi belgedeki daha ileri zamanlı eski değere kaybetmez', () => {
  // Belge başka cihazda "ileride" bir saatle damgalanmış
  const prev = project([{ id: 'l1', bolum: 's1', kod: 'A', ad: 'A', miktar: 1, zaman: '2026-06-01T00:00:00.000Z' }], { guncelleme: '2026-06-01T00:00:00.000Z' });
  const next = M.clone(prev);
  next.kalemler[0].miktar = 9;
  M.stampChanges(prev, next, '2026-02-01T00:00:00.000Z');
  assert.ok(next.kalemler[0].zaman > '2026-06-01T00:00:00.000Z', 'damga görülen en yeni zamandan sonra');
  const other = M.clone(prev);
  assert.equal(M.mergeProjects(next, other).kalemler[0].miktar, 9);
  assert.equal(M.laterStamp('2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z'), '2026-01-02T00:00:00.001Z');
  assert.equal(M.laterStamp('2026-01-03T00:00:00.000Z', '2026-01-02T00:00:00.000Z'), '2026-01-03T00:00:00.000Z');
  let s = M.setSetting(M.normalizeSettings({ zaman: { kurlar: '2026-06-01T00:00:00.000Z' } }), 'kurlar', { EUR: 40 }, '2026-02-01T00:00:00.000Z');
  assert.ok(s.zaman.kurlar > '2026-06-01T00:00:00.000Z');
  s = M.setSetting(s, 'kurlar', { EUR: 40 }, '2026-07-01T00:00:00.000Z');
  assert.ok(s.zaman.kurlar < '2026-07-01T00:00:00.000Z', 'aynı değer damgayı değiştirmez');
});

test('ayarlar anahtar başına birleşir', () => {
  let a = M.normalizeSettings({});
  let b = M.normalizeSettings({});
  a = M.setSetting(a, 'kurlar', { EUR: 36 }, '2026-01-02T00:00:00.000Z');
  b = M.setSetting(b, 'birimler', ['Adet', 'Kutu'], '2026-01-03T00:00:00.000Z');
  const merged = M.mergeSettings(a, b);
  assert.equal(merged.kurlar.EUR, 36);
  assert.deepEqual(merged.birimler, ['Adet', 'Kutu']);
  assert.deepEqual(M.mergeSettings(b, a), merged);
});

test('birleştirme kancası yalnız BOMX dosyalarını tanır', () => {
  assert.equal(M.mergeFile('baska/dosya.json', new Uint8Array(), new Uint8Array()), null);
  assert.ok(M.isProjectPath('BOM/projeler/1-A-B/proje.json'));
  assert.ok(!M.isProjectPath('BOM/projeler/1-A-B/revizyon/00.json'));
  assert.ok(M.isTemplatePath('BOM/sablonlar/abc.json'));
});

/* ─── CSV ve aktarma ────────────────────────────────────── */

test('CSV tırnak, hücre içi satır sonu ve ayırıcıyı tanır', () => {
  assert.equal(M.detectDelimiter('a;b;c\n1;2;3'), ';');
  assert.equal(M.detectDelimiter('a,b\n1,2'), ',');
  assert.equal(M.detectDelimiter('a\tb'), '\t');
  const rows = M.parseCsv('﻿Kod;Ad;Not\r\nPE01;"Pompa; 2,2 kW";"iki\nsatır"\r\nV31;Vana;"""tırnak"""\r\n\r\n');
  assert.deepEqual(rows, [['Kod', 'Ad', 'Not'], ['PE01', 'Pompa; 2,2 kW', 'iki\nsatır'], ['V31', 'Vana', '"tırnak"']]);
  const csv = M.toCsv([['a;b', 'c"d', ' e'], [1, null, 'x']]);
  assert.equal(csv, '﻿"a;b";"c""d";" e"\r\n1;;x\r\n');
  assert.deepEqual(M.parseCsv(csv), [['a;b', 'c"d', ' e'], ['1', '', 'x']]);
});

test('başlıklar komponent alanlarına eşlenir; P&PX KODListesi.csv biçimi doğrudan okunur', () => {
  assert.deepEqual(M.guessColumns(['Stok Kodu', 'Malzeme Adı', 'Marka', 'Birim Fiyatı', 'Döviz', 'Açıklama']), ['kod', 'ad', 'uretici', 'fiyat', 'paraBirimi', 'aciklama']);
  const ppx = M.tableToComponents(M.parseCsv('KOD;AÇIKLAMA\nPE01;Ön Yıkama Pompa Motoru\nV07;Hava; ana valf'));
  assert.equal(ppx.hasHeader, true);
  assert.deepEqual(ppx.columns, ['kod', 'ad']);
  assert.deepEqual(ppx.items.map((i) => i.fields), [{ kod: 'PE01', ad: 'Ön Yıkama Pompa Motoru' }, { kod: 'V07', ad: 'Hava; ana valf' }]);
  const noHeader = M.tableToComponents([['A1', 'Civata M8'], ['A2', 'Somun M8']]);
  assert.equal(noHeader.hasHeader, false);
  assert.equal(noHeader.items.length, 2);
});

test('aktarma planı yeni, güncellenecek, değişmeyen ve hatalı satırları ayırır', () => {
  const library = [M.normalizeComponent({ id: 'c1', kod: 'PE01', ad: 'Pompa', fiyat: 100, uretici: 'Grundfos' })];
  const items = [
    { row: 2, fields: { kod: 'pe01', ad: 'Pompa', fiyat: '120', uretici: '' } },
    { row: 3, fields: { kod: 'V31', ad: 'Vana' } },
    { row: 4, fields: { kod: 'V31', ad: 'Vana tekrar' } },
    { row: 5, fields: { ad: 'Kodsuz' } },
    { row: 6, fields: { kod: 'Y1' } }
  ];
  const merge = M.planImport(items, library, 'merge');
  assert.equal(merge.add.length, 1);
  assert.equal(merge.add[0].kod, 'V31');
  assert.equal(merge.update.length, 1);
  assert.deepEqual(merge.update[0].changes, ['fiyat']);
  assert.equal(merge.update[0].after.uretici, 'Grundfos', 'boş hücre var olanı silmez');
  assert.equal(merge.repeated, 1);
  assert.equal(merge.invalid.length, 2);
  const replace = M.planImport(items, library, 'replace');
  assert.deepEqual(replace.update[0].changes, ['uretici', 'fiyat']);
  const add = M.planImport(items, library, 'add');
  assert.equal(add.update.length, 0);
  assert.equal(add.same, 1);
});

test('kütüphane CSV olarak verilip geri okunduğunda aynı kalır', () => {
  const list = [M.normalizeComponent({ kod: 'PE01', ad: 'Pompa; 2,2 kW', fiyat: 1250.5, paraBirimi: 'EUR', favori: true, aciklama: 'iki\nsatır' })];
  const parsed = M.tableToComponents(M.parseCsv(M.toCsv(M.libraryToRows(list))));
  const plan = M.planImport(parsed.items, [], 'merge');
  const back = plan.add[0];
  for (const key of ['kod', 'ad', 'fiyat', 'paraBirimi', 'favori', 'aciklama']) assert.deepEqual(back[key], list[0][key], key);
});

test('yapıştırılan satırlardan kod ve miktar çıkar', () => {
  const library = [
    M.normalizeComponent({ id: 'c1', kod: 'PE01', ad: 'Pompa' }),
    M.normalizeComponent({ id: 'c2', kod: '1530010001', ad: 'Civata' })
  ];
  const rows = M.parsePasted('Kod\tMiktar\nPE01\t3\n2 x 1530010001\nPE01 x 4\nYOK1;2;Montaj işçiliği\npe01\nV99 5', library);
  assert.deepEqual(rows.map((r) => `${r.kod}:${r.miktar}:${r.component ? 'k' : '-'}`), [
    'PE01:3:k', '1530010001:2:k', 'PE01:4:k', 'YOK1:2:-', 'PE01:1:k', 'V99:5:-'
  ]);
  assert.equal(rows[3].ad, 'Montaj işçiliği');
});

test('yapıştırmada kütüphanedeki kod "kod × miktar" sanılmaz; bitişik yazım koddur', () => {
  const library = [M.normalizeComponent({ id: 'c1', kod: 'M8X20', ad: 'Cıvata' }), M.normalizeComponent({ id: 'c2', kod: 'V31', ad: 'Vana' })];
  const rows = M.parsePasted('M8X20\nBOX12\n2x V31\nV31 x3', library);
  assert.deepEqual(rows.map((r) => `${r.kod}:${r.miktar}:${r.component ? 'k' : '-'}`), ['M8X20:1:k', 'BOX12:1:-', 'V31:2:k', 'V31:3:k']);
});

test('para birimi üç harfli koda çevrilir; geçersiz değer TRY olur (sayfaya ham metin girmez)', () => {
  assert.equal(M.normalizeLine({ paraBirimi: 'eur' }).paraBirimi, 'EUR');
  assert.equal(M.normalizeLine({ paraBirimi: 'TL' }).paraBirimi, 'TRY');
  assert.equal(M.normalizeLine({ paraBirimi: '<img src=x onerror=alert(1)>' }).paraBirimi, 'TRY');
  assert.equal(M.normalizeComponent({ paraBirimi: 'EURO' }).paraBirimi, 'TRY');
  assert.deepEqual(Object.keys(M.normalizeProject({ kurlar: { EUR: 36, '<b>': 5 } }).kurlar), ['EUR']);
});

test('"değiştir" kipinde dosyadaki boş hücre kütüphanedeki değeri temizler; "güncelle" kipinde temizlemez', () => {
  const library = [M.normalizeComponent({ id: 'c1', kod: 'PE01', ad: 'Pompa', uretici: 'Grundfos', fiyat: 100 })];
  const table = M.tableToComponents(M.parseCsv('Kod;Ad;Marka;Fiyat\nPE01;Pompa;;120'));
  assert.equal(table.items[0].fields.uretici, '');
  const replace = M.planImport(table.items, library, 'replace');
  assert.equal(replace.update[0].after.uretici, '');
  assert.equal(replace.update[0].after.fiyat, 120);
  const merge = M.planImport(table.items, library, 'merge');
  assert.equal(merge.update[0].after.uretici, 'Grundfos');
});

test('değişmeyen not her değişiklikte yeniden damgalanmaz (normalize edilmiş hâller karşılaştırılır)', () => {
  const prev = M.normalizeProject(Object.assign(project([]), { notlar: 'Not', alanZaman: { notlar: '2026-01-01T00:00:00.000Z' }, guncelleme: '2026-01-01T00:00:00.000Z' }));
  const next = M.normalizeProject(Object.assign(M.clone(prev), { notlar: 'Not\n' }));
  assert.equal(M.stampChanges(prev, next, '2026-01-05T00:00:00.000Z'), false);
  assert.equal(next.alanZaman.notlar, '2026-01-01T00:00:00.000Z');
});

test('P&PX kodları kategorisiyle komponent olur', () => {
  const items = M.componentsFromPpx([{ kod: 'PE01', aciklama: 'Ön Yıkama Pompa Motoru' }, { kod: 'LS04', aciklama: 'Seviye' }, { kod: 'pe01', aciklama: 'tekrar' }],
    [{ kod: 'PE01', ad: 'Ön Yıkama Pompa Motoru', aciklama: 'Uzun açıklama' }]);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0].fields, { kod: 'PE01', ad: 'Ön Yıkama Pompa Motoru', kategori: 'Pompa', aciklama: 'Uzun açıklama' });
  assert.equal(items[1].fields.kategori, 'Seviye Sensörü');
});

test('şablon kalemleri kütüphanedeki güncel bilgiyle gelir', () => {
  const library = lib([{ id: 'c1', kod: 'PE01', ad: 'Pompa yeni', fiyat: 150 }]);
  const t = M.templateFromLines('Pompa seti', [
    M.normalizeLine({ komponentId: 'c1', kod: 'PE01', ad: 'Pompa eski', fiyat: 100, miktar: 2, referans: 'PE01, PE02' }),
    M.normalizeLine({ kod: 'MONTAJ', ad: 'Montaj', miktar: 1, fiyat: 500 })
  ]);
  const lines = M.linesFromTemplate(t, library, 's9');
  assert.equal(lines[0].ad, 'Pompa yeni');
  assert.equal(lines[0].fiyat, 150);
  assert.equal(lines[0].miktar, 2);
  assert.equal(lines[0].referans, 'PE01, PE02');
  assert.equal(lines[0].bolum, 's9');
  assert.equal(lines[1].komponentId, null);
  assert.equal(lines[1].fiyat, 500);
  assert.notEqual(lines[0].id, t.kalemler[0].id, 'her eklemede yeni kimlik');
});

test('belge yazıları üç dilde, birimler çevrilir', () => {
  assert.equal(M.docText('en').title, 'BILL OF MATERIALS');
  assert.equal(M.docText('xx').title, 'MALZEME LİSTESİ');
  assert.equal(M.unitText('Adet', 'en'), 'pcs');
  assert.equal(M.unitText('Adet', 'de'), 'Stk.');
  assert.equal(M.unitText('Adet', 'tr'), 'Adet');
  assert.equal(M.statusLabel('onay', 'de'), 'Freigegeben');
  const p = project([{ id: 'l1', bolum: 's1', kod: 'A', ad: 'A', miktar: 2, fiyat: 1.5 }]);
  const rows = M.projectToCsvRows(p, 'en');
  assert.equal(rows[0][1], 'Item');
  assert.deepEqual(rows[1].slice(0, 4), ['Elektrik', '1.1', 'A', 'A']);
  assert.equal(rows[1][14], '3');
});
