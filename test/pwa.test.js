// PWA: manifest, hizmet çalışanının sakladığı dosyalar ve GitHub Pages iş akışı birbirini tutar
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const swFiles = () => {
  const m = read('sw.js').match(/const FILES = \[([\s\S]*?)\];/);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
};

test('manifest projeye özel kimlikle yüklenebilir uygulama tanımlar', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.equal(m.id, 'bomx-malzeme-listesi', 'başka programlarla (P&PX…) aynı adreste çakışmayan kimlik');
  assert.equal(m.short_name, 'BOMX');
  assert.equal(m.start_url, './');
  assert.equal(m.scope, './');
  assert.equal(m.display, 'standalone');
  const sizes = m.icons.map((i) => `${i.sizes}:${i.purpose}`);
  for (const need of ['192x192:any', '512x512:any', '512x512:maskable']) assert.ok(sizes.includes(need), need);
  for (const icon of m.icons) {
    const file = path.join(ROOT, icon.src);
    assert.ok(fs.existsSync(file), icon.src);
    if (icon.type === 'image/png') {
      const b = fs.readFileSync(file);
      const [w, h] = icon.sizes.split('x').map(Number);
      assert.deepEqual([b.readUInt32BE(16), b.readUInt32BE(20)], [w, h], `${icon.src} boyutu`);
    }
  }
});

test('hizmet çalışanı sayfanın yüklediği her dosyayı saklar ve yalnız kendi önbelleğini siler', () => {
  const files = swFiles();
  for (const f of files) if (f !== './') assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} yok`);
  const html = read('index.html');
  const used = [...html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"]+)"/g)].map((x) => x[1]).filter((u) => !/^(https?:|data:)/.test(u));
  const lazy = [...read('codes/ui/output.js').matchAll(/loadScript\('([^']+)'\)/g)].map((x) => x[1]);
  for (const u of [...used, ...lazy, 'manifest.webmanifest']) assert.ok(files.includes(u), `${u} sw.js FILES listesinde yok`);
  for (const img of [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map((x) => x[1])) assert.ok(files.includes(img), img);
  const sw = read('sw.js');
  assert.match(sw, /const CACHE = 'bomx-program-v\d+'/);
  assert.match(sw, /name\.startsWith\(PREFIX\) && name !== CACHE/, 'yalnız bomx-program- önbellekleri silinir');
});

test('Pages iş akışı sitedeki dosyaları içerir; şirket verisi ve geliştirme dosyaları sitede yoktur', () => {
  const yml = read('.github/workflows/pages.yml');
  const copied = [...yml.matchAll(/^\s+cp (?:-r )?(.+?) _site\/(?:assets\/)?$/gm)].flatMap((x) => x[1].split(/\s+/));
  for (const f of swFiles()) {
    if (f === './') continue;
    assert.ok(copied.some((c) => f === c || f.startsWith(`${c}/`)), `${f} siteye kopyalanmıyor`);
  }
  for (const c of copied) assert.ok(!/^(test|tools|aktarim|node_modules)\b|\.json$/.test(c), `${c} siteye girmemeli`);
  assert.match(yml, /actions\/deploy-pages/);
});
