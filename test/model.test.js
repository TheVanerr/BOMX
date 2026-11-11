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
  assert.equal(M.formatQty(2), '2');
  assert.equal(M.formatQty(2.5), '2,5');
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
  const c = M.normalizeComponent({ kod: ' PE01 ', ad: 'Pompa  Motoru', fiyat: '1.250,00', paraBirimi: 'EUR', favori: 'evet', teslimSuresi: '14' });
  assert.equal(c.kod, 'PE01');
  assert.equal(c.ad, 'Pompa Motoru');
  assert.equal('fiyat' in c, false, 'eski kayıttaki fiyat okunurken düşer');
  assert.equal('paraBirimi' in c, false);
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

test('kalem kütüphaneden alınır; açıklamaya iç notlar girmez, fiyat taşınmaz', () => {
  const line = M.lineFromComponent({ id: 'c1', kod: 'PE01', ad: 'Pompa', ureticiKodu: 'XZS50', birim: 'Adet', fiyat: 100, paraBirimi: 'EUR',
    aciklama: 'Paslanmaz pompa, 2,2 kW\nNot: etiketten doğrulanmalı\nKullanım: KBN 1650\nKomple: 07 1\nKaynak (web): ornek.com' }, 3, 's1');
  assert.equal(line.komponentId, 'c1');
  assert.equal(line.kod, 'PE01');
  assert.equal(line.ureticiKodu, 'XZS50');
  assert.equal(line.aciklama, 'Paslanmaz pompa, 2,2 kW');
  assert.equal(M.normalizeLine(Object.assign({}, line, { fiyat: 5, iskonto: 10 })).fiyat, undefined);
  assert.deepEqual(M.libraryDiff(line, M.normalizeComponent({ id: 'c1', kod: 'PE01', ad: 'Pompa', ureticiKodu: 'XZS50', aciklama: 'Paslanmaz pompa, 2,2 kW\nKullanım: başka makine' })), [], 'iç not değişince kalem farklı sayılmaz');
  const changed = M.normalizeComponent({ id: 'c1', kod: 'PE01', ad: 'Pompa', ureticiKodu: 'XZS50-X', aciklama: 'Yeni açıklama' });
  assert.deepEqual(M.libraryDiff(line, changed), ['ureticiKodu', 'aciklama']);
  assert.equal(M.refreshFromLibrary(line, changed).aciklama, 'Yeni açıklama');
});

test('malzeme listesinin sütunları sabittir: fotoğraf, stok kodu, tanım, model kodu, adet, açıklama', () => {
  assert.deepEqual(M.COLUMNS.map((c) => c.key), ['foto', 'kod', 'ad', 'ureticiKodu', 'miktar', 'aciklama']);
  assert.deepEqual(M.COLUMNS.map((c) => M.docText('tr')[c.doc]), ['Fotoğraf', 'Stok Kodu', 'Tanım', 'Model Kodu', 'Adet', 'Açıklama']);
  assert.equal(M.qtyText({ miktar: 2, birim: 'Adet' }), '2');
  assert.equal(M.qtyText({ miktar: 12.5, birim: 'm' }), '12,5 m');
});

