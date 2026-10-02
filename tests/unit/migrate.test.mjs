import test from 'node:test';
import assert from 'node:assert/strict';
import {loadApp, read, plain} from '../helpers/load-app.mjs';

const T = loadApp();
const v1 = () => JSON.parse(read('sample.json'));

test('sample.json is a v1 file (no "v")', () => {
  assert.equal(v1().v, undefined);
});

test('migrate: v1 → v2 keeps the content and stamps v', () => {
  const src = v1(), before = plain(src);
  const o = plain(T.migrate(src));
  assert.equal(o.v, 2);
  assert.equal(o.v, T.SCHEMA);
  assert.equal(o.sites.length, 2);
  assert.deepEqual(o.doc, before.doc);
  // every site field already present in v1 is unchanged
  o.sites.forEach((s, i) => {
    const b = before.sites[i];
    assert.equal(s.id, b.id);
    assert.equal(s.name, b.name);
    assert.deepEqual(s.info, b.info);
    assert.deepEqual(s.place, b.place);
    assert.deepEqual(s.floor, b.floor);
    assert.deepEqual(s.racks, b.racks);
    assert.deepEqual(s.diagram, b.diagram);
  });
});

test('migrate: is idempotent on a v2 object', () => {
  const once = plain(T.migrate(v1()));
  const twice = plain(T.migrate(plain(once)));
  assert.deepEqual(twice, once);
});

test('migrate: returns null without a sites array', () => {
  for (const bad of [null, undefined, 0, 'x', [], {}, {sites: 'x'}, {sites: {}}, {doc: {}}]) {
    assert.equal(T.migrate(bad), null, JSON.stringify(bad));
  }
});

test('migrate: fills defaults for partial / garbage input', () => {
  const o = plain(T.migrate({sites: [
    {racks: [{devices: [null, {u: 3}, 'x']}, 7], floor: {items: [{type: 'row', racks: ['A', {n: 'B', on: 1}, null]}, 'junk', {text: 9}]}},
    5, null, 'str',
  ]}));
  assert.equal(o.v, 2);
  assert.deepEqual(o.doc, {title: 'Site Survey', company: '', logoText: 'APJC', logo: null});
  assert.equal(o.sites.length, 1, 'non-object sites are dropped');
  const s = o.sites[0];
  assert.match(s.id, /^[a-z0-9]+$/);
  assert.equal(s.name, '');
  assert.deepEqual(s.info, {agency: '', location: '', datetime: '', surveyors: ''});
  assert.deepEqual(s.place, {equipment: '', building: '', address: '', racks: ''});
  assert.equal(s.floor.orient, 'h');
  assert.equal(s.floor.door, 'center');
  assert.equal(s.floor.items.length, 2);
  assert.equal(s.floor.items[0].type, 'row');
  assert.deepEqual(s.floor.items[0].racks, [{n: 'A', on: false}, {n: 'B', on: true}, {n: '', on: false}]);
  assert.deepEqual({type: s.floor.items[1].type, text: s.floor.items[1].text}, {type: 'label', text: '9'});
  assert.equal(s.racks.length, 1, 'non-object racks are dropped');
  const r = s.racks[0];
  assert.equal(r.size, 42);
  assert.equal(r.device, '');
  assert.equal(r.rack, '');
  assert.deepEqual(r.power, []);
  assert.deepEqual(r.cables, []);
  assert.equal(r.devices.length, 1, 'null / string devices are dropped');
  assert.deepEqual({name: r.devices[0].name, u: r.devices[0].u, h: r.devices[0].h}, {name: '', u: 3, h: 1});
  assert.deepEqual(s.diagram, {img: null, caption: ''});
});

