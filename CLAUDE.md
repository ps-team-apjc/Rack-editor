# Rack Site Survey Editor: handoff

A browser tool for drafting **data-center site survey documents** (Thai/English), modelled on
`NT Site survey.pdf` (APJC, for National Telecom). A user adds one or more sites. For each site
they fill in survey info, a room floor plan, rack elevations (42U), power, cabling and a
connection diagram. The tool then renders a paper-style preview and exports it.

Everything lives in one self-contained HTML file: vanilla JS, no build step, no dependencies,
works offline.

## Files

| File | What it is |
|---|---|
| `index.html` | **Main source, offline/standalone build.** Full `<!doctype html>` document. Open it directly in Chrome/Edge. Has Print / Save PDF, Download .docx / JSON / .md. |
| `artifact.html` | The same app as published to a claude.ai Artifact. There is no `<html>/<head>/<body>` (the host adds the skeleton) and it loads Google Fonts. Downloads go through `window.claude.use('downloads')`. The page has no Print button (the host frame blocks `window.print`). |
| `sample.json` | Exported state with the two sample sites (NT Data Center Sriracha, NT Data Center Bangkok). Load it with **Export ▾ → Load JSON** to get the sample data back. |
| `docs/design-mockup.html` | The approved static UI design (tokens, rail, device table, toast, mobile). Reference only; the real UI is in the two app files. |
| `tools/port.mjs` | Generates `artifact.html` from `index.html` (applies the differences in the table below). |
| `tests/` | Automated tests (see **How to test**): `unit/`, `golden/`, `e2e/`, `helpers/`, `fixtures/`. |
| `SECURITY.md` | Threat model, mitigations, remaining risks, how to report issues. |
| `package.json` | npm scripts only. There are no dependencies; plain `node` (≥ 22) runs everything. |
| `CLAUDE.md` | This file. |

**Keep the two HTML files in sync.** Apart from the differences below, the code is identical.
When you change features, edit `index.html` only, then run `node tools/port.mjs` to regenerate `artifact.html`.
The same command refreshes the CSP script hash in `index.html` (see **Security**). Any edit to the `<script>` needs it, or the offline page won't run its script.
Never hand-edit `artifact.html`: `tests/unit/port.test.mjs` fails when it differs from the generator output.
If a change to `index.html` breaks one of the generator's anchors, `port.mjs` throws and names it; update the anchor in `tools/port.mjs`.

| Area | `index.html` (offline) | `artifact.html` (hosted) |
|---|---|---|
| Wrapper | full doctype/html/head/body | content only, `<title>` first |
| Fonts | system: `Leelawadee UI`, `Segoe UI`, Tahoma; mono `Consolas` | Google Fonts: IBM Plex Sans Thai, Sarabun, IBM Plex Mono |
| localStorage key | `rack-site-survey-offline-v1` | `rack-site-survey-v1` |
| Buttons | ดาวน์โหลด .docx, Undo/Redo, and a ส่งออก ▾ menu: Print / Save PDF (`#bPrint`), Markdown (`#bMd`, copy + Download .md in the modal), Copy for Word (`#bWord`), Save JSON (`#bDl`), Load JSON (`#bJson`), Reset… (`#bReset`) | same minus Print and Download .md |
| `@media print` / `@page A4` CSS | yes | no |
| CSP `<meta>` (script pinned by sha256) | yes | no (the host owns `<head>`; it sandboxes the iframe) |
| `dl()` blob-link helper | yes | no (uses `saveFile`) |

## Architecture (all inside one IIFE in the `<script>`)

- **State**: a single object `S`. It is saved to `localStorage` with a debounce of about 300 ms by `save()`, and every read and write is wrapped in try/catch. On load, `S` comes from storage (through `migrate()`) or from `sample()`.
  - If `setItem` throws a quota error, `save()` also shows a persistent `#saveBanner` (role=alert) with a Download JSON button. The banner goes away after the next successful save. Other storage errors only change the status text.
