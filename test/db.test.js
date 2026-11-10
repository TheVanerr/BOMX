/* Veritabanı ve GitHub katmanı. P&PX'in ortak katman testlerinden uyarlandı; birleştirme kancası,
   anahtar sahibi ve BOMX dosyalarının iki cihaz arasında kayıt kayıt birleşmesi eklendi. */

const test = require('node:test');
const assert = require('node:assert/strict');

const BomxDb = require('../ortak/bomx-db.js');
const BomxGitHub = require('../ortak/bomx-github.js');
const M = require('../codes/model.js');
const BomxStore = require('../codes/store.js');
const { createFakeGitHub, blobSha } = require('./fake-github.js');

const text = (s) => new TextEncoder().encode(s);
const str = (b) => new TextDecoder().decode(b);

/** Aynı sahte depoya bağlı bir cihaz; saat depoyla ortak ilerler */
function device(hub, options) {
  const remote = BomxGitHub.createRemote({ repo: hub.id, token: hub.token, fetchFn: hub.fetchFn });
  return BomxDb.createDb(Object.assign({
    local: BomxDb.memoryLocal(),
    remote,
    now: () => { hub.clock.now += 1000; return hub.clock.now; },
    flushMs: 3600000,
    merge: M.mergeFile
  }, options));
}

/* ─── Git uyumu ─────────────────────────────────────────── */

