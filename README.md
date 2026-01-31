# Zotero ODF/DOCX Scan

Converts between citation markers and active Zotero citations in ODF and DOCX documents. Supports both the drag-and-drop **Scannable Cite** format and **pandoc** citation syntax.

For usage details, see the [project website](https://zotero-odf-scan.github.io/zotero-odf-scan/).

## Building

The build requires `bash` (Git Bash on Windows is fine). Before building, install dependencies once:

```
npm install
```

Then build the XPI:

```
npm run build
```

This runs `build.sh`, which zips the plugin sources into an installable XPI file.

## Releasing

Releases are created with the `release.sh` script, which requires the [GitHub CLI (`gh`)](https://cli.github.com/):

```bash
# Public release
./release.sh 2.1.0

# Draft release (for testing before publishing)
./release.sh 2.1.0 --draft
```

The script will:
1. Update version in `package.json` and `manifest.json`
2. Update `updates.json` with the new version and download URL
3. Build the XPI and calculate its SHA256 hash
4. Commit, tag (`v2.1.0`), and push
5. Create a GitHub release with the XPI attached

Version numbering follows semver: MAJOR.MINOR.PATCH (e.g. `2.1.0` → `2.1.1` for a bug fix, `2.2.0` for a new feature).

## Tests

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

### Unit tests (`test/unit/`)

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

### Integration tests (`test/integration/`)

| Test file | What it covers |
|-----------|---------------|
| `citationsToMarkers` | Zotero Word fields → pipe-separated scannable cite markers |
| `citationsToPandoc` | Zotero Word fields → pandoc `[@citekey]` syntax |
| `pandocToMarkers` | Pandoc `[@citekey]` syntax → scannable cite markers |
| `markersToPandoc` | Pipe-separated markers → pandoc `[@citekey]` syntax |

Integration tests use XML fixtures in `test/fixtures/` and a Zotero mock (`test/helpers/zotero-mock.js`) that simulates item lookup without a running Zotero instance.