test('açıklama belgenin dilinde gelir; o dilde yoksa Türkçesi yazar', () => {
  const c = M.normalizeComponent({ id: 'c1', kod: 'A', ad: 'A', aciklama: 'Pompa\nİlgili kod: 10 1\nAlternatif: X', aciklamaEn: 'Pump', aciklamaDe: '' });
  const line = M.lineFromComponent(c, 1, 's1');
  assert.equal(line.aciklama, 'Pompa', 'iç notlar girmez');
  assert.equal(M.lineDescription(line, 'tr'), 'Pompa');
  assert.equal(M.lineDescription(line, 'en'), 'Pump');
  assert.equal(M.lineDescription(line, 'de'), 'Pompa');
  assert.deepEqual(M.libraryDiff(line, Object.assign({}, c, { aciklamaDe: 'Pumpe' })), [], 'kalemde boş çeviri fark değildir');
  assert.deepEqual(M.libraryDiff(Object.assign({}, line, { aciklamaEn: 'Eski' }), c), ['aciklamaEn'], 'dolu çeviri farkı gösterilir');
  const p = project([Object.assign({}, line, { id: 'l1', bolum: 's1' })]);
  assert.equal(M.projectToCsvRows(p, 'en')[1][5], 'Pump');
  assert.equal(M.docSafe('−40…+120 °C, ≤100 V, 10 kΩ'), '-40…+120 °C, <=100 V, 10 kohm', 'PDF yazı tipinde olmayan işaretler');
  assert.equal(M.revisionNote({ rev: '00', aciklama: 'İlk yayın' }, M.docText('en')), 'First issue');
  assert.equal(M.revisionNote({ rev: '00', aciklama: 'Müşteri onayı' }, M.docText('en')), 'Müşteri onayı');
  // Çeviri kütüphaneye sonradan girildiyse eski kalem de kütüphanedeki çeviriyle yazar; boş çeviri fark sayılmaz
  const old = M.normalizeLine({ komponentId: 'c2', kod: 'B', ad: 'B', aciklama: 'Vana' });
  const lib2 = M.normalizeComponent({ id: 'c2', kod: 'B', ad: 'B', aciklama: 'Vana', aciklamaEn: 'Valve' });
  assert.equal(M.lineDescription(old, 'en', lib2), 'Valve');
  assert.equal(M.lineDescription(old, 'de', lib2), 'Vana');
  assert.deepEqual(M.libraryDiff(old, lib2), []);
  assert.equal(M.hasTranslation(old, 'en', lib2), true);
  assert.equal(M.hasTranslation(old, 'de', lib2), false);
  const pp = project([Object.assign({}, old, { id: 'l1', bolum: 's1', miktar: 1 })], { dil: 'de' });
  assert.match(M.checkProject(pp, new Map([['c2', lib2]])).map((c) => c.text).join(' | '), /Almanca açıklaması olmayan 1 kalem/);
  assert.equal(M.projectToCsvRows(Object.assign({}, pp, { dil: 'en' }), 'en', new Map([['c2', lib2]]))[1][5], 'Valve');
  assert.equal(M.normalizeOutput({}).kapak, true, 'kapak varsayılan olarak açık');
  assert.equal(M.normalizeOutput({ kapak: false }).kapak, false);
  for (const [lang] of M.DOC_LANGS) for (const key of ['docType', 'docTypeValue', 'pages', 'title']) assert.ok(M.docText(lang)[key], `${lang}.${key}`);
});

test('özet kalem sayısını ve adet birimindeki toplamı verir', () => {
  const p = project([
    { id: 'l1', bolum: 's1', kod: 'A', ad: 'A', miktar: 2, kategori: 'Pompa' },
    { id: 'l2', bolum: 's1', kod: 'B', ad: 'B', miktar: 1, kategori: 'Pompa' },
    { id: 'l3', bolum: 's2', kod: 'C', ad: 'C', miktar: 4, birim: 'm', kategori: 'Kablo' }
  ]);
  assert.deepEqual(M.projectTotals(p), { count: 3, pieces: 3 });
  assert.deepEqual(M.categoryBreakdown(p).map((r) => [r.kategori, r.count, r.pieces]), [['Pompa', 2, 3], ['Kablo', 1, 0]]);
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
    { id: 'l1', bolum: 's1', komponentId: 'c1', kod: 'A', ad: 'A', miktar: 2, tedarikci: 'Festo', referans: 'V31' },
    { id: 'l2', bolum: 's2', komponentId: 'c1', kod: 'A', ad: 'A', miktar: 3, tedarikci: 'Festo', referans: 'V32, V31' },
    { id: 'l3', bolum: 's2', kod: 'B', ad: 'B', miktar: 1 }
  ]);
  const groups = M.purchaseList(p);
  assert.deepEqual(groups.map((g) => g.tedarikci), ['Festo', '']);
  assert.equal(groups[0].items.length, 1);
  assert.equal(groups[0].items[0].miktar, 5);
  assert.equal(groups[0].items[0].referans, 'V31, V32');
  assert.deepEqual(groups[0].items[0].bolumler, ['Elektrik', 'Pnömatik']);
});

/* ─── Kontrol ───────────────────────────────────────────── */