test('dosya kimliği Git ile birebir aynı hesaplanır', async () => {
  assert.equal(await BomxDb.gitBlobSha(text('test content\n')), 'd670460b4b4aece5915caf5c68d12f560a9fe3e4');
  assert.equal(await BomxDb.gitBlobSha(new Uint8Array(0)), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
  const sample = Buffer.from('şğüÇ\r\nÿ', 'utf8');
  assert.equal(await BomxDb.gitBlobSha(sample), blobSha(sample));
});

test('GET istekleri önbellekten okumaz: eski dal başı eşitlemeyi yanıltır', async () => {
  const hub = createFakeGitHub();
  const db = device(hub);
  await db.write('a.json', text('1'));
  await db.sync();
  assert.ok(hub.stats.get > 0);
  assert.equal(hub.stats.uncachedViolations, 0);
});

/* ─── Kayıt ─────────────────────────────────────────────── */

test('boş depoda ilk commit BOMX README ile atılır, dosyalar depoya aynen yazılır', async () => {
  const hub = createFakeGitHub();
  const db = device(hub);
  const body = text('{"model":"Ç"}\r\n');
  await db.write('BOM/projeler/şık proje/proje.json', body);
  const s = await db.sync();
  assert.equal(s.state, 'ok', s.error);
  assert.equal(s.pending, 0);
  assert.deepEqual([...hub.files().get('BOM/projeler/şık proje/proje.json')], [...body], 'satır sonu ve Türkçe harf korunmalı');
  assert.match(str(hub.files().get('README.md')), /BOMX veri deposu/);
});

test('aynı içerik yeniden yazılmaz, boş commit oluşmaz', async () => {
  const hub = createFakeGitHub();
  const db = device(hub);
  assert.equal(await db.write('a.json', text('1')), true);
  assert.equal(await db.write('a.json', text('1')), false);
  await db.sync();
  const commits = hub.commitCount();
  await db.write('a.json', text('1'));
  await db.sync();
  await db.sync();
  assert.equal(hub.commitCount(), commits);
});

test('sık otomatik kayıt tek commit olur; değişiklik yokken yalnız tek okuma yapılır', async () => {
  const hub = createFakeGitHub();
  const db = device(hub);
  await db.sync();
  const commits = hub.commitCount();
  for (let i = 0; i < 200; i += 1) await db.write('BOM/projeler/x/proje.json', text(`{"n":${i}}`));
  await db.sync();
  assert.equal(hub.commitCount(), commits + 1);
  assert.equal(str(hub.files().get('BOM/projeler/x/proje.json')), '{"n":199}');
  const reads = hub.stats.get;
  await db.sync();
  assert.equal(hub.stats.get, reads + 1, 'yalnız dal başı sorulmalı');
});

test('küçük metin dosyaları kaç tane olursa olsun tek gönderimde az istekle gider', async () => {
  const hub = createFakeGitHub();
  const db = device(hub);
  await db.sync();
  for (let i = 0; i < 40; i += 1) await db.write(`BOM/sablonlar/${i}.json`, text(`{"ad":"${i}"}`));
  const before = hub.stats.post + hub.stats.patch;
  await db.sync();
  assert.equal(hub.stats.post + hub.stats.patch - before, 3, 'ağaç, commit, dal başı');
});

/* ─── Hata durumları ────────────────────────────────────── */

test('internet yokken kayıt kaybolmaz, bağlantı gelince gönderilir', async () => {
  const hub = createFakeGitHub();
  const db = device(hub);
  hub.hooks.network = true;
  await db.write('a.json', text('emek'));
  const offline = await db.sync();
  assert.equal(offline.state, 'offline');
  assert.equal(offline.pending, 1);
  assert.equal(str((await db.read('a.json')).bytes), 'emek');
  hub.hooks.network = false;
  const online = await db.sync();
  assert.equal(online.state, 'ok');
  assert.equal(online.pending, 0);
  assert.equal(str(hub.files().get('a.json')), 'emek');
});

test('hız sınırı ve geçersiz anahtar anlaşılır yazılır, kayıt cihazda bekler', async () => {
  const hub = createFakeGitHub();
  const db = device(hub);
  await db.sync();
  await db.write('a.json', text('1'));
  hub.hooks.fail = (method) => (method === 'POST' ? { status: 403, json: { message: 'You have exceeded a secondary rate limit' }, headers: { 'retry-after': '120' } } : null);
  const limited = await db.sync();
  assert.equal(limited.state, 'error');
  assert.match(limited.error, /hız sınırı/);
  assert.equal(limited.pending, 1);
  hub.hooks.fail = null;
  assert.equal((await db.sync()).state, 'ok');

  const wrong = BomxDb.createDb({
    local: BomxDb.memoryLocal(),
    remote: BomxGitHub.createRemote({ repo: hub.id, token: 'yanlis', fetchFn: hub.fetchFn })
  });
  const denied = await wrong.sync();
  assert.equal(denied.state, 'error');
  assert.equal(denied.auth, true, 'anahtar sorunu ayrıca işaretlenir');
  assert.match(denied.error, /anahtarı geçersiz/);
  hub.hooks.fail = (method) => (method === 'POST' ? { status: 403, json: { message: 'Resource not accessible by personal access token' }, headers: {} } : null);
  await db.write('b.json', text('2'));
  assert.match((await db.sync()).error, /yazma izni yok/);
});

test('depo bilgisi özel olup olmadığını ve anahtarın bitişini söyler; depo adı doğrulanır', async () => {
  const open = createFakeGitHub({ isPrivate: false, tokenExpires: '2027-11-10 12:00:00 UTC' });
  const remote = BomxGitHub.createRemote({ repo: open.id, token: open.token, fetchFn: open.fetchFn });
  const info = await remote.info();
  assert.equal(info.private, false);
  assert.equal(new Date(info.tokenExpires).toISOString(), '2027-11-10T12:00:00.000Z');
  assert.throws(() => BomxGitHub.createRemote({ repo: 'sadece-ad', token: 'x' }), /kullanici\/depo/);
  assert.throws(() => BomxGitHub.createRemote({ repo: 'a/b/c', token: 'x' }), /kullanici\/depo/);
  assert.equal(BomxGitHub.parseExpiry('bozuk'), null);
});

test('anahtarın sahibi bulunur: depo adı yalnız "bomx-veri" yazılabilir', async () => {
  const hub = createFakeGitHub({ owner: 'TheVanerr', name: 'bomx-veri' });
  const me = await BomxGitHub.whoAmI(hub.token, hub.fetchFn);
  assert.equal(me.login, 'TheVanerr');
  await assert.rejects(() => BomxGitHub.whoAmI('yanlis', hub.fetchFn), /anahtarı geçersiz/);
});

/* ─── İki cihaz ─────────────────────────────────────────── */

test('bir cihazda yazılan öbür cihazda görünür, silme de taşınır', async () => {
  const hub = createFakeGitHub();
  const a = device(hub);
  const b = device(hub);
  await a.write('BOM/sablonlar/1.json', text('{"ad":"1"}'));
  await a.write('BOM/projeler/şık proje/proje.json', text('{"model":"Ç"}'));
  await a.sync();
  await b.sync();
  assert.equal(str((await b.read('BOM/sablonlar/1.json')).bytes), '{"ad":"1"}');
  assert.equal(await a.remove('BOM/sablonlar/1.json'), 1);
  await a.sync();
  assert.equal(hub.files().has('BOM/sablonlar/1.json'), false);
  await b.sync();
  assert.equal(await b.read('BOM/sablonlar/1.json'), null);
});

test('program dosyası tanımıyorsa iki sürüm de durur (.catisma kopyası)', async () => {
  const hub = createFakeGitHub();
  const a = device(hub);
  const b = device(hub);
  const p = 'notlar/serbest.txt';
  await a.write(p, text('ortak'));
  await a.sync();
  await b.sync();
  await a.write(p, text('a sürümü'));
  await b.write(p, text('b sürümü'));
  await a.sync();
  await b.sync();
  await a.sync();
  const main = str((await a.read(p)).bytes);
  assert.equal(str((await b.read(p)).bytes), main);
  const copies = (await a.list()).filter((r) => r.path.startsWith(`${p}.catisma-`));
  assert.equal(copies.length, 1);
  assert.deepEqual([main, str(copies[0].bytes)].sort(), ['a sürümü', 'b sürümü']);
});

test('birleştirme kancası iki sürümü birleştirir, kopya oluşmaz; kanca hata verirse kopya oluşur', async () => {
  const hub = createFakeGitHub();
  const merge = (path, mine, theirs) => {
    if (path === 'bozuk.json') throw new Error('okunamadı');
    if (path !== 'liste.json') return null;
    const set = new Set([...JSON.parse(str(mine)), ...JSON.parse(str(theirs))]);
    return text(JSON.stringify([...set].sort()));
  };
  const a = device(hub, { merge });
  const b = device(hub, { merge });
  await a.write('liste.json', text('["x"]'));
  await a.write('bozuk.json', text('1'));
  await a.sync();
  await b.sync();
  await a.write('liste.json', text('["x","a"]'));
  await a.write('bozuk.json', text('a'));
  await b.write('liste.json', text('["x","b"]'));
  await b.write('bozuk.json', text('b'));
  await a.sync();
  const s = await b.sync();
  assert.equal(s.state, 'ok', s.error);
  assert.ok(s.changed.includes('liste.json'));
  await a.sync();
  for (const db of [a, b]) {
    assert.equal(str((await db.read('liste.json')).bytes), '["a","b","x"]');
    assert.equal((await db.list()).filter((r) => r.path.startsWith('liste.json.catisma-')).length, 0);
  }
  assert.equal((await b.list()).filter((r) => r.path.startsWith('bozuk.json.catisma-')).length, 1);
});

test('gönderim sırasında başka cihaz commit atarsa ezilmez, birleşip yeniden gönderilir', async () => {
  const hub = createFakeGitHub();
  const a = device(hub);
  const b = device(hub);
  await a.write('ortak.json', text('0'));
  await a.sync();
  await b.sync();
  await a.write('a.json', text('a'));
  await b.write('b.json', text('b'));
  hub.hooks.beforeRefUpdate = async () => { await b.sync(); };
  const s = await a.sync();
  assert.equal(s.state, 'ok', s.error);
  assert.equal(str(hub.files().get('a.json')), 'a');
  assert.equal(str(hub.files().get('b.json')), 'b');
});

test('sunucu kısa süreliğine eski commit döndürse de yeni çalışma geri alınmaz', async () => {
  const hub = createFakeGitHub();
  const db = device(hub);
  await db.write('c.json', text('eski'));
  await db.sync();
  const old = hub.headSha();
  await db.write('c.json', text('yeni'));
  await db.sync();
  hub.hooks.staleRef = old;
  const s = await db.sync();
  assert.equal(s.state, 'ok', s.error);
  assert.equal(str((await db.read('c.json')).bytes), 'yeni');
});

test('silme ile düzenleme karşılaşırsa içerik kaybolmaz', async () => {
  const hub = createFakeGitHub();
  const a = device(hub);
  const b = device(hub);
  await a.write('x.json', text('1'));
  await a.write('y.json', text('1'));
  await a.sync();
  await b.sync();
  await a.remove('x.json');
  await a.write('y.json', text('a düzenledi'));
  await a.sync();
  await b.write('x.json', text('b düzenledi'));
  await b.remove('y.json');
  await b.sync();
  await a.sync();
  for (const db of [a, b]) {
    assert.equal(str((await db.read('x.json')).bytes), 'b düzenledi');
    assert.equal(str((await db.read('y.json')).bytes), 'a düzenledi');
  }
});

test('ikili ve büyük dosya bozulmadan taşınır', async () => {
  const hub = createFakeGitHub();
  const a = device(hub);
  const b = device(hub);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00, 0x80]);
  const big = 'ş'.repeat(800000);
  await a.write('logo.png', png);
  await a.write('buyuk.json', text(big));
  await a.write('bos.txt', new Uint8Array(0));
  assert.equal((await a.sync()).state, 'ok');
  await b.sync();
  assert.deepEqual([...(await b.read('logo.png')).bytes], [...png]);
  assert.equal(str((await b.read('buyuk.json')).bytes), big);
  assert.equal((await b.read('bos.txt')).bytes.length, 0);
});

