# Security

## Threat model

The app is a single HTML page with no server. It runs in two ways:

- `index.html`, opened from disk (`file://`).
- `artifact.html`, inside the claude.ai Artifact sandbox (an iframe, downloads via `window.claude.use('downloads')`).

Everything a user can be handed by someone else is treated as untrusted:

- imported JSON files (drafts shared by colleagues or customers)
- uploaded images
- typed text
- whatever is already in `localStorage` and IndexedDB (on `file://`, Chrome lets other local HTML files share this storage)

That data reaches these sinks: the DOM (`innerHTML` templates), inline SVG, the DOCX XML, Markdown, the clipboard (Copy for Word, HTML) and download file names.

The goal is that a hostile file can't run script, load remote content, corrupt other drafts or hang the tab.

## Mitigations

| Risk | Mitigation (in `index.html`, ported to `artifact.html`) |
|---|---|
| HTML/attribute injection (XSS) | Every interpolated value goes through `esc()`, which encodes `& < > " '`. Ids, `data-k`, `aria-describedby`, `max` and `src` are escaped too, even though they are already sanitised. |
| Script or remote URLs in image fields | `safeImg()`/`okImg()` accept only base64 `data:image/(png\|jpeg\|gif\|webp)` up to 15 MB. Everything else, including SVG, `javascript:`, `http(s):` and broken base64, becomes `''`. `imgURL()` always returns a value that passed this check, and the IndexedDB cache stores only checked values. Uploads are re-encoded through a canvas, so an SVG is turned into pixels. |
| Crafted ids | `migrate()` keeps an id only if it matches `[A-Za-z0-9_-]{1,64}` and is unique in the document. Any other id is regenerated. |
| `idb:` refs in someone else's file | Imported files must carry inline images. `migrate(o, {imported:true})` drops `idb:` refs, so a file can't point at images stored in this browser. |
| Prototype pollution | `parseJSON()` drops `__proto__`, `constructor` and `prototype` keys. `migrate()` copies with spread (own data properties only). `setP()`/`getP()` refuse prototype keys, missing keys and writes through non-objects. |
| Newer schema | `migrate()` returns `null` for `v > SCHEMA`, and the import shows an inline error. A newer draft found in storage is copied to `<key>-v<N>-backup` before the sample loads. If that copy fails, saving is paused (`HOLD`) so the draft is never overwritten. |
| Hangs from huge values | Rack height is capped at `RACK_MAX` (100) in `migrate()` and on input. Overlap and drawing loops are bounded. Uploads are limited to 30 MB and JSON files to 100 MB. |
| Invalid or hostile DOCX | `xesc()` removes characters that XML 1.0 forbids (C0 controls, lone surrogates, U+FFFE/FFFF). Part names and rel ids are fixed. GIF and WebP images are re-encoded to PNG, because only PNG and JPEG are declared. |
| Markdown with live HTML | User text has `<` encoded (`mdT`). One-line fields can't start new lines or headings (`mdL`). Table pipes are escaped. |
| Download names | `safeName()` removes path and control characters and leading or trailing dots, and caps the length at 80 characters. |
| Defence in depth (offline build) | A CSP `<meta>` in `index.html`: `default-src 'none'`, `script-src` pinned to the sha256 of the one inline script (so injected inline handlers can't run), `img-src data:`, `base-uri`/`form-action`/`object-src 'none'`. `node tools/port.mjs` refreshes the hash, and a unit test fails when it is stale. |

Regression tests:

- `tests/unit/security.test.mjs`, which loads `tests/fixtures/malicious.json`
- `tests/unit/escaping.test.mjs`
- the e2e `security` suite (`node tests/e2e/run.mjs --suite security`), which asserts that the sentinel `window.__pwned` is never set

## Remaining risks (accepted)

- **No CSP in `artifact.html`.** A `<meta>` CSP can't go there because the host owns `<head>`. The Artifact iframe sandbox and the escaping above are the controls.
- **`style-src 'unsafe-inline'`.** The UI uses `style=""` attributes. CSS injection would still require breaking out of `esc()`.
- **Shared `file://` storage.** In Chrome, any HTML file opened from disk can read this app's drafts in `localStorage`/IndexedDB. Don't keep confidential surveys in the browser on shared machines. Use Save JSON and Reset instead.
- **Data left behind.** Deleted images stay in IndexedDB for up to a day (GC age). Undo history stays in memory until the tab closes.
- **Markdown links.** Text like `[x](javascript:…)` is left as typed. Markdown renderers (GitHub, Notion, Confluence) block such links.
- **Deeply nested unknown fields** in an imported file can exhaust the stack while images are interned. The import then fails and the current draft is left unchanged.

## Reporting a vulnerability

Report it privately through **GitHub → Security → Report a vulnerability** (a private security advisory) on `ps-team-apjc/Rack-editor`, or contact the ps-team-apjc maintainers directly. Don't open a public issue. Include a JSON file or the steps that reproduce the problem.