- **Schema version**: `S.v` (currently `SCHEMA = 2`; files without `v` are v1). `migrate(obj)` turns any older or partial object into a valid current state, filling defaults with `normSite()`. It returns `null` when there is no `sites` array. It runs on localStorage load, on JSON import and on undo/redo restore.
  - To add Phase-1 fields (`rack.pdu`, `rack.cableSchedule`, `site.photos`, `site.issues`, `site.signoff`), bump `SCHEMA` and add a step `if(v<3){...defaults...;v=3}` in `migrate()` (there is a commented example). Also add the defaults to `normSite()`/factories.
- **Images (IndexedDB)**: uploaded images are stored in IndexedDB (database `KEY+'-img'`, store `img`, records `{u: dataURL, t: time}`, keyed by a content hash). `S` keeps only `"idb:<id>"` refs. `IMG` is the in-memory cache (id → data URL), so rendering stays synchronous.
  - **Always read images through `imgURL(ref)`, `diagImg(s)` and `logoSrc()`.** Never put `s.diagram.img` straight into HTML.
  - At startup the cache is loaded before the first render. Any inline `data:image` strings (old v1 drafts) are moved to IDB (`internImages`). After 3 s, `gcImages()` deletes records that S, the saved draft and the undo/redo stacks don't reference, but only when they are older than one day (so other open tabs stay safe).
  - JSON export (`exportJSON()` → `inlineImages`) is self-contained, with inline data URLs. JSON import runs `migrate()` and then `internImages()`.
  - If IndexedDB is unavailable (blocked or sandboxed), `putImg()` returns the data URL itself and S keeps it inline, which is the old behaviour.
  - All IDB access goes through `idbOpen()` / `idb(mode, fn)`, which never throw and resolve `null` on failure.
- **Undo / redo**: `UNDO`/`REDO` are stacks of `JSON.stringify(S)` snapshots, capped at 50 and kept in memory only.
  - Wrap every mutation in `mutate(fn)`. It snapshots S first and records the step only if S changed. `act()`, floor toggles, floor item type changes, uploads, JSON import, Reset and tab deletes all go through it.
  - Typing is coalesced: the `input` handler calls `beginEdit()`, and the burst is committed after about 1 s idle or on `focusout` (`commitEdit()`).
  - `undo()` / `redo()` restore a snapshot, then `save()` + `renderAll()`. Shortcuts: Ctrl/Cmd+Z, Ctrl+Y, Ctrl+Shift+Z. They are ignored while focus is in a text input or textarea (those keep native undo) and while a modal is open.
  - `histUI()` enables/disables `#bUndo` / `#bRedo` if those buttons exist.
  - `toastUndo(msg)` shows a toast with an Undo button for 6 s inside the `#toastUndo` host (`aria-live=polite`). Call it after a destructive `act()`.
- **Section registry**: `SECTIONS = [{id, title, label, en, chip, page, pages?, done(s), sum(s), editor(s,P,si), doc(s,si,x), md(s,x), docx(s,x,c)}]` holds the numbered per-site sections, currently `info`, `place`, `racks` and `diagram`. Each section's number is its position + 1.
  - `renderEditor()`, the rail/chips, `siteHTML()`, `toMarkdown()` and `buildDocx()` all loop over the registry. To add a section, add one entry.
  - `title` is the document heading. `label`/`en` (Thai + muted English), `chip` (short phone label), `done(s)` (`'full'|'part'|'empty'`, drives the outline dot) and `sum(s)` (one-line card summary, HTML) are UI only and never reach the output. The racks section is special-cased in `navKeys()`/`renderRail()` (its racks are nested nav items).
  - Arguments: `x = {n, t, id}` from `secX()` (DOCX also gets `x.pb`), and `c` holds the DOCX helpers (`run, para, tbl, kvr, span, pic, addMedia`).
  - `page:false` sections flow onto the site's first page (after the `<h2>` site name). `page:true` sections return their own `.page` divs, and `pages(s)` gives their page count.
  - `pagePlan()` computes the TOC page numbers for both the preview and the DOCX.
