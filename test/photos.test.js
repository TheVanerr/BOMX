/* Komponent fotoğrafları ve fotoğraflı paket: fotoğraf parçaları (yazma, silme, iki cihazın değişikliğinin birleşmesi),
   paket biçimi (ortak fotoğraf havuzu), raporlardaki fotoğrafın komponente geçmesi ve ERP ürün ağacı (Excel / CSV) okuma. */

const test = require('node:test');
const assert = require('node:assert/strict');
const BomxDb = require('../ortak/bomx-db.js');
const M = require('../codes/model.js');
const R = require('../codes/reports.js');
const BomxStore = require('../codes/store.js');

// Sabit zamanlar (2026-01-…) "şimdi"den sonra olsun; silinme kayıtları süresi dolmuş sayılmasın
M.setClock(() => Date.parse('2025-12-31T00:00:00.000Z'));

const JPG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
const JPG2 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAg==';
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const bytes = (doc) => new TextEncoder().encode(JSON.stringify(doc));
const fresh = () => {
  const db = BomxDb.createDb({ local: BomxDb.memoryLocal(), merge: M.mergeFile });
  return { db, store: BomxStore.createStore(db) };
};

test('fotoğraf verisi yalnız küçük JPEG / PNG / WebP / GIF data URL olabilir; parça yolu kimliğin ilk hex harfidir', () => {
  assert.equal(M.isPhotoData(JPG), true);
  assert.equal(M.isPhotoData(PNG), true);
  assert.equal(M.isPhotoData('data:image/svg+xml;base64,PHN2Zz4='), false, 'SVG betik taşıyabilir, alınmaz');
  assert.equal(M.isPhotoData('https://ornek.com/a.jpg'), false);
  assert.equal(M.isPhotoData(`data:image/jpeg;base64,${'A'.repeat(700000)}`), false, 'çok büyük');
  assert.equal(M.isPhotoData(''), false);
  assert.equal(M.photoShardPath(M.shardOf('a1b2c3d4e5f6')), 'BOM/fotograflar/fa.json');
  assert.equal(M.isPhotoShardPath('BOM/fotograflar/f0.json'), true);
  assert.equal(M.isPhotoShardPath('BOM/kutuphane/k0.json'), false);
});

test('iki cihazın aynı fotoğraf parçasındaki değişiklikleri kayıt kayıt birleşir', () => {
  const mine = bytes({
    format: 'bomx-fotograflar',
    fotolar: [
      { id: 'a1', veri: JPG, zaman: '2026-01-02T00:00:00.000Z' },
      { id: 'a3', veri: PNG, zaman: '2026-01-04T00:00:00.000Z' }
    ],
    silinen: {}
  });
  const theirs = bytes({
    format: 'bomx-fotograflar',
    fotolar: [
      { id: 'a1', veri: JPG2, zaman: '2026-01-01T00:00:00.000Z' },
      { id: 'a2', veri: PNG, zaman: '2026-01-03T00:00:00.000Z' }
    ],
    silinen: { a3: '2026-01-05T00:00:00.000Z' }
  });
  const merged = M.parsePhotoShard(M.mergeFile('BOM/fotograflar/fa.json', mine, theirs));
  assert.deepEqual(merged.fotolar.map((p) => [p.id, p.veri]), [['a1', JPG], ['a2', PNG]], 'yeni olan kalır, öbür cihazın eklediği gelir');
  assert.equal(merged.silinen.a3, '2026-01-05T00:00:00.000Z', 'sonradan silinen silinmiş kalır');
  // Silmeden sonra yeniden eklenen fotoğraf kalır
  const again = bytes({ fotolar: [{ id: 'a3', veri: JPG, zaman: '2026-01-06T00:00:00.000Z' }], silinen: {} });
  const back = M.parsePhotoShard(M.mergePhotoShardBytes(M.mergeFile('BOM/fotograflar/fa.json', mine, theirs), again));
  assert.deepEqual(back.fotolar.map((p) => p.id), ['a1', 'a2', 'a3']);
  assert.equal(back.silinen.a3, undefined);
});

