/* Veri katmanı: kütüphane parçaları, projeler, ad değiştirme, revizyon anlık görüntüleri, şablonlar, ayarlar. */

const test = require('node:test');
const assert = require('node:assert/strict');
const BomxDb = require('../ortak/bomx-db.js');
const M = require('../codes/model.js');
const BomxStore = require('../codes/store.js');

const fresh = () => {
  const db = BomxDb.createDb({ local: BomxDb.memoryLocal(), merge: M.mergeFile });
  return { db, store: BomxStore.createStore(db) };
};
const paths = async (db) => (await db.list()).map((r) => r.path).sort();

test('kütüphane kimliğe göre parçalara yazılır, silinen kimlik parçada kalır', async () => {
  const { db, store } = fresh();
  assert.equal(await store.isEmpty(), true);
  const saved = await store.saveComponents([
    { id: '0aaaaaaaaaaa', kod: 'PE01', ad: 'Pompa' },
    { id: 'faaaaaaaaaaa', kod: 'V31', ad: 'Vana' },
    { id: '0bbbbbbbbbbb', kod: 'LS01', ad: 'Seviye' }
  ]);
  assert.equal(saved.length, 3);
  assert.ok(saved.every((c) => c.zaman));
  assert.deepEqual(await paths(db), ['BOM/kutuphane/k0.json', 'BOM/kutuphane/kf.json']);
  assert.equal(await store.isEmpty(), false);
  assert.deepEqual((await store.loadLibrary()).components.map((c) => c.kod), ['LS01', 'PE01', 'V31']);
  assert.equal(await store.deleteComponents(['0aaaaaaaaaaa']), 1);
  const shard = M.parseShard((await db.read('BOM/kutuphane/k0.json')).bytes);
  assert.deepEqual(shard.komponentler.map((c) => c.kod), ['LS01']);
  assert.ok(shard.silinen['0aaaaaaaaaaa']);
  // Bozuk parça diğerlerini engellemez
  await db.write('BOM/kutuphane/k5.json', new TextEncoder().encode('{bozuk'));
  const lib = await store.loadLibrary();
  assert.deepEqual(lib.components.map((c) => c.kod), ['LS01', 'V31']);
  assert.deepEqual(lib.errors, ['BOM/kutuphane/k5.json']);
});

test('aynı parçaya üst üste binen kütüphane yazımları birbirini silmez (sırayla yazılır)', async () => {
  const { store } = fresh();
  await store.saveComponents([{ id: '0aaaaaaaaaaa', kod: 'A', ad: 'A' }, { id: '0bbbbbbbbbbb', kod: 'B', ad: 'B' }]);
  // Beklemeden başlatılan silme ve kayıt aynı k0 parçasını değiştirir
  await Promise.all([
    store.deleteComponents(['0aaaaaaaaaaa']),
    store.saveComponents([{ id: '0bbbbbbbbbbb', kod: 'B', ad: 'B', favori: true }]),
    store.saveComponents([{ id: '0ccccccccccc', kod: 'C', ad: 'C' }])
  ]);
  const lib = (await store.loadLibrary()).components;
  assert.deepEqual(lib.map((c) => `${c.kod}${c.favori ? '★' : ''}`), ['B★', 'C'], 'silinen geri gelmez, iki kayıt da kalır');
});

test('proje açılır, kaydedilir, listelenir; aynı ad iki kez açılamaz', async () => {
  const { store } = fresh();
  const settings = M.normalizeSettings({ varsayilanBolumler: ['Elektrik', 'Mekanik'] });
  const p = await store.createProject({ seriNo: '0626051', musteri: 'DÜNYA', model: 'ULT M200 3B' }, settings);
  assert.equal(p.id, '0626051-DÜNYA-ULT M200 3B');
  assert.deepEqual(p.bolumler.map((s) => s.ad), ['Elektrik', 'Mekanik']);
  assert.equal(p.rev, '00');
  assert.equal(p.revizyonlar[0].aciklama, 'İlk yayın');
  assert.equal(p.hazirlayan, 'Fatih GÜRAL');
  await assert.rejects(() => store.createProject({ seriNo: '0626051', musteri: 'dünya', model: 'ult m200 3b' }, settings), /zaten var/);
  await assert.rejects(() => store.createProject({ seriNo: '', musteri: 'A', model: 'B' }, settings), /gerekli/);

  const next = M.clone(p);
  next.kalemler.push(M.lineFromComponent({ id: 'c1', kod: 'PE01', ad: 'Pompa' }, 2, p.bolumler[0].id));
  M.stampChanges(p, next);
  await store.saveProject(next);
  const read = await store.readProject(p.id);
  assert.equal(read.kalemler.length, 1);
  const { projects } = await store.listProjects();
  assert.equal(projects.length, 1);
  assert.equal(projects[0].kalemSayisi, 1);
  assert.deepEqual(projects[0].totals, { count: 1, pieces: 2 });
  assert.deepEqual(projects[0].komponentler, ['c1']);
  assert.equal(await store.readProject('yok'), null);
});

test('proje kaydı veritabanındaki hâlle birleşir: ekranın görmediği (eşitlemeden gelen) kalem ezilmez', async () => {
  const { store } = fresh();
  const p = await store.createProject({ seriNo: '1', musteri: 'A', model: 'M' }, {});
  const screen = M.clone(p); // düzenleyicinin bellekteki hâli
  // Eşitleme başka cihazın kalemini veritabanına getirdi
  const remote = M.clone(p);
  remote.kalemler.push(M.lineFromComponent({ id: 'c9', kod: 'L', ad: 'Uzak kalem' }, 1, p.bolumler[0].id));
  M.stampChanges(p, remote);
  await store.saveProject(remote);
  // Ekran henüz bilmeden kendi değişikliğini kaydeder
  const mine = M.clone(screen);
  mine.notlar = 'ekrandan not';
  M.stampChanges(screen, mine);
  const res = await store.saveProject(mine);
  const read = await store.readProject(p.id);
  assert.deepEqual(read.kalemler.map((l) => l.kod), ['L']);
  assert.equal(read.notlar, 'ekrandan not');
  assert.deepEqual(res.project.kalemler.map((l) => l.kod), ['L'], 'kayıt birleşmiş hâli döndürür');
});

