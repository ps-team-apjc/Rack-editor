// Golden outputs for sample.json: the Markdown export and every DOCX part.
//
// Layout (all committed):
//   tests/golden/sample.md            toMarkdown() of sample.json
//   tests/golden/docx/<part>          every XML/rels part of the .docx except docProps/core.xml (it holds a timestamp)
//   tests/golden/docx/media.json      media part names → sha256 of the bytes, or "raster" for SVG drawings that the
//                                     browser rasterises (their pixels depend on the renderer, so only the name is checked)
//
// Used by tests/golden/golden.test.mjs (node:vm build) and tests/e2e/run.mjs (real browser build), so both
// must produce the same Markdown and XML.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {loadApp, loadSample, PNG_1x1} from '../helpers/load-app.mjs';
import {unzip, blobBytes} from '../helpers/zip.mjs';

export const GOLDEN = path.dirname(fileURLToPath(import.meta.url));
const DOCX_DIR = path.join(GOLDEN, 'docx');
const IGNORED = new Set(['docProps/core.xml']);
const PLACEHOLDER = Buffer.from(PNG_1x1.split(',')[1], 'base64');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const isMedia = (n) => n.startsWith('word/media/');

/** Markdown + DOCX parts of sample.json, built in the node:vm sandbox. */
export async function vmOutputs(file = 'index.html') {
  const T = loadApp(file);
  loadSample(T);
  const md = T.toMarkdown();
  const parts = unzip(await blobBytes(await T.buildDocx()));
  return {md, parts};
}

/** media part → sha256, or "raster" for rasterised drawings (placeholder PNG in the vm build). */
function mediaManifest(parts, rasterNames) {
  const m = {};
  for (const n of Object.keys(parts).filter(isMedia).sort()) {
    m[n] = rasterNames ? (rasterNames.has(n) ? 'raster' : sha(parts[n])) : (parts[n].equals(PLACEHOLDER) ? 'raster' : sha(parts[n]));
  }
  return m;
}

export function writeGolden({md, parts}) {
  fs.writeFileSync(path.join(GOLDEN, 'sample.md'), md);
  fs.rmSync(DOCX_DIR, {recursive: true, force: true});
  for (const [n, b] of Object.entries(parts)) {
    if (IGNORED.has(n) || isMedia(n)) continue;
    const f = path.join(DOCX_DIR, n);
    fs.mkdirSync(path.dirname(f), {recursive: true});
    fs.writeFileSync(f, b);
  }
  fs.writeFileSync(path.join(DOCX_DIR, 'media.json'), JSON.stringify(mediaManifest(parts), null, 2) + '\n');
}

function listFiles(dir, base = dir) {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? listFiles(p, base) : [path.relative(base, p).split(path.sep).join('/')];
  });
}

function firstDiff(a, b) {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  const ctx = (s) => JSON.stringify(s.slice(Math.max(0, i - 80), i + 120));
  return `first difference at char ${i}\n    golden: ${ctx(a)}\n    actual: ${ctx(b)}`;
}

/**
 * Compare outputs to the committed golden files. Returns a list of problems ([] = identical).
 * Text is compared with CRLF normalised, so a CRLF checkout (core.autocrlf) does not matter.
 */
export function compareGolden({md, parts}) {
  const bad = [];
  const text = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
  if (!fs.existsSync(path.join(GOLDEN, 'sample.md'))) return ['golden files missing: run  node tests/golden/golden.test.mjs --update'];
  const gmd = text(path.join(GOLDEN, 'sample.md'));
  if (gmd !== md) bad.push(`sample.md: ${firstDiff(gmd, md)}`);

  const golden = listFiles(DOCX_DIR).filter((n) => n !== 'media.json').sort();
  const actual = Object.keys(parts).filter((n) => !IGNORED.has(n) && !isMedia(n)).sort();
  if (golden.join() !== actual.join()) bad.push(`docx part list differs\n    golden: ${golden}\n    actual: ${actual}`);
  for (const n of actual) {
    if (!golden.includes(n)) continue;
    const g = text(path.join(DOCX_DIR, n)), a = parts[n].toString('utf8');
    if (g !== a) bad.push(`docx ${n}: ${firstDiff(g, a)}`);
  }
  const gm = JSON.parse(text(path.join(DOCX_DIR, 'media.json')));
  const raster = new Set(Object.keys(gm).filter((n) => gm[n] === 'raster'));
  const am = mediaManifest(parts, raster);
  if (JSON.stringify(gm) !== JSON.stringify(am)) bad.push(`docx media differs\n    golden: ${JSON.stringify(gm)}\n    actual: ${JSON.stringify(am)}`);
  return bad;
}
