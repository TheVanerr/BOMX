/* Sayfa bağlantıları: betik sırası ve yolları, dış kaynak yok, JS'in eriştiği öğeler sayfada,
   kurulum bağlantıları, PDF yazı tipleri ve logolar. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const html = read('index.html');
const UI_FILES = ['codes/app.js', ...fs.readdirSync(path.join(ROOT, 'codes/ui')).map((f) => `codes/ui/${f}`)];

test('sayfa betikleri sırayla yükler ve hepsi diskte vardır', () => {
  const sources = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(sources.length >= 14);
  for (const src of sources) assert.ok(fs.existsSync(path.join(ROOT, src)), src);
  const at = (name) => sources.findIndex((s) => s.endsWith(name));
  // Veritabanı birleştirme kancası iş kurallarındadır: açılış katmanından önce yüklenir
  assert.ok(at('bomx-db.js') < at('bomx-boot.js'));
  assert.ok(at('model.js') < at('bomx-boot.js'));
  assert.ok(at('model.js') < at('store.js') && at('model.js') < at('xlsx.js'));
  assert.equal(sources[sources.length - 1], 'codes/app.js', 'uygulama en son başlar');
  for (const css of [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1])) assert.ok(fs.existsSync(path.join(ROOT, css)), css);
});

test('dış kaynaktan betik ya da ES modülü yüklenmez (dosyadan açılan sayfada çalışmaz)', () => {
  assert.doesNotMatch(html, /<script[^>]+src="https?:/i);
  assert.doesNotMatch(html, /type="module"/i);
  for (const file of [...UI_FILES, 'codes/model.js', 'codes/store.js', 'codes/xlsx.js', 'ortak/bomx-boot.js']) {
    assert.doesNotMatch(read(file), /^\s*(import|export)\s/m, file);
  }
});

test("JS'in eriştiği her öğe sayfada ya da bir şablonda tanımlıdır", () => {
  const defined = new Set([...html.matchAll(/\bid="([^"$]+)"/g)].map((m) => m[1]));
  const sources = UI_FILES.map(read).join('\n');
  for (const m of sources.matchAll(/\bid="([A-Za-z][\w-]*)"/g)) defined.add(m[1]);
  // Sağ paneldeki alanlar field('ilMiktar', …) ve select('ipDurum', …) yardımcılarıyla kurulur
  for (const m of sources.matchAll(/\b(?:field|select)\('([A-Za-z][\w-]*)'/g)) defined.add(m[1]);
  defined.add('busyRoot');
  // Komponent formu alan adlarıyla kurulur: ld/mf + alan anahtarı
  const composed = /^(ld|mf)(kod|ad|kategori|uretici|ureticiKodu|tedarikci|tedarikciKodu|birim|teslimSuresi|aciklama|aciklamaEn|aciklamaDe|link|favori|pasif|error)$/;
  const missing = [];
  for (const m of sources.matchAll(/(?:U\.\$|getElementById)\('([A-Za-z][\w-]*)'\)/g)) {
    if (!defined.has(m[1]) && !composed.test(m[1])) missing.push(m[1]);
  }
  assert.deepEqual([...new Set(missing)], []);
});

test('kurulum bağlantıları bomx-veri deposunu ve yazma iznini hazır getirir', () => {
  const setup = read('codes/ui/setup.js');
  assert.match(setup, /https:\/\/github\.com\/new\?name=\$\{REPO_NAME\}&visibility=private/);
  assert.match(setup, /REPO_NAME = 'bomx-veri'/);
  assert.match(setup, /personal-access-tokens\/new/);
  assert.match(setup, /&contents=write&expires_in=365/);
  assert.match(setup, /Only select repositories/);
  assert.match(read('ortak/bomx-boot.js'), /if \(!info\.private\) throw/, 'açık depoya bağlanılmaz');
});

test('PDF motoru yalnız gömülü Selawik yazı tiplerini yükler; yazı tipi ve logo dosyaları üretilmiş', () => {
  const dom = read('codes/pdf/pdf-dom.js');
  const faces = dom.slice(dom.indexOf('const FACES'), dom.indexOf('];', dom.indexOf('const FACES')));
  assert.doesNotMatch(faces, /Carlito/);
  for (const f of ['selawk.ttf', 'selawksb.ttf', 'selawkb.ttf']) assert.match(faces, new RegExp(f.replace('.', '\\.')));
  const fonts = read('codes/pdf/fonts.js');
  for (const f of ['selawk.ttf', 'selawksb.ttf', 'selawkb.ttf']) {
    const m = fonts.match(new RegExp(`"${f.replace('.', '\\.')}": "([A-Za-z0-9+/=]+)"`));
    assert.ok(m, f);
    assert.deepEqual(Buffer.from(m[1], 'base64'), fs.readFileSync(path.join(ROOT, 'assets/fonts', f)), `${f} güncel değil: node tools/build-assets.js`);
  }
  const logos = read('codes/pdf/logos.js');
  for (const k of ['dolfin', 'vico', 'enva', 'ksystem']) assert.match(logos, new RegExp(`"${k}": "data:image/`), k);
  assert.ok(fs.existsSync(path.join(ROOT, 'assets/fonts/OFL-Selawik.txt')), 'yazı tipi lisansı');
});

test('PDF ve Excel P&PX motorlarıyla uyumlu: ortak zip yazıcı ve PDF dosyası', () => {
  // P&PX ayrı projedir: BOMX'in yanındaki (../P&PX) ya da içindeki klasör; ikisi de yoksa karşılaştırma atlanır
  const pidPdf = ['../P&PX', 'P&PX'].map((d) => path.join(ROOT, d, 'P-IDX/P&ID/codes/engine/pdf.js')).find((f) => fs.existsSync(f));
  if (pidPdf) {
    const norm = (t) => t.replace(/\r\n/g, '\n');
    assert.equal(norm(read('codes/pdf/pdf.js')), norm(fs.readFileSync(pidPdf, 'utf8')), 'pdf.js P&PX ile aynı kalmalı');
  }
  assert.match(read('codes/xlsx.js'), /function writeZip\(entries\)/);
});
