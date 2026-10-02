// Security regression tests: hostile JSON imports, image schemes, ids, prototype pollution, newer schemas,
// XML-invalid characters in DOCX, Markdown HTML injection, download names, oversized values, and the CSP hash.
// See SECURITY.md for the threat model.
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadApp, loadSample, read, plain} from '../helpers/load-app.mjs';
import {unzip, blobBytes} from '../helpers/zip.mjs';
import {checkXml, wText} from '../helpers/xml.mjs';
import {unsafeMarkup} from '../helpers/html.mjs';
import {cspHash} from '../../tools/port.mjs';

const T = loadApp();
const MAL = read('tests/fixtures/malicious.json');
const IMG = read('tests/fixtures/diagram.dataurl.txt').trim();

/** Import malicious.json the way the Load JSON button does. */
function importMal() {
  const o = T.migrate(T.parseJSON(MAL), {imported: true});
  assert.ok(o, 'the malicious file still loads (it is a v2 survey)');
  o.cur = 0;
  T.S = o;
  return o;
}
/** Every HTML string the app renders for state S: preview + every editor card of every site. */
function allHTML() {
  const S = T.S, out = [T.docHTML().h];
  S.sites.forEach((s, si) => {
    S.cur = si;
    out.push(T.card('doc', 'doc', false, 'ed-doc', '–', 'x', 'y', ''), T.card('site', 'site:' + s.id, true, `ed-${si}-site`, 'S', 'x', 'y', ''));
    T.SECTIONS.forEach((sec, k) => out.push(T.card('sec:' + sec.id, `sec:${s.id}:${sec.id}`, true, `ed-${si}-${sec.id}`, k + 1, sec.label, sec.en, sec.editor(s, `sites.${si}`, si))));
  });
  S.cur = 0;
  return out.join('\n');
}

test('malicious.json: every rendered tag is clean (no handlers, scripts, foreign src/href, unsafe ids)', () => {
  importMal();
  assert.deepEqual(unsafeMarkup(allHTML()), []);
});

