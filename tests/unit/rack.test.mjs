import test from 'node:test';
import assert from 'node:assert/strict';
import {loadApp, plain} from '../helpers/load-app.mjs';

const T = loadApp();
const rack = (devices, extra = {}) => ({id: 'r', device: 'MPX9200', rack: 'Rack G3', size: 42, devices,
  power: ['p'], cables: [{id: 'c', type: 't', text: 'run'}], ...extra});
const dev = (name, u, h = 1) => ({id: name, name, u, h});
const errs = (r) => plain(T.devErrors(r));

test('unitsOf: sums device heights', () => {
  assert.equal(T.unitsOf(rack([])), 0);
  assert.equal(T.unitsOf(rack([dev('a', 21)])), 1);
  assert.equal(T.unitsOf(rack([dev('a', 21, 2), dev('b', 10, '3')])), 5);
  assert.equal(T.unitsOf(rack([dev('a', 21, '')])), 0, 'empty height counts 0');
});

test('uLabel: single, multi-U, skips devices without U', () => {
  assert.equal(T.uLabel(rack([dev('a', 21)])), 'U 21');
  assert.equal(T.uLabel(rack([dev('a', 21, 2)])), 'U 21–22');
  assert.equal(T.uLabel(rack([dev('a', '21', '3')])), 'U 21–23', 'string values from inputs');
  assert.equal(T.uLabel(rack([dev('a', 1), dev('b', 40, 3)])), 'U 1, U 40–42');
  assert.equal(T.uLabel(rack([dev('a', ''), dev('b', 5)])), 'U 5');
  assert.equal(T.uLabel(rack([])), '');
});

test('devErrors: valid edges U 1 and U 42 are fine', () => {
  assert.deepEqual(errs(rack([dev('a', 1), dev('b', 42)])), {});
  assert.deepEqual(errs(rack([dev('a', 41, 2)])), {});
  assert.deepEqual(errs(rack([dev('a', 1, 42)])), {});
  assert.deepEqual(errs(rack([dev('a', '')])), {}, 'no U yet → no error');
});

test('devErrors: out of range', () => {
  const e = errs(rack([dev('a', 42, 2)]));
  assert.deepEqual(Object.keys(e), ['0']);
  assert.equal(e[0], 'เกินขนาดตู้ — ใช้ได้เฉพาะ U 1–42');
  assert.ok(errs(rack([dev('a', 43)]))[0]);
  assert.ok(errs(rack([dev('a', -1)]))[0], 'negative U');
  assert.equal(errs(rack([dev('a', 24, 2)], {size: 24}))[0], 'เกินขนาดตู้ — ใช้ได้เฉพาะ U 1–24', 'uses the rack size');
  assert.deepEqual(errs(rack([dev('a', 2, 42)])), {0: 'เกินขนาดตู้ — ใช้ได้เฉพาะ U 1–42'});
});

test('devErrors: overlap names the earlier device and the unit', () => {
  const e = errs(rack([dev('Server A', 21, 2), dev('Switch B', 22)]));
  assert.deepEqual(Object.keys(e), ['1'], 'only the later device is flagged');
  assert.match(e[1], /^ทับซ้อนกับ Server A ที่ U 22 /);
  const same = errs(rack([dev('X', 5), dev('Y', 5)]));
  assert.match(same[1], /ทับซ้อนกับ X ที่ U 5/);
  const unnamed = errs(rack([dev('', 5), dev('Y', 5)]));
  assert.match(unnamed[1], /ทับซ้อนกับ อุปกรณ์อื่น ที่ U 5/);
  assert.deepEqual(errs(rack([dev('a', 21, 2), dev('b', 23)])), {}, 'adjacent is not overlapping');
  // out of range wins over overlap for the same device
  const both = errs(rack([dev('a', 42), dev('b', 42, 2)]));
  assert.match(both[1], /^เกินขนาดตู้/);
});

test('rackStat: full / part / empty', () => {
  assert.equal(T.rackStat(rack([dev('a', 21)])), 'full');
  assert.equal(T.rackStat(rack([dev('a', 21), dev('b', 21)])), 'part', 'errors downgrade full → part');
  assert.equal(T.rackStat({device: '', rack: '', size: 42, devices: [], power: [], cables: []}), 'empty');
  assert.equal(T.rackStat({device: '', rack: 'Rack ', size: 42, devices: [dev('', 21)], power: [''], cables: [{text: ' '}]}), 'empty',
    'placeholder "Rack " and blanks do not count');
  assert.equal(T.rackStat(T.blankRack()), 'part', 'a blank rack only has its default power sources');
});

test('the sample racks are all valid and complete', () => {
  T.S = T.sample();
  for (const s of T.S.sites) for (const r of s.racks) {
    assert.deepEqual(errs(r), {}, r.rack);
    assert.equal(T.rackStat(r), 'full', r.rack);
    assert.equal(T.unitsOf(r), 1);
  }
});
