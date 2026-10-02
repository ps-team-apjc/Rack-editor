#!/usr/bin/env node
// Browser end-to-end checks for index.html and artifact.html in headless Chrome / Edge (no dependencies).
//
//   node tests/e2e/run.mjs                      both targets, all suites
//   node tests/e2e/run.mjs --only index         one target (index | artifact)
//   node tests/e2e/run.mjs --suite ui           one suite (behaviour | ui | golden | security)
//   node tests/e2e/run.mjs --browser "C:/…/msedge.exe"   or set CHROME_PATH
//
// Suites (each runs in its own browser with a fresh temporary profile, killed afterwards):
//   behaviour  storage, schema migration, undo/redo, IndexedDB images, import/export, quota banner, image GC
//   ui         card state, focus/scroll keeping, outline rail + scroll-spy, delete arming, tabs, modal, floor
//              cells, device table errors, reset flow, phone layout
//   golden     Markdown + DOCX of sample.json from the real browser equal tests/golden/ (see golden.test.mjs)
//   security   importing tests/fixtures/malicious.json runs no injected script (sentinel window.__pwned stays unset)
//
// Pages are copied to a temp dir first. artifact.html gets a viewport <meta> prepended, because the
// claude.ai host page supplies it. Exits 0 with a SKIP message when no browser is installed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {launch, findBrowser, sleep, HELPERS} from './cdp.mjs';
import {unzip} from '../helpers/zip.mjs';
import {compareGolden} from '../golden/golden-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const TARGETS = [
  {name: 'index', file: 'index.html', key: 'rack-site-survey-offline-v1'},
  {name: 'artifact', file: 'artifact.html', key: 'rack-site-survey-v1'},
].filter((t) => !arg('--only') || t.name === arg('--only'));
const SUITES = {behaviour, ui, golden, security};
const suiteNames = arg('--suite') ? [arg('--suite')] : Object.keys(SUITES);
const IMG = fs.readFileSync(path.join(ROOT, 'tests/fixtures/diagram.dataurl.txt'), 'utf8').trim();
const SAMPLE = fs.readFileSync(path.join(ROOT, 'sample.json'), 'utf8');
const MAL = fs.readFileSync(path.join(ROOT, 'tests/fixtures/malicious.json'), 'utf8');
// Network noise from Google Fonts in artifact.html (offline machines) is not an app error.
const isNoise = (e) => /fonts\.(googleapis|gstatic)\.com/.test(e);