test('migrate: coerces bad scalar values', () => {
  const o = plain(T.migrate({doc: {title: 5, logo: 7, logoText: null}, sites: [{name: 12, floor: {orient: 'x', door: 'up'},
    racks: [{size: 0}, {size: -3}, {size: 'abc'}, {size: 24}], diagram: {img: '', caption: null}}]}));
  assert.equal(o.doc.title, '5');
  assert.equal(o.doc.logo, '', 'a logo that is not a valid image becomes the text logo');
  assert.equal(o.doc.logoText, 'APJC');
  assert.equal(o.sites[0].name, '12');
  assert.equal(o.sites[0].floor.orient, 'h');
  assert.equal(o.sites[0].floor.door, 'center');
  assert.deepEqual(o.sites[0].racks.map((r) => r.size), [42, 42, 42, 24]);
  assert.equal(o.sites[0].diagram.img, null);
  assert.equal(o.sites[0].diagram.caption, '');
  assert.equal(plain(T.migrate({doc: {logo: ''}, sites: []})).doc.logo, '', "'' (text logo) is kept");
  assert.equal(plain(T.migrate({doc: {}, sites: []})).doc.logo, null, 'missing logo → APJC logo');
});

test('migrate: unknown fields are kept at every level', () => {
  const src = v1();
  src.extra = {a: 1};
  src.doc.extra = 'd';
  const s = src.sites[0];
  s.extra = 's'; s.info.extra = 'i'; s.place.extra = 'p'; s.floor.extra = 'f'; s.floor.items[0].extra = 'fi'; s.floor.items[1].racks[0].extra = 'fr';
  s.racks[0].extra = 'r'; s.racks[0].devices[0].extra = 'dv'; s.racks[0].cables[0].extra = 'c'; s.diagram.extra = 'dg';
  const o = plain(T.migrate(src)), t = o.sites[0];
  assert.deepEqual(o.extra, {a: 1});
  assert.equal(o.doc.extra, 'd');
  assert.deepEqual([t.extra, t.info.extra, t.place.extra, t.floor.extra, t.floor.items[0].extra, t.floor.items[1].racks[0].extra,
    t.racks[0].extra, t.racks[0].devices[0].extra, t.racks[0].cables[0].extra, t.diagram.extra],
  ['s', 'i', 'p', 'f', 'fi', 'fr', 'r', 'dv', 'c', 'dg']);
});

test('migrate: cur is clamped to a valid site index', () => {
  const cur = (c) => T.migrate({...v1(), cur: c}).cur;
  assert.equal(cur(1), 1);
  assert.equal(cur('1'), 1);
  assert.equal(cur(2), 0, 'past the end');
  assert.equal(cur(99), 0);
  assert.equal(cur(-1), 0);
  assert.equal(cur(1.5), 0);
  assert.equal(cur('abc'), 0);
  assert.equal(cur(undefined), 0);
  assert.equal(T.migrate({sites: [], cur: 0}).cur, 0);
});

test('startup: a v1 draft in localStorage is migrated on load', () => {
  const src = v1();
  delete src.sites[0].info.surveyors;
  delete src.sites[0].racks[0].cables;
  const A = loadApp('index.html', {storage: {'rack-site-survey-offline-v1': JSON.stringify(src)}});
  assert.equal(A.S.v, 2);
  assert.equal(A.S.sites[0].name, 'NT Data Center Sriracha');
  assert.equal(A.S.sites[0].info.surveyors, '');
  assert.deepEqual(plain(A.S.sites[0].racks[0].cables), []);
});

test('startup: unreadable or empty storage falls back to the sample', () => {
  for (const raw of ['{not json', '{"foo":1}', '{"sites":[]}']) {
    const A = loadApp('index.html', {storage: {'rack-site-survey-offline-v1': raw}});
    assert.equal(A.S.sites.length, 2, raw);
    assert.equal(A.S.sites[0].name, 'NT Data Center Sriracha');
  }
});

test('artifact.html uses its own storage key', () => {
  const A = loadApp('artifact.html', {storage: {'rack-site-survey-v1': JSON.stringify({sites: [{name: 'Hosted'}]})}});
  assert.equal(A.KEY, 'rack-site-survey-v1');
  assert.equal(A.S.sites[0].name, 'Hosted');
});
