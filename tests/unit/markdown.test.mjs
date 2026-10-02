import test from 'node:test';
import assert from 'node:assert/strict';
import {loadApp, loadSample, read} from '../helpers/load-app.mjs';

const T = loadApp();

test('toMarkdown: sample.json equals tests/golden/sample.md', () => {
  loadSample(T);
  assert.equal(T.toMarkdown(), read('tests/golden/sample.md'));
});

test('toMarkdown: structure', () => {
  loadSample(T);
  const md = T.toMarkdown();
  assert.ok(md.startsWith('# Site Survey\n\nNational Telecom Public Company Limited\n'));
  assert.equal((md.match(/^## /gm) || []).length, 2, 'one H2 per site');
  assert.equal((md.match(/^### /gm) || []).length, 8, 'four sections per site');
  assert.equal((md.match(/^#### ข้อมูลจุดติดตั้ง /gm) || []).length, 6, 'one heading per rack');
  assert.match(md, /^- \[G1\] \| \[G3\] \| \[G5\]$/m, 'installed racks marked [x]');
  assert.match(md, /^- · \| · \| · \| · \| · \| · \| \[10\] \| \[09\] \| ·$/m, 'blank floor positions');
  assert.match(md, /^- _Rear_$/m);
});

test('toMarkdown: table cells escape | and keep line breaks as <br>', () => {
  loadSample(T);
  const s = T.S.sites[0];
  s.info.agency = 'A | B';
  s.info.surveyors = 'one\ntwo';
  const md = T.toMarkdown();
  assert.ok(md.includes('| ชื่อหน่วยงาน | A \\| B |'));
  assert.ok(md.includes('| ผู้เข้าสำรวจพื้นที่ | one<br>two |'));
});

test('toMarkdown: multi-U devices and diagram placeholder', () => {
  loadSample(T);
  T.S.sites[0].racks[0].devices[0].h = 2;
  T.S.sites[0].diagram.img = 'data:image/png;base64,AAAA';
  const md = T.toMarkdown();
  assert.ok(md.includes('อุปกรณ์ในตู้: NetScaler MPX9200 @ U21–22'));
  assert.ok(md.includes('| หมายเลข Unit | U 21–22 |'));
  assert.ok(md.includes('(แนบรูปแผนภาพ)'));
  assert.ok(md.includes('(ยังไม่มีแผนภาพ)'));
});