const explicit = arg('--browser') || process.env.CHROME_PATH;
const exe = findBrowser(explicit);
if (!exe && explicit) {
  console.error(`browser not found at ${explicit} (from --browser / CHROME_PATH)`);
  process.exit(2);
}
if (!exe) {
  console.log('SKIP: no Chrome / Edge / Chromium found. Install one or set CHROME_PATH=/path/to/chrome to run the e2e tests.');
  process.exit(0);
}
for (const s of suiteNames) if (!SUITES[s]) { console.error(`unknown suite ${s}`); process.exit(2); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rsse-e2e-'));
process.on('exit', () => { try { fs.rmSync(tmp, {recursive: true, force: true, maxRetries: 10, retryDelay: 200}); } catch { /* best effort */ } });
console.log(`browser: ${exe}`);
const t0 = Date.now();
const totals = {pass: 0, fail: 0};

for (const tg of TARGETS) {
  let src = fs.readFileSync(path.join(ROOT, tg.file), 'utf8');
  if (tg.name === 'artifact') src = '<meta name="viewport" content="width=device-width, initial-scale=1">\n' + src;
  const page = path.join(tmp, tg.file);
  fs.writeFileSync(page, src);
  const url = 'file:///' + page.split(path.sep).join('/').replace(/^\/+/, '');
  for (const sn of suiteNames) {
    const b = await launch(exe, {tmpRoot: tmp});
    const res = {pass: 0, fail: 0};
    const ok = (n, c, extra = '') => {
      console.log(`  ${c ? 'PASS' : 'FAIL'} ${n}${extra && !c ? '  ' + extra : ''}`);
      c ? res.pass++ : res.fail++;
    };
    console.log(`\n[${tg.name}] ${sn}`);
    try {
      await SUITES[sn]({b, ok, url, KEY: tg.key, tg});
      ok('no console or page errors', b.errors.filter((e) => !isNoise(e)).length === 0, JSON.stringify(b.errors.filter((e) => !isNoise(e))));
    } catch (e) {
      ok('suite ran to completion', false, e.stack || String(e));
    } finally {
      await b.close();
    }
    console.log(`  → ${res.pass} passed, ${res.fail} failed`);
    totals.pass += res.pass; totals.fail += res.fail;
  }
}
console.log(`\n${totals.fail ? 'FAILED' : 'ALL PASS'}: ${totals.pass} passed, ${totals.fail} failed in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exitCode = totals.fail ? 1 : 0;

/* ------------------------------------------------------------------ helpers */
function tools(b, url, KEY) {
  const ev = b.ev;
  const reload = async () => {
    await b.go(url);
    for (let i = 0; i < 100 && !(await ev(`document.querySelectorAll('#doc .page').length>0`)); i++) await sleep(100);
    await sleep(300);
    await ev(HELPERS);
  };
  const LS = async () => JSON.parse((await ev(`localStorage.getItem(${JSON.stringify(KEY)})`)) || 'null');
  const waitLS = async (f, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await LS(); if (v && f(v)) return v; await sleep(200); } return LS(); };
  const waitFor = async (expr, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr)) return true; await sleep(100); } return false; };
  const setField = (sel, val) => ev(`(()=>{const el=document.querySelector(${JSON.stringify(sel)});el.focus();el.value=${JSON.stringify(val)};el.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  const ctrl = (k, shift = false, target = 'document.body') => ev(`(()=>{const t=${target};t.dispatchEvent(new KeyboardEvent('keydown',{key:'${k}',ctrlKey:true,shiftKey:${shift},bubbles:true,cancelable:true}));return 1})()`);
  const key = (sel, k, o = {}) => ev(`(()=>{const t=${sel};t.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(k)},shiftKey:${!!o.shift},bubbles:true,cancelable:true}));return 1})()`);
  const idbKeys = () => ev(`new Promise(r=>{const q=indexedDB.open(${JSON.stringify(KEY + '-img')});q.onsuccess=()=>{const g=q.result.transaction('img').objectStore('img').getAllKeys();g.onsuccess=()=>r(g.result)}})`);
  const loadJson = async (txt) => {
    const err = await ev(`__loadJson(${JSON.stringify(txt)})`);
    if (!err) await waitFor(`!document.getElementById('modalRoot').firstChild`);
    return err;
  };
  return {ev, reload, LS, waitLS, waitFor, setField, ctrl, key, idbKeys, loadJson};
}

/* ------------------------------------------------------------------ behaviour */
async function behaviour({b, ok, url, KEY}) {
  const {ev, reload, LS, waitLS, waitFor, setField, ctrl, idbKeys, loadJson} = tools(b, url, KEY);
  const nRackPages = () => ev(`document.querySelectorAll('#doc [id^="pv-0-racks-rack-"]').length`);
  await reload();
  ok('sample loads (cover + TOC + 10 pages)', (await ev(`document.querySelectorAll('#doc .page').length`)) === 12);
  ok('preview meta says 12 pages', /^12 /.test(await ev(`document.getElementById('pvMeta').textContent`)));
  // edit + reload
  await setField('[data-b="sites.0.info.agency"]', 'NTDC-EDITED');
  ok('saved state has v=2', (await waitLS((v) => v.v === 2 && v.sites[0].info.agency === 'NTDC-EDITED'))?.v === 2);
  ok('typing updates the preview', await waitFor(`document.getElementById('pv-0').textContent.includes('NTDC-EDITED')`, 3000));
  await reload();
  ok('edit survives reload', (await ev(`document.querySelector('[data-b="sites.0.info.agency"]').value`)) === 'NTDC-EDITED');
  // element ids
  ok('editor ids', await ev(`['ed-doc','ed-0-site','ed-0-info','ed-0-place','ed-0-racks','ed-0-diagram','ed-0-racks-rack-2'].every(i=>document.getElementById(i))`));
  ok('preview ids', await ev(`['pv-cover','pv-toc','pv-0','pv-0-info','pv-0-place','pv-0-racks','pv-0-racks-rack-0','pv-0-diagram','pv-1','pv-1-diagram'].every(i=>document.getElementById(i))`));
  // undo/redo of a rack delete
  const n0 = await nRackPages();
  const rDel = `document.querySelector('#ed-0-racks-rack-0 [data-confirm="rDel"]')`;
  await ev(`${rDel}.click()`); await ev(`${rDel}.click()`);
  ok('rack deleted', (await nRackPages()) === n0 - 1);
  await ctrl('z'); ok('Ctrl+Z restores the rack', (await nRackPages()) === n0);
  await ctrl('y'); ok('Ctrl+Y deletes it again', (await nRackPages()) === n0 - 1);
  await ctrl('z', true); ok('Ctrl+Shift+Z with nothing to redo changes nothing', (await nRackPages()) === n0 - 1);
  await ctrl('z'); ok('undo again restores', (await nRackPages()) === n0);
  // device delete
  const devs = () => ev(`document.querySelectorAll('#ed-0-racks-rack-0 tr.dev').length`);
  const d0 = await devs();
  const dDel = `document.querySelector('#ed-0-racks-rack-0 [data-confirm="dDel"]')`;
  await ev(`${dDel}.click()`); await ev(`${dDel}.click()`);
  ok('device deleted', (await devs()) === d0 - 1);
  await ctrl('z'); ok('undo device delete', (await devs()) === d0);
  // typing is coalesced into undo steps
  const ag = `document.querySelector('[data-b="sites.0.info.agency"]').value`;
  for (const v of ['A1', 'A12', 'A123']) await setField('[data-b="sites.0.info.agency"]', v);
  await ctrl('z', false, `document.querySelector('[data-b="sites.0.info.agency"]')`);
  ok('Ctrl+Z inside a text input is native, not app undo', (await ev(ag)) === 'A123');
  await sleep(1300);
  await setField('[data-b="sites.0.info.agency"]', 'B1'); await ev(`document.activeElement.blur()`);
  await ctrl('z'); ok('undo typing burst 2 → A123', (await ev(ag)) === 'A123', await ev(ag));
  await ctrl('z'); ok('undo typing burst 1 → NTDC-EDITED', (await ev(ag)) === 'NTDC-EDITED', await ev(ag));
  await ctrl('y'); ok('redo → A123', (await ev(ag)) === 'A123');
  // floor toggle + undo
  const on = () => ev(`document.querySelectorAll('#floorEd rect[fill="#16607F"]').length`);
  const o0 = await on();
  await ev(`document.querySelector('#floorEd [data-tog]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
  const o1 = await on(); await ctrl('z');
  ok('floor toggle + undo', o1 !== o0 && (await on()) === o0, `${o0}/${o1}`);
  // delete → undo toast
  await ev(`${rDel}.click()`); await ev(`${rDel}.click()`);
  ok('delete shows an Undo toast in the aria-live region', await ev(`(()=>{const h=document.getElementById('toastUndo');return h.getAttribute('aria-live')==='polite'&&h.textContent.includes('ลบตู้ Rack แล้ว')&&!!h.querySelector('button')})()`));
  await ev(`document.querySelector('#toastUndo button').click()`);
  ok('toast Undo restores', (await nRackPages()) === n0);
  // import v1 JSON with inline images
  const j = JSON.parse(SAMPLE);
  ok('sample.json is v1 (no v)', j.v === undefined);
  j.sites[0].diagram.img = IMG; j.doc.logo = IMG;
  await loadJson(JSON.stringify(j));
  const st = await waitLS((v) => /^idb:/.test(v.sites[0].diagram.img || ''));
  ok('import → v2, images stored as idb: refs', st.v === 2 && /^idb:/.test(st.sites[0].diagram.img) && /^idb:/.test(st.doc.logo) && !JSON.stringify(st).includes('data:image'));
  ok('preview shows the imported diagram', await ev(`!!document.querySelector('#doc .diagram img')?.src.startsWith('data:image/png')`));
  ok('IndexedDB holds the image', await ev(`new Promise(r=>{const q=indexedDB.open(${JSON.stringify(KEY + '-img')});q.onsuccess=()=>{const g=q.result.transaction('img').objectStore('img').getAll();g.onsuccess=()=>r(g.result.some(x=>x.u===${JSON.stringify(IMG)}))}})`));
  ok('import is undoable', await (async () => { await ctrl('z'); const a = await ev(ag); await ctrl('y'); return a === 'A123'; })());
  // export JSON is self-contained
  const ex = JSON.parse(await ev(`(()=>{document.getElementById('bJson').click();const v=document.getElementById('jsOut').value;document.getElementById('modalRoot').innerHTML='';return v})()`));
  ok('JSON modal export has v=2 and inline images', ex.v === 2 && ex.sites[0].diagram.img === IMG && ex.doc.logo === IMG && !JSON.stringify(ex).includes('"idb:'));
  await ev(`window.__capHref=null;document.getElementById('bDl').click()`);
  await waitFor(`!!window.__capHref`, 5000);
  const dl = await ev(`__getDownload()`);
  const dj = JSON.parse(Buffer.from(dl.b64, 'base64').toString('utf8'));
  ok('Save JSON downloads inline images + v', dj.v === 2 && dj.sites[0].diagram.img === IMG && /\.json$/.test(dl.name), dl.name);
  // reload → images come back from IndexedDB
  await reload();
  ok('after reload the diagram shows (from IndexedDB)', await waitFor(`document.querySelector('#doc .diagram img')?.src===${JSON.stringify(IMG)}`, 5000));
  ok('after reload the custom logo shows', await ev(`document.querySelector('#doc .logo img')?.src===${JSON.stringify(IMG)}`));
  // upload through the file input
  const png = path.join(tmp, 'upload.png');
  fs.writeFileSync(png, Buffer.from(IMG.split(',')[1], 'base64'));
  await ev(`document.querySelector('[data-act="rmDiag"]').click()`);
  await waitLS((v) => v.sites[0].diagram.img === null);
  await b.send('DOM.enable');
  const docN = await b.send('DOM.getDocument');
  const q = await b.send('DOM.querySelector', {nodeId: docN.result.root.nodeId, selector: '#ed-0-diagram input[type=file]'});
  await b.send('DOM.setFileInputFiles', {nodeId: q.result.nodeId, files: [png]});
  await waitFor(`!!document.querySelector('#ed-0-diagram .imgdrop img')`, 15000);
  ok('upload → idb: ref in storage', /^idb:/.test((await waitLS((v) => /^idb:/.test(v.sites[0].diagram.img || ''))).sites[0].diagram.img || ''));
  await reload();
  ok('uploaded image shows after reload', await waitFor(`!!document.querySelector('#doc .diagram img')?.src.startsWith('data:image/png')`, 5000));
  // a v1 draft in localStorage with inline images is migrated on load
  const v1 = JSON.parse(SAMPLE);
  v1.sites[1].diagram.img = IMG; delete v1.sites[0].info.surveyors; delete v1.sites[0].racks[0].cables;
  await ev(`localStorage.setItem(${JSON.stringify(KEY)},${JSON.stringify(JSON.stringify(v1))})`);
  await reload();
  const m = await waitLS((v) => v.v === 2 && /^idb:/.test(v.sites[1].diagram.img || ''));
  ok('v1 storage migrated: v2, fields filled, inline image moved to IndexedDB', m.v === 2 && m.sites[0].info.surveyors === '' && Array.isArray(m.sites[0].racks[0].cables) && /^idb:/.test(m.sites[1].diagram.img));
  // garbage state
  await ev(`localStorage.setItem(${JSON.stringify(KEY)},'{"sites":[{"racks":[{"devices":[null,{"u":3}]}],"floor":{"items":[{"type":"row","racks":["A",{"n":"B","on":1}]}]}}]}')`);
  await reload();
  ok('partial / garbage state still renders', (await ev(`document.querySelectorAll('#doc .page').length`)) >= 4);
  ok('a non-survey JSON import shows an error', (await ev(`__loadJson('{"foo":1}')`)).length > 0);
  await ev(`document.getElementById('modalRoot').innerHTML=''`);
  // quota → persistent banner
  await ev(`window.__si=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException('full','QuotaExceededError')}`);
  await setField('[data-b="sites.0.info.agency"]', 'Q');
  ok('quota error → banner with role=alert', await waitFor(`document.getElementById('saveBanner')?.getAttribute('role')==='alert'`, 3000));
  await sleep(3000);
  ok('banner persists', await ev(`!!document.getElementById('saveBanner')`));
  await ev(`window.__capHref=null;window.__capName='';document.querySelector('#saveBanner button').click()`);
  await waitFor(`!!window.__capName`, 3000);
  ok('banner button downloads JSON', (await ev(`window.__capName||''`)).endsWith('.json'));
  await ev(`Storage.prototype.setItem=window.__si`);
  await setField('[data-b="sites.0.info.agency"]', 'QQ');
  ok('banner clears after a successful save', await waitFor(`!document.getElementById('saveBanner')`, 3000));
  // image GC: old orphan removed, recent orphan kept
  await ev(`new Promise(r=>{const q=indexedDB.open(${JSON.stringify(KEY + '-img')});q.onsuccess=()=>{const tx=q.result.transaction('img','readwrite');tx.objectStore('img').put({u:'data:image/png;base64,AAAA',t:1},'oldorphan');tx.objectStore('img').put({u:'data:image/png;base64,BBBB',t:Date.now()},'neworphan');tx.oncomplete=r}})`);
  await reload();
  await sleep(3800);
  const keys = await idbKeys();
  ok('GC removes an old orphan, keeps a recent one', !keys.includes('oldorphan') && keys.includes('neworphan'), keys.join(','));
  void LS;
}

/* ------------------------------------------------------------------ ui */
async function ui({b, ok, url, KEY}) {
  const {ev, reload, key, waitFor} = tools(b, url, KEY);
  const vp = (w, h, mobile) => b.send('Emulation.setDeviceMetricsOverride', {width: w, height: h, deviceScaleFactor: 1, mobile: !!mobile});
  await vp(1440, 900); await reload();
  // card open/closed state
  ok('rack 0 open by default, rack 1 closed', await ev(`document.getElementById('ed-0-racks-rack-0').open&&!document.getElementById('ed-0-racks-rack-1').open`));
  await ev(`document.querySelector('#ed-0-info>summary').click()`); await sleep(100);
  await ev(`document.querySelector('#ed-0-racks-rack-1>summary').click()`); await sleep(500);
  await reload();
  ok('open/closed state persists across reload', await ev(`!document.getElementById('ed-0-info').open&&document.getElementById('ed-0-racks-rack-1').open`));
  const st = JSON.parse(await ev(`localStorage.getItem(${JSON.stringify(KEY)})`));
  ok('UI state is kept apart from the document state', !JSON.stringify(st).includes('"o"') && !!(await ev(`localStorage.getItem(${JSON.stringify(KEY + '-ui')})`)));
  ok('exported JSON has no UI state', await ev(`(()=>{document.getElementById('bJson').click();const v=document.getElementById('jsOut').value;document.getElementById('modalRoot').innerHTML='';return !v.includes('"o"')&&!v.includes('rack:')})()`));
  await ev(`document.querySelector('[data-ui="expand"]').click()`); await sleep(100);
  ok('expand all', await ev(`[...document.querySelectorAll('#editor details[data-k]')].every(d=>d.open)`));
  await ev(`document.querySelector('[data-ui="collapse"]').click()`); await sleep(100);
  ok('collapse all', await ev(`[...document.querySelectorAll('#editor details[data-k]')].every(d=>!d.open)`));
  await ev(`document.querySelector('[data-ui="expand"]').click()`); await sleep(100);
  // focus + scroll kept across a full re-render
  await ev(`window.scrollTo(0,700)`); await sleep(200);
  const sy0 = await ev(`window.scrollY`);
  await ev(`(()=>{const el=document.querySelector('[data-b="sites.0.place.address"]');el.focus();el.setSelectionRange(3,5)})()`);
  await ev(`(()=>{const s=document.querySelector('[data-fitype="0"]');s.value='label';s.dispatchEvent(new Event('change',{bubbles:true}))})()`); await sleep(300);
  const sy1 = await ev(`window.scrollY`);
  ok('scroll position kept after renderEditor', Math.abs(sy1 - sy0) < 3, `${sy0}→${sy1}`);
  ok('focused field + selection kept after renderEditor', await ev(`document.activeElement&&document.activeElement.dataset.b==='sites.0.place.address'&&document.activeElement.selectionStart===3&&document.activeElement.selectionEnd===5`));
  await ev(`document.activeElement.blur();document.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true}))`); await sleep(200);
  // rail click → editor card + preview
  await ev(`window.scrollTo(0,0)`); await sleep(200);
  await ev(`document.querySelector('#rail [data-nav="sec:diagram"]').click()`); await sleep(900);
  const topEd = await ev(`document.getElementById('ed-0-diagram').getBoundingClientRect().top`);
  const barH = await ev(`parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bar-h'))`);
  ok('rail click scrolls the editor card under the sticky bar', topEd >= barH - 2 && topEd < barH + 40, `top=${topEd} bar=${barH}`);
  ok('--bar-h is measured from #bar', barH > 0 && barH === (await ev(`Math.round(document.getElementById('bar').getBoundingClientRect().height)`)), String(barH));
  ok('rail click scrolls the preview to pv-0-diagram', await ev(`(()=>{const sc=document.getElementById('pvScroll'),t=document.getElementById('pv-0-diagram');const d=t.getBoundingClientRect().top-sc.getBoundingClientRect().top;return d>-5&&d<200})()`));
  ok('rail marks the item current', await ev(`document.querySelector('#rail [aria-current="true"]').dataset.nav==='sec:diagram'`));
  // scroll-spy; the preview follows
  await ev(`window.scrollTo(0,0)`); await sleep(1200);
  ok('scroll-spy: at the top an upper item is current', await ev(`['doc','site'].includes(document.querySelector('#rail [aria-current="true"]').dataset.nav)`));
  await ev(`window.scrollTo(0,document.getElementById('ed-0-place').getBoundingClientRect().top+window.scrollY-${40 + 49 + 20})`); await sleep(1500);
  const cur = await ev(`document.querySelector('#rail [aria-current="true"]').dataset.nav`);
  ok('scroll-spy highlights the section in view', cur === 'sec:place', cur);
  ok('preview follows the active section', await ev(`(()=>{const sc=document.getElementById('pvScroll'),t=document.getElementById('pv-0-place');const d=t.getBoundingClientRect().top-sc.getBoundingClientRect().top;return d>-5&&d<250})()`));
  // armDelete
  await ev(`document.getElementById('ed-0-racks-rack-0').open=true`);
  const dsel = `document.querySelector('#ed-0-racks-rack-0 [data-confirm="pDel"]')`;
  const p0 = await ev(`document.querySelectorAll('#ed-0-racks-rack-0 .prow').length`);
  await ev(`${dsel}.click()`); await sleep(100);
  ok('first click arms (red + label, nothing deleted)', await ev(`${dsel}.classList.contains('arm')&&${dsel}.dataset.arm==='คลิกอีกครั้งเพื่อลบ'&&document.querySelectorAll('#ed-0-racks-rack-0 .prow').length===${p0}`));
  ok('armed state announced in aria-live', await ev(`document.getElementById('armLive').getAttribute('aria-live')==='polite'&&document.getElementById('armLive').textContent.includes('คลิกอีกครั้งเพื่อลบ')`));
  await key(`document`, 'Escape'); ok('Esc disarms', await ev(`!${dsel}.classList.contains('arm')`));
  await ev(`${dsel}.click()`); await sleep(3300); ok('3 s timeout disarms', await ev(`!${dsel}.classList.contains('arm')`));
  await ev(`${dsel}.click()`); await ev(`document.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`); ok('click elsewhere disarms', await ev(`!${dsel}.classList.contains('arm')`));
  await ev(`${dsel}.click()`); await ev(`${dsel}.click()`); await sleep(150);
  ok('second click deletes + Undo toast', await ev(`document.querySelectorAll('#ed-0-racks-rack-0 .prow').length===${p0 - 1}&&document.getElementById('toastUndo').textContent.includes('ลบแหล่งจ่ายแล้ว')`));
  await ev(`document.querySelector('#toastUndo .tbtn').click()`); await sleep(200);
  ok('toast Undo restores', await ev(`document.querySelectorAll('#ed-0-racks-rack-0 .prow').length===${p0}`));
  ok('every delete uses data-confirm (device, power, cable, floor item, rack, site)', await ev(`['dDel','pDel','cDel','fDel','rDel','delSite'].every(a=>document.querySelector('[data-confirm="'+a+'"]'))&&!document.querySelector('[data-act="dDel"],[data-act="pDel"],[data-act="cDel"],[data-act="fDel"],[data-act="rDel"],[data-act="delSite"]')`));
  // tabs
  ok('tabs: role, aria-selected, roving tabindex', await ev(`(()=>{const t=[...document.querySelectorAll('[role=tab]')];return t.length===2&&t[0].getAttribute('aria-selected')==='true'&&t[0].tabIndex===0&&t[1].tabIndex===-1&&!!document.querySelector('[role=tablist]').getAttribute('aria-label')})()`));
  await ev(`document.getElementById('tab-0').focus()`); await key(`document.getElementById('tab-0')`, 'ArrowRight'); await sleep(300);
  ok('ArrowRight selects + focuses the next tab', await ev(`document.getElementById('tab-1').getAttribute('aria-selected')==='true'&&document.activeElement.id==='tab-1'`));
  await key(`document.getElementById('tab-1')`, 'ArrowLeft'); await sleep(300); ok('ArrowLeft goes back', await ev(`document.activeElement.id==='tab-0'`));
  await key(`document.getElementById('tab-0')`, 'End'); await sleep(300); ok('End selects the last tab', await ev(`document.activeElement.id==='tab-1'`));
  await ev(`document.getElementById('tab-0').click()`); await sleep(300);
  ok('tab ×: arm, delete a site, Undo restores', await (async () => {
    const x = `document.querySelector('[data-tabx="1"]')`;
    await ev(`${x}.click()`); const armed = await ev(`${x}.classList.contains('arm')`); await ev(`${x}.click()`); await sleep(200);
    const gone = await ev(`document.querySelectorAll('[role=tab]').length===1`);
    await ev(`document.querySelector('#toastUndo .tbtn').click()`); await sleep(300);
    return armed && gone && (await ev(`document.querySelectorAll('[role=tab]').length===2`));
  })());
  // export menu + modal focus handling
  await ev(`document.getElementById('bExport').focus();document.getElementById('bExport').click()`);
  ok('export menu opens (aria-expanded)', await ev(`document.getElementById('bExport').getAttribute('aria-expanded')==='true'&&!document.getElementById('expMenu').hidden`));
  await key(`document.getElementById('expMenu')`, 'Escape');
  ok('Esc closes the menu and returns focus', await ev(`document.getElementById('expMenu').hidden&&document.activeElement.id==='bExport'`));
  await ev(`document.getElementById('bExport').click();document.getElementById('bJson').focus();document.getElementById('bJson').click()`); await sleep(200);
  ok('modal moves focus inside (aria-modal)', await ev(`!!document.activeElement.closest('.modal-card')&&document.querySelector('.modal-card').getAttribute('aria-modal')==='true'`));
  await ev(`(()=>{const f=[...document.querySelectorAll('.modal-card button:not([disabled]),.modal-card input,.modal-card textarea')].filter(x=>x.offsetParent);f[f.length-1].focus()})()`);
  await key(`document.activeElement`, 'Tab'); await sleep(50);
  ok('Tab at the last control stays inside the modal', await ev(`!!document.activeElement.closest('.modal-card')`));
  await key(`document`, 'Escape'); await sleep(100);
  ok('Esc closes the modal and returns focus to the trigger', await ev(`!document.getElementById('modalRoot').firstChild&&document.activeElement.id==='bExport'`));
  // floor cells
  ok('floor cell: role=button, tabindex, aria-pressed, aria-label', await ev(`(()=>{const g=document.querySelector('#floorEd [data-tog][role=button]');return !!g&&g.getAttribute('tabindex')==='0'&&g.hasAttribute('aria-pressed')&&!!g.getAttribute('aria-label')})()`));
  const p1 = await ev(`document.querySelector('#floorEd [role=button]').getAttribute('aria-pressed')`);
  await ev(`document.querySelector('#floorEd [role=button]').focus()`); await key(`document.activeElement`, 'Enter'); await sleep(150);
  ok('Enter toggles a cell and keeps focus', await ev(`document.querySelector('#floorEd [role=button]').getAttribute('aria-pressed')!==${JSON.stringify(p1)}&&document.activeElement.getAttribute('role')==='button'`));
  await key(`document.activeElement`, ' '); await sleep(150);
  ok('Space toggles back', await ev(`document.querySelector('#floorEd [role=button]').getAttribute('aria-pressed')===${JSON.stringify(p1)}`));
  ok('installed cell has a check mark (not colour only) + legend; preview SVG unchanged', await ev(`!!document.querySelector('#floorEd g[aria-pressed="true"] path')&&!!document.querySelector('.flegend')&&!document.querySelector('#doc svg path[stroke="#FFFFFF"][pointer-events]')`));
  ok('door select: Thai/English labels, raw values', await ev(`(()=>{const s=document.querySelector('[data-b="sites.0.floor.door"]');return [...s.options].map(o=>o.value).join()==='left,center,right,none'&&/กลาง/.test(s.selectedOptions[0].text)&&s.value==='center'})()`));
  // device table
  await ev(`document.getElementById('ed-0-racks-rack-0').open=true`);
  await ev(`document.querySelector('#ed-0-racks-rack-0 [data-act="dAdd"]').click()`); await sleep(250);
  const nd = await ev(`document.querySelectorAll('#ed-0-racks-rack-0 tr.dev').length`);
  const uSel = `document.querySelector('[data-b="sites.0.racks.0.devices.${nd - 1}.u"]')`;
  ok('add device: U defaults to the free unit above, new row focused', await ev(`+${uSel}.value===22&&document.activeElement.dataset.b==='sites.0.racks.0.devices.${nd - 1}.name'`));
  await ev(`(()=>{const u=${uSel};u.value='21';u.dispatchEvent(new Event('input',{bubbles:true}))})()`); await sleep(400);
  ok('overlap → inline error, red row, aria-invalid + aria-describedby', await ev(`(()=>{const u=${uSel},m=document.getElementById(u.getAttribute('aria-describedby'));return u.getAttribute('aria-invalid')==='true'&&u.closest('tr').classList.contains('err')&&!!m&&!m.closest('tr').hidden&&/ทับซ้อน/.test(m.textContent)})()`));
  ok('card summary shows the warning count; rail shows a badge', await ev(`/1/.test(document.querySelector('[data-sum="rack:0"] .badge')?.textContent||'')&&!!document.querySelector('#rail .badge.err')`));
  await ev(`(()=>{const u=${uSel};u.value='30';u.dispatchEvent(new Event('input',{bubbles:true}))})()`); await sleep(400);
  ok('fixing the U clears the error', await ev(`(()=>{const u=${uSel};return !u.hasAttribute('aria-invalid')&&u.closest('tr').nextElementSibling.hidden&&!document.querySelector('#rail .badge.err')})()`));
  await ev(`document.querySelector('#ed-0-racks-rack-0 [data-act="rDup"]').click()`); await sleep(250);
  ok('duplicate rack: element ids stay unique in the editor', await ev(`(()=>{const ids=[...document.querySelectorAll('#editor [id]')].map(e=>e.id);return ids.length===new Set(ids).size})()`));
  await ev(`document.activeElement.blur();document.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true}))`); await sleep(200);
  ok('U inputs: inputmode=numeric, max = rack size', await ev(`(()=>{const u=document.querySelector('[data-b="sites.0.racks.0.devices.0.u"]');return u.inputMode==='numeric'&&u.max==='42'})()`));
  // reset flow
  await ev(`document.getElementById('bReset').click()`); await sleep(150);
  await ev(`document.getElementById('rsBlank').click()`); await sleep(150);
  ok('reset: confirmation step has Cancel + save JSON first', await ev(`!!document.getElementById('rsCancel')&&!!document.getElementById('rsSave')&&!!document.getElementById('rsGo')`));
  await ev(`document.getElementById('rsCancel').click()`); await sleep(100);
  ok('Cancel leaves the draft untouched', await ev(`document.querySelectorAll('[role=tab]').length===2&&!document.getElementById('modalRoot').firstChild`));
  await ev(`document.getElementById('bReset').click()`); await ev(`document.getElementById('rsBlank').click()`); await ev(`document.getElementById('rsGo').click()`); await sleep(300);
  ok('Confirm resets to one blank site + Undo toast', await ev(`document.querySelectorAll('[role=tab]').length===1&&document.getElementById('toastUndo').textContent.includes('รีเซ็ตแล้ว')`));
  await ev(`document.querySelector('#toastUndo .tbtn').click()`); await sleep(300);
  ok('Undo brings the draft back after reset', await ev(`document.querySelectorAll('[role=tab]').length===2`));
  // phone layout
  await vp(375, 812, true); await reload(); await sleep(400);
  const m = await ev(`({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth,seg:getComputedStyle(document.getElementById('seg')).display,rail:getComputedStyle(document.getElementById('rail')).display,mbar:getComputedStyle(document.getElementById('mbar')).display,chips:getComputedStyle(document.getElementById('chips')).display,pv:getComputedStyle(document.querySelector('.preview-wrap')).display})`);
  ok('phone: no horizontal scroll at 375 px', m.sw <= m.cw, JSON.stringify(m));
  ok('phone: switch + chips + bottom bar, no rail, preview hidden in edit view', m.seg !== 'none' && m.chips !== 'none' && m.mbar !== 'none' && m.rail === 'none' && m.pv === 'none', JSON.stringify(m));
  await ev(`document.querySelector('#ed-0-racks-rack-0').open=true`);
  const small = await ev(`(()=>{const sel=['#bExport','#mUndo','#mDocx','#seg button','.chip','.tab','.tab-add','#ed-0-racks-rack-0>summary','.btn.sm','[data-b="sites.0.info.agency"]','#ed-0-racks-rack-0 tr.dev input','#ed-0-racks-rack-0 .del.ib'];return sel.map(s=>{const e=document.querySelector(s);if(!e)return s+':missing';const r=e.getBoundingClientRect();return r.height<39.5||(r.width<39.5&&!/input|summary|\\.btn\\.sm|tab$|chip|seg|Docx/.test(s))?s+':'+Math.round(r.width)+'x'+Math.round(r.height):null}).filter(Boolean)})()`);
  ok('phone: tap targets ≥ 40 px', small.length === 0, JSON.stringify(small));
  await ev(`document.querySelector('#seg [data-mv="preview"]').click()`); await sleep(500);
  const m2 = await ev(`({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth,ed:getComputedStyle(document.querySelector('.editor-col')).display,pv:getComputedStyle(document.querySelector('.preview-wrap')).display})`);
  ok('phone preview view: paper shown, no horizontal scroll', m2.pv !== 'none' && m2.ed === 'none' && m2.sw <= m2.cw, JSON.stringify(m2));
  ok('phone undo/redo buttons wired and disabled with no history', await ev(`document.getElementById('mUndo').disabled===true&&document.getElementById('mRedo').disabled===true`));
  void waitFor;
}

