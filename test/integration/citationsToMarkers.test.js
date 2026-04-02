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
        const jones = createMockItem({
            key: 'JONES2019',
            id: 2,
            citationKey: 'jones2019',
            firstCreator: 'Jones',
            title: 'Another Paper',
            year: '2019'
        });

        global.Zotero = createZoteroMock({ items: { SMITH2020: smith, JONES2019: jones } });
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

    it('multi-item field → one marker per item, not just the first', async () => {
        // field-zotero-multicite.xml has two citationItems (SMITH2020 and JONES2019)
        const input = fs.readFileSync(path.join(fixturesDir, 'field-zotero-multicite.xml'), 'utf8');
        const result = await DOCXScan.citationsToMarkers(input);
        assert.ok(result.includes('SMITH2020'), 'should include first item key');
        assert.ok(result.includes('JONES2019'), 'should include second item key');
        // Two separate marker blocks (each starts with { )
        const markerCount = (result.match(/\{[^}]*\}/g) || []).length;
        assert.equal(markerCount, 2, 'should produce exactly two markers');
    });

    it('single-item field → URI is zu: short form, not full HTTP', async () => {
        const input = fs.readFileSync(path.join(fixturesDir, 'field-zotero-citation.xml'), 'utf8');
        const result = await DOCXScan.citationsToMarkers(input);
        assert.ok(result.includes('zu:'), 'should use zu: short URI form');
        assert.ok(!result.includes('http://zotero.org'), 'should not contain full HTTP URI');
    });

    it('multi-item field → all markers use zu: short URI form', async () => {
        const input = fs.readFileSync(path.join(fixturesDir, 'field-zotero-multicite.xml'), 'utf8');
        const result = await DOCXScan.citationsToMarkers(input);
        assert.ok(!result.includes('http://zotero.org'), 'should not contain full HTTP URIs');
        const zuCount = (result.match(/zu:/g) || []).length;
        assert.equal(zuCount, 2, 'should have one zu: URI per marker');
    });
});