- **Element ids** (for nav and scroll-sync):
  - Editor: `ed-doc` (cover card), `ed-<si>-site`, `ed-<si>-<sectionId>` (cards), `ed-<si>-racks-rack-<j>` (rack cards). Every card is a `<details data-k data-nav>`.
  - Chrome: `bar` (top bar), `tabs`, `saved`, `bUndo`/`bRedo`, `bDocx`, `bExport`/`expMenu`, `seg` (phone edit/preview switch), `rail`, `chips`, `editor`, `pvScroll`/`doc`/`pvMeta`, `mbar` (phone bottom bar: `mUndo`, `mRedo`, `mDocx`), `modalRoot`, `toastUndo`, `armLive`, `floorEd`, `saveBanner`.
  - Preview: `pv-cover`, `pv-toc`, `pv-<si>` (the site's first page), `pv-<si>-<sectionId>` (each section's `<h5>`; a site with no racks gets one section-3 page with the heading and a placeholder, also in the DOCX and Markdown), `pv-<si>-racks-rack-<j>` (rack pages).
  - `<si>` is the site index.
- **Rendering**: string templates and `innerHTML`.
  - `renderTabs()` draws the site tabs (top bar).
  - `renderEditor()` draws the form, then the rail and chips. It keeps the window scroll position and the focused control (found again by `focusSel()`: `data-b` path, `data-act`/`data-confirm` + indexes, summary key) across the rebuild.
  - `renderDoc()` draws the paper preview (keeps its scroll position).
  - `renderAll()` runs all three.
  - `updateChrome()` refreshes summaries (`[data-sum]`), dots (`[data-dot]`), rail and chips in place. The typing path (`liveRefresh()`) uses it, plus `syncDevErr()` for the inline device errors, so typing and Tab never rebuild the form.
- **Binding**: inputs carry `data-b="<path>"`, e.g. `sites.0.racks.1.devices.0.u`.
  - The delegated `input` handler on `#editor` calls `setP(S, path, value)`, then `save()`, then re-renders **only the preview**. This keeps focus in the form.
  - On `change`, selects and number inputs trigger a full `renderEditor()`, so derived chips and warnings update.
- **Actions**: buttons carry `data-act="<name>"` plus `data-i` / `data-j` indexes. `act(a,i,j)` runs the `switch` in `doAct()` inside `mutate()` (one undo step), then `save(); renderAll()`. `doAct` returns `false` when it did nothing.
- **Deletes (`armDelete(btn, run)`)**: every delete (site, rack, device, power source, cable type, floor item, site tab) is a button with `data-confirm="<action>"` (tab ×: `data-tabx`).
  - The first click arms it (red, "คลิกอีกครั้งเพื่อลบ", announced in `#armLive`). The second click runs the action through `act()` and then calls `toastUndo("ลบ…แล้ว")` (`DEL_MSG`).
  - Esc, a click elsewhere, losing focus or 3 s disarm it.
  - Icon-only buttons carry class `ib` and show the label as a popover (`data-arm`), so rows never reflow. Text buttons swap their text and lock a min-width.
  - Never use `confirm()`, `alert()` or `prompt()`, because the artifact host blocks them.
- **UI state** (`UI`, key `KEY+'-ui'`): which cards are open, `UI.o[key]`, with keys `doc`, `site:<siteId>`, `sec:<siteId>:<sectionId>`, `rack:<rackId>`.
  - It is separate from `S`: never in undo history, never exported.
  - Defaults: cover closed, site and sections open, only the first rack open. A capture-phase `toggle` listener stores changes. `data-def` carries the default so the render itself stays quiet.
  - New or duplicated racks open via `setOpen()` (inside `doAct`). Expand/Collapse all is `setAll()`.
  - `S` is saved once at startup, so a fresh sample keeps its random ids (and so its UI keys) across reloads.
- **Outline rail / chips / scroll sync**: `navKeys()` lists `doc`, `site`, `sec:<id>`, `rack:<j>`. `edId(key)` / `pvId(key)` map a key to the editor card and the preview element.
  - `renderRail()` (≥1180px) and `renderChips()` (<1180px) draw links with a completeness dot and a warning badge for racks with `devErrors()`. `statusOf()`: required fields filled → full, some → part, none → empty. Racks use `rackStat()`.
  - `goto(key)` opens the card, scrolls it under the sticky bars and scrolls the preview (`pvScrollTo`).
  - `observeNav()` is an IntersectionObserver on a 2 px line below the sticky bars. The deepest card crossing it becomes `ACTIVE`, and once the user has scrolled (`spy`) the preview follows (`followPreview`). Focusing a field does the same.