test('ayar kaydı veritabanındaki hâlle anahtar anahtar birleşir', async () => {
  const { store } = fresh();
  const base = await store.readSettings();
  await store.saveSettings(M.setSetting(base, 'birimler', ['Adet', 'Kutu'], '2026-11-10T10:00:00.000Z'));
  const written = await store.saveSettings(M.setSetting(base, 'kategoriler', ['Pompa'], '2026-11-10T10:00:01.000Z'));
  assert.deepEqual(written.birimler, ['Adet', 'Kutu']);
  assert.deepEqual(written.kategoriler, ['Pompa']);
  assert.deepEqual((await store.readSettings()).birimler, ['Adet', 'Kutu']);
});

test('kopyadan başlayan proje bölüm ve kalemleri yeni kimlikle alır', async () => {
  const { store } = fresh();
  const src = await store.createProject({ seriNo: '1', musteri: 'A', model: 'M' }, {});
  src.kalemler.push(M.lineFromComponent({ id: 'c1', kod: 'X', ad: 'X' }, 3, src.bolumler[0].id));
  await store.saveProject(src);
  const copy = await store.createProject({ seriNo: '2', musteri: 'A', model: 'M' }, {}, await store.readProject(src.id));
  assert.equal(copy.kalemler.length, 1);
  assert.notEqual(copy.kalemler[0].id, src.kalemler[0].id);
  assert.notEqual(copy.bolumler[0].id, src.bolumler[0].id);
  assert.equal(copy.kalemler[0].bolum, copy.bolumler[0].id);
  assert.equal(copy.kalemler[0].miktar, 3);
});

test('proje adı değişince revizyon dosyalarıyla birlikte taşınır', async () => {
  const { db, store } = fresh();
  const p = await store.createProject({ seriNo: '0326067', musteri: 'MİTAŞ', model: 'KBN 2B 1650' }, {});
  await store.saveRevision(p.id, p);
  const renamed = Object.assign(M.clone(p), { model: 'KBN 2B 1500' });
  const id = await store.renameProject(p.id, renamed);
  assert.equal(id, '0326067-MİTAŞ-KBN 2B 1500');
  assert.deepEqual(await paths(db), [
    'BOM/projeler/0326067-MİTAŞ-KBN 2B 1500/proje.json',
    'BOM/projeler/0326067-MİTAŞ-KBN 2B 1500/revizyon/00.json'
  ]);
  assert.equal((await store.readProject(id)).model, 'KBN 2B 1500');
  const other = await store.createProject({ seriNo: '9', musteri: 'B', model: 'C' }, {});
  await assert.rejects(() => store.renameProject(other.id, Object.assign(M.clone(other), { seriNo: '0326067', musteri: 'MİTAŞ', model: 'KBN 2B 1500' })), /zaten var/);
  assert.equal(await store.deleteProject(id), 2);
  assert.equal(await store.readProject(id), null);
});

test('revizyon anlık görüntüsü yazılır, okunur, sıralanır', async () => {
  const { store } = fresh();
  const p = await store.createProject({ seriNo: '1', musteri: 'A', model: 'M' }, {});
  p.kalemler.push(M.lineFromComponent({ id: 'c1', kod: 'X', ad: 'X' }, 3, p.bolumler[0].id));
  await store.saveRevision(p.id, p);
  const r1 = Object.assign(M.clone(p), { rev: '01' });
  r1.kalemler[0].miktar = 5;
  await store.saveRevision(p.id, r1);
  await store.saveRevision(p.id, Object.assign(M.clone(p), { rev: '10' }));
  assert.deepEqual(await store.listRevisions(p.id), ['00', '01', '10']);
  const snap = await store.readRevision(p.id, '00');
  assert.equal(snap.kalemler[0].miktar, 3);
  const diff = M.diffBoms(snap.kalemler, (await store.readRevision(p.id, '01')).kalemler);
  assert.equal(diff.changed.length, 1);
});

test('şablonlar ve ayarlar kaydedilir, çakışma kopyaları listelenir', async () => {
  const { db, store } = fresh();
  const t = await store.saveTemplate(M.templateFromLines('Pompa seti', [M.normalizeLine({ kod: 'PE01', ad: 'Pompa', miktar: 2 })]));
  assert.equal((await store.listTemplates()).templates[0].ad, 'Pompa seti');
  await store.deleteTemplate(t.id);
  assert.equal((await store.listTemplates()).templates.length, 0);

  const s = M.setSetting(await store.readSettings(), 'birimler', ['Adet', 'Metre']);
  await store.saveSettings(s);
  assert.deepEqual((await store.readSettings()).birimler, ['Adet', 'Metre']);
  assert.ok((await store.readSettings()).zaman.birimler);

  await db.write('BOM/projeler/x/proje.json.catisma-20261110-101010', new TextEncoder().encode('{}'));
  assert.deepEqual((await store.listConflicts()).map((c) => c.path), ['BOM/projeler/x/proje.json.catisma-20261110-101010']);
  assert.equal((await store.listProjects()).projects.length, 0, 'çakışma kopyası proje sayılmaz');
  const st = await store.stats();
  assert.ok(st.files >= 2 && st.bytes > 0);
});
