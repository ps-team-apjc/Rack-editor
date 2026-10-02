import test from 'node:test';
import assert from 'node:assert/strict';
import {loadApp, plain} from '../helpers/load-app.mjs';

const T = loadApp();
const ids = (s) => [s.id, ...s.floor.items.map((i) => i.id), ...s.racks.flatMap((r) => [r.id, ...r.devices.map((d) => d.id), ...r.cables.map((c) => c.id)])];

test('blankRack: 42U, one device, two power sources, three cable types, distinct ids', () => {
  const r = plain(T.blankRack());
  assert.equal(r.size, 42);
  assert.equal(r.rack, 'Rack ');
  assert.equal(r.devices.length, 1);
  assert.deepEqual({u: r.devices[0].u, h: r.devices[0].h}, {u: 21, h: 1});
  assert.equal(r.power.length, 2);
  assert.deepEqual(r.cables.map((c) => c.type), ['สาย LOM RJ45', 'สาย Management RJ45', 'สาย Fiber OM3/4 Patch Cord']);
  const all = [r.id, ...r.devices.map((d) => d.id), ...r.cables.map((c) => c.id)];
  assert.equal(new Set(all).size, all.length);
  assert.notEqual(T.blankRack().id, T.blankRack().id);
});

test('blankSite: named by number, valid after migrate, fresh ids each call', () => {
  const a = plain(T.blankSite(3)), b = plain(T.blankSite(3));
  assert.equal(a.name, 'New site 3');
  assert.equal(a.racks.length, 1);
  assert.deepEqual(a.floor.items.map((i) => i.type), ['label', 'row', 'label']);
  assert.deepEqual(a.diagram, {img: null, caption: ''});
  assert.equal(new Set(ids(a)).size, ids(a).length, 'ids unique within a site');
  assert.equal(ids(a).filter((x) => ids(b).includes(x)).length, 0, 'no ids shared between two blank sites');
  const m = plain(T.migrate({sites: [plain(a)]}));
  assert.deepEqual(m.sites[0], a, 'a blank site is already normalised');
});

test('cloneSite: deep copy with fresh ids and "(copy)" name', () => {
  const src = T.sample().sites[0];
  const before = plain(src);
  const c = T.cloneSite(src);
  assert.equal(c.name, src.name + ' (copy)');
  const a = ids(before), b = ids(plain(c));
  assert.equal(a.length, b.length);
  assert.equal(b.filter((x) => a.includes(x)).length, 0, 'every id is new');
  assert.equal(new Set(b).size, b.length);
  // same content apart from ids and name
  const strip = (s) => JSON.parse(JSON.stringify(s, (k, v) => (k === 'id' ? undefined : v)));
  assert.deepEqual({...strip(plain(c)), name: ''}, {...strip(before), name: ''});
  // deep: changing the clone leaves the original alone
  c.racks[0].devices[0].name = 'changed';
  c.floor.items[1].racks[0].on = false;
  assert.deepEqual(plain(src), before);
});

test('sample(): two sites, v2, valid against migrate', () => {
  const s = plain(T.sample());
  assert.equal(s.v, T.SCHEMA);
  assert.deepEqual(s.sites.map((x) => x.name), ['NT Data Center Sriracha', 'NT Data Center Bangkok']);
  assert.deepEqual(s.sites.map((x) => x.racks.length), [3, 3]);
  assert.deepEqual(plain(T.migrate(plain(s))), s);
});