- **Layout vars**: `measure()` (ResizeObserver) writes `--bar-h`, `--seg-h`, `--chips-h` (measured heights) on `:root`. The sticky rail, preview and chips and `scroll-margin-top` use them, with no hard-coded toolbar pixels.
  - Breakpoints: ≥1180px rail | form | preview; 980–1179px chips instead of the rail; <980px one column with the แก้ไข | ตัวอย่าง switch (`setView()`, `body[data-mv]`), the bottom bar (`#mbar`) and 40px tap targets.
  - Print CSS forces the preview visible whatever the view.
- **Toast**: one live region `#toastUndo` (`aria-live=polite`, bottom-left, above the phone bar). `toast(text)` is plain. `toastUndo(msg)` adds Undo and dismiss, and pauses on hover/focus.
- **Modal**: `modal(title, body, btns)` / `closeModal()`. `role=dialog` + `aria-modal`, focus moves in, Tab is trapped, Esc and the backdrop close it, and focus returns to the trigger (the Export button when opened from the menu).
  - Reset is two steps (`resetStep()`: choose, then Cancel / "บันทึก JSON ก่อน" / ยืนยันรีเซ็ต) and ends with `toastUndo`.
- **Tabs**: `role=tablist/tab`, roving tabindex, Left/Right/Home/End select and focus. The × shows only on hover, focus or the active tab.
- **Floor-plan cells**: a rack cell in the editor's floor SVG carries `data-tog="itemIndex:rackIndex"` and toggles `on` (install rack, filled teal plus a white check mark, in the editor SVG only; the preview SVG is unchanged).
  - Named cells are `role=button`, `tabindex=0`, `aria-pressed`, with Enter/Space. `refreshFloor()` redraws the SVG and re-focuses the cell.
- **Device table**: spreadsheet-like (`tr.dev` rows: name, U, H, delete). `devErrors(r)` gives per-row messages (out of range / overlap). The row gets `err`, and the U/H inputs get `aria-invalid` + `aria-describedby` pointing at the error row under it.
  - "เพิ่มอุปกรณ์" defaults U to the free unit just above the highest device, else the first free U.

### Key functions

| Function | Purpose |
|---|---|
| `sample()`, `blankSite(n)`, `blankRack()`, `cloneSite(s)` | Data factories (`cloneSite` makes fresh ids) |
| `unitsOf(r)`, `uLabel(r)`, `devErrors(r)`, `rackStat(r)` | Derived "จำนวน Unit", "หมายเลข Unit" (e.g. `U 21`, `U 21–22`), per-device overlap/out-of-range errors, rack completeness |
| `rackSVG(r)` | Rack elevation SVG: 8 px per U, numbered from the bottom, devices drawn as `#0E7C86` bars with white labels |
| `floorSVG(f, interactive)` | Room plan SVG. `f.orient` `'h'` = rows run left→right and stack top→bottom; `'v'` = columns run top→bottom and sit side by side. Aisle labels (rotated in `'v'`), door trapezoid at the bottom (`left/center/right/none`) |
| `migrate(o)`, `normSite(s)` | Schema upgrade and defensive defaults (see Architecture) |
| `SECTIONS`, `secX()`, `pagePlan()` | Section registry and the shared TOC page plan |
| `siteHTML(s, si)`, `docHTML()` | Paper preview: cover, TOC (page numbers from `pagePlan()`: cover 1, TOC 2, per site → 1 page for sections 1+2, 1 page per rack, 1 page for the diagram), then pages |
| `mutate(fn)`, `undo()`, `redo()`, `toastUndo(msg)` | Undo history (see Architecture) |
| `armDelete(btn,run)`, `act()`, `onAct()`, `delTab()`, `selectSite()` | Delete confirmation, undoable actions (+ focus/scroll follow-up), tabs |
| `renderRail()`, `renderChips()`, `updateChrome()`, `goto()`, `observeNav()`, `setView()`, `measure()` | Outline/section navigation, scroll sync, layout vars |
| `saveUI()`, `isOpen()`, `setOpen()` | Card open/closed UI state |
| `putImg(dataUrl)`, `imgURL(ref)`, `diagImg(s)`, `internImages(o)`, `loadImages(o)`, `inlineImages(o)`, `gcImages()`, `exportJSON()` | IndexedDB image store |
| `toMarkdown()` | Markdown export (tables, floor plan as text rows with `[x]` = install rack) |
| `copyWord()` | Rasterises the preview SVGs to PNG and writes `text/html` to the clipboard (falls back to `execCommand('copy')`) |
| `buildDocx()` | **Real .docx generator, hand-written OOXML + a stored (uncompressed) ZIP writer** (`crc32`, `zipFiles`). A4, 2 cm margins, logo in `header1.xml`, styles Heading1/Heading2 (Navigation pane works), 2-column bordered tables (3500 / 6138 twips), SVGs → PNG via `svgStrToPng`, uploaded images embedded as-is |
| `saveFile(name, data, mime)` | Uses the `claude.use('downloads')` capability when hosted, otherwise a blob `<a download>` |
| `shrink(file, max)` | Downscales uploaded images (logo 400 px, diagram 1600 px) to a data URL, which `putImg()` then stores in IDB |
| `logoSrc()` | `S.doc.logo === null` → built-in `APJC_LOGO` (base64 PNG taken from the source PDF); `''` → text logo (`S.doc.logoText`); `"idb:…"` / data URL → custom logo (resolved via `imgURL`) |