test('fotoğraf kimliğe göre parçaya yazılır, boş veri siler ve silinme zamanı kalır', async () => {
  const { db, store } = fresh();
  assert.equal(await store.savePhotos([{ id: 'a1b2c3d4e5f6', veri: JPG }, { id: 'b2c3d4e5f6a1', veri: PNG }]), 2);
  assert.deepEqual((await db.list()).map((r) => r.path).sort(), ['BOM/fotograflar/fa.json', 'BOM/fotograflar/fb.json']);
  let photos = await store.loadPhotos();
  assert.equal(photos.get('a1b2c3d4e5f6'), JPG);
  assert.equal(photos.get('b2c3d4e5f6a1'), PNG);
  assert.equal(await store.savePhotos([{ id: 'a1b2c3d4e5f6', veri: '' }]), 1);
  photos = await store.loadPhotos();
  assert.equal(photos.has('a1b2c3d4e5f6'), false);
  assert.equal(photos.size, 1);
  const shard = M.parsePhotoShard((await db.read('BOM/fotograflar/fa.json')).bytes);
  assert.deepEqual(shard.fotolar, []);
  assert.ok(shard.silinen.a1b2c3d4e5f6);
  // Bozuk parça diğer fotoğrafları engellemez
  await db.write('BOM/fotograflar/f5.json', new TextEncoder().encode('{bozuk'));
  assert.equal((await store.loadPhotos()).get('b2c3d4e5f6a1'), PNG);
});

test('iki cihazın aynı parçaya eklediği fotoğraflar GitHub üzerinden birleşir; silme de taşınır', async () => {
  const BomxGitHub = require('../ortak/bomx-github.js');
  const { createFakeGitHub } = require('./fake-github.js');
  const hub = createFakeGitHub();
  const device = () => {
    const db = BomxDb.createDb({
      local: BomxDb.memoryLocal(),
      remote: BomxGitHub.createRemote({ repo: hub.id, token: hub.token, fetchFn: hub.fetchFn }),
      now: () => { hub.clock.now += 1000; return hub.clock.now; },
      flushMs: 3600000,
      merge: M.mergeFile
    });
    return { db, store: BomxStore.createStore(db) };
  };
  const a = device();
  const b = device();
  await a.store.savePhotos([{ id: 'a1b2c3d4e5f6', veri: JPG }]);
  await b.store.savePhotos([{ id: 'a9b8c7d6e5f4', veri: PNG }]);
  await a.db.sync();
  const s = await b.db.sync();
  assert.equal(s.state, 'ok', s.error);
  await a.db.sync();
  for (const d of [a, b]) {
    const photos = await d.store.loadPhotos();
    assert.deepEqual([photos.get('a1b2c3d4e5f6'), photos.get('a9b8c7d6e5f4')], [JPG, PNG]);
    assert.equal((await d.db.list()).filter((r) => r.path.includes('.catisma-')).length, 0, 'çakışma kopyası oluşmaz');
  }
  await a.store.savePhotos([{ id: 'a9b8c7d6e5f4', veri: '' }]);
  await a.db.sync();
  await b.db.sync();
  assert.equal((await b.store.loadPhotos()).has('a9b8c7d6e5f4'), false);
});

test('paket: aynı fotoğraf havuzda bir kez durur, boş alan yazılmaz, tür ve kaynak taşınır', () => {
  const list = [
    { id: 'x1', kod: '10 1', ad: 'Pompa A', kategori: 'Pompa', tur: 'elektrik', neden: 'Pompa', kaynaklar: ['agac.html'], foto: JPG, fotoKaynagi: 'agac.html' },
    { id: 'x2', kod: '10 2', ad: 'Pompa B', kategori: 'Pompa', tur: 'elektrik', foto: JPG },
    { id: 'x3', kod: '10 3', ad: 'Kablo', teslimSuresi: 12, fiyat: 12.5, paraBirimi: 'EUR', foto: 'bozuk' }
  ];
  const doc = M.packageDocument(list, (c) => c.foto, { ad: 'Deneme' });
  assert.equal(doc.format, M.PACKAGE_FORMAT);
  assert.equal(doc.ad, 'Deneme');
  assert.deepEqual(Object.keys(doc.fotograflar), ['f1']);
  assert.equal(doc.fotograflar.f1, JPG);
  assert.deepEqual(doc.komponentler.map((c) => c.foto), ['f1', 'f1', undefined]);
  assert.equal(doc.komponentler[0].fotoKaynagi, 'agac.html');
  assert.equal('id' in doc.komponentler[0], false, 'kimlik taşınmaz');
  assert.equal('uretici' in doc.komponentler[0], false, 'boş alan yazılmaz');
  assert.equal(doc.komponentler[2].teslimSuresi, 12);
  assert.equal('fiyat' in doc.komponentler[2], false, 'pakete fiyat yazılmaz');
  assert.equal('paraBirimi' in doc.komponentler[2], false);

  const items = M.packageItems(JSON.parse(JSON.stringify(doc)));
  assert.deepEqual(items.map((it) => it.foto), [JPG, JPG, '']);
  assert.equal(items[0].fotoKaynagi, 'agac.html');
  assert.deepEqual(items[0].meta, { sinif: 'elektrik', neden: 'Pompa', kaynaklar: ['agac.html'], uyarilar: [] });
  assert.equal(items[2].meta, null);
  const plan = M.planImport(items.map((it) => ({ row: it.row, fields: it.fields })), [], 'add');
  assert.deepEqual(plan.add.map((c) => c.kod), ['10 1', '10 2', '10 3']);
});

