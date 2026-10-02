// Escaping of user text in the preview HTML strings and in the DOCX XML.
// The broader attack-surface tests (malicious JSON, image schemes, prototype pollution, DoS) are in security.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadApp, loadSample} from '../helpers/load-app.mjs';
import {unzip, blobBytes} from '../helpers/zip.mjs';
import {checkXml, wText} from '../helpers/xml.mjs';
import {unsafeMarkup} from '../helpers/html.mjs';

const T = loadApp();
const EVIL = `<script>alert(1)</script> & "q" 'a'`;
const ESC = '&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;q&quot;';   // what esc() makes of EVIL up to the quote

/** Sample state with EVIL in every user-editable text field. */
function evilState() {
  loadSample(T);
  const S = T.S;
  Object.assign(S.doc, {title: EVIL, company: EVIL, logoText: EVIL});
  for (const s of S.sites) {
    s.name = EVIL;
    for (const k of Object.keys(s.info)) s.info[k] = EVIL;
    for (const k of Object.keys(s.place)) s.place[k] = EVIL;
    for (const it of s.floor.items) if (it.type === 'label') it.text = EVIL; else it.racks.forEach((r) => { if (r.n) r.n = EVIL; });
    for (const r of s.racks) {
      r.device = EVIL; r.rack = EVIL;
      r.devices.forEach((d) => { d.name = EVIL; });
      r.power = r.power.map(() => EVIL);
      r.cables.forEach((c) => { c.type = EVIL; c.text = EVIL + '\n' + EVIL; });
    }
    s.diagram.caption = EVIL;
  }
  return S;
}
const noRawMarkup = (h) => {
  assert.ok(!h.includes('<script'), 'raw <script> in output');
  assert.ok(!/\son\w+=/i.test(h), 'event-handler attribute in output');
};

test('preview HTML: names with <script>, & and " are escaped', () => {
  evilState();
  const h = T.docHTML().h;
  noRawMarkup(h);
  assert.ok(h.includes(ESC), 'escaped form present');
  // every occurrence of the payload is the escaped one
  assert.equal(h.split('alert(1)').length - 1, h.split('&lt;script&gt;alert(1)').length - 1);
  assert.ok(!h.includes('"q"'), 'double quotes are entity-encoded');
});

test('preview HTML: text logo is escaped', () => {
  evilState();
  T.S.doc.logo = '';
  const h = T.docHTML().h;
  noRawMarkup(h);
  assert.ok(h.includes(`<span class="lt">${ESC}`));
});

test('preview SVGs: rack and floor labels are escaped', () => {
  const S = evilState();
  const r = T.rackSVG(S.sites[0].racks[0]), f = T.floorSVG(S.sites[0].floor, false), fi = T.floorSVG(S.sites[0].floor, true);
  for (const svg of [r, f, fi]) { noRawMarkup(svg); assert.ok(svg.includes(ESC)); }
  assert.ok(fi.includes(`aria-label="ตู้ ${ESC}`), 'interactive cell aria-label escaped');
});

test('editor HTML: values in inputs/textareas are escaped', () => {
  const S = evilState();
  const h = T.rackCard(S.sites[0].racks[0], 0, 'sites.0', 0);
  noRawMarkup(h);
  assert.ok(h.includes(`value="${ESC}`));
  assert.ok(h.includes(`<textarea data-b="sites.0.racks.0.cables.0.text"`));
});

test("preview HTML: single quotes are entity-encoded", () => {
  evilState();
  const h = T.docHTML().h;
  assert.ok(!h.includes("'a'"), "raw ' in output");
  assert.ok(h.includes('&#39;a&#39;'));
  assert.equal(T.esc(`<a href='x'>&"`), '&lt;a href=&#39;x&#39;&gt;&amp;&quot;');
});

test('preview HTML: diagram image / logo refs cannot break out of src="…"', () => {
  loadSample(T);
  const payload = 'x" onerror="alert(1)';
  T.S = T.migrate({...JSON.parse(JSON.stringify(T.S)), doc: {...T.S.doc, logo: payload}});
  assert.equal(T.S.doc.logo, '', 'invalid logo → text logo');
  T.S.sites[0].diagram.img = payload;               // even when set directly (bypassing migrate), imgURL() drops it
  const h = T.docHTML().h;
  noRawMarkup(h);
  assert.ok(!h.includes('alert(1)'));
  const ed = T.SECTIONS.find((x) => x.id === 'diagram').editor(T.S.sites[0], 'sites.0', 0);
  noRawMarkup(ed);
  assert.ok(!ed.includes('<img'), 'no image shown for an invalid ref');
});

test('editor HTML: ids from imported JSON cannot break out of attributes', () => {
  loadSample(T);
  const o = JSON.parse(JSON.stringify(T.S));
  o.sites[0].racks[0].id = 'r" onmouseover="alert(1)';
  o.sites[0].racks[0].devices[0].id = 'd" onfocus="alert(1)';
  T.S = T.migrate(o);
  assert.match(T.S.sites[0].racks[0].id, /^[A-Za-z0-9_-]+$/);
  assert.match(T.S.sites[0].racks[0].devices[0].id, /^[A-Za-z0-9_-]+$/);
  const h = T.rackCard(T.S.sites[0].racks[0], 0, 'sites.0', 0);
  noRawMarkup(h);
  // and if an unsafe id ever reached a render directly, the attribute is still escaped
  const r = JSON.parse(JSON.stringify(T.S.sites[0].racks[0]));
  r.id = 'r" onmouseover="alert(1)'; r.devices[0].id = 'd" onfocus="alert(1)';
  assert.deepEqual(unsafeMarkup(T.rackCard(r, 0, 'sites.0', 0)).filter((x) => !/[(id|data-k|aria-describedby)]/.test(x)), []);
});

test('DOCX XML: escaped, well-formed, and the text round-trips exactly', async () => {
  evilState();
  const P = unzip(await blobBytes(await T.buildDocx()));
  for (const n of ['word/document.xml', 'word/header1.xml', 'docProps/core.xml']) {
    const x = P[n].toString('utf8');
    assert.doesNotThrow(() => checkXml(x), n);
    assert.ok(!x.includes('<script'), n);
  }
  const d = P['word/document.xml'].toString('utf8');
  assert.ok(d.includes(ESC));
  const t = wText(d);
  assert.ok(t.includes(EVIL), 'decoded text equals the original');
  assert.ok(t.includes('ข้อมูลจุดติดตั้ง ' + EVIL + ' ในตู้ ' + EVIL));
  assert.ok(P['docProps/core.xml'].toString('utf8').includes('<dc:title>' + ESC));
});

test('DOCX XML: text logo header is escaped', async () => {
  evilState();
  T.S.doc.logo = '';
  const P = unzip(await blobBytes(await T.buildDocx()));
  const hdr = P['word/header1.xml'].toString('utf8');
  assert.doesNotThrow(() => checkXml(hdr));
  assert.equal(wText(hdr), EVIL);
});