test('kontrol eksik adedi, kütüphane farkını, tekrarı ve referansı bulur; fiyat sormaz', () => {
  const library = lib([
    { id: 'c1', kod: 'PE01', ad: 'Pompa yeni' },
    { id: 'c2', kod: 'V31', ad: 'Vana', pasif: true },
    { id: 'c3', kod: 'LS01', ad: 'Seviye' }
  ]);
  const p = project([
    { id: 'l1', bolum: 's1', komponentId: 'c1', kod: 'PE01', ad: 'Pompa', miktar: 2, referans: 'PE01' },
    { id: 'l2', bolum: 's1', komponentId: 'c1', kod: 'PE01', ad: 'Pompa', miktar: 1, referans: 'PE01' },
    { id: 'l3', bolum: 's1', komponentId: 'c2', kod: 'V31', ad: 'Vana', miktar: 0 },
    { id: 'l4', bolum: 's1', komponentId: 'silindi', kod: 'X9', ad: 'Eski', miktar: 1 },
    { id: 'l5', bolum: 's1', kod: 'LS01', ad: 'Seviye', miktar: 1 },
    { id: 'l6', bolum: 's1', kod: 'İŞÇİLİK', ad: 'Montaj', miktar: 1 }
  ]);
  const checks = M.checkProject(p, library);
  const find = (re) => checks.find((c) => re.test(c.text));
  assert.equal(find(/Adedi girilmemiş/).level, 'error');
  assert.deepEqual(find(/Adedi girilmemiş/).lines, ['l3']);
  assert.equal(find(/Adedi girilmemiş/).fix.kind, 'removeZero');
  assert.deepEqual(find(/Kütüphaneden farklı tanım/).lines, ['l1', 'l2']);
  assert.equal(find(/Kütüphaneden farklı tanım/).fix.kind, 'refresh');
  assert.ok(find(/Pasif/));
  assert.deepEqual(find(/silinmiş/).lines, ['l4']);
  assert.deepEqual(find(/bağlanabilir/).lines, ['l5']);
  assert.deepEqual(find(/serbest/).lines, ['l6']);
  assert.equal(find(/tekrar eden/).fix.kind, 'merge');
  assert.ok(find(/PE01 referansı 2 kalemde/));
  assert.ok(find(/"Pnömatik" bölümü boş/));
  assert.equal(find(/fiyat|kur\b/i), undefined);
});

test('boş liste ve revizyon açıklaması kontrolü', () => {
  const empty = project([]);
  assert.match(M.checkProject(empty, new Map())[0].text, /boş/);
  const p = project([{ id: 'l', bolum: 's1', kod: 'A', ad: 'A', miktar: 1 }], { rev: '01', revizyonlar: [{ rev: '00', aciklama: 'İlk yayın' }, { rev: '01' }] });
  assert.ok(M.checkProject(p, new Map()).some((c) => /Rev\. 01 açıklaması/.test(c.text)));
});

/* ─── Revizyon farkı ────────────────────────────────────── */

test('revizyon farkı komponent bazında eklenen, çıkarılan ve adedi değişeni bulur', () => {
  const old = [
    { kod: 'A', ad: 'A', komponentId: 'a', miktar: 2 },
    { kod: 'B', ad: 'B', komponentId: 'b', miktar: 1 },
    { kod: 'C', ad: 'C', komponentId: 'c', miktar: 1 }
  ].map(M.normalizeLine);
  const now = [
    { kod: 'A', ad: 'A', komponentId: 'a', miktar: 1 },
    { kod: 'A', ad: 'A', komponentId: 'a', miktar: 2 },
    { kod: 'B', ad: 'B', komponentId: 'b', miktar: 1 },
    { kod: 'D', ad: 'D', miktar: 1 }
  ].map(M.normalizeLine);
  const d = M.diffBoms(old, now);
  assert.deepEqual(d.added.map((x) => x.kod), ['D']);
  assert.deepEqual(d.removed.map((x) => x.kod), ['C']);
  assert.deepEqual(d.changed.map((x) => x.kod), ['A']);
  assert.equal(d.changed[0].yeni.miktar, 3);
  assert.equal(d.same, 1);
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
  let s = M.setSetting(M.normalizeSettings({ zaman: { birimler: '2026-06-01T00:00:00.000Z' } }), 'birimler', ['Kutu'], '2026-02-01T00:00:00.000Z');
  assert.ok(s.zaman.birimler > '2026-06-01T00:00:00.000Z');
  s = M.setSetting(s, 'birimler', ['Kutu'], '2026-07-01T00:00:00.000Z');
  assert.ok(s.zaman.birimler < '2026-07-01T00:00:00.000Z', 'aynı değer damgayı değiştirmez');
});

