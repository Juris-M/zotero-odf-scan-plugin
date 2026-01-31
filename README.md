# ODF/DOCX Scan for Zotero

*ODF/DOCX Scan for Zotero* is an add-on for the [Zotero](https://www.zotero.org/) reference manager that lets you insert plain-text citation markers into any document and then convert them into active Zotero citations. This provides Zotero citation support for word processors without a dedicated Zotero plugin, such as [Scrivener](https://www.literatureandlatte.com/scrivener/overview).

The add-on supports two citation marker formats:

- **Scannable Cite** — drag-and-drop markers from the Zotero client
- **Pandoc citations** — `[@citekey]` syntax using Zotero's [Citation Key](https://www.zotero.org/support/kb/citation_keys) field

Both ODF (.odt) and DOCX (.docx) files are supported. ODF conversion requires [LibreOffice](https://www.libreoffice.org/) and the Zotero LibreOffice plugin, DOCX conversion requires Microsoft Word and the Zotero Word plugin.

For full documentation, see the [project website](https://zotero-odf-scan.github.io/zotero-odf-scan/).

## Installation

[Download the latest release](https://github.com/Juris-M/zotero-odf-scan-plugin/releases/latest) (.xpi file). In Zotero, go to Tools &rarr; Plugins, click the gear icon, and select "Install Plugin From File...".

The add-on installs the *Scannable Cite* export translator and adds an *ODF Scan* option under Zotero's Tools menu.

## Scannable Cite markers

Set the "Default Output Format" to "Scannable Cite" in the Export tab of the [Zotero Preferences](https://www.zotero.org/support/preferences). You can then insert markers by dragging items from your Zotero library or by pressing Ctrl+Alt+C (Cmd+Shift+C on macOS) to copy and then pasting.

A marker has five pipe-separated fields:

```
{See | Smith, (2012) |p. 45 | for an example |zu:2433:WQVBH98K}
```

| Field | Content |
|-------|---------|
| 1 | Prefix (e.g. "See") |
| 2 | Readable cite (author, year) — for display only |
| 3 | Locator (e.g. "p. 45", "ch. 3") |
| 4 | Suffix (e.g. "for an example") |
| 5 | Item URI — **do not modify** |

Use `-` before the author name to suppress the author in the rendered citation. Use `*asterisks*` for *italics* and `**double**` for **bold** in prefixes and suffixes.

## Pandoc citations

The add-on can also convert [pandoc-style citations](https://pandoc.org/chunkedhtml-demo/8.20-citation-syntax.html) to and from Zotero citations. Pandoc citations use the `[@citekey]` syntax, where the citekey corresponds to the item's [Citation Key](https://www.zotero.org/support/kb/citation_keys) field in Zotero.

## Converting your document

1. Save your document as .odt (OpenDocument) or .docx (Word)
2. In Zotero, open Tools &rarr; ODF Scan
3. Select the conversion direction
4. Choose your input file and output destination
5. Click "Process Document"

For ODF files, open the converted document in LibreOffice, click "Set Document Preferences" in the Zotero toolbar, choose a citation style, and Zotero will format all citations. Use "Insert Bibliography" to add a bibliography.

The add-on can also convert active Zotero citations back to markers or pandoc syntax. This is useful if you want to switch from LibreOffice or Word to a different editor.

## Support

Report issues on the [GitHub issue tracker](https://github.com/Juris-M/zotero-odf-scan-plugin/issues) or ask questions in the [Zotero forums](https://forums.zotero.org/).

## Development

### Building

The build requires `bash` (Git Bash on Windows is fine). Before building, install dependencies once:

```
npm install
```

Then build the XPI:

```
npm run build
```

This runs `build.sh`, which zips the plugin sources into an installable XPI file.

### Releasing

Releases are created with the `release.sh` script, which requires the [GitHub CLI (`gh`)](https://cli.github.com/):

```bash
# Public release
./release.sh 2.1.0

# Draft release (for testing before publishing)
./release.sh 2.1.0 --draft
```

The script will:
1. Update version in `package.json`, `manifest.json`, and `CITATION.cff`
2. Update `updates.json` with the new version and download URL
3. Build the XPI and calculate its SHA256 hash
4. Commit, tag (`v2.1.0`), and push
5. Create a GitHub release with the XPI attached

Version numbering follows semver: MAJOR.MINOR.PATCH (e.g. `2.1.0` → `2.1.1` for a bug fix, `2.2.0` for a new feature).

### Tests

Tests use the Node.js built-in test runner (`node:test`) — no extra test dependencies needed.

```bash
# Run all tests (unit + integration)
npm test

# Unit tests only
npm run test:unit

# Integration tests only
npm run test:integration

# Lint + tests
npm run test:all
```

#### Unit tests (`test/unit/`)

| Test file | What it covers |
|-----------|---------------|
| `escapeXml` | XML entity escaping (`&` → `&amp;`, `<` → `&lt;`, etc.) |
| `generateCitationID` | Random 8-character alphanumeric ID generation |
| `extractTextRuns` | Parsing `<w:r><w:t>` runs from Word XML paragraphs |
| `rebuildParagraph` | Writing modified text runs back into paragraph XML |
| `buildWordField` | Building Word field XML (fldChar begin/instrText/end) |
| `parsePandocCitationGroup` | Parsing `@citekey` entries from pandoc bracket syntax |
| `parsePandocLocator` | Splitting locators (`p. 45`) from suffixes (`emphasis added`) |
| `labelToPandocLocator` | Mapping CSL labels to pandoc prefixes (`page` → `p. `) |
| `getItemByURI` | Resolving all Zotero URI formats (`zu:`, `http://zotero.org/`, `zotero://select/`) |

#### Integration tests (`test/integration/`)

| Test file | What it covers |
|-----------|---------------|
| `citationsToMarkers` | Zotero Word fields → pipe-separated scannable cite markers |
| `citationsToPandoc` | Zotero Word fields → pandoc `[@citekey]` syntax |
| `pandocToMarkers` | Pandoc `[@citekey]` syntax → scannable cite markers |
| `markersToPandoc` | Pipe-separated markers → pandoc `[@citekey]` syntax |

Integration tests use XML fixtures in `test/fixtures/` and a Zotero mock (`test/helpers/zotero-mock.js`) that simulates item lookup without a running Zotero instance.