test('paket okuma: doğrudan data URL, düz dizi; havuzda olmayan ya da geçersiz fotoğraf alınmaz', () => {
  assert.equal(M.packageItems({ komponentler: [{ kod: 'a', ad: 'b', foto: PNG }] })[0].foto, PNG);
  const bad = M.packageItems({ fotograflar: { f1: 'javascript:alert(1)' }, komponentler: [{ kod: 'a', ad: 'b', foto: 'f1' }, { kod: 'c', ad: 'd', foto: 'f9' }, { kod: 'e', ad: 'f', foto: 'toString' }] });
  assert.deepEqual(bad.map((it) => it.foto), ['', '', '']);
  assert.equal(M.packageItems([{ kod: 'a', ad: 'b' }, 'x', null]).length, 1);
  assert.equal(M.packageItems({ baska: [] }), null);
});

/* ─── Rapor fotoğrafları ─── */

const page = (script) => `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><script>\n${script}\n</script></body></html>`;

test('ürün ağacındaki fotoğraf komponente geçer; fotoğrafsız boy aynı ailenin fotoğrafını alır', () => {
  const data = {
    groups: { G: [{ m: 'G 1', items: [
      { c: '10 00001', n: 'KABLO RAKORU PG9 SİYAH', q: '1', p: 'photos/10 00001.jpg' },
      { c: '10 00002', n: 'KABLO RAKORU PG11 SİYAH', q: '1', p: '' },
      { c: '10 00003', n: 'POMPA LEO XZS 50-32-160/22', q: '1', p: 'photos/yok.jpg' }
    ] }] }
  };
  const html = page(`const DATA = ${JSON.stringify(data)};\nconst IMGS = ${JSON.stringify({ 'photos/10 00001.jpg': JPG })};`);
  const rep = R.readHtml(html, 'agac.html');
  assert.equal(rep.kind, 'agac');
  assert.equal(rep.photos['photos/10 00001.jpg'], JPG);
  const items = new Map(R.importItems([rep], {}).map((it) => [it.fields.kod, it]));
  assert.equal(items.get('10 00001').foto, JPG);
  assert.equal(items.get('10 00001').fotoKaynak, 'agac.html');
  assert.equal(items.get('10 00002').foto, JPG, 'aynı aile (rakamlar dışında aynı ad, aynı kategori)');
  assert.equal(items.get('10 00002').fotoKaynak, '10 00001 fotoğrafı');
  assert.equal(items.get('10 00003').foto, '', 'raporda olmayan fotoğraf yolu');
});

/* ─── ERP ürün ağacı (Excel / CSV) ─── */

const MULTI = [
  ['Seviye', 'Kaynak Kodu', 'Kaynak Adı', 'Tip', 'Miktar', 'Birim'],
  [0, '07 18442', 'KBN 2B 1650 PARÇA YIKAMA MAKİNESİ KSYS', 'SU', 1, 'AD'],
  [1, '07 18452', 'KBN 2B 1650 PRO KSY PNÖMATİK KOMPLESİ', 'AS', 1, 'AD'],
  [2, '10 07492', 'ÇİFT TARAFLI P.VALF 24VDC 4V220-08 1/4" 5-2', 'HM', 1, 'AD'],
  [2, '10 00319', 'KABLO RAKORU ORG03-PG11 ETANJ TİP GRİ', 'HM', 8, 'AD'],
  [2, '10 00111', 'CİVATA IMBUS M8*20 INOX', 'HM', 8, 'AD'],
  [1, 'OP-010', 'MONTAJ OPERASYONU', 'OP', 1, 'AD'],
  [1, '10 03121', 'POMPA LEO XZS 50-32-160/22 380V/50HZ', 'HM', 1, 'AD'],
  [1, 'IS-01', 'MONTAJ İŞÇİLİĞİ', 'YU', 2, 'SAAT']
];