## Data model

```jsonc
{
  "v": 2,                                                // schema version (missing = v1); see migrate()
  "doc": { "title": "Site Survey", "company": "National Telecom Public Company Limited",
           "logoText": "APJC", "logo": null },          // null = APJC logo, "" = text, "idb:<id>" (or inline "data:...") = custom
  "cur": 0,                                              // selected site tab
  "sites": [{
    "id": "abc1234", "name": "NT Data Center Sriracha",  // section heading
    "info":  { "agency": "NTDC", "location": "...", "datetime": "วันพุธที่ 8 กรกฏาคม 2569 เวลา 11:00 – 12:00 น.", "surveyors": "one per line" },
    "place": { "equipment": "NetScaler MPX9200, H3C Server", "building": "...", "address": "...", "racks": "Rack G-1, G-3, G-5" },
    "floor": { "orient": "h" | "v", "door": "left" | "center" | "right" | "none",
               "items": [ { "id": "", "type": "label", "text": "Rear" },
                          { "id": "", "type": "row", "racks": [ { "n": "G1", "on": true }, { "n": "", "on": false } ] } ] },
    "racks": [{
      "id": "", "device": "MPX9200", "rack": "Rack G3", "size": 42,
      "devices": [ { "id": "", "name": "NetScaler MPX9200", "u": 21, "h": 1 } ],   // u = lowest unit occupied
      "power":   [ "มีเพียงพอต่อการใช้งาน C12-C13", "..." ],                          // count = จำนวนแหล่งจ่าย
      "cables":  [ { "id": "", "type": "สาย Fiber OM3/4 Patch Cord", "text": "one run per line\n..." } ]
    }],
    "diagram": { "img": null | "idb:<id>" | "data:image/...", "caption": "" }
  }]
}
```

In localStorage and in undo snapshots, images are `"idb:<id>"` refs. Exported JSON always has inline
`data:image/...` URLs. Importing a file converts them back to refs.

An empty rack name (`"n": ""`) is a blank floor position. In the editor, users type rack rows as
comma lists, and an empty slot between commas makes a blank position (`, , 10, 09`).

## Document structure (must match the original PDF)

Per site, in Thai:

1. ข้อมูลเกี่ยวกับการสำรวจพื้นที่ (ชื่อหน่วยงาน, สถานที่/ที่อยู่, วัน-เวลาที่สำรวจ, ผู้เข้าสำรวจพื้นที่)
2. ข้อมูลสถานที่ติดตั้ง (สถานที่ติดตั้งอุปกรณ์ header row, ชื่ออาคาร/ชั้น, ที่อยู่, ห้อง/หมายเลขตู้, แผนผังห้องโดยสังเขป + floor plan)
3. ข้อมูลจุดติดตั้งในตู้ Rack, การเชื่อมต่อระบบไฟฟ้า และการเชื่อมต่อสายสัญญาณ: one table per rack with the header "ข้อมูลจุดติดตั้ง {device} ในตู้ {rack}" and these rows:
   - ห้อง/หมายเลขตู้, จำนวน Unit, หมายเลข Unit
   - rack drawing
   - ข้อมูลแหล่งจ่ายไฟฟ้าและ Outlet ในตู้ Rack (จำนวนแหล่งจ่าย, แหล่งที่ n)
   - ระยะและแนวการเดินสายสัญญาณ
