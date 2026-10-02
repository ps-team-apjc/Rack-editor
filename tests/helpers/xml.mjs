// A small XML well-formedness checker (no DTDs): one root element, matched tags, quoted unique
// attributes, legal entity references, no stray '<' or '&' in text. Throws with a position on error.
const NAME = /^[A-Za-z_][\w.:-]*/;
const ENT = /^&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9A-Fa-f]+);/;

export function checkXml(src) {
  let i = 0, depth = 0, roots = 0;
  const stack = [];
  const fail = (msg) => { throw new Error(`${msg} at ${i}: ${JSON.stringify(src.slice(Math.max(0, i - 60), i + 60))}`); };
  const text = (end) => {               // validate character data up to `end`
    for (let k = i; k < end; k++) {
      if (src[k] === '&') { if (!ENT.test(src.slice(k, k + 12))) { i = k; fail('bad entity'); } }
      else if (src[k] === '>' && src.slice(k - 2, k) === ']]') { i = k; fail("']]>' in text"); }
    }
    if (depth === 0 && src.slice(i, end).trim()) fail('text outside the root element');
  };
  if (src.startsWith('<?xml')) { const e = src.indexOf('?>'); if (e < 0) fail('unterminated declaration'); i = e + 2; }
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) { text(src.length); i = src.length; break; }
    text(lt); i = lt;
    if (src.startsWith('<!--', i)) { const e = src.indexOf('-->', i); if (e < 0) fail('unterminated comment'); i = e + 3; continue; }
    if (src.startsWith('<![CDATA[', i)) { const e = src.indexOf(']]>', i); if (e < 0) fail('unterminated CDATA'); i = e + 3; continue; }
    if (src.startsWith('<?', i)) { const e = src.indexOf('?>', i); if (e < 0) fail('unterminated PI'); i = e + 2; continue; }
    if (src.startsWith('</', i)) {
      const m = NAME.exec(src.slice(i + 2)); if (!m) fail('bad end tag');
      const name = m[0]; i += 2 + name.length;
      while (/\s/.test(src[i])) i++;
      if (src[i] !== '>') fail('bad end tag');
      i++;
      const open = stack.pop();
      if (open !== name) fail(`</${name}> closes <${open}>`);
      depth--; continue;
    }
    const m = NAME.exec(src.slice(i + 1)); if (!m) fail('bad start tag');
    const name = m[0]; i += 1 + name.length;
    const seen = new Set();
    for (;;) {
      const ws = /^\s*/.exec(src.slice(i))[0].length; i += ws;
      if (src.startsWith('/>', i)) { i += 2; if (depth === 0) roots++; break; }
      if (src[i] === '>') { i++; if (depth === 0) roots++; stack.push(name); depth++; break; }
      if (!ws) fail('missing whitespace before attribute');
      const a = NAME.exec(src.slice(i)); if (!a) fail('bad attribute name');
      if (seen.has(a[0])) fail(`duplicate attribute ${a[0]}`); seen.add(a[0]);
      i += a[0].length;
      while (/\s/.test(src[i])) i++;
      if (src[i] !== '=') fail('attribute without value'); i++;
      while (/\s/.test(src[i])) i++;
      const q = src[i]; if (q !== '"' && q !== "'") fail('unquoted attribute value');
      const e = src.indexOf(q, i + 1); if (e < 0) fail('unterminated attribute value');
      const val = src.slice(i + 1, e);
      if (val.includes('<')) fail("'<' in attribute value");
      for (let k = val.indexOf('&'); k >= 0; k = val.indexOf('&', k + 1)) if (!ENT.test(val.slice(k, k + 12))) fail('bad entity in attribute');
      i = e + 1;
    }
  }
  if (stack.length) fail(`unclosed <${stack[stack.length - 1]}>`);
  if (roots !== 1) fail(`expected one root element, found ${roots}`);
  return true;
}

/** Decode the five predefined entities and numeric references. */
export const unXml = (s) => s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9A-Fa-f]+);/g, (m, e) =>
  ({amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"}[e] ?? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1))));

/** Concatenated <w:t> text of a WordprocessingML part (entities decoded). */
export const wText = (xml) => [...xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => unXml(m[1])).join('');
