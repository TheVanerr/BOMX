/* PDF için gömülü yazı tipi ve logo dosyalarını üretir: codes/pdf/fonts.js ve codes/pdf/logos.js.
   Dosyadan açılan sayfa diskteki dosyayı programla okuyamaz (fetch file:// yasak) ve dosyadan yüklenen
   resim tuvali kirletir; bu yüzden ikisi de <script> ile gelen base64 metindir. Elle düzenlenmez:
     node tools/build-assets.js */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const FONTS = ['selawk.ttf', 'selawksb.ttf', 'selawkb.ttf'];
const LOGOS = { dolfin: 'dolfin.png', vico: 'vico.png', enva: 'enva.svg', ksystem: 'ksystem.png' };
const MIME = { png: 'image/png', svg: 'image/svg+xml', jpg: 'image/jpeg' };

function write(file, banner, name, entries) {
  const body = entries.map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n');
  fs.writeFileSync(path.join(ROOT, file), `/* ${banner}\n   tools/build-assets.js üretir; elle düzenlenmez. */\nwindow.${name} = {\n${body}\n};\n`);
  console.log(`${file}: ${(fs.statSync(path.join(ROOT, file)).size / 1024).toFixed(0)} KB`);
}

write('codes/pdf/fonts.js', 'PDF yazı tipleri: Selawik (Segoe UI ölçülerinde, SIL Open Font License, assets/fonts/OFL-Selawik.txt)', 'BOMX_FONTS',
  FONTS.map((f) => [f, fs.readFileSync(path.join(ROOT, 'assets/fonts', f)).toString('base64')]));

write('codes/pdf/logos.js', 'Belge antetindeki logolar (P&PX ile aynı)', 'BOMX_LOGOS',
  Object.entries(LOGOS).map(([k, f]) => [k, `data:${MIME[f.split('.').pop()]};base64,${fs.readFileSync(path.join(ROOT, 'assets/logos', f)).toString('base64')}`]));
