const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createZoteroMock, createMockItem } = require('../helpers/zotero-mock.js');

const fixturesDir = path.join(__dirname, '..', 'fixtures');

// citationsToMarkers() takes Word XML containing Zotero citation fields
// (the fldChar begin/instrText/separate/end structure) and replaces each
// one with a pipe-separated scannable cite marker like:
//   { prefix | Author, Title (Year) | locator | suffix | uri }
// This is the DOCX equivalent of the ODF "to markers" mode.

describe('citationsToMarkers', () => {
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

        global.Zotero = createZoteroMock({ items: { SMITH2020: smith } });
        delete require.cache[require.resolve('../../chrome/content/docxScan.js')];
        DOCXScan = require('../../chrome/content/docxScan.js');
    });

    it('Zotero field fixture → pipe-separated marker with item key, no field structure left', async () => {
        // Input: field-zotero-citation.xml (a full Word field with fldChar/instrText)
        // Output: marker containing "SMITH2020" and pipe separators, no fldCharType
        const input = fs.readFileSync(path.join(fixturesDir, 'field-zotero-citation.xml'), 'utf8');
        const result = await DOCXScan.citationsToMarkers(input);
        assert.ok(result.includes('|'));
        assert.ok(result.includes('SMITH2020'));
        assert.ok(!result.includes('fldCharType="begin"'));
    });

    it('non-Zotero field (TOC) → left unchanged', async () => {
        // Input: field-non-zotero.xml (a TOC field)
        // Output: identical — only Zotero fields are converted
        const input = fs.readFileSync(path.join(fixturesDir, 'field-non-zotero.xml'), 'utf8');
        const result = await DOCXScan.citationsToMarkers(input);
        assert.ok(result.includes('TOC'));
        assert.ok(result.includes('Table of Contents'));
    });

    it('plain paragraph (no fields) → returned unchanged', async () => {
        const input = fs.readFileSync(path.join(fixturesDir, 'paragraph-simple.xml'), 'utf8');
        const result = await DOCXScan.citationsToMarkers(input);
        assert.equal(result, input);
    });
});
