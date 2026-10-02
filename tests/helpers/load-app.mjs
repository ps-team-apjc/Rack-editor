// Loads the app's <script> from index.html (or artifact.html) into a node:vm sandbox with a minimal fake
// browser, and exposes the IIFE internals as `T` for unit tests.
//
// Test-only mechanism: the shipped file is never modified. We read the HTML, take the IIFE source, and
// append `globalThis.__T={...}` just before the IIFE's closing `})();` in an in-memory copy only.
//
// The fake browser is deliberately small:
//  - `document`, `window` & co. are "anything goes" proxies, so DOM wiring at startup runs without throwing.
//  - `localStorage` is a real in-memory Storage (seedable, to test the load path).
//  - `setTimeout` is a no-op (debounced saves / timers never fire, nothing keeps the process alive).
//  - `Image` reads the PNG/JPEG header of data: URLs for naturalWidth/Height and fires onload; SVG data
//    URLs get the size from the viewBox. `<canvas>.toDataURL()` returns a fixed 1x1 PNG. So buildDocx()
//    produces the same XML as the browser; only rasterised SVG pictures differ (they are placeholders).
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

// 1x1 white PNG used for every rasterised SVG in the sandbox.
export const PNG_1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';

const EXPOSE = ['migrate', 'normSite', 'sample', 'blankSite', 'blankRack', 'cloneSite', 'unitsOf', 'uLabel', 'devErrors',
  'rackStat', 'toMarkdown', 'crc32', 'zipFiles', 'buildDocx', 'SECTIONS', 'secX', 'pagePlan', 'docHTML', 'siteHTML',
  'esc', 'rackSVG', 'floorSVG', 'rackCard', 'card', 'SCHEMA', 'KEY', 'inlineImages', 'imgURL', 'logoSrc', 'logoHTML',
  'APJC_LOGO', 'dataUrlBytes', 'exportJSON', 'doAct'];

/** Extract the IIFE source from the app HTML and append the test hook (in memory only). */
export function appSource(file = 'index.html') {
  const html = read(file);
  const a = html.indexOf('<script>\n(function(){');
  const b = html.lastIndexOf('\n})();\n</script>');
  if (a < 0 || b < 0) throw new Error(`cannot find the app IIFE in ${file}`);
  const body = html.slice(a + '<script>\n'.length, b);           // "(function(){ ... " without the final "})();"
  const hook = `\nglobalThis.__T={get S(){return S},set S(v){S=v},${EXPOSE.join(',')}};\n`;
  return body + hook + '})();\n';
}

/** Anything-goes stub: every property is another stub, calls/constructs return stubs, sets are stored. */
function stub(init = {}) {
  const store = {...init};
  return new Proxy(function () {}, {
    get(t, k) {
      if (k in store) return store[k];
      if (k === Symbol.toPrimitive) return () => '';
      if (k === Symbol.iterator) return function* () {};
      if (k === 'then') return undefined;                // never thenable, so `await stub` is fine
      if (k === 'length') return 0;
      if (typeof k === 'symbol') return undefined;
      return (store[k] = stub());
    },
    set(t, k, v) { store[k] = v; return true; },
    apply() { return stub(); },
    construct() { return stub(); },
  });
}

function pngSize(b) {               // IHDR width/height
  return {w: b.readUInt32BE(16), h: b.readUInt32BE(20)};
}
function jpegSize(b) {
  let p = 2;
  while (p < b.length) {
    if (b[p] !== 0xFF) { p++; continue; }
    const m = b[p + 1], len = b.readUInt16BE(p + 2);
    if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return {w: b.readUInt16BE(p + 7), h: b.readUInt16BE(p + 5)};
    p += 2 + len;
  }
  return null;
}
export function dataUrlSize(u) {
  if (u.startsWith('data:image/svg+xml')) {
    const svg = decodeURIComponent(u.slice(u.indexOf(',') + 1));
    const m = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
    return m ? {w: +m[1], h: +m[2]} : null;
  }
  const m = /^data:image\/([\w.+-]+);base64,(.*)$/s.exec(u);
  if (!m) return null;
  const b = Buffer.from(m[2], 'base64');
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) return pngSize(b);
  if (b[0] === 0xFF && b[1] === 0xD8) return jpegSize(b);
  return null;
}

class FakeImage {
  constructor() { this.onload = null; this.onerror = null; this.naturalWidth = 0; this.naturalHeight = 0; }
  set src(u) {
    this._src = u;
    const sz = dataUrlSize(String(u));
    queueMicrotask(() => {
      if (sz) { this.naturalWidth = this.width = sz.w; this.naturalHeight = this.height = sz.h; this.onload && this.onload(); }
      else this.onerror && this.onerror(new Error('bad image'));
    });
  }
  get src() { return this._src; }
}

function fakeCanvas() {
  return {width: 0, height: 0, getContext: () => stub(), toDataURL: () => PNG_1x1};
}

class MemStorage {
  constructor(seed = {}) { this.m = new Map(Object.entries(seed)); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

/**
 * Load the app into a fresh sandbox. Returns T: the exposed internals (T.S is a live getter/setter).
 * opts.storage: initial localStorage entries, e.g. {[KEY]: JSON.stringify(v1State)}.
 */
export function loadApp(file = 'index.html', opts = {}) {
  const document = stub({
    createElement: (tag) => (tag === 'canvas' ? fakeCanvas() : stub()),
  });
  const localStorage = new MemStorage(opts.storage);
  const ctx = {
    document, localStorage, sessionStorage: new MemStorage(),
    indexedDB: stub(), navigator: stub(), matchMedia: () => stub({matches: false}),
    getComputedStyle: () => stub(), requestAnimationFrame: () => 0, addEventListener: () => {},
    scrollTo: () => {}, scrollY: 0, innerHeight: 900, innerWidth: 1440,
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    queueMicrotask, Image: FakeImage, XMLSerializer: stub(), ClipboardItem: stub(), FileReader: stub(),
    URL, Blob, TextEncoder, TextDecoder, atob, btoa, console,
    DOMException: globalThis.DOMException, HTMLAnchorElement: stub(),
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(appSource(file), ctx, {filename: file});
  const T = ctx.__T;
  T.localStorage = localStorage;
  return T;
}

/** Deep-copy across realms (vm objects → plain host objects) so assert.deepStrictEqual works. */
export const plain = (o) => JSON.parse(JSON.stringify(o));

/** Load sample.json into the app as the JSON import does (migrate, cur=0). */
export function loadSample(T) {
  const o = T.migrate(JSON.parse(read('sample.json')));
  o.cur = 0;
  T.S = o;
  return o;
}
