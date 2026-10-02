import test from 'node:test';
import assert from 'node:assert/strict';
import {loadApp, loadSample, plain} from '../helpers/load-app.mjs';

const T = loadApp();

test('SECTIONS: four numbered sections in document order', () => {
  assert.deepEqual(plain(T.SECTIONS).map((s) => s.id), ['info', 'place', 'racks', 'diagram']);
  assert.deepEqual(plain(T.SECTIONS).map((s) => s.title), [
    'ข้อมูลเกี่ยวกับการสำรวจพื้นที่',
    'ข้อมูลสถานที่ติดตั้ง',
    'ข้อมูลจุดติดตั้งในตู้ Rack, การเชื่อมต่อระบบไฟฟ้า และการเชื่อมต่อสายสัญญาณ',
    'แผนภาพการเชื่อมต่ออุปกรณ์ระบบ',
  ]);
  assert.deepEqual(plain(T.SECTIONS).map((s) => s.page), [false, false, true, true]);
});

test('SECTIONS: every entry has the registry shape', () => {
  loadSample(T);
  const s = T.S.sites[0];
  for (const sec of T.SECTIONS) {
    for (const k of ['id', 'title', 'label', 'en', 'chip']) assert.equal(typeof sec[k], 'string', `${sec.id}.${k}`);
    assert.equal(typeof sec.page, 'boolean', `${sec.id}.page`);
    for (const k of ['done', 'sum', 'editor', 'doc', 'md', 'docx']) assert.equal(typeof sec[k], 'function', `${sec.id}.${k}`);
    if (sec.page) {
      assert.equal(typeof sec.pages, 'function', `${sec.id}.pages`);
      assert.ok(Number.isInteger(sec.pages(s)) && sec.pages(s) >= 0);
    }
    assert.ok(['full', 'part', 'empty'].includes(sec.done(s)), `${sec.id}.done`);
    assert.equal(typeof sec.sum(s), 'string');
    const x = T.secX(sec, T.SECTIONS.indexOf(sec), 0);
    assert.deepEqual(plain(x), {n: T.SECTIONS.indexOf(sec) + 1, t: sec.title, id: `pv-0-${sec.id}`});
    assert.equal(typeof sec.md(s, x), 'string');
    assert.equal(typeof sec.doc(s, 0, x), 'string');
  }
  assert.equal(new Set(T.SECTIONS.map((s) => s.id)).size, T.SECTIONS.length, 'unique ids');
});

test('SECTIONS: done() levels', () => {
  const s = T.migrate({sites: [{}]}).sites[0];
  const done = (id) => T.SECTIONS.find((x) => x.id === id).done(s);
  assert.equal(done('info'), 'empty');
  assert.equal(done('racks'), 'empty');
  assert.equal(done('diagram'), 'empty');
  s.info.agency = 'A';
  assert.equal(done('info'), 'part');
  Object.assign(s.info, {location: 'L', datetime: 'D', surveyors: 'S'});
  assert.equal(done('info'), 'full');
  s.diagram.caption = 'c';
  assert.equal(done('diagram'), 'part');
  s.diagram.img = 'data:image/png;base64,AAAA';
  assert.equal(done('diagram'), 'full');
});

test('pagePlan: sample → 12 pages with the TOC numbers of the PDF', () => {
  loadSample(T);
  const p = T.pagePlan();
  assert.equal(p.pages, 12);
  assert.deepEqual(p.sites.map((x) => x.start), [3, 8]);
  assert.deepEqual(p.sites.map((x) => plain(x.secs)), [[3, 3, 4, 7], [8, 8, 9, 12]]);
  assert.equal(p.sites[0].s, T.S.sites[0]);
});

test('pagePlan: matches the preview page count', () => {
  loadSample(T);
  const d = T.docHTML();
  assert.equal(d.pages, 12);
  assert.equal((d.h.match(/<div class="page[ "]/g) || []).length, 12);
  // TOC entries carry the plan numbers
  const toc = d.h.slice(d.h.indexOf('id="pv-toc"'), d.h.indexOf('id="pv-0"'));
  assert.deepEqual([...toc.matchAll(/<span>(\d+)<\/span><\/div>/g)].map((m) => +m[1]), [3, 3, 3, 4, 7, 8, 8, 8, 9, 12]);
});

test('pagePlan: varies with racks per site', () => {
  T.S = T.migrate({sites: [{racks: [{}, {}, {}, {}, {}]}, {racks: [{}]}]});
  const p = T.pagePlan();
  assert.deepEqual(p.sites.map((x) => plain(x.secs)), [[3, 3, 4, 9], [10, 10, 11, 12]]);
  assert.equal(p.pages, 12);
  assert.equal((T.docHTML().h.match(/<div class="page[ "]/g) || []).length, 12);
});

test('pagePlan: a site with no racks', () => {
  T.S = T.migrate({sites: [{racks: []}]});
  const p = T.pagePlan();
  // Section 3 keeps its own page (heading + placeholder), so the TOC numbers stay distinct and match the preview.
  assert.equal(p.pages, 5);
  const h = T.docHTML().h;
  assert.equal((h.match(/<div class="page[ "]/g) || []).length, 5);
  assert.deepEqual(plain(p.sites[0].secs), [3, 3, 4, 5]);
  assert.ok(h.includes('id="pv-0-racks"'), 'section 3 heading exists in the preview');
  assert.ok(h.includes('(ยังไม่มีข้อมูลตู้ Rack)'));
  assert.ok(T.toMarkdown().includes('\n\n(ยังไม่มีข้อมูลตู้ Rack)\n'), 'Markdown placeholder under section 3');
});
