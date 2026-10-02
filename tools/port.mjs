#!/usr/bin/env node
// Generates artifact.html (the claude.ai hosted build) from index.html (the offline build), applying the
// documented differences from CLAUDE.md ("Keep the two HTML files in sync"):
//   wrapper (no doctype/html/head/body, <title> first + Google Fonts links), fonts, no print CSS,
//   localStorage key, SVG/Word font names, no Print button, no Download .md, no dl() helper (saveFile only),
//   no CSP meta (it lives in <head>, which the host owns). It also refreshes the CSP script hash in index.html.
//
//   node tools/port.mjs           write artifact.html
//   node tools/port.mjs --check   exit 1 if artifact.html differs from the generated output
//
// Every replacement asserts how many times its anchor occurs, so a change in index.html that breaks an
// anchor fails loudly instead of producing a half-ported file. Fix the anchor here when that happens.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const HEAD = `<title>Rack Site Survey Editor</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&family=Sarabun:wght@400;600;700&display=swap">`;

/** index.html source → artifact.html source (both with LF line endings). */
export function port(indexHtml) {
  let s = indexHtml.replace(/\r\n/g, '\n');
  const sub = (a, b, cnt = 1) => {
    const n = s.split(a).length - 1;
    if (n !== cnt) throw new Error(`port: expected ${cnt} occurrence(s), found ${n}: ${a.slice(0, 80)}`);
    s = s.split(a).join(b);
  };
  const re = (rx, b) => {
    if (!rx.test(s)) throw new Error(`port: pattern not found: ${rx}`);
    s = s.replace(rx, b);
  };

  // Wrapper: the host page supplies doctype/html/head/body and the viewport meta.
  const i0 = s.indexOf('<style>');
  if (i0 < 0) throw new Error('port: no <style> block');
  s = HEAD + '\n' + s.slice(i0);
  sub('</style>\n</head>\n<body>\n', '</style>\n\n');
  sub('\n\n</body>\n</html>\n', '\n');

  // Fonts: system fonts offline, Google Fonts when hosted.
  sub(`  --ui:"Leelawadee UI","Segoe UI","Noto Sans Thai",Tahoma,sans-serif;
  --docf:"Leelawadee UI","Sarabun","Noto Sans Thai",Tahoma,sans-serif;
  --mono:Consolas,"Cascadia Mono",ui-monospace,monospace;`, `  --ui:"IBM Plex Sans Thai",system-ui,"Segoe UI",Tahoma,sans-serif;
  --docf:"Sarabun","IBM Plex Sans Thai",Tahoma,sans-serif;
  --mono:"IBM Plex Mono",ui-monospace,Consolas,monospace;`);

  // No print CSS / @page (the host frame blocks window.print).
  sub('@page{size:A4;margin:0}\n', '');
  {
    const a = s.indexOf('@media print{'), b = s.indexOf('@media (prefers-reduced-motion');
    if (a < 0 || b < a) throw new Error('port: print block not found before the reduced-motion block');
    s = s.slice(0, a) + s.slice(b);
  }

  // Script differences.
  sub("const KEY='rack-site-survey-offline-v1';", "const KEY='rack-site-survey-v1';");
  sub('font-family="Leelawadee UI,Sarabun,Tahoma,sans-serif"', 'font-family="Sarabun,Tahoma,sans-serif"', 2);
  sub('font-family="Consolas,monospace"', 'font-family="IBM Plex Mono,monospace"');
  sub("pg.style.cssText='font-family:Leelawadee UI,Tahoma,sans-serif;", "pg.style.cssText='font-family:Sarabun,Tahoma,sans-serif;");

  // No Print button.
  re(/ *<button type="button" role="menuitem" id="bPrint">.*<\/button>\n/, '');
  sub("$('bPrint').onclick=()=>window.print();\n", '');

  // No Download .md and no <a download> helper: downloads go through saveFile().
  sub('<button class="btn sm" type="button" id="mdDl">ดาวน์โหลด .md</button>', '');
  sub("  $('mdDl').onclick=()=>dl('site-survey.md',md,'text/markdown');\n", '');
  sub('<span class="k">คัดลอก / .md</span>', '<span class="k">Copy</span>');
  re(/function dl\(name,text,type\)\{.*\n/, '');
  re(/\$\('bDl'\)\.onclick=\(\)=>\{const n=.*\n/, "$('bDl').onclick=()=>saveFile(fileBase()+'.json',exportJSON(),'application/json');\n");

  if (/window\.print|function dl\(|<!doctype|<\/html>\n*$/i.test(s)) throw new Error('port: offline-only code left in the hosted build');
  return s;
}

/**
 * index.html carries a Content-Security-Policy <meta> whose script-src is the sha256 of its one inline <script>
 * (so injected inline handlers / scripts cannot run). Any edit to the script changes the hash: withCsp() rewrites it.
 * The browser hashes the parsed script text, i.e. with CRLF normalised to LF.
 */
export function cspHash(indexHtml) {
  const s = indexHtml.replace(/\r\n/g, '\n');
  const scripts = [...s.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  if (scripts.length !== 1) throw new Error(`csp: expected exactly 1 inline <script>, found ${scripts.length}`);
  return 'sha256-' + crypto.createHash('sha256').update(scripts[0][1], 'utf8').digest('base64');
}
const CSP_RE = /(<meta http-equiv="Content-Security-Policy" content="[^"]*script-src ')sha256-[^']*(')/;
export function withCsp(indexHtml) {
  if (!CSP_RE.test(indexHtml)) throw new Error('csp: Content-Security-Policy meta with a script-src hash not found in index.html');
  return indexHtml.replace(CSP_RE, `$1${cspHash(indexHtml)}$2`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const src = path.join(ROOT, 'index.html');
  const idx = fs.readFileSync(src, 'utf8'), fixed = withCsp(idx);
  if (fixed !== idx) {
    if (process.argv.includes('--check')) { console.error('index.html: the CSP script hash is stale. Run: node tools/port.mjs'); process.exit(1); }
    fs.writeFileSync(src, fixed);
    console.log('updated the CSP script hash in index.html');
  }
  const out = port(fixed);
  const dest = path.join(ROOT, 'artifact.html');
  if (process.argv.includes('--check')) {
    const cur = fs.readFileSync(dest, 'utf8').replace(/\r\n/g, '\n');
    if (cur !== out) {
      let i = 0; while (i < cur.length && cur[i] === out[i]) i++;
      const line = cur.slice(0, i).split('\n').length;
      console.error(`artifact.html is out of sync with index.html (first difference on line ${line}). Run: node tools/port.mjs`);
      process.exit(1);
    }
    console.log('artifact.html is in sync with index.html');
  } else {
    fs.writeFileSync(dest, out);
    console.log(`wrote artifact.html (${out.length} chars)`);
  }
}
