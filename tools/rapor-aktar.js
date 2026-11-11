/* Raporlardan (HTML ürün ağacı, kritik parça listesi, sarf / depo listesi) ve ERP ürün ağaçlarından (Excel .xlsx/.xlsm, CSV)
   elektrikli komponentleri çıkarıp fotoğraflı BOMX komponent paketi yazar. Program içindeki "İçe aktar" ile aynı kodu kullanır;
   paket BOMX'e "İçe aktar → Dosyadan" ile fotoğraflarıyla alınır.

   node tools/rapor-aktar.js [dosya ...] [--paket cikti.json] [--ek ek.json] [--csv klasor] [--tam-ad]

   Dosya verilmezse BOMX klasöründeki .html raporları (index.html dışında) ve .xlsx / .xlsm ürün ağaçları okunur.
   --paket  paketin yazılacağı dosya (varsayılan: BOMX klasöründe "BOMX elektrik komponentleri.json")
   --ek     koda göre ek bilgi: { "10 03121": { "uretici", "ureticiKodu", "ozellik", "not", "kaynak", "foto": "dosya.jpg" | data URL,
            "fotoKaynagi", "fotoDegistir": true } }. ozellik ve not açıklamanın başına, kaynak sonuna ("Kaynak (web): …") yazılır;
            foto, komponentin fotoğrafı yoksa (fotoDegistir ile her durumda) kullanılır. Fotoğraf önceden küçültülmüş olmalı
            (kenar 420 px, JPEG).
   --csv    ayrıca seçilenleri ve bütün kodları (Sınıf, Neden, Kaynak sütunlarıyla) CSV olarak bu klasöre yazar
   --tam-ad ad olarak ERP stok adı yerine ürün tam adı */

const fs = require('node:fs');
const path = require('node:path');
const M = require('../codes/model.js');
const R = require('../codes/reports.js');
const X = require('../codes/xlsx.js');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return false;
  args.splice(i, 1);
  return true;
};
const option = (name) => {
  const i = args.indexOf(name);
  if (i < 0 || i === args.length - 1) return null;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};