test('malicious.json: migrate() sanitises ids, images, enums, numbers', () => {
  const o = plain(importMal());
  const ids = [];
  const walk = (x) => { if (x && typeof x === 'object') { if (typeof x.id === 'string') ids.push(x.id); Object.values(x).forEach(walk); } };
  walk(o.sites);
  assert.ok(ids.length >= 12);
  for (const id of ids) assert.match(id, /^[A-Za-z0-9_-]{1,64}$/, id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique across the document');
  assert.equal(o.doc.logo, '', 'invalid logo → text logo');
  assert.deepEqual(o.sites.map((s) => s.diagram.img), [null, null, null, null], 'javascript:, SVG, broken base64 and idb: refs are all dropped');
  const s = o.sites[0];
  assert.equal(s.floor.orient, 'h');
  assert.equal(s.floor.door, 'center');
  assert.deepEqual(s.floor.items.map((i) => i.type), ['label', 'row', 'label']);
  assert.equal(s.racks[0].size, T.RACK_MAX, 'rack height is capped');
  assert.equal(o.sites[1].racks[0].size, 42, 'non-numeric size → 42');
  assert.deepEqual(s.racks[0].devices.map((d) => d.u), ['', 1, -1e9], 'a non-numeric U becomes empty; numbers are kept');
  assert.deepEqual(s.racks[0].devices.map((d) => d.h), [1, 1e9, 2e9]);
  assert.deepEqual(s.racks[0].power, ['<img src=x onerror=window.__pwned=1>', '7', '']);
  assert.equal(o.cur, 0);
});

test('malicious.json: Markdown carries no raw HTML tags and no injected headings', () => {
  importMal();
  const md = T.toMarkdown();
  assert.ok(!/<(?!br>)[a-zA-Z/]/.test(md), 'only the <br> line breaks the generator itself adds');
  assert.ok(!/^# fake heading/m.test(md), 'a newline in a one-line field cannot start a heading');
  assert.ok(md.includes('&lt;script>window.__pwned=1&lt;/script>'));
  assert.ok(md.includes('\\| col \\| break \\|'), 'pipes in table cells are escaped');
});

test('malicious.json: DOCX is well-formed XML (control chars and lone surrogates dropped) and builds', async () => {
  importMal();
  const P = unzip(await blobBytes(await T.buildDocx()));
  for (const n of Object.keys(P).filter((n) => /\.(xml|rels)$/.test(n))) assert.doesNotThrow(() => checkXml(P[n].toString('utf8')), n);
  const d = P['word/document.xml'].toString('utf8');
  assert.ok(!/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(d));
  assert.ok(wText(d).includes("T'itle "), "text around the dropped characters survives, ' stays literal");
  assert.ok(!Object.keys(P).some((n) => !/^(\[Content_Types\]\.xml|_rels\/\.rels|docProps\/core\.xml|word\/(document|styles|header1)\.xml|word\/_rels\/(document|header1)\.xml\.rels|word\/media\/(image\d+\.(png|jpeg)|logo\.(png|jpeg)))$/.test(n)), 'only fixed part names');
});

test('malicious.json: huge U / H / size values stay cheap (no unbounded loops)', () => {
  const o = importMal();
  const r = o.sites[0].racks[0], t0 = Date.now();
  T.devErrors(r); T.rackSVG(r); T.rackStat(r);
  T.doAct('dAdd', 0, 0);
  const raw = {size: 1e9, devices: [{u: 1, h: 1e9}, {u: -1e9, h: 2e9}]};
  T.devErrors(raw);
  assert.ok(T.rackSVG(raw).length < 200000, 'drawing is bounded by RACK_MAX');
  assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0} ms`);
});

test('safeImg / okImg: only base64 PNG, JPEG, GIF, WebP data URLs within the size cap', () => {
  for (const ok of [IMG, 'data:image/png;base64,AAAA', 'data:image/jpeg;base64,/9j/4AAQ', 'data:image/gif;base64,R0lGOD==', 'data:image/webp;base64,UklG']) {
    assert.equal(T.safeImg(ok), ok, ok.slice(0, 30));
  }
  for (const bad of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/svg+xml,<svg onload=alert(1)>',
    'data:text/html;base64,PHNjcmlwdD4=', 'data:image/png;base64,AAAA" onerror="alert(1)', 'data:image/png,AAAA', 'https://evil.example/x.png',
    '//evil.example/x.png', 'blob:null/1', 'idb:abc', ' data:image/png;base64,AAAA', 'data:image/png;base64,AA AA', '', null, 7, {}]) {
    assert.equal(T.safeImg(bad), '', String(bad).slice(0, 40));
  }
  assert.equal(T.okImg('data:image/png;base64,' + 'A'.repeat(15e6)), false, 'over the size cap');
  // imgURL never returns an unsafe value, whatever is in the state
  assert.equal(T.imgURL('x" onerror="alert(1)'), '');
  assert.equal(T.imgURL('idb:doesnotexist'), '');
  assert.equal(T.imgURL(IMG), IMG);
});

test('migrate: idb: refs are kept from this browser\'s own storage but dropped from imported files', () => {
  const src = () => ({doc: {logo: 'idb:abc123'}, sites: [{diagram: {img: 'idb:def456'}}]});
  const own = T.migrate(src()), imp = T.migrate(src(), {imported: true});
  assert.equal(own.doc.logo, 'idb:abc123');
  assert.equal(own.sites[0].diagram.img, 'idb:def456');
  assert.equal(imp.doc.logo, '');
  assert.equal(imp.sites[0].diagram.img, null);
  assert.equal(T.migrate({sites: [{diagram: {img: 'idb:' + 'a'.repeat(41)}}]}).sites[0].diagram.img, null, 'over-long ref');
  assert.equal(T.migrate({sites: [{diagram: {img: 'idb:ABC'}}]}).sites[0].diagram.img, null, 'ref charset');
});

test('migrate: ids — valid ones kept, invalid or duplicate ones regenerated', () => {
  const o = T.migrate({sites: [{id: 'ok_id-1', racks: [{id: 'ok_id-1'}, {id: 'a b'}, {id: 5}, {id: 'x'.repeat(65)}]}]});
  assert.equal(o.sites[0].id, 'ok_id-1');
  const r = o.sites[0].racks.map((x) => x.id);
  assert.notEqual(r[0], 'ok_id-1', 'duplicate regenerated');
  assert.notEqual(r[1], 'a b');
  assert.equal(r[2], '5');
  assert.ok(r[3].length <= 64);
  for (const id of r) assert.match(id, /^[A-Za-z0-9_-]{1,64}$/);
  assert.equal(T.safeId('<x>').length > 0 && /^[a-z0-9]+$/.test(T.safeId('<x>')), true);
});

test('prototype pollution: __proto__ / constructor keys in JSON never reach a prototype', () => {
  const txt = '{"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":1}},"doc":{"__proto__":{"polluted":1}},' +
    '"sites":[{"__proto__":{"polluted":1},"racks":[{"__proto__":{"polluted":1},"devices":[{"__proto__":{"polluted":1}}]}]}]}';
  const parsed = T.parseJSON(txt);
  assert.ok(!Object.hasOwn(parsed, '__proto__') && !Object.hasOwn(parsed, 'constructor') && !Object.hasOwn(parsed.doc, '__proto__'));
  const o = T.migrate(parsed);
  // the restore/undo path parses with plain JSON.parse: migrate's copies must not pollute either
  const o2 = T.migrate(JSON.parse(txt));
  const fresh = T.sample();   // objects created in the app's realm after the import
  for (const x of [fresh, fresh.doc, fresh.sites[0], fresh.sites[0].racks[0], o, o.doc, o.sites[0], o2.doc, o2.sites[0], o2.sites[0].racks[0], {}]) {
    assert.equal(x.polluted, undefined);
  }
  assert.equal(Object.getPrototypeOf(o2.doc), Object.getPrototypeOf(fresh.doc), 'doc keeps the ordinary prototype');
});

test('setP / getP: no prototype keys, no writes to missing keys or through non-objects', () => {
  loadSample(T);
  const S = T.S;
  assert.equal(T.setP(S, 'doc.title', 'OK'), true);
  assert.equal(S.doc.title, 'OK');
  assert.equal(T.setP(S, 'sites.0.racks.0.devices.0.u', 5), true);
  for (const p of ['__proto__.polluted', 'doc.__proto__.polluted', 'sites.0.constructor.prototype.polluted', 'sites.constructor.polluted',
    'doc.nope', 'nope.deeper.x', 'doc.title.length', 'sites.99.name']) {
    assert.equal(T.setP(S, p, 'x'), false, p);
  }
  assert.equal(T.sample().polluted, undefined);
  assert.equal(({}).polluted, undefined);
  assert.equal(T.getP(S, '__proto__'), undefined);
  assert.equal(T.getP(S, 'doc.constructor'), undefined);
  assert.equal(T.getP(S, 'doc.title'), 'OK');
});

test('newer schema: refused on import (no silent downgrade); draft in storage is backed up, not overwritten', () => {
  assert.equal(T.newerV({v: 3, sites: []}), 3);
  assert.equal(T.newerV({v: 2, sites: []}), 0);
  assert.equal(T.newerV({sites: []}), 0);
  assert.equal(T.migrate({v: 3, sites: [{}]}), null);
  assert.equal(T.migrate({v: '99', sites: [{}]}), null);
  const raw = JSON.stringify({v: 3, sites: [{name: 'From the future'}]});
  const A = loadApp('index.html', {storage: {'rack-site-survey-offline-v1': raw}});
  assert.equal(A.S.sites[0].name, 'NT Data Center Sriracha', 'falls back to the sample');
  assert.equal(A.localStorage.getItem('rack-site-survey-offline-v1-v3-backup'), raw, 'the newer draft is kept under a backup key');
});

test('xesc: XML 1.0-invalid characters are dropped, valid ones (incl. surrogate pairs) kept', () => {
  assert.equal(T.xesc('a\x00b\x01\x08\x0B\x0C\x0E\x1Fc￾￿d'), 'abcd');
  assert.equal(T.xesc('tab\tnl\ncr\r'), 'tab\tnl\ncr\r');
  assert.equal(T.xesc('x\uD800y\uDC00z'), 'xyz', 'lone surrogates');
  assert.equal(T.xesc('emoji 😀'), 'emoji 😀', 'a valid pair stays');
  assert.equal(T.xesc(`<&>"'`), `&lt;&amp;&gt;&quot;'`);
});

test('mdT / mdL: no raw tags; one-line fields stay on one line', () => {
  assert.equal(T.mdT('<img src=x onerror=1>\nnext'), '&lt;img src=x onerror=1>\nnext');
  assert.equal(T.mdL('a\n# b'), 'a # b');
  loadSample(T);
  assert.equal(T.toMarkdown(), read('tests/golden/sample.md'), 'normal data unchanged');
});

test('safeName: download file names', () => {
  assert.equal(T.safeName('Site Survey', 'x'), 'Site Survey');
  assert.equal(T.safeName('สำรวจ ไซต์', 'x'), 'สำรวจ ไซต์', 'Thai kept');
  assert.equal(T.safeName('../../etc/passwd', 'x'), 'etc passwd');
  assert.equal(T.safeName('a\\b:c*d?e"f<g>h|i\x00j\x1Fk', 'x'), 'a b c d e f g h i j k');
  assert.equal(T.safeName('...', 'fallback'), 'fallback');
  assert.equal(T.safeName('', 'fallback'), 'fallback');
  assert.equal(T.safeName(' name. ', 'x'), 'name');
  assert.ok(T.safeName('ก'.repeat(500), 'x').length <= 80);
});

test('docxImg: PNG/JPEG pass through, GIF/WebP are re-encoded to PNG, anything else is dropped', async () => {
  assert.equal(await T.docxImg(IMG), IMG);
  assert.equal(await T.docxImg('javascript:alert(1)'), '');
  assert.equal(await T.docxImg(''), '');
});

test('CSP: index.html pins its inline script by hash; artifact.html has no CSP meta (the host sandboxes it)', () => {
  const i = read('index.html');
  const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(i);
  assert.ok(meta, 'CSP meta present');
  const pol = meta[1];
  assert.ok(pol.includes(`script-src '${cspHash(i)}'`), 'hash is current — run: node tools/port.mjs');
  for (const d of ["default-src 'none'", "img-src data:", "base-uri 'none'", "form-action 'none'", "object-src 'none'"]) assert.ok(pol.includes(d), d);
  assert.ok(!/unsafe-eval/.test(pol) && !/script-src[^;]*unsafe-inline/.test(pol));
  assert.ok(i.indexOf('Content-Security-Policy') < i.indexOf('<style>'), 'meta precedes the first style/script');
  assert.ok(!/\son[a-z]+="/.test(i.slice(0, i.indexOf('<script>'))), 'no inline event-handler attributes in the static markup');
  assert.ok(!read('artifact.html').includes('Content-Security-Policy'));
});
