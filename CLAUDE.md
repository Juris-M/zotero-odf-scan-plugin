# CLAUDE.md — ODF Scan for Zotero

## What this plugin does

*ODF Scan for Zotero* converts plain-text citation markers in word-processor documents into active Zotero citations, and vice-versa. This enables Zotero citation support in editors without a native Zotero plugin (e.g. Scrivener).

Two marker formats are supported:
- **Scannable Cite**: `{See | Smith, (2012) |p. 45 | for an example |zu:2433:WQVBH98K}`
- **Pandoc**: `[@citekey]` (uses Zotero's Citation Key field)

Two file formats are supported:
- **ODF** (.odt, .fodt) — downstream requires LibreOffice + Zotero LibreOffice plugin
- **DOCX** (.docx) — downstream requires Word + Zotero Word plugin

Four conversion directions exist:
| Mode value | Direction |
|---|---|
| `tocitations` | Markers → Zotero citations (default) |
| `tomarkers` | Zotero citations → markers |
| `pandoctocitations` | Pandoc → Zotero citations |
| `topandoc` | Zotero citations → Pandoc |

---

## Plugin architecture

This is a **Zotero 7+ bootstrap-style plugin** (no install.rdf, no chrome.manifest).

### Entry point: `bootstrap.js`

Lifecycle hooks called by Zotero:
- `install()` — installs the Scannable Cite translator via `Zotero.Translators.save()`
- `startup()` — registers chrome:// package programmatically via `aomStartup.registerChrome`, sets default prefs, loads `odfScanMenu.js`, initializes the menu object
- `onMainWindowLoad()` / `onMainWindowUnload()` — adds/removes the menu item per window
- `shutdown()` — removes menu items, unregisters chrome package
- `uninstall()` — no-op

Chrome packages registered:
- `chrome://odf-scan/content/` → `chrome/content/`
- `chrome://odf-scan/locale/en-US/` → `chrome/locale/en-US/`

Default preferences (all under `extensions.zotero.`):
- `ODFScan.fileType` — `"odf"`
- `ODFScan.outputMode` — `"tocitations"`
- `ODFScan.odf.lastInputFile{mode}` / `ODFScan.odf.lastOutputFile{mode}` — remembered paths

---

### Source files in `chrome/content/`

#### `odfScanMenu.js` — menu integration
- Defines `Zotero_ODFScan` as a plain object (not a function constructor)
- `addToWindow(win)` inserts a `<menuitem id="menu_odfScan">` after the existing `menu_rtfScan` item in the Tools menu
- `openDialog(win)` opens `chrome://odf-scan/content/odfScan.xhtml` as a `chrome,centerscreen,resizable=yes` dialog

#### `odfScan.xhtml` — dialog UI
- XUL `<window>` (not a wizard — the wizard structure from the original rtfScan has been replaced)
- Loads Zotero core scripts: `chrome://zotero/content/include.js` and `customElements.js`
- Loads `odfScan.js` for the dialog controller
- Four radio buttons for conversion direction
- Input/output file pickers
- Status box (hidden by default, shown on completion/error)

#### `odfScan.js` — dialog controller (`Zotero_ODFScanDialog`)
- `init()` attaches event listeners and restores last-used paths from prefs
- `processDocument()` detects file type from extension, routes to `processDOCX()` or `processODF()`
- **Important**: Creates stub `canAdvance`/`advance`/`rewind` on `document.documentElement` because `odfConverter.js` still uses them
- **Important**: Communicates with converters via globals: `window.inputFile`, `window.outputFile`, `window.DOCXScanComplete`, `window.DOCXScanFailed`
- Scripts are loaded lazily via `Services.scriptloader.loadSubScript()` — always loads `citationUtils.js` first
- ODF completion is detected with `setTimeout(200ms)` polling of flags — fragile but inherited from original design

#### `citationUtils.js` — shared format-agnostic utilities (`CitationUtils`)
Loaded by both `odfScan.js` paths before either converter is loaded. Contains everything not tied to a specific XML format:
- Pandoc syntax parsing: `parsePandocCitationGroup`, `parsePandocLocator`, `labelToPandocLocator`
- Zotero item lookup: `findItemByCitationKey`, `getItemByURI`
- URI construction: `buildItemURI`, `buildItemURIShort`, `httpURIToShort`
- XML escaping: `escapeXml`
- Text-based marker↔pandoc converters used by the ODF pandoc flows:
  - `pandocToMarkersText(content)` — pandoc plain text → scannable cite markers (ODF mode)
  - `markersToPandoc(content)` — scannable cite markers → pandoc plain text

#### `odfConverter.js` — ODF scan logic (`_ODFScanImpl` + `ODFConverter`)
Merges the former `rtfScan.js` (core ODF processing) and `odfConvert.js` (wrapper) into one file.

`_ODFScanImpl` (internal function constructor):
- Contains `_scanODF(outputMode)` — the main ODF processing function using heavy regex-based XML manipulation
- Zotero citation XML template: `<text:reference-mark-start text:name="ZOTERO_ITEM {...} RND{id}"/>...`
- Scannable Cite marker template: `{ prefix | readable | locator | suffix | uri }`
- `runODFScan(outputMode)` — public entry point used by `ODFConverter`
- **Known issue**: Attempts to load stringbundle from `chrome://rtf-odf-scan-for-zotero/locale/zotero.properties` (old plugin ID) — falls back to hardcoded English strings when this fails

`ODFConverter` (public object, `window.ODFConverter`):
- `scanODF(outputMode)` — wraps `_ODFScanImpl.runODFScan(outputMode)`
- `pandocToODF()` — reads ODF content (flat or ZIP), converts pandoc citations to scannable cite markers using `CitationUtils.pandocToMarkersText()`, then runs ODF scan
- `citationsToPandocODF()` — two-step: ODF citations → markers via ODF scan, then `CitationUtils.markersToPandoc()`

#### `docxConverter.js` — DOCX scan logic (`DOCXConverter`)
DOCX-specific logic only. Format-agnostic utilities live in `citationUtils.js`.
- `scanDOCX(outputMode)` — extracts DOCX ZIP, reads `word/document.xml`, processes it, repacks ZIP
- ZIP extraction uses `nsIZipReader`; ZIP creation uses `nsIZipWriter`
- Four conversion methods map to the four modes:
  - `citationsToMarkers(content)` — Word field XML → scannable cite markers
  - `citationsToPandoc(content)` — Word field XML → pandoc syntax
  - `pandocToMarkers(content)` — pandoc syntax → scannable cite markers (DOCX/Word XML mode)
  - `pandocToCitationsDirect(content)` — pandoc syntax → Zotero Word fields directly
  - `markersToCitations(content)` — scannable cite markers → Word field XML
- DOCX-only utilities (not in citationUtils.js): `extractTextRuns`, `rebuildParagraph`, `replaceAsync`, `buildWordField`, `generateCitationID`, `buildCitationData`, `buildCitationDataFromURI`

#### `odfScan.css` — dialog styles

---

### `resource/translators/Scannable Cite.js`

Standard Zotero export translator. Installed at startup via `Zotero.Translators.save()`. Enables drag-and-drop of Scannable Cite markers from the Zotero library pane.

---

### Localization (`chrome/locale/en-US/`)

- `odf-scan.ftl` — Fluent strings for Zotero 7+ (linked from dialog via `<html:link rel="localization">`)
- `about.dtd`, `zotero.dtd`, `zotero.properties` — Legacy files; `zotero.properties` is referenced in `rtfScan.js` via the old chrome path and fails silently, falling back to hardcoded strings

---

## Zotero API patterns used

| API | Usage |
|-----|-------|
| `Zotero.debug(msg)` | All logging |
| `Zotero.Prefs.get/set(key)` | Persisting file paths and settings |
| `Zotero.File.pathToFile(path)` | String path → nsIFile |
| `Zotero.File.getContentsAsync(path)` | Async file read |
| `Zotero.File.putContents(file, str)` | Sync file write |
| `Zotero.getTempDirectory()` | Temp dir for ZIP extraction |
| `Zotero.Translators.save(header, code)` | Install translator |
| `Zotero.Schema.schemaUpdatePromise` | Wait for Zotero ready |
| `ChromeUtils.importESModule(...)` | Import ES modules (FilePicker) |
| `Services.scriptloader.loadSubScript(url, win)` | Lazy script loading |
| `Services.prefs.getDefaultBranch(branch)` | Default pref registration |
| `Components.classes[...].createInstance(...)` | XPCOM (file I/O, ZIP) |

---

## Testing

Tests run with **Node.js built-in test runner** (`node:test`) — no Mocha/Jest.

```bash
npm test               # unit + integration
npm run test:unit      # test/unit/*.test.js
npm run test:integration  # test/integration/*.test.js
npm run test:all       # lint + tests
```

- **Unit tests** (`test/unit/`) — test pure functions from `citationUtils.js` and `docxConverter.js`
- **Integration tests** (`test/integration/`) — test full conversion pipelines using XML fixtures in `test/fixtures/` and a Zotero mock at `test/helpers/zotero-mock.js`
- Tests run entirely in Node.js; no running Zotero instance needed

---

## Build & release

```bash
npm install      # one-time
npm run build    # produces .xpi via build.sh
./release.sh 3.0.1          # full release
./release.sh 3.0.1 --draft  # draft release
```

Release script updates version in `package.json`, `manifest.json`, `CITATION.cff`, and `updates.json`, then commits, tags, and creates a GitHub release.

---

## Known issues / areas to watch

1. **odfConverter.js stringbundle**: Uses old chrome path `chrome://rtf-odf-scan-for-zotero/` (old plugin ID). Always fails and falls back to hardcoded English strings. Not a bug in practice, but localization is broken for ODF conversion strings.

2. **setTimeout-based completion detection**: `odfScan.js` uses `setTimeout(200ms)` to poll `conversionComplete`/`conversionFailed` flags after triggering ODF conversion. Fragile — if conversion takes longer, the status update runs before it finishes.

3. **manifest.json `strict_max_version`**: Currently `"9.0.*"`. May need updating when Zotero releases version 10+.