test('ayarlar anahtar başına birleşir', () => {
  let a = M.normalizeSettings({});
  let b = M.normalizeSettings({});
  a = M.setSetting(a, 'kategoriler', ['Pompa'], '2026-01-02T00:00:00.000Z');
  b = M.setSetting(b, 'birimler', ['Adet', 'Kutu'], '2026-01-03T00:00:00.000Z');
  const merged = M.mergeSettings(a, b);
  assert.deepEqual(merged.kategoriler, ['Pompa']);
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
  assert.deepEqual(M.guessColumns(['Stok Kodu', 'Malzeme Adı', 'Marka', 'Birim Fiyatı', 'Döviz', 'Açıklama']), ['kod', 'ad', 'uretici', '', '', 'aciklama'], 'fiyat ve döviz sütunu alınmaz');
  const ppx = M.tableToComponents(M.parseCsv('KOD;AÇIKLAMA\nPE01;Ön Yıkama Pompa Motoru\nV07;Hava; ana valf'));
  assert.equal(ppx.hasHeader, true);
  assert.deepEqual(ppx.columns, ['kod', 'ad']);
  assert.deepEqual(ppx.items.map((i) => i.fields), [{ kod: 'PE01', ad: 'Ön Yıkama Pompa Motoru' }, { kod: 'V07', ad: 'Hava; ana valf' }]);
  const noHeader = M.tableToComponents([['A1', 'Civata M8'], ['A2', 'Somun M8']]);
  assert.equal(noHeader.hasHeader, false);
  assert.equal(noHeader.items.length, 2);
});

test('aktarma planı yeni, güncellenecek, değişmeyen ve hatalı satırları ayırır', () => {
  const library = [M.normalizeComponent({ id: 'c1', kod: 'PE01', ad: 'Pompa', kategori: 'Eski', uretici: 'Grundfos' })];
  const items = [
    { row: 2, fields: { kod: 'pe01', ad: 'Pompa', kategori: 'Yeni', uretici: '' } },
    { row: 3, fields: { kod: 'V31', ad: 'Vana' } },
    { row: 4, fields: { kod: 'V31', ad: 'Vana tekrar' } },
    { row: 5, fields: { ad: 'Kodsuz' } },
    { row: 6, fields: { kod: 'Y1' } }
  ];
  const merge = M.planImport(items, library, 'merge');
  assert.equal(merge.add.length, 1);
  assert.equal(merge.add[0].kod, 'V31');
  assert.equal(merge.update.length, 1);
  assert.deepEqual(merge.update[0].changes, ['kategori']);
  assert.equal(merge.update[0].after.uretici, 'Grundfos', 'boş hücre var olanı silmez');
  assert.equal(merge.repeated, 1);
  assert.equal(merge.invalid.length, 2);
  const replace = M.planImport(items, library, 'replace');
  assert.deepEqual(replace.update[0].changes, ['kategori', 'uretici']);
  const add = M.planImport(items, library, 'add');
  assert.equal(add.update.length, 0);
  assert.equal(add.same, 1);
});

test('yalnız çeviri kipi var olan kodun EN / DE açıklamasını yazar, yeni kod eklemez, başka alana dokunmaz', () => {
  const library = [M.normalizeComponent({ id: 'c1', kod: 'PE01', ad: 'Pompa (düzeltildi)', aciklama: 'Grundfos pompa', aciklamaDe: 'Pumpe (eigene)' })];
  const items = [
    { row: 1, fields: { kod: 'PE01', ad: 'Pompa', kategori: 'Motor', aciklama: 'Eski', aciklamaEn: 'Grundfos pump', aciklamaDe: '' } },
    { row: 2, fields: { kod: 'AYIKLANAN', ad: 'Gereksiz kod', aciklamaEn: 'Unused' } },
    { row: 3, fields: { kod: 'PE01', ad: 'Pompa', aciklamaEn: 'Tekrar' } }
  ];
  const plan = M.planImport(items, library, 'ceviri');
  assert.equal(plan.add.length, 0, 'kütüphanede olmayan kod eklenmez');
  assert.equal(plan.absent, 1);
  assert.equal(plan.rows.find((r) => r.row === 2).status, 'absent');
  assert.equal(plan.repeated, 1);
  assert.deepEqual(plan.update[0].changes, ['aciklamaEn']);
  const after = plan.update[0].after;
  assert.equal(after.ad, 'Pompa (düzeltildi)', 'tanım dosyadakiyle ezilmez');
  assert.equal(after.aciklama, 'Grundfos pompa');
  assert.equal(after.kategori, '');
  assert.equal(after.aciklamaDe, 'Pumpe (eigene)', 'dosyada boş çeviri var olanı silmez');
  assert.equal(M.planImport([items[0]], [Object.assign({}, library[0], { aciklamaEn: 'Grundfos pump' })], 'ceviri').same, 1);
});