test('çok dosyalı aktarma hız sınırına takılmamak için turlara bölünür', async () => {
  const hub = createFakeGitHub();
  const db = device(hub);
  await db.sync();
  for (let i = 0; i < 70; i += 1) await db.write(`resim${i}.png`, new Uint8Array([255, i]));
  const first = await db.sync();
  assert.equal(first.pending, 20);
  const second = await db.sync();
  assert.equal(second.pending, 0);
});

/* ─── Yerel mod ve bağlanma ─────────────────────────────── */

test('yerel çalışma sonradan depoya bağlanınca gönderilir, depodaki veriyle birleşir', async () => {
  const hub = createFakeGitHub();
  const other = device(hub);
  await other.write('depoda.json', text('d'));
  await other.sync();
  const local = BomxDb.memoryLocal();
  const offline = BomxDb.createDb({ local });
  await offline.write('yerel.json', text('y'));
  assert.equal(offline.status().mode, 'local');
  const connected = device(hub, { local });
  const s = await connected.sync();
  assert.equal(s.state, 'ok', s.error);
  assert.equal(str(hub.files().get('yerel.json')), 'y');
  assert.equal(str((await connected.read('depoda.json')).bytes), 'd');
});

test('yedek indirilip boş veritabanına aynen yüklenir, var olan dosya korunur; başka biçim reddedilir', async () => {
  const db = BomxDb.createDb({ local: BomxDb.memoryLocal() });
  await db.write('a.json', text('liste'));
  await db.write('logo.png', new Uint8Array([255, 0, 128]));
  const backup = JSON.parse(JSON.stringify(await db.exportBackup()));
  assert.equal(backup.format, 'bomx-yedek');
  const fresh = BomxDb.createDb({ local: BomxDb.memoryLocal() });
  await fresh.write('a.json', text('daha yeni'));
  assert.deepEqual(await fresh.importBackup(backup), { written: 1, kept: 1 });
  assert.equal(str((await fresh.read('a.json')).bytes), 'daha yeni');
  assert.deepEqual([...(await fresh.read('logo.png')).bytes], [255, 0, 128]);
  await assert.rejects(() => fresh.importBackup({ format: 'ppx-yedek', files: [] }), /BOMX yedeği değil/);
});