const fullName = flag('--tam-ad');
const packPath = path.resolve(option('--paket') || path.join(ROOT, 'BOMX elektrik komponentleri.json'));
const extraPath = option('--ek');
const csvDir = option('--csv');
const SOURCE = /\.(html?|xlsx|xlsm|csv)$/i;
const files = args.length ? args.map((f) => path.resolve(f))
  : fs.readdirSync(ROOT).filter((f) => SOURCE.test(f) && !/\.csv$/i.test(f) && f.toLowerCase() !== 'index.html').map((f) => path.join(ROOT, f));

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
function photoData(value, base) {
  if (!value) return '';
  if (/^data:image\//.test(value)) return value;
  const file = path.resolve(base, value);
  const mime = MIME[path.extname(file).toLowerCase()];
  if (!mime) throw new Error(`Fotoğraf biçimi tanınmadı: ${value}`);
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}

async function readSource(file) {
  const name = path.basename(file);
  if (/\.html?$/i.test(file)) {
    const rep = R.readHtml(fs.readFileSync(file, 'utf8'), name);
    return ['agac', 'kritik', 'sarf'].includes(rep.kind) ? rep : null;
  }
  const rows = /\.csv$/i.test(file) ? M.parseCsv(fs.readFileSync(file, 'utf8')) : await X.readWorkbook(new Uint8Array(fs.readFileSync(file)));
  return R.readTreeTable(rows, name);
}

(async () => {
  const reports = [];
  for (const file of files) {
    const rep = await readSource(file);
    if (rep) {
      reports.push(rep);
      console.log(`${R.SOURCE_LABEL[rep.kind]}: ${rep.name} · ${rep.summary}`);
    } else {
      console.log(`atlandı (tanınan rapor ya da ürün ağacı değil): ${path.basename(file)}`);
    }
  }
  if (!reports.length) {
    console.error('Okunacak rapor bulunamadı.');
    process.exit(1);
  }

  const items = R.importItems(reports, { adKaynagi: fullName ? 'tam' : 'erp', kullanim: true, birimler: M.DEFAULT_SETTINGS.birimler });
  const selected = items.filter((it) => R.DEFAULT_CLASSES.includes(it.meta.sinif));

  // Ek bilgi (ör. üreticiden derlenen özellik ve fotoğraf)
  const extra = extraPath ? JSON.parse(fs.readFileSync(extraPath, 'utf8')) : {};
  const extraBase = extraPath ? path.dirname(path.resolve(extraPath)) : ROOT;
  const used = new Set();
  for (const it of selected) {
    const e = extra[it.fields.kod];
    if (!e) continue;
    used.add(it.fields.kod);
    const f = it.fields;
    if (e.uretici && !f.uretici) f.uretici = e.uretici;
    if (e.ureticiKodu && !f.ureticiKodu) f.ureticiKodu = e.ureticiKodu;
    if (e.kategori && !f.kategori) f.kategori = e.kategori;
    // Açıklama: özellik, not, raporun yazdığı (kullanım…), en sonda bilginin web kaynağı
    if (e.ozellik && !String(f.aciklama || '').includes(e.ozellik)) {
      // "Not:" ve "Kaynak (web):" satırları iç bilgidir, malzeme listesine girmez (BomxModel.bomDescription)
      f.aciklama = [e.ozellik, e.not ? `Not: ${e.not}` : '', f.aciklama, e.kaynak ? `Kaynak (web): ${e.kaynak}` : ''].filter(Boolean).join('\n');
    }
    if (e.foto && (!it.foto || e.fotoDegistir)) {
      it.foto = photoData(e.foto, extraBase);
      it.fotoKaynak = e.fotoKaynagi || 'ek bilgi';
    }
  }
  const unused = Object.keys(extra).filter((k) => !used.has(k));
  if (unused.length) console.log(`Ek bilgide olup seçilenlerde bulunmayan kodlar: ${unused.join(', ')}`);

  const list = selected.map((it) => Object.assign({}, it.fields, {
    tur: it.meta.sinif,
    neden: it.meta.neden,
    kaynaklar: it.meta.kaynaklar,
    uyarilar: it.meta.uyarilar,
    foto: it.foto || '',
    fotoKaynagi: it.foto ? it.fotoKaynak || '' : ''
  }));
  const doc = M.packageDocument(list, (c) => c.foto, {
    ad: 'Elektrikli komponentler',
    aciklama: 'Raporlardan ve ürün ağaçlarından çıkarılan elektrikli parçalar, redüktörler ve elektrikli kompleler. BOMX\'te Kütüphane → İçe aktar → Dosyadan ile alınır.',
    kaynaklar: reports.map((r) => `${R.SOURCE_LABEL[r.kind]}: ${r.name}`)
  });
  fs.writeFileSync(packPath, JSON.stringify(doc, null, 1));

  const photos = doc.komponentler.filter((c) => c.foto).length;
  const count = {};
  for (const it of items) count[it.meta.sinif] = (count[it.meta.sinif] || 0) + 1;
  console.log(`\n${items.length} kod: ${Object.entries(count).map(([k, n]) => `${R.CLASS_LABELS[k]} ${n}`).join(', ')}`);
  console.log(`${selected.length} komponent (${photos} fotoğraflı, ${Object.keys(doc.fotograflar).length} farklı fotoğraf) → ${packPath} (${Math.round(fs.statSync(packPath).size / 1024)} KB)`);
  const missing = selected.filter((it) => !it.fields.kod);
  if (missing.length) console.log(`Stok kodu olmayan ${missing.length} kalem: ${missing.map((it) => it.fields.ad).join(' · ')} (aktarırken kodunu yazın)`);

  if (csvDir) {
    const out = path.resolve(csvDir);
    const toComponent = (it) => M.normalizeComponent(Object.assign({ id: `rapor-${it.row}` }, it.fields));
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'elektrik-komponentleri.csv'), M.toCsv(M.libraryToRows(selected.map(toComponent))));
    const all = [['Sınıf', 'Kod', 'Ad', 'Kategori', 'Üretici', 'Üretici Kodu', 'Birim', 'Açıklama', 'Neden', 'Kaynak', 'Uyarı']];
    for (const it of items) {
      const f = it.fields;
      all.push([R.CLASS_LABELS[it.meta.sinif], f.kod, f.ad, f.kategori, f.uretici, f.ureticiKodu, f.birim, f.aciklama, it.meta.neden, it.meta.kaynaklar.join(', '), it.meta.uyarilar.join('; ')]);
    }
    fs.writeFileSync(path.join(out, 'tum-kodlar.csv'), M.toCsv(all));
    console.log(`CSV → ${out}`);
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
