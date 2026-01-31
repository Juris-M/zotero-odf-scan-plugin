const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createZoteroMock, createMockItem } = require('../helpers/zotero-mock.js');

const fixturesDir = path.join(__dirname, '..', 'fixtures');

// pandocToMarkers() scans Word XML paragraphs for pandoc-style citations
// like [@smith2020] (possibly split across multiple <w:r> runs) and
// replaces them with pipe-separated scannable cite markers. This is the
// first step in converting pandoc citations → Zotero citations in DOCX.

describe('pandocToMarkers', () => {
    let DOCXScan;

    beforeEach(() => {
        const smith = createMockItem({
            key: 'SMITH2020',
            id: 1,
            citationKey: 'smith2020',
            firstCreator: 'Smith',
            title: 'A Great Paper',
            year: '2020'
        });
        const jones = createMockItem({
            key: 'JONES2019',
            id: 2,
            citationKey: 'jones2019',
            firstCreator: 'Jones',
            title: 'Another Paper',
            year: '2019'
        });

        global.Zotero = createZoteroMock({
            items: { SMITH2020: smith, JONES2019: jones }
        });
        delete require.cache[require.resolve('../../chrome/content/docxScan.js')];
        DOCXScan = require('../../chrome/content/docxScan.js');
    });

    it('"See [@smith2020]." → marker with key SMITH2020, author "Smith", no pandoc syntax left', async () => {
        const input = '<w:p><w:r><w:t>See [@smith2020].</w:t></w:r></w:p>';
        const result = await DOCXScan.pandocToMarkers(input);
        assert.ok(result.includes('SMITH2020'), 'should contain the item key');
        assert.ok(result.includes('Smith'), 'should contain author name');
        assert.ok(!result.includes('@smith2020'), 'should not contain pandoc syntax');
    });

    it('[@smith2020; @jones2019] → two markers (one per citekey)', async () => {
        // Input: paragraph-multi-cite.xml fixture with multi-cite group
        const input = fs.readFileSync(path.join(fixturesDir, 'paragraph-multi-cite.xml'), 'utf8');
        const result = await DOCXScan.pandocToMarkers(input);
        assert.ok(result.includes('SMITH2020'), 'should contain first item key');
        assert.ok(result.includes('JONES2019'), 'should contain second item key');
    });

    it('plain text paragraph (no citations) → returned unchanged', async () => {
        const input = fs.readFileSync(path.join(fixturesDir, 'paragraph-simple.xml'), 'utf8');
        const result = await DOCXScan.pandocToMarkers(input);
        assert.ok(result.includes('Hello world'));
    });

    it('citation split across multiple <w:r> runs → still found and converted', async () => {
        // Input: paragraph-split-runs.xml where [@smith2020] is split across runs
        const input = fs.readFileSync(path.join(fixturesDir, 'paragraph-split-runs.xml'), 'utf8');
        const result = await DOCXScan.pandocToMarkers(input);
        assert.ok(result.includes('SMITH2020'), 'should find and convert the split citation');
        assert.ok(!result.includes('@smith2020'), 'should not contain pandoc syntax');
    });
});
