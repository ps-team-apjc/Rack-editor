// A small quote-aware HTML tag scanner for the security tests. It follows the HTML tokenizer closely enough
// to see what a browser would see: tag names and attribute names/values (unquoted, "…" and '…'), so a payload
// that breaks out of an attribute shows up as an extra attribute, while escaped text stays text.

/** Every start tag in html → [{name, attrs: [[name, value|null], …]}]. */
export function tags(html) {
  const out = [];
  let i = 0;
  while ((i = html.indexOf('<', i)) >= 0) {
    const m = /^<([a-zA-Z][^\s/>]*)/.exec(html.slice(i, i + 80));
    if (!m) { i++; continue; }
    let j = i + m[0].length;
    const attrs = [];
    for (;;) {
      while (j < html.length && /[\s/]/.test(html[j]) && !html.startsWith('/>', j)) j++;
      if (j >= html.length || html[j] === '>' || html.startsWith('/>', j)) break;
      const n = /^[^\s/>=]+/.exec(html.slice(j, j + 200));
      if (!n) { j++; continue; }
      j += n[0].length;
      let k = j;
      while (/\s/.test(html[k] || '')) k++;
      let v = null;
      if (html[k] === '=') {
        k++;
        while (/\s/.test(html[k] || '')) k++;
        const q = html[k];
        if (q === '"' || q === "'") { const e = html.indexOf(q, k + 1); v = html.slice(k + 1, e < 0 ? html.length : e); j = e < 0 ? html.length : e + 1; }
        else { const u = /^[^\s>]*/.exec(html.slice(k))[0]; v = u; j = k + u.length; }
      }
      attrs.push([n[0].toLowerCase(), v]);
    }
    out.push({name: m[1].toLowerCase(), attrs});
    i = j;
  }
  return out;
}

const BAD_TAGS = new Set(['script', 'iframe', 'object', 'embed', 'base', 'meta', 'link', 'form', 'style', 'foreignobject', 'frame', 'frameset', 'template', 'math']);
const IMG_SRC = /^data:image\/(?:png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const ID_VAL = /^[\w:-]+$/;

/**
 * Returns a list of problems: script-capable tags, event-handler attributes, non-image src, non-fragment href,
 * javascript: in a URL-bearing attribute (text in value="…" is data), and ids / data-k / aria-describedby values outside the safe charset.
 */
export function unsafeMarkup(html) {
  const bad = [];
  for (const t of tags(html)) {
    if (BAD_TAGS.has(t.name)) bad.push(`<${t.name}> tag`);
    for (const [k, v] of t.attrs) {
      if (/^on/.test(k)) bad.push(`${t.name}[${k}] event handler`);
      if (v != null && /^(src|href|xlink:href|action|formaction|style|srcset|poster|data)$/.test(k) && /javascript:/i.test(v)) bad.push(`${t.name}[${k}] javascript: URL`);
      if (k === 'src' && !IMG_SRC.test(v || '')) bad.push(`${t.name}[src]=${String(v).slice(0, 60)}`);
      if ((k === 'href' || k === 'xlink:href') && !/^#[\w-]*$/.test(v || '')) bad.push(`${t.name}[${k}]=${String(v).slice(0, 60)}`);
      if (['id', 'data-k', 'aria-describedby', 'aria-labelledby', 'for'].includes(k) && !ID_VAL.test(v || '')) bad.push(`${t.name}[${k}]=${String(v).slice(0, 60)}`);
      if (k === 'style' && /url\(|expression|@import/i.test(v || '')) bad.push(`${t.name}[style] ${String(v).slice(0, 60)}`);
    }
  }
  return bad;
}
