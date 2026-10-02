import test from 'node:test';
import assert from 'node:assert/strict';
import {loadApp, loadSample, read, PNG_1x1} from '../helpers/load-app.mjs';
import {unzip, blobBytes} from '../helpers/zip.mjs';
import {checkXml, wText} from '../helpers/xml.mjs';

const T = loadApp();
const build = async () => unzip(await blobBytes(await T.buildDocx()));
const count = (s, re) => (s.match(re) || []).length;
const IMG = read('tests/fixtures/diagram.dataurl.txt').trim();

loadSample(T);
const P = await build();
const doc = P['word/document.xml'].toString('utf8');

test('docx: expected parts', () => {
  const names = Object.keys(P);
  for (const n of ['[Content_Types].xml', '_rels/.rels', 'docProps/core.xml', 'word/document.xml', 'word/styles.xml',
    'word/header1.xml', 'word/_rels/document.xml.rels', 'word/_rels/header1.xml.rels', 'word/media/logo.png']) {
    assert.ok(names.includes(n), n);
  }
  assert.equal(names[0], '[Content_Types].xml', 'content types first');
});

test('docx: every XML part is well-formed', () => {
  for (const [n, b] of Object.entries(P)) {
    if (!/\.(xml|rels)$/.test(n)) continue;
    assert.doesNotThrow(() => checkXml(b.toString('utf8')), n);
  }
});

test('docx: sample has 10 tables, 2 Heading1 sites, 8 Heading2 sections', () => {
  assert.equal(count(doc, /<w:tbl>/g), 10);
  assert.equal(count(doc, /<w:tbl>/g), count(doc, /<\/w:tbl>/g));
  assert.equal(count(doc, /<w:pStyle w:val="Heading1"\/>/g), 2);
  assert.equal(count(doc, /<w:pStyle w:val="Heading2"\/>/g), 8);
  assert.equal(count(doc, /<w:gridCol w:w="3500"\/><w:gridCol w:w="6138"\/>/g), 10, '3500 / 6138 twips columns');
});

test('docx: A4 page, 2 cm margins, header reference', () => {
  assert.match(doc, /<w:pgSz w:w="11906" w:h="16838"\/>/);
  assert.match(doc, /<w:pgMar w:top="1418" w:right="1134" w:bottom="1134" w:left="1134"/);
  assert.match(doc, /<w:headerReference w:type="default" r:id="rIdHdr"\/>/);
});

test('docx: Thai complex-script font and size are set (w:cs, w:szCs)', () => {
  const st = P['word/styles.xml'].toString('utf8');
  assert.match(st, /<w:rFonts [^>]*w:cs="Leelawadee UI"/);
  assert.match(st, /<w:szCs w:val="21"\/>/);
  assert.match(st, /<w:lang [^>]*w:bidi="th-TH"/);
  // every explicit run size carries the matching complex-script size
  const sz = [...doc.matchAll(/<w:sz w:val="(\d+)"\/>(<w:szCs w:val="(\d+)"\/>)?/g)];
  assert.ok(sz.length > 0);
  for (const m of sz) assert.equal(m[3], m[1], `w:sz ${m[1]} without matching w:szCs`);
  // bold runs are bold in complex script too
  assert.equal(count(doc, /<w:b\/>/g), count(doc, /<w:b\/><w:bCs\/>/g));
});

test('docx: images present and wired (8 drawings + header logo)', () => {
  const media = Object.keys(P).filter((n) => n.startsWith('word/media/'));
  assert.equal(media.length, 9);
  assert.equal(count(doc, /<wp:inline /g), 8, '2 floor plans + 6 racks');
  const rels = P['word/_rels/document.xml.rels'].toString('utf8');
  for (const rid of doc.matchAll(/r:embed="([^"]+)"/g)) {
    const m = new RegExp(`Id="${rid[1]}" Type="[^"]+/image" Target="media/([^"]+)"`).exec(rels);
    assert.ok(m, rid[1]);
    assert.ok(P['word/media/' + m[1]], m[1]);
  }
  const hdr = P['word/header1.xml'].toString('utf8');
  assert.match(hdr, /r:embed="rIdLogo"/);
  assert.match(P['word/_rels/header1.xml.rels'].toString('utf8'), /Id="rIdLogo" [^>]*Target="media\/logo.png"/);
  // the built-in logo is embedded as-is, sized from its natural 169x68 px to 40 px high
  assert.deepEqual(P['word/media/logo.png'], Buffer.from(T.APJC_LOGO.split(',')[1], 'base64'));
  assert.match(hdr, /<wp:extent cx="942975" cy="381000"\/>/);
  const ct = P['[Content_Types].xml'].toString('utf8');
  assert.match(ct, /Extension="png" ContentType="image\/png"/);
  assert.match(ct, /Extension="jpeg" ContentType="image\/jpeg"/);
});

test('docx: text content', () => {
  const t = wText(doc);
  for (const s of ['Site Survey', 'National Telecom Public Company Limited', 'สารบัญ', 'NT Data Center Sriracha', 'NT Data Center Bangkok',
    '1.  ข้อมูลเกี่ยวกับการสำรวจพื้นที่', '2.  ข้อมูลสถานที่ติดตั้ง', '4.  แผนภาพการเชื่อมต่ออุปกรณ์ระบบ',
    'ข้อมูลจุดติดตั้ง MPX9200 ในตู้ Rack G3', 'U 21', '1 Unit', '2 แหล่ง', '(แนบแผนภาพการเชื่อมต่อ)',
    'Existing SRI FL3 / New SRIRACHA FL3 — All Connectivity = 10G-SR']) {
    assert.ok(t.includes(s), s);
  }
  assert.match(P['docProps/core.xml'].toString('utf8'), /<dc:title>Site Survey<\/dc:title>/);
});

test('docx: uploaded diagram and custom logo are embedded as-is', async () => {
  loadSample(T);
  T.S.sites[0].diagram.img = IMG;
  T.S.doc.logo = IMG;
  const Q = await build();
  const raw = Buffer.from(IMG.split(',')[1], 'base64');
  const d = Q['word/document.xml'].toString('utf8');
  assert.equal(count(d, /<wp:inline /g), 9);
  assert.ok(Object.values(Q).some((b) => b.equals(raw)), 'diagram bytes present');
  assert.deepEqual(Q['word/media/logo.png'], raw);
  assert.ok(!wText(d).includes('(แนบแผนภาพการเชื่อมต่อ)') || wText(d).split('(แนบแผนภาพการเชื่อมต่อ)').length === 2, 'only site 2 has the placeholder');
});

test('docx: text logo when logo is ""', async () => {
  loadSample(T);
  T.S.doc.logo = '';
  T.S.doc.logoText = 'ACME';
  const Q = await build();
  assert.ok(!Q['word/media/logo.png']);
  assert.equal(wText(Q['word/header1.xml'].toString('utf8')), 'ACME');
  assert.doesNotThrow(() => checkXml(Q['word/_rels/header1.xml.rels'].toString('utf8')));
});

test('docx: blank site with no racks still builds valid XML', async () => {
  T.S = T.migrate({sites: [{name: 'Empty', racks: []}]});
  const Q = await build();
  const d = Q['word/document.xml'].toString('utf8');
  assert.doesNotThrow(() => checkXml(d));
  assert.equal(count(d, /<w:tbl>/g), 2);
  assert.ok(PNG_1x1);
});