test('çok seviyeli ERP ürün ağacı: kök makine, alt kırılım; operasyon ve süre satırları atlanır', () => {
  const t = R.readTreeTable(MULTI, 'KSY ÇOK SEVİYELİ ÜRÜN AĞACI.xlsm');
  assert.equal(t.kind, 'agac');
  assert.equal(t.title, 'KBN 2B 1650 KSYS', 'makine adından "parça yıkama makinesi" çıkar');
  assert.match(t.summary, /çok seviyeli/);
  assert.deepEqual(t.data.subs['07 18452'].map((s) => s.kod), ['10 07492', '10 00319', '10 00111']);
  const items = new Map(R.importItems([t], {}).map((it) => [it.fields.kod, it]));
  assert.equal(items.has('OP-010'), false);
  assert.equal(items.has('IS-01'), false);
  assert.equal(items.get('07 18452').meta.sinif, 'komple', 'içinde elektrikli valf var');
  assert.deepEqual([items.get('10 00319').meta.sinif, items.get('10 00319').fields.kategori], ['elektrik', 'Kablo Aksesuarı']);
  assert.equal(items.get('10 00111').meta.sinif, 'diger');
  assert.deepEqual([items.get('10 03121').meta.sinif, items.get('10 03121').fields.kategori], ['elektrik', 'Pompa']);
  assert.match(items.get('10 03121').fields.aciklama, /KBN 2B 1650 KSYS/, 'kullanıldığı makine açıklamada');
});

test('tek seviyeli ürün ağacı dosya adıyla anılır; ürün ağacı olmayan tablo null döner', () => {
  const rows = [['Kaynak Kodu', 'Kaynak Adı', 'Miktar', 'Birim'], ['10 03121', 'POMPA LEO XZS 50-32-160/22 380V/50HZ', 1, 'AD'],
    ['10 00212', 'KABLO 2*0,75 TTR K.RENGİ+MAVİ', 10, 'MT'], ['10 00111', 'CİVATA IMBUS M8*20 INOX', 8, 'AD']];
  const t = R.readTreeTable(rows, 'KSY ÇOK SEVİYELİ ÜRÜN AĞACI.xlsm');
  assert.equal(t.title, 'KSY ÜRÜN AĞACI');
  assert.match(t.summary, /tek seviyeli/);
  assert.equal(R.readTreeTable([['Kod', 'Ad'], ['a', 'b']], 'liste.csv'), null);
});

test('elektrik sınıflandırması: bağlantı elemanı pompa değildir, sac parça komple değildir, gövde komplesi elektrikli komple değildir', () => {
  const data = {
    groups: { G: [{ m: 'G 1', items: [
      { c: '10 20001', n: 'POMPA BAĞLANTI ELEMANLARI', q: '1' },
      { c: '10 20002', n: 'KBN 2B KABLO KANAL BAĞLANTI NO.2 SAC', q: '1' },
      { c: '10 20003', n: 'KABLO KANALI 100*60MM PLASTİK GRİ DELİKLİ', q: '1' },
      { c: '10 20004', n: 'KUMANDA KABLOSU 16*0,75MM LIYCY', q: '1' },
      { c: '07 20005', n: 'GÖVDE KOMPLESİ', q: '1' }
    ] }] },
    subs: { '07 20005': [{ c: '10 20006', n: 'SENSÖR M18 PNP' }, { c: '10 20007', n: 'GÖVDE SACI' }] }
  };
  const items = new Map(R.importItems([R.readHtml(page(`const DATA = ${JSON.stringify(data)};`), 'x.html')], {}).map((it) => [it.fields.kod, it]));
  const cls = (kod) => [items.get(kod).meta.sinif, items.get(kod).fields.kategori];
  assert.equal(cls('10 20001')[0], 'diger');
  assert.equal(cls('10 20002')[0], 'diger');
  assert.deepEqual(cls('10 20003'), ['elektrik', 'Kablo Aksesuarı']);
  assert.deepEqual(cls('10 20004'), ['elektrik', 'Kablo']);
  assert.equal(cls('07 20005')[0], 'diger');
  assert.equal(cls('10 20006')[0], 'elektrik');
});
