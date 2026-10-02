// Minimal ZIP reader for the app's stored (uncompressed) archives. Reads the central directory, then
// each local header, and checks every entry's CRC-32 against node:zlib when available.
import zlib from 'node:zlib';

export function readZip(buf) {
  buf = Buffer.from(buf.buffer ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) : buf);
  // End of central directory: last 22 bytes (the app writes no comment).
  let eocd = -1;
  for (let p = buf.length - 22; p >= Math.max(0, buf.length - 22 - 0xFFFF); p--) {
    if (buf.readUInt32LE(p) === 0x06054b50) { eocd = p; break; }
  }
  if (eocd < 0) throw new Error('no end-of-central-directory record');
  const count = buf.readUInt16LE(eocd + 10), cdSize = buf.readUInt32LE(eocd + 12), cdOff = buf.readUInt32LE(eocd + 16);
  if (cdOff + cdSize !== eocd) throw new Error(`central directory at ${cdOff}+${cdSize} does not end at EOCD ${eocd}`);
  const entries = [];
  let p = cdOff;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`bad central header #${i}`);
    const method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16), csize = buf.readUInt32LE(p + 20),
      usize = buf.readUInt32LE(p + 24), nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32),
      flags = buf.readUInt16LE(p + 8), lho = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nl).toString('utf8');
    if (buf.readUInt32LE(lho) !== 0x04034b50) throw new Error(`bad local header for ${name}`);
    const lnl = buf.readUInt16LE(lho + 26), lxl = buf.readUInt16LE(lho + 28);
    if (buf.subarray(lho + 30, lho + 30 + lnl).toString('utf8') !== name) throw new Error(`local/central name mismatch for ${name}`);
    if (buf.readUInt32LE(lho + 14) !== crc) throw new Error(`local/central CRC mismatch for ${name}`);
    const data = buf.subarray(lho + 30 + lnl + lxl, lho + 30 + lnl + lxl + csize);
    entries.push({name, method, crc, csize, usize, flags, data});
    p += 46 + nl + xl + cl;
  }
  return entries;
}

/** {name: Buffer}; throws if any entry is compressed or its CRC is wrong. */
export function unzip(buf) {
  const out = {};
  for (const e of readZip(buf)) {
    if (e.method !== 0) throw new Error(`${e.name}: expected stored (method 0), got ${e.method}`);
    if (e.csize !== e.usize) throw new Error(`${e.name}: stored entry sizes differ`);
    if (typeof zlib.crc32 === 'function' && zlib.crc32(e.data) !== e.crc) throw new Error(`${e.name}: CRC mismatch`);
    out[e.name] = Buffer.from(e.data);
  }
  return out;
}

export async function blobBytes(blob) {
  return Buffer.from(await blob.arrayBuffer());
}
