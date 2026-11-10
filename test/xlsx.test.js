/* Excel: malzeme listesi çalışma kitabının parçaları, formüller, okuma ve kütüphane gidiş-dönüşü. */

const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../codes/model.js');
const X = require('../codes/xlsx.js');

const dec = new TextDecoder();

function sampleProject() {
  return M.normalizeProject({
    id: '0626051-DÜNYA-ULT M200 3B', seriNo: '0626051', musteri: 'DÜNYA', model: 'ULT M200 3B', baslik: 'Yıkama & <Durulama>',
    paraBirimi: 'TRY', kurlar: { EUR: 36.5, USD: 34 }, rev: '01', notlar: 'Not satırı 1\nNot satırı 2',
    bolumler: [{ id: 's1', ad: 'Elektrik Panosu' }, { id: 's2', ad: 'Pnömatik' }],
    kalemler: [
      { id: 'l1', bolum: 's1', kod: 'PE01', ad: 'Pompa "A"', miktar: 2, fiyat: 100, paraBirimi: 'EUR', tedarikci: 'Grundfos', referans: 'PE01, PE02' },
      { id: 'l2', bolum: 's1', kod: 'KBL', ad: 'Kablo', miktar: 12.5, birim: 'm', fiyat: 8.75, paraBirimi: 'TRY', iskonto: 10 },
      { id: 'l3', bolum: 's2', kod: 'V31', ad: 'Valf', miktar: 4, fiyat: null, paraBirimi: 'TRY' },
      { id: 'l4', bolum: 's2', kod: 'SNS', ad: 'Sensör', miktar: 1, fiyat: 20, paraBirimi: 'USD' }
    ],
    revizyonlar: [{ rev: '00', tarih: '2026-11-01', aciklama: 'İlk yayın' }, { rev: '01', tarih: '2026-11-10', aciklama: 'Pompa eklendi' }]
  });
}

test('malzeme listesi çalışma kitabı gerekli parçaları ve üç sayfayı içerir', async () => {
  const bytes = X.bomWorkbook(sampleProject(), { columns: [...M.DEFAULT_COLUMNS, 'iskonto', 'tedarikci'] });
  const files = await X.readZip(bytes);
  for (const name of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml',
    'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'xl/worksheets/sheet3.xml', 'docProps/core.xml']) {
    assert.ok(files.has(name), name);
  }
  const book = dec.decode(files.get('xl/workbook.xml'));
  assert.match(book, /name="Malzeme Listesi"/);
  assert.match(book, /_xlnm\.Print_Titles/);
  assert.match(book, /fullCalcOnLoad="1"/);
  const sheet = dec.decode(files.get('xl/worksheets/sheet1.xml'));
  assert.match(sheet, /Yıkama &amp; &lt;Durulama&gt;/, 'özel karakterler kaçırılır');
  assert.match(sheet, /<f>IF\(/, 'tutar formülü');
  assert.match(sheet, /\(1-[A-Z]+\d+\/100\)/, 'iskonto formüle girer');
  assert.match(sheet, /<f>SUMIF\(/, 'ara toplam formülü');
  assert.match(sheet, /state="frozen"/);
  assert.match(sheet, /fitToWidth="1"/);
  assert.doesNotMatch(sheet, /NaN|undefined/);
});

test('iskonto sütunu belgede yoksa oran tutar formülüne sabit yazılır (Excel yeniden hesapta da aynı tutar)', async () => {
  const p = M.normalizeProject({
    seriNo: '1', musteri: 'A', model: 'B', bolumler: [{ id: 's', ad: 'G' }],
    kalemler: [{ id: 'l', bolum: 's', kod: 'X', ad: 'X', miktar: 2, fiyat: 100, iskonto: 10 }]
  });
  const sheet = dec.decode((await X.readZip(X.bomWorkbook(p, { columns: M.DEFAULT_COLUMNS }))).get('xl/worksheets/sheet1.xml'));
  assert.match(sheet, /\*\(1-10\/100\)\)<\/f><v>180<\/v>/);
});

test('fiyatsız belge fiyat sütunları ve toplam içermez', async () => {
  const bytes = X.bomWorkbook(sampleProject(), { prices: false, purchase: false, summary: false });
  const files = await X.readZip(bytes);
  assert.equal(files.has('xl/worksheets/sheet2.xml'), false);
  const sheet = dec.decode(files.get('xl/worksheets/sheet1.xml'));
  assert.doesNotMatch(sheet, /SUMIF|Birim Fiyat|Genel toplam/);
});

test('sütun seçimi: fiyatın yanına para birimi gelir', () => {
  assert.deepEqual(X.excelColumns(['no', 'kod', 'fiyat', 'tutar'], true), ['no', 'kod', 'fiyat', 'paraBirimi', 'tutar']);
  assert.deepEqual(X.excelColumns(['no', 'kod', 'tutar'], true), ['no', 'kod', 'paraBirimi', 'tutar']);
  assert.deepEqual(X.excelColumns(['no', 'kod', 'fiyat', 'tutar'], false), ['no', 'kod']);
  assert.equal(X.colName(0), 'A');
  assert.equal(X.colName(25), 'Z');
  assert.equal(X.colName(26), 'AA');
});

test('kütüphane Excel olarak verilip geri okunduğunda aynı kalır', async () => {
  const list = [
    M.normalizeComponent({ kod: 'PE01', ad: 'Pompa & Motor', fiyat: 1250.5, paraBirimi: 'EUR', kategori: 'Pompa', favori: true }),
    M.normalizeComponent({ kod: 'V31', ad: 'Sepet Aç Valfi', teslimSuresi: 14, aciklama: 'iki\nsatır' })
  ];
  const rows = await X.readWorkbook(X.libraryWorkbook(list));
  assert.equal(rows[0][0], 'Kod');
  const table = M.tableToComponents(rows);
  assert.deepEqual(table.columns.slice(0, 3), ['kod', 'ad', 'kategori']);
  const plan = M.planImport(table.items, [], 'merge');
  assert.equal(plan.add.length, 2);
  const pe = plan.add.find((c) => c.kod === 'PE01');
  assert.equal(pe.fiyat, 1250.5);
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
