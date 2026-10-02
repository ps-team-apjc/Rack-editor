// Minimal Chrome DevTools Protocol driver for headless Chrome / Edge. No dependencies (Node ≥ 22: fetch + WebSocket).
// Each launch uses a fresh temporary profile and a random debugging port (--remote-debugging-port=0), and
// close() always kills the browser process tree and removes the profile (reused profiles cause EBUSY locks).
import {spawn, execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Find Chrome / Edge / Chromium. CHROME_PATH (or --browser) wins. Returns null when none is installed. */
export function findBrowser(explicit = process.env.CHROME_PATH) {
  if (explicit) return fs.existsSync(explicit) ? explicit : null;
  const env = process.env, c = [];
  if (process.platform === 'win32') {
    for (const base of [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA, 'C:/Program Files', 'C:/Program Files (x86)']) {
      if (!base) continue;
      c.push(path.join(base, 'Google/Chrome/Application/chrome.exe'), path.join(base, 'Microsoft/Edge/Application/msedge.exe'),
        path.join(base, 'Chromium/Application/chrome.exe'));
    }
  } else if (process.platform === 'darwin') {
    c.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium');
  } else {
    for (const n of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'microsoft-edge-stable']) {
      for (const d of (env.PATH || '').split(':')) c.push(path.join(d, n));
    }
  }
  return c.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
}

function killTree(proc) {
  if (!proc || proc.exitCode !== null) return;
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], {stdio: 'ignore'});
    else proc.kill('SIGKILL');
  } catch { /* already gone */ }
}

const live = new Set();
const cleanupAll = () => { for (const b of live) b.killSync(); };
process.on('exit', cleanupAll);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { cleanupAll(); process.exit(130); });

/** Launch a headless browser on a fresh temp profile. Returns {send, ev, go, close, errors, logs}. */
export async function launch(exe, {tmpRoot = os.tmpdir()} = {}) {
  const profile = fs.mkdtempSync(path.join(tmpRoot, 'rsse-profile-'));
  const proc = spawn(exe, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run',
    '--no-default-browser-check', '--disable-gpu', '--disable-extensions', '--disable-background-networking',
    '--disable-sync', '--disable-component-update', '--allow-file-access-from-files', '--window-size=1440,900', 'about:blank'],
  {stdio: 'ignore'});
  const b = {
    killSync() {
      killTree(proc);
      try { fs.rmSync(profile, {recursive: true, force: true, maxRetries: 10, retryDelay: 200}); } catch { /* best effort */ }
      live.delete(b);
    },
  };
  live.add(b);
  try {
    // The browser writes its port to <profile>/DevToolsActivePort.
    let port;
    for (let i = 0; i < 150 && !port; i++) {
      try { port = +fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch { /* not yet */ }
      if (!port) await sleep(100);
    }
    if (!port) throw new Error('browser did not open a DevTools port');
    let tgt;
    for (let i = 0; i < 100 && !tgt; i++) {
      try { tgt = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* starting */ }
      if (!tgt) await sleep(100);
    }
    if (!tgt) throw new Error('no page target');
    const ws = new WebSocket(tgt.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0;
    const pend = {}, waiters = [], errors = [], logs = [];
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; }
      if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
      if (m.method === 'Runtime.consoleAPICalled') {
        const t = m.params.args.map((a) => a.value ?? a.description).join(' ');
        logs.push(m.params.type + ': ' + t);
        if (m.params.type === 'error') errors.push('console.error: ' + t);
      }
      if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push('log: ' + m.params.entry.text + (m.params.entry.url ? ' ' + m.params.entry.url : ''));
      for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i].method === m.method) { waiters[i].res(m.params); waiters.splice(i, 1); }
    };
    const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({id: i, method, params})); });
    const once = (method, ms = 15000) => new Promise((res) => {
      const t = setTimeout(() => res(null), ms);
      t.unref();
      waiters.push({method, res: (v) => { clearTimeout(t); res(v); }});
    });
    await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');
    const ev = async (expr) => {
      const r = await send('Runtime.evaluate', {expression: expr, awaitPromise: true, returnByValue: true});
      if (r.result.exceptionDetails) throw new Error('eval: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text) + '\n  in: ' + expr.slice(0, 200));
      return r.result.result.value;
    };
    const go = async (url) => { const loaded = once('Page.loadEventFired'); await send('Page.navigate', {url}); await loaded; };
    const close = async () => {
      try { await Promise.race([send('Browser.close'), sleep(1500)]); } catch { /* ignore */ }
      try { ws.close(); } catch { /* ignore */ }
      await Promise.race([new Promise((r) => proc.once('exit', r)), sleep(2000)]);
      b.killSync();
    };
    return {send, ev, go, close, errors, logs, profile};
  } catch (e) {
    b.killSync();
    throw e;
  }
}

/** In-page helpers: capture <a download> clicks (docx/json), read Markdown, load JSON through the real modal. */
export const HELPERS = `
(()=>{if(window.__helpers)return;window.__helpers=1;
const oc=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download){window.__capName=this.download;window.__capHref=this.href;return}return oc.call(this)};
window.__getDownload=async()=>{const b=await (await fetch(window.__capHref)).blob();const buf=new Uint8Array(await b.arrayBuffer());let s='';for(let i=0;i<buf.length;i+=0x8000)s+=String.fromCharCode.apply(null,buf.subarray(i,i+0x8000));return {name:window.__capName,b64:btoa(s)}};
window.__docx=async()=>{window.__capHref=null;document.getElementById('bDocx').click();for(let i=0;i<300&&!window.__capHref;i++)await new Promise(r=>setTimeout(r,50));return window.__getDownload()};
window.__md=()=>{document.getElementById('bMd').click();const v=document.getElementById('mdOut').value;document.getElementById('modalRoot').innerHTML='';return v};
window.__loadJson=(txt)=>{document.getElementById('bJson').click();document.getElementById('jsOut').value=txt;document.getElementById('jsLoad').click();return document.getElementById('jsErr')?.textContent||''};
})();`;
