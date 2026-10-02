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
| `sample.json` | Exported state with the two sample sites (NT Data Center Sriracha, NT Data Center Bangkok). Load it with **Save / load JSON** to get the sample data back. |
| `CLAUDE.md` | This file. |

**Keep the two HTML files in sync.** Apart from the differences below, the code is identical.
When you change features, edit `index.html` first and port the change to `artifact.html`.

| Area | `index.html` (offline) | `artifact.html` (hosted) |
|---|---|---|
| Wrapper | full doctype/html/head/body | content only, `<title>` first |
| Fonts | system: `Leelawadee UI`, `Segoe UI`, Tahoma; mono `Consolas` | Google Fonts: IBM Plex Sans Thai, Sarabun, IBM Plex Mono |
| localStorage key | `rack-site-survey-offline-v1` | `rack-site-survey-v1` |
| Buttons | Download .docx, Print / Save PDF, Download JSON, Copy Markdown (+ Download .md in modal), Copy for Word, Save / load JSON, Reset | same minus Print and Download .md |
| `@media print` / `@page A4` CSS | yes | no |
| `dl()` blob-link helper | yes | no (uses `saveFile`) |

## Architecture (all inside one IIFE in the `<script>`)

- **State**: a single object `S`. It is saved to `localStorage` with a debounce of about 300 ms by `save()`, and every read and write is wrapped in try/catch. On load, `S` comes from storage or from `sample()`.
- **Rendering**: string templates and `innerHTML`.
  - `renderTabs()` draws the site tabs.
  - `renderEditor()` draws the left-hand form.
  - `renderDoc()` draws the right-hand paper preview.
  - `renderAll()` runs all three.
- **Binding**: inputs carry `data-b="<path>"`, e.g. `sites.0.racks.1.devices.0.u`.
  - The delegated `input` handler on `#editor` calls `setP(S, path, value)`, then `save()`, then re-renders **only the preview**. This keeps focus in the form.
  - On `change`, selects and number inputs trigger a full `renderEditor()`, so derived chips and warnings update.
- **Actions**: buttons carry `data-act="<name>"` plus `data-i` / `data-j` indexes. Everything goes through one `switch` in `act(a,i,j)`, which ends with `save(); renderAll()`.
- **Two-click deletes**:
  - Buttons with `data-confirm` arm first ("Click again to delete") and reset after 3 s. Tab deletes (`data-tabx`) work the same way.
  - Never use `confirm()`, `alert()` or `prompt()`, because the artifact host blocks them.
- **Floor-plan clicks**: a rack cell in the editor's floor SVG carries `data-tog="itemIndex:rackIndex"` and toggles `on` (install rack, drawn filled teal).

### Key functions

| Function | Purpose |
|---|---|
| `sample()`, `blankSite(n)`, `blankRack()`, `cloneSite(s)` | Data factories (`cloneSite` makes fresh ids) |
| `unitsOf(r)`, `uLabel(r)`, `rackWarnings(r)` | Derived "จำนวน Unit", "หมายเลข Unit" (e.g. `U 21`, `U 21–22`), overlap/out-of-range warnings |
| `rackSVG(r)` | Rack elevation SVG: 8 px per U, numbered from the bottom, devices drawn as `#0E7C86` bars with white labels |
| `floorSVG(f, interactive)` | Room plan SVG. `f.orient` `'h'` = rows run left→right and stack top→bottom; `'v'` = columns run top→bottom and sit side by side. Aisle labels (rotated in `'v'`), door trapezoid at the bottom (`left/center/right/none`) |
| `siteHTML(s)`, `docHTML()` | Paper preview: cover, TOC (page numbers computed: cover 1, TOC 2, per site → 1 page for sections 1+2, 1 page per rack, 1 page for the diagram), then pages |
| `toMarkdown()` | Markdown export (tables, floor plan as text rows with `[x]` = install rack) |
| `copyWord()` | Rasterises the preview SVGs to PNG and writes `text/html` to the clipboard (falls back to `execCommand('copy')`) |
| `buildDocx()` | **Real .docx generator, hand-written OOXML + a stored (uncompressed) ZIP writer** (`crc32`, `zipFiles`). A4, 2 cm margins, logo in `header1.xml`, styles Heading1/Heading2 (Navigation pane works), 2-column bordered tables (3500 / 6138 twips), SVGs → PNG via `svgStrToPng`, uploaded images embedded as-is |
| `saveFile(name, data, mime)` | Uses the `claude.use('downloads')` capability when hosted, otherwise a blob `<a download>` |
| `shrink(file, max)` | Downscales uploaded images (logo 400 px, diagram 1600 px) before storing them as data URLs |
| `logoSrc()` | `S.doc.logo === null` → built-in `APJC_LOGO` (base64 PNG taken from the source PDF); `''` → text logo (`S.doc.logoText`); string → custom data URL |

## Data model

```jsonc
{
  "doc": { "title": "Site Survey", "company": "National Telecom Public Company Limited",
           "logoText": "APJC", "logo": null },          // null = APJC logo, "" = text, "data:..." = custom
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
    "diagram": { "img": null | "data:image/...", "caption": "" }
  }]
}
```

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

## Constraints to respect

- Single file, no external network at runtime for `index.html` (no CDN, no web fonts).
- `artifact.html`: scripts load only from cdnjs/jsdelivr/unpkg, and fonts only from Google Fonts.
  - No `window.print`, no `<a download>`, no `alert/confirm/prompt`.
  - Use `saveFile()` for downloads, and wrap all storage in try/catch.
- Thai text: keep the `cs` font and `szCs` size in DOCX runs (`w:cs`, `w:szCs`), or Thai will render in the wrong font or size.
- Images are stored as data URLs in `S`, and localStorage holds about 5 MB. `save()` shows "Not saved here — use Save / load JSON" when the quota is exceeded.

## How to test

```bash
# Headless smoke test (Playwright): load, click Download .docx, validate the zip/XML
node -e "
const {chromium}=require('playwright');(async()=>{const b=await chromium.launch();
const p=await b.newPage({acceptDownloads:true});const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto('file://'+process.cwd()+'/index.html');
const [d]=await Promise.all([p.waitForEvent('download'),p.click('#bDocx')]);await d.saveAs('out.docx');
console.log(errs.length?errs:'ok');await b.close()})()"
python3 -c "import docx;d=docx.Document('out.docx');print(len(d.tables),'tables',len(d.inline_shapes),'images')"
soffice --headless --convert-to pdf out.docx   # visual check; sample data → 12 pages
```

## Known limits and ideas for next steps

- The TOC page numbers are computed, not a Word TOC field. They drift when a rack table overflows a page. Option: emit a real `TOC \o "1-2"` field and let Word update it.
- The connection diagram is image upload only. A built-in diagram editor (switches ↔ devices, link labels like "10G-SR") would be a natural next feature.
- There is no undo. Possible approach: keep a history stack of `JSON.stringify(S)` snapshots in `act()`.
- Ideas:
  - device library / presets (NetScaler MPX9200 1U, H3C server 1U/2U, etc.)
  - power-cord presets (C13-C14, C19-C20, 5-15P to C13)
  - cable-run builder (type, distance, count → generated Thai sentence)
- Consider splitting into modules (`state.js`, `svg.js`, `docx.js`, `ui.js`) with a tiny build step that inlines them back into one HTML file for both targets.
