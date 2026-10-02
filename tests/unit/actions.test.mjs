import test from 'node:test';
import assert from 'node:assert/strict';
import {loadApp, plain} from '../helpers/load-app.mjs';

const T = loadApp();
const fresh = () => { T.S = T.sample(); return T.S.sites[0]; };
const elementIds = (html) => [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);

test('rDup: the copy gets fresh rack, device and cable ids (no duplicate element ids)', () => {
  const s = fresh();
  s.racks[0].devices.push({id: 'd2', name: 'Second', u: 30, h: 2});
  T.doAct('rDup', 0);
  const [a, b] = s.racks;
  assert.notEqual(b.id, a.id);
  for (const d of b.devices) assert.ok(!a.devices.some((x) => x.id === d.id), 'device id reused');
  for (const c of b.cables) assert.ok(!a.cables.some((x) => x.id === c.id), 'cable id reused');
  const strip = (r) => JSON.parse(JSON.stringify(r, (k, v) => (k === 'id' ? undefined : v)));
  assert.deepEqual(strip(plain(b)), strip(plain(a)), 'same content');
  const ids = elementIds(T.rackCard(a, 0, 'sites.0', 0) + T.rackCard(b, 1, 'sites.0', 0));
  assert.deepEqual(ids.filter((x, i) => ids.indexOf(x) !== i), [], 'element ids unique across the two rack cards');
});

test('dAdd: new device goes just above the highest one, else the first free U', () => {
  const s = fresh(), r = s.racks[0];                    // one device at U 21
  T.doAct('dAdd', 0);
  assert.deepEqual({u: r.devices[1].u, h: r.devices[1].h, name: r.devices[1].name}, {u: 22, h: 1, name: ''});
  r.devices = [{id: 'top', name: 'top', u: 42, h: 1}, {id: 'low', name: 'low', u: 1, h: 2}];
  T.doAct('dAdd', 0);
  assert.equal(r.devices[2].u, 3, 'above U 42 is full → first free U');
  r.devices = [];
  T.doAct('dAdd', 0);
  assert.equal(r.devices[0].u, 21, 'empty rack → U 21');
});

test('site actions: add, duplicate, move, delete keeps at least one site', () => {
  fresh();
  T.doAct('addSite');
  assert.equal(T.S.sites.length, 3);
  assert.equal(T.S.cur, 2);
  assert.equal(T.S.sites[2].name, 'New site 3');
  T.doAct('moveL');
  assert.equal(T.S.cur, 1);
  assert.equal(T.S.sites[1].name, 'New site 3');
  T.doAct('dupSite');
  assert.equal(T.S.sites[2].name, 'New site 3 (copy)');
  T.S = T.migrate({sites: [{name: 'only'}]});
  assert.equal(T.doAct('delSite'), false, 'the last site cannot be deleted');
  assert.equal(T.S.sites.length, 1);
  assert.equal(T.doAct('nope'), false, 'unknown action does nothing');
});

test('floor actions: add row / label, move, delete', () => {
  const s = fresh(), n = s.floor.items.length;
  T.doAct('fAddRow');
  T.doAct('fAddLbl');
  assert.deepEqual(plain(s.floor.items.slice(n).map((i) => i.type)), ['row', 'label']);
  T.doAct('fUp', n + 1);
  assert.deepEqual(plain(s.floor.items.slice(n).map((i) => i.type)), ['label', 'row']);
  T.doAct('fDel', n);
  assert.equal(s.floor.items.length, n + 1);
  T.doAct('fUp', 0);
  assert.equal(s.floor.items.length, n + 1, 'moving the first item up is a no-op');
});