/* ─── Bildirim ve zaman aşımı ───────────────────────────── */

test('çekilen değişiklik yalnız o eşitlemenin bildiriminde gelir, sonraki bildirimlerde yinelenmez', async () => {
  const hub = createFakeGitHub();
  const a = device(hub);
  const b = device(hub);
  await a.write('x.json', text('1'));
  await a.sync();
  const seen = [];
  b.onStatus((s) => seen.push(s.changed.slice()));
  const s = await b.sync();
  assert.deepEqual(s.changed.filter((p) => p === 'x.json'), ['x.json']);
  seen.length = 0;
  await b.write('y.json', text('2'));
  assert.ok(seen.length >= 1);
  assert.ok(seen.every((c) => c.length === 0), 'yazma bildirimi eski listeyi taşımaz');
});

test('gönderim başarısız olsa da önce çekilen değişiklik bildirilir', async () => {
  const hub = createFakeGitHub();
  const a = device(hub);
  const b = device(hub);
  await a.write('ortak.json', text('a'));
  await a.sync();
  await b.sync();
  await a.write('ortak.json', text('a2'));
  await a.sync();
  await b.write('b.json', text('b'));
  hub.hooks.fail = (method) => (method === 'POST' ? { status: 503, json: { message: 'down' }, headers: {} } : null);
  const s = await b.sync();
  assert.equal(s.state, 'offline');
  assert.ok(s.changed.includes('ortak.json'));
  assert.equal(str((await b.read('ortak.json')).bytes), 'a2');
});

test('yanıt vermeyen GitHub isteği zaman aşımıyla biter, kayıt cihazda bekler', async () => {
  const hang = () => new Promise(() => {});
  const remote = BomxGitHub.createRemote({ repo: 'ben/veri', token: 'x', fetchFn: hang, timeoutMs: 60 });
  const started = Date.now();
  await assert.rejects(() => remote.info(), (e) => e.offline === true && /zamanında yanıt vermedi/.test(e.message));
  assert.ok(Date.now() - started < 2000);
  const db = BomxDb.createDb({ local: BomxDb.memoryLocal(), remote, flushMs: 3600000 });
  await db.write('a.json', text('1'));
  const s = await db.sync();
  assert.equal(s.state, 'offline');
  assert.equal(s.pending, 1);
});