4. แผนภาพการเชื่อมต่ออุปกรณ์ระบบ (uploaded image + caption)

Styling: document accent `#1A5E80`, device bar `#0E7C86`, highlighted rack `#16607F`, table rules
`#3A3A3A`, APJC logo top-right on every page. The paper preview is always white. The UI chrome
has light and dark tokens on `:root`.

## Security

See `SECURITY.md` for the threat model. Imported JSON, uploads, typed text, `localStorage` and IndexedDB are all untrusted. **Every untrusted value must go through a sanitiser before it reaches a sink:**

| Helper | Use it for |
|---|---|
| `esc(s)` | HTML text **and** every attribute value. It encodes `& < > " '`. Escape ids, numbers and enums in attributes too. |
| `safeImg(u)` / `okImg(u)` | Any image URL. Only base64 `data:image/(png|jpeg|gif|webp)` up to 15 MB passes. Read images only through `imgURL()`, `diagImg()` and `logoSrc()`, which already apply it. |
| `safeId(x)` | Ids, `[A-Za-z0-9_-]{1,64}`. `migrate()` also makes them unique. |
| `xesc(s)` | DOCX XML text. It drops characters XML 1.0 forbids. `run()` uses it. |
| `mdT(s)` / `mdL(s)` | Markdown user text: block text, and single-line text (headings, list items). |
| `parseJSON(t)` | Every `JSON.parse` of storage or of a file. It drops `__proto__`, `constructor` and `prototype` keys. |
| `safeName(s, d)` | Download file names. |

Other rules:

- Imported files go through `migrate(o, {imported:true})`, which drops `idb:` refs.
- `migrate()` refuses files with a newer schema: check `newerV(o)` and show an inline message, never an `alert()`.
- Never put an untrusted value in `on*`, `style`, `href`, `src` or a CSS selector without the matching helper.
- Never add inline `on…=""` attributes. The CSP blocks them in `index.html`. Bind handlers in JS.
- Rack height is capped at `RACK_MAX`, and any loop driven by U/H/size must stay bounded by it.
- Regression tests live in `tests/unit/security.test.mjs` (with `tests/fixtures/malicious.json`) and in the e2e `security` suite.

## Constraints to respect

- Single file, no external network at runtime for `index.html` (no CDN, no web fonts).
- `artifact.html`: scripts load only from cdnjs/jsdelivr/unpkg, and fonts only from Google Fonts.
  - No `window.print`, no `<a download>`, no `alert/confirm/prompt`.
  - Use `saveFile()` for downloads, and wrap all storage in try/catch.
- Thai text: keep the `cs` font and `szCs` size in DOCX runs (`w:cs`, `w:szCs`), or Thai will render in the wrong font or size.
- Images live in IndexedDB, and `S` holds `idb:` refs. Only the IDB fallback keeps data URLs inline, and localStorage holds about 5 MB. On quota errors, `save()` shows "Not saved here — use Save / load JSON" plus the persistent `#saveBanner`.
- Preview, Markdown and DOCX output must stay the same when internals are refactored. Compare before/after (preview `innerHTML` with `id` attributes stripped, Markdown text, and every DOCX part except `docProps/core.xml`). `npm test` does the Markdown + DOCX part of this against `tests/golden/`.

## How to test

No dependencies and no installs: everything runs on plain Node ≥ 22 (`node:test`, `node:vm`, built-in `fetch`/`WebSocket`).