/* ------------------------------------------------------------------ golden */
async function golden({b, ok, url, KEY}) {
  const {ev, reload, loadJson} = tools(b, url, KEY);
  await reload();
  ok('load sample.json through the JSON modal', (await loadJson(SAMPLE)) === '');
  const md = await ev(`__md()`);
  const d = await ev(`__docx()`);
  ok('docx download is named after the title', /^Site Survey \d{4}-\d\d-\d\d\.docx$/.test(d.name), d.name);
  const parts = unzip(Buffer.from(d.b64, 'base64'));
  const bad = compareGolden({md, parts});
  ok('browser Markdown + DOCX equal tests/golden (except core.xml and raster pixels)', bad.length === 0, '\n' + bad.join('\n'));
  ok('preview page count is 12', (await ev(`document.querySelectorAll('#doc .page').length`)) === 12);
}

/* ------------------------------------------------------------------ security */
async function security({b, ok, url, KEY}) {
  const {ev, reload, waitFor, loadJson} = tools(b, url, KEY);
  // Fires every event an injected handler could listen to, then reports what an attacker would have achieved.
  const audit = `(async()=>{
    const els=[...document.querySelectorAll('body *')];
    for(const e of els)for(const t of ['mouseover','mouseenter','focus','focusin','error','load','animationstart','toggle','pointerover'])try{e.dispatchEvent(new Event(t))}catch(_){}
    await new Promise(r=>setTimeout(r,300));
    return {pwned:window.__pwned,
      handlers:els.flatMap(e=>[...e.attributes].filter(a=>/^on/i.test(a.name)).map(a=>e.tagName+'['+a.name+']')),
      scripts:document.querySelectorAll('script').length,
      foreign:[...document.querySelectorAll('[src],[href]')].map(e=>e.getAttribute('src')??e.getAttribute('href')).filter(v=>!(v.startsWith('#')||/^data:image.(png|jpeg|jpg|gif|webp);base64,/.test(v)||v.startsWith('https://fonts.googleapis.com')||v.startsWith('https://fonts.gstatic.com'))),
      badTags:document.querySelectorAll('#doc iframe,#doc object,#doc embed,#doc foreignObject,#editor iframe,#editor foreignObject,#doc script,#editor script').length}})()`;
  const clean = (r) => r.pwned === undefined && r.handlers.length === 0 && r.foreign.length === 0 && r.badTags === 0;
  await reload();
  const scripts0 = await ev(`document.querySelectorAll('script').length`);
  await ev(`window.__pwned=undefined`);
  ok('malicious.json imports (it is a valid v2 survey)', (await loadJson(MAL)) === '');
  const n = await ev(`document.querySelectorAll('[data-tab]').length`);
  ok('all 4 sites imported', n === 4, String(n));
  for (let i = 0; i < n; i++) {
    await ev(`document.querySelector('[data-tab="${i}"]').click()`);
    await sleep(150);
    const r = await ev(audit);
    ok(`site ${i + 1}: no injected handler, script, foreign URL or tag ran or exists`, clean(r) && r.scripts === scripts0, JSON.stringify(r));
  }
  await ev(`document.querySelector('[data-tab="0"]').click()`);
  // exports and Copy for Word with the hostile state
  await ev(`__md()`);
  const d = await ev(`__docx()`);
  ok('docx still builds', !!d && d.b64.length > 1000);
  await ev(`document.getElementById('bWord').click()`);
  await sleep(1500);
  ok('Copy for Word runs no injected script', (await ev(`window.__pwned`)) === undefined);
  // the sanitised state survives a reload from storage
  await reload();
  const r = await ev(audit);
  ok('after reload: still clean', clean(r) && r.scripts === scripts0, JSON.stringify(r));
  ok('stored state has safe ids and no hostile image refs', await ev(`(()=>{const s=JSON.parse(localStorage.getItem(${JSON.stringify(KEY)}));return s.sites.every(x=>/^[A-Za-z0-9_-]+$/.test(x.id)&&x.diagram.img===null)&&s.doc.logo===''})()`));
  ok('Object.prototype not polluted', await ev(`({}).polluted===undefined`));
  // a file from a newer schema is refused with an inline message
  const err = await ev(`__loadJson(${JSON.stringify(JSON.stringify({v: 3, sites: [{name: 'future'}]}))})`);
  ok('newer-schema file refused with an inline message', /schema v3/.test(err), err);
  await ev(`document.getElementById('modalRoot').innerHTML=''`);
  ok('state unchanged after the refused import', await ev(`!document.getElementById('editor').textContent.includes('future')`));
  void waitFor;
}