/* ─── BOMX dosyaları iki cihazda ────────────────────────── */

test('iki cihaz kütüphanenin aynı parçasında farklı komponentleri değiştirir: ikisi de kalır', async () => {
  const hub = createFakeGitHub();
  const a = device(hub);
  const b = device(hub);
  const sa = BomxStore.createStore(a);
  const sb = BomxStore.createStore(b);
  // Aynı parçaya düşen iki kimlik
  const [x, y] = await sa.saveComponents([
    { id: 'a00000000001', kod: 'PE01', ad: 'Pompa', fiyat: 100 },
    { id: 'a00000000002', kod: 'V31', ad: 'Vana', fiyat: 10 }
  ]);
  await a.sync();
  await b.sync();
  await sa.saveComponents([Object.assign({}, x, { fiyat: 120 })]);
  await sb.saveComponents([Object.assign({}, y, { ad: 'Sepet Aç Valfi' }), { id: 'a00000000003', kod: 'LS01', ad: 'Seviye' }]);
  await a.sync();
  await b.sync();
  await a.sync();
  for (const s of [sa, sb]) {
    const lib = (await s.loadLibrary()).components;
    assert.deepEqual(lib.map((c) => c.kod).sort(), ['LS01', 'PE01', 'V31']);
    assert.equal(lib.find((c) => c.kod === 'PE01').fiyat, 120);
    assert.equal(lib.find((c) => c.kod === 'V31').ad, 'Sepet Aç Valfi');
  }
  assert.equal([...hub.files().keys()].filter((k) => k.includes('.catisma-')).length, 0, 'çakışma kopyası olmamalı');
});

test('bir cihaz siler, öbürü başka kaydı değiştirir: silinen geri gelmez', async () => {
  const hub = createFakeGitHub();
  const a = device(hub);
  const b = device(hub);
  const sa = BomxStore.createStore(a);
  const sb = BomxStore.createStore(b);
  await sa.saveComponents([{ id: 'b00000000001', kod: 'A', ad: 'A' }, { id: 'b00000000002', kod: 'B', ad: 'B' }]);
  await a.sync();
  await b.sync();
  await sa.deleteComponents(['b00000000001']);
  await sb.saveComponents([{ id: 'b00000000002', kod: 'B', ad: 'B yeni' }]);
  await a.sync();
  await b.sync();
  await a.sync();
  for (const s of [sa, sb]) {
    const lib = (await s.loadLibrary()).components;
    assert.deepEqual(lib.map((c) => `${c.kod}:${c.ad}`), ['B:B yeni']);
  }
});

test('aynı proje iki cihazda düzenlenir: kalemler birleşir, alan başına en yeni kalır', async () => {
  const hub = createFakeGitHub();
  const a = device(hub);
  const b = device(hub);
  const sa = BomxStore.createStore(a);
  const sb = BomxStore.createStore(b);
  const created = await sa.createProject({ seriNo: '0626051', musteri: 'DÜNYA', model: 'ULT M200 3B' }, {});
  await a.sync();
  await b.sync();
  const pa = await sa.readProject(created.id);
  const pb = await sb.readProject(created.id);
  const sec = pa.bolumler[0].id;

  const nextA = M.clone(pa);
  nextA.kalemler.push(M.lineFromComponent({ id: 'c1', kod: 'PE01', ad: 'Pompa', fiyat: 50 }, 2, sec));
  nextA.notlar = 'A notu';
  M.stampChanges(pa, nextA, '2026-11-10T10:00:00.000Z');
  await sa.saveProject(nextA);

  const nextB = M.clone(pb);
  nextB.kalemler.push(M.lineFromComponent({ id: 'c2', kod: 'V31', ad: 'Vana', fiyat: 5 }, 4, sec));
  nextB.durum = 'inceleme';
  M.stampChanges(pb, nextB, '2026-11-10T10:00:05.000Z');
  await sb.saveProject(nextB);

  await a.sync();
  const s = await b.sync();
  assert.equal(s.state, 'ok', s.error);
  await a.sync();
  for (const st of [sa, sb]) {
    const p = await st.readProject(created.id);
    assert.deepEqual(p.kalemler.map((l) => l.kod).sort(), ['PE01', 'V31']);
    assert.equal(p.notlar, 'A notu');
    assert.equal(p.durum, 'inceleme');
  }
  assert.equal([...hub.files().keys()].filter((k) => k.includes('.catisma-')).length, 0);
});