```bash
npm test                 # unit + golden (~2 s, no browser)
                         #   = node --test "tests/unit/*.test.mjs" "tests/golden/*.test.mjs"
npm run test:e2e         # browser e2e on index.html AND artifact.html (~90 s) = node tests/e2e/run.mjs
npm run port             # regenerate artifact.html from index.html   = node tools/port.mjs
npm run port:check       # exit 1 if artifact.html is out of sync     = node tools/port.mjs --check
npm run golden:update    # regenerate tests/golden/ (only for intended output changes; review the diff)
                         #   = node tests/golden/golden.test.mjs --update
```

Run one file: `node --test tests/unit/docx.test.mjs`. Note that `node --test tests/unit` (a bare directory) does not work on Node 22; use the glob.

- **Unit tests** (`tests/unit/`): `tests/helpers/load-app.mjs` takes the IIFE source out of `index.html` (or `artifact.html`), appends `globalThis.__T={...internals}` **in memory only**, and runs it in `node:vm` with a tiny fake browser (anything-goes DOM proxies, in-memory `localStorage`, no-op timers, an `Image` that reads PNG/JPEG/SVG sizes, a canvas that returns a 1×1 PNG). The shipped files are never modified for tests. To test another internal function, add its name to `EXPOSE` in `load-app.mjs`; `T.S` gets and sets the app state.
  - Coverage: `migrate()`/startup load, `unitsOf`/`uLabel`/`devErrors`/`rackStat`, factories, `doAct` actions, `toMarkdown()`, `crc32`/`zipFiles` (read back with `tests/helpers/zip.mjs`), `buildDocx()` (well-formed XML via `tests/helpers/xml.mjs`, Thai `w:cs`/`w:szCs`, 10 tables, images), the `SECTIONS` registry, `pagePlan()` (12 pages), escaping, and the port sync (`port.test.mjs`).
  - Mark a known, unfixed gap as a `todo` test. When you fix it, remove the `todo` option so the test then guards the fix. There are none at the moment.
- **Golden files** (`tests/golden/`): `sample.md` and every DOCX part of `sample.json` except `docProps/core.xml` (timestamp). `docx/media.json` lists the media: as-is images by sha256, and rasterised SVG drawings as `"raster"` (name only, because pixels depend on the renderer). The vm build and the real browser must produce byte-identical Markdown and XML (the e2e `golden` suite checks the browser side).
- **Browser e2e** (`tests/e2e/run.mjs`, driver `tests/e2e/cdp.mjs`): finds Chrome/Edge/Chromium automatically (override with `CHROME_PATH=…` or `--browser …`) and prints `SKIP` (exit 0) if none is installed. Each suite gets a fresh temp profile and a random DevTools port, and the browser is always killed. The pages are copied to a temp dir, and `artifact.html` gets a viewport `<meta>` there because the host page supplies it. Suites:
  - `behaviour`: storage, migration, undo/redo, IndexedDB images, import/export, quota banner, GC
  - `ui`: card state, focus/scroll, rail + scroll-spy, delete arming, tabs, modal, floor cells, device table, reset, phone layout
  - `golden`
  - `security`: importing `malicious.json` sets no sentinel, leaves no handlers or foreign URLs, and newer schemas are refused
  - Options: `--only index|artifact`, `--suite behaviour|ui|golden|security`.
  - Downloads are read from the Blob given to `URL.createObjectURL`, because the CSP has no `connect-src`.
- Visual check of the DOCX when needed: `soffice --headless --convert-to pdf <file>.docx` (sample data → 12 pages).

## Known limits and ideas for next steps

- Open issues found by the test suite:
  - None at the moment. The escaping/XSS, empty-racks TOC and newer-schema items were fixed in the security review (see `SECURITY.md`).
- The TOC page numbers are computed, not a Word TOC field. They drift when a rack table overflows a page. Option: emit a real `TOC \o "1-2"` field and let Word update it.
- The connection diagram is image upload only. A built-in diagram editor (switches ↔ devices, link labels like "10G-SR") would be a natural next feature.
- Ideas:
  - device library / presets (NetScaler MPX9200 1U, H3C server 1U/2U, etc.)
  - power-cord presets (C13-C14, C19-C20, 5-15P to C13)
  - cable-run builder (type, distance, count → generated Thai sentence)
- Consider splitting into modules (`state.js`, `svg.js`, `docx.js`, `ui.js`) with a tiny build step that inlines them back into one HTML file for both targets.