test('kütüphane CSV olarak verilip geri okunduğunda aynı kalır', () => {
  const list = [M.normalizeComponent({ kod: 'PE01', ad: 'Pompa; 2,2 kW', ureticiKodu: 'XZS50-32', favori: true, aciklama: 'iki\nsatır' })];
  const parsed = M.tableToComponents(M.parseCsv(M.toCsv(M.libraryToRows(list))));
  const plan = M.planImport(parsed.items, [], 'merge');
  const back = plan.add[0];
  for (const key of ['kod', 'ad', 'ureticiKodu', 'favori', 'aciklama']) assert.deepEqual(back[key], list[0][key], key);
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

test('eski dosyalardaki fiyat, para birimi ve kur okunurken düşer', () => {
  const line = M.normalizeLine({ kod: 'A', ad: 'A', fiyat: 10, paraBirimi: 'EUR', iskonto: 5 });
  for (const key of ['fiyat', 'paraBirimi', 'iskonto']) assert.equal(key in line, false, key);
  const p = M.normalizeProject({ paraBirimi: 'EUR', kurlar: { EUR: 36 }, kurTarihi: '2026-01-01', cikti: { fiyat: true, araToplam: true } });
  for (const key of ['paraBirimi', 'kurlar', 'kurTarihi']) assert.equal(key in p, false, key);
  assert.equal('fiyat' in p.cikti, false);
  const s = M.normalizeSettings({ kurlar: { EUR: 36 }, paraBirimleri: ['TRY'], raporParaBirimi: 'EUR' });
  for (const key of ['kurlar', 'paraBirimleri', 'raporParaBirimi', 'varsayilanParaBirimi', 'kurTarihi']) assert.equal(key in s, false, key);
});

test('"değiştir" kipinde dosyadaki boş hücre kütüphanedeki değeri temizler; "güncelle" kipinde temizlemez', () => {
  const library = [M.normalizeComponent({ id: 'c1', kod: 'PE01', ad: 'Pompa', uretici: 'Grundfos', kategori: 'Eski' })];
  const table = M.tableToComponents(M.parseCsv('Kod;Ad;Marka;Kategori\nPE01;Pompa;;Yeni'));
  assert.equal(table.items[0].fields.uretici, '');
  const replace = M.planImport(table.items, library, 'replace');
  assert.equal(replace.update[0].after.uretici, '');
  assert.equal(replace.update[0].after.kategori, 'Yeni');
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
  const library = lib([{ id: 'c1', kod: 'PE01', ad: 'Pompa yeni' }]);
  const t = M.templateFromLines('Pompa seti', [
    M.normalizeLine({ komponentId: 'c1', kod: 'PE01', ad: 'Pompa eski', miktar: 2, referans: 'PE01, PE02' }),
    M.normalizeLine({ kod: 'MONTAJ', ad: 'Montaj', miktar: 1 })
  ]);
  const lines = M.linesFromTemplate(t, library, 's9');
  assert.equal(lines[0].ad, 'Pompa yeni');
  assert.equal(lines[0].miktar, 2);
  assert.equal(lines[0].referans, 'PE01, PE02');
  assert.equal(lines[0].bolum, 's9');
  assert.equal(lines[1].komponentId, null);
  assert.equal(lines[1].ad, 'Montaj');
  assert.notEqual(lines[0].id, t.kalemler[0].id, 'her eklemede yeni kimlik');
});

test('belge yazıları üç dilde, birimler çevrilir', () => {
  assert.equal(M.docText('en').title, 'BILL OF MATERIALS');
  assert.equal(M.docText('xx').title, 'MALZEME LİSTESİ');
  assert.equal(M.unitText('Adet', 'en'), 'pcs');
  assert.equal(M.unitText('Adet', 'de'), 'Stk.');
  assert.equal(M.unitText('Adet', 'tr'), 'Adet');
  assert.equal(M.statusLabel('onay', 'de'), 'Freigegeben');
  const p = project([{ id: 'l1', bolum: 's1', kod: 'A', ad: 'Tanım', ureticiKodu: 'M1', miktar: 2, aciklama: 'iki\nsatır' }, { id: 'l2', bolum: 's1', kod: 'K', ad: 'Kablo', miktar: 12.5, birim: 'm' }]);
  const rows = M.projectToCsvRows(p, 'en');
  assert.deepEqual(rows[0], ['Section', 'Stock Code', 'Definition', 'Model Code', 'Qty', 'Description']);
  assert.deepEqual(rows[1], ['Elektrik', 'A', 'Tanım', 'M1', '2', 'iki satır']);
  assert.equal(rows[2][4], '12,5 m');
});
