// Guards the "keep the two HTML files in sync" rule: artifact.html must be exactly what tools/port.mjs
// generates from index.html. If this fails after editing index.html, run:  node tools/port.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {port} from '../../tools/port.mjs';
import {read} from '../helpers/load-app.mjs';

test('artifact.html equals tools/port.mjs output for index.html', () => {
  const want = port(read('index.html')), have = read('artifact.html');
  if (have !== want) {
    let i = 0; while (i < have.length && have[i] === want[i]) i++;
    assert.fail(`artifact.html is out of sync (line ${have.slice(0, i).split('\n').length}). Run: node tools/port.mjs\n` +
      `  committed: ${JSON.stringify(have.slice(i - 60, i + 80))}\n  generated: ${JSON.stringify(want.slice(i - 60, i + 80))}`);
  }
});

test('artifact.html keeps the documented hosted-build differences', () => {
  const a = read('artifact.html');
  assert.ok(a.startsWith('<title>Rack Site Survey Editor</title>\n'), '<title> first, no doctype');
  assert.ok(!/<!doctype|<html|<head>|<body>/i.test(a.replace(/`<html><body>\$\{src\.innerHTML\}<\/body><\/html>`/, '')), 'no document wrapper');
  assert.match(a, /fonts\.googleapis\.com/);
  assert.match(a, /const KEY='rack-site-survey-v1';/);
  assert.ok(!a.includes('window.print'), 'no window.print');
  assert.ok(!a.includes('id="bPrint"'), 'no Print button');
  assert.ok(!a.includes('id="mdDl"'), 'no Download .md');
  assert.ok(!a.includes('function dl('), 'no dl() helper');
  assert.ok(!a.includes('@media print'), 'no print CSS');
  assert.ok(!/\b(alert|confirm|prompt)\(/.test(a), 'no alert/confirm/prompt');
  for (const m of a.matchAll(/<(?:script|link)[^>]+(?:src|href)="(https?:[^"]+)"/g)) {
    assert.match(m[1], /^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com)(\/|$)/, m[1]);
  }
});

test('index.html is offline: no external URLs loaded', () => {
  const i = read('index.html');
  assert.ok(i.startsWith('<!doctype html>'));
  assert.ok(!/<(?:script|link)[^>]+(?:src|href)="https?:/.test(i), 'no CDN / web fonts');
  assert.ok(!/\b(alert|confirm|prompt)\(/.test(i), 'no alert/confirm/prompt');
  assert.match(i, /const KEY='rack-site-survey-offline-v1';/);
});

test('port() fails loudly when an anchor is missing', () => {
  assert.throws(() => port(read('index.html').replace("const KEY='rack-site-survey-offline-v1';", "const KEY='x';")), /expected 1 occurrence/);
});
