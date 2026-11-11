/* Excel: malzeme listesi çalışma kitabının parçaları, fotoğraflar, okuma ve kütüphane gidiş-dönüşü. */

const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../codes/model.js');
const X = require('../codes/xlsx.js');

const dec = new TextDecoder();

function sampleProject() {
  return M.normalizeProject({
    id: '0626051-DÜNYA-ULT M200 3B', seriNo: '0626051', musteri: 'DÜNYA', model: 'ULT M200 3B', baslik: 'Yıkama & <Durulama>',
    rev: '01', notlar: 'Not satırı 1\nNot satırı 2',
    bolumler: [{ id: 's1', ad: 'Elektrik Panosu' }, { id: 's2', ad: 'Pnömatik' }],
    kalemler: [
      { id: 'l1', bolum: 's1', komponentId: 'c1', kod: 'PE01', ad: 'Pompa "A"', ureticiKodu: 'XZS50-32', miktar: 2, aciklama: 'Paslanmaz pompa', tedarikci: 'Grundfos', referans: 'PE01, PE02' },
      { id: 'l2', bolum: 's1', kod: 'KBL', ad: 'Kablo', miktar: 12.5, birim: 'm' },
      { id: 'l3', bolum: 's2', komponentId: 'c1', kod: 'V31', ad: 'Valf', miktar: 4 },
      { id: 'l4', bolum: 's2', kod: 'SNS', ad: 'Sensör', miktar: 1 }
    ],
    revizyonlar: [{ rev: '00', tarih: '2026-11-01', aciklama: 'İlk yayın' }, { rev: '01', tarih: '2026-11-10', aciklama: 'Pompa eklendi' }]
  });
}

/** Başlığı geçerli, küçük bir JPEG (genişlik 400, yükseklik 200) */
function sampleJpeg() {
  const bytes = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0xc8, 0x01, 0x90, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xd9];
  return `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`;
}

test('malzeme listesi çalışma kitabı gerekli parçaları ve üç sayfayı içerir; fiyat yoktur', async () => {
  const bytes = X.bomWorkbook(sampleProject(), {});
  const files = await X.readZip(bytes);
  for (const name of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml',
    'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'xl/worksheets/sheet3.xml', 'docProps/core.xml']) {
    assert.ok(files.has(name), name);
  }
  const book = dec.decode(files.get('xl/workbook.xml'));
  assert.match(book, /name="Malzeme Listesi"/);
  assert.match(book, /_xlnm\.Print_Titles/);
  const sheet = dec.decode(files.get('xl/worksheets/sheet1.xml'));
  assert.match(sheet, /Yıkama &amp; &lt;Durulama&gt;/, 'özel karakterler kaçırılır');
  for (const head of ['Fotoğraf', 'Stok Kodu', 'Tanım', 'Model Kodu', 'Adet', 'Açıklama']) assert.ok(sheet.includes(`>${head}<`), head);
  assert.match(sheet, /12,5 m/, 'adet dışı birim miktarın yanında yazar');
  assert.match(sheet, /state="frozen"/);
  assert.match(sheet, /fitToWidth="1"/);
  assert.doesNotMatch(sheet, /NaN|undefined|Fiyat|Tutar|SUMIF|<drawing/);
  assert.equal(files.has('xl/drawings/drawing1.xml'), false, 'fotoğraf yoksa çizim parçası da yok');
});

test('kalem fotoğrafları hücreye gömülür; aynı fotoğraf dosyada bir kez durur', async () => {
  const jpeg = sampleJpeg();
  const files = await X.readZip(X.bomWorkbook(sampleProject(), { photoOf: (line) => (line.komponentId ? jpeg : '') }));
  const types = dec.decode(files.get('[Content_Types].xml'));
  assert.match(types, /Extension="jpeg" ContentType="image\/jpeg"/);
  assert.match(types, /\/xl\/drawings\/drawing1\.xml/);
  assert.match(dec.decode(files.get('xl/worksheets/sheet1.xml')), /<drawing r:id="rId1"\/>/);
  assert.match(dec.decode(files.get('xl/worksheets/_rels/sheet1.xml.rels')), /drawings\/drawing1\.xml/);
  const drawing = dec.decode(files.get('xl/drawings/drawing1.xml'));
  assert.equal((drawing.match(/<xdr:oneCellAnchor>/g) || []).length, 2, 'fotoğraflı iki kalem');
  assert.match(drawing, new RegExp(`<xdr:ext cx="${72 * 9525}" cy="${36 * 9525}"/>`), 'oran korunur');
  assert.equal([...files.keys()].filter((k) => k.startsWith('xl/media/')).length, 1);
  assert.equal(X.decodePhoto('data:image/webp;base64,AAAA'), null, 'Excel yalnız JPEG ve PNG alır');
  assert.deepEqual([X.decodePhoto(jpeg).width, X.decodePhoto(jpeg).height], [400, 200]);
});

test('sütun harfleri', () => {
  assert.equal(X.colName(0), 'A');
  assert.equal(X.colName(25), 'Z');
  assert.equal(X.colName(26), 'AA');
});

test('kütüphane Excel olarak verilip geri okunduğunda aynı kalır', async () => {
  const list = [
    M.normalizeComponent({ kod: 'PE01', ad: 'Pompa & Motor', ureticiKodu: 'XZS50', kategori: 'Pompa', favori: true }),
    M.normalizeComponent({ kod: 'V31', ad: 'Sepet Aç Valfi', teslimSuresi: 14, aciklama: 'iki\nsatır' })
  ];
  const rows = await X.readWorkbook(X.libraryWorkbook(list));
  assert.equal(rows[0][0], 'Stok Kodu');
  assert.equal(rows[0].includes('Birim Fiyat'), false);
  const table = M.tableToComponents(rows);
  assert.deepEqual(table.columns.slice(0, 3), ['kod', 'ad', 'kategori']);
  const plan = M.planImport(table.items, [], 'merge');
  assert.equal(plan.add.length, 2);
  const pe = plan.add.find((c) => c.kod === 'PE01');
  assert.equal(pe.ureticiKodu, 'XZS50');
  assert.equal(pe.favori, true);
  assert.equal(pe.ad, 'Pompa & Motor');
  assert.equal(plan.add.find((c) => c.kod === 'V31').aciklama, 'iki\nsatır');
});

test('paylaşılan metinli ve boş hücreli Excel okunur', async () => {
  const files = [
    ['[Content_Types].xml', '<Types/>'],
    ['xl/workbook.xml', '<workbook xmlns:r="r"><sheets><sheet name="A" sheetId="1" r:id="rId9"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId9" Target="worksheets/data.xml"/></Relationships>'],
    ['xl/sharedStrings.xml', '<sst><si><t>Stok Kodu</t></si><si><r><t>Malzeme </t></r><r><t>Adı</t></r></si><si><t>A&amp;B</t></si></sst>'],
    ['xl/worksheets/data.xml', '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>' +
      '<row r="2"><c r="A2"><v>1530010001</v></c><c r="C2" t="s"><v>2</v></c></row><row r="3"/></sheetData></worksheet>']
  ];
  const rows = await X.readWorkbook(X.writeZip(files));
  assert.deepEqual(rows, [['Stok Kodu', '', 'Malzeme Adı'], [1530010001, '', 'A&B']]);
  const table = M.tableToComponents(rows);
  assert.deepEqual(table.items[0].fields, { kod: 1530010001, ad: 'A&B' });
  assert.equal(M.planImport(table.items, [], 'merge').add[0].kod, '1530010001');
});
