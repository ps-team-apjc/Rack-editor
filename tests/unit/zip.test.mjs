import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import {loadApp} from '../helpers/load-app.mjs';
import {readZip, unzip, blobBytes} from '../helpers/zip.mjs';

const T = loadApp();
const enc = (s) => new TextEncoder().encode(s);

test('crc32: known vectors', () => {
  assert.equal(T.crc32(enc('')), 0);
  assert.equal(T.crc32(enc('a')), 0xE8B7BE43);
  assert.equal(T.crc32(enc('123456789')), 0xCBF43926);
  assert.equal(T.crc32(enc('The quick brown fox jumps over the lazy dog')), 0x414FA339);
  assert.equal(T.crc32(new Uint8Array(32)), 0x190A55AD);
  assert.equal(T.crc32(new Uint8Array(32).fill(0xFF)), 0xFF6CAB0B);
});

test('crc32: matches node:zlib on random and Thai data', {skip: typeof zlib.crc32 !== 'function' && 'zlib.crc32 needs Node ≥ 22.2'}, () => {
  for (let n = 0; n < 20; n++) {
    const b = new Uint8Array(1 + n * 97);
    for (let i = 0; i < b.length; i++) b[i] = (i * 2654435761 + n) >>> 24;
    assert.equal(T.crc32(b), zlib.crc32(b));
  }
  const th = enc('ข้อมูลเกี่ยวกับการสำรวจพื้นที่');
  assert.equal(T.crc32(th), zlib.crc32(th));
});

test('zipFiles: a valid stored zip that reads back byte for byte', async () => {
  const bin = new Uint8Array(300).map((_, i) => i & 255);
  const files = [{name: 'a.txt', data: 'hello'}, {name: 'dir/ไทย.xml', data: '<x>ข้อมูล</x>'}, {name: 'bin/data.bin', data: bin},
    {name: 'empty', data: ''}];
  const blob = T.zipFiles(files);
  assert.equal(blob.type, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  const buf = await blobBytes(blob);
  const entries = readZip(buf);
  assert.deepEqual(entries.map((e) => e.name), files.map((f) => f.name), 'order and UTF-8 names');
  for (const e of entries) {
    assert.equal(e.method, 0, 'stored');
    assert.equal(e.flags & 0x0800, 0x0800, 'UTF-8 name flag');
    assert.equal(e.csize, e.usize);
    assert.equal(T.crc32(e.data), e.crc);
  }
  const parts = unzip(buf);
  assert.equal(parts['a.txt'].toString(), 'hello');
  assert.equal(parts['dir/ไทย.xml'].toString(), '<x>ข้อมูล</x>');
  assert.deepEqual(new Uint8Array(parts['bin/data.bin']), bin);
  assert.equal(parts.empty.length, 0);
  // exact size: local headers + central directory + EOCD, nothing else
  const nameLen = files.reduce((a, f) => a + enc(f.name).length, 0);
  const dataLen = files.reduce((a, f) => a + (typeof f.data === 'string' ? enc(f.data).length : f.data.length), 0);
  assert.equal(buf.length, files.length * (30 + 46) + 2 * nameLen + dataLen + 22);
});

test('zipFiles: empty archive is just an EOCD record', async () => {
  const buf = await blobBytes(T.zipFiles([]));
  assert.equal(buf.length, 22);
  assert.deepEqual(readZip(buf), []);
});
