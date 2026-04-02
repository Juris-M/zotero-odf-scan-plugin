const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createZoteroMock, createMockItem } = require('../helpers/zotero-mock.js');

const fixturesDir = path.join(__dirname, '..', 'fixtures');

// citationsToPandoc() is the reverse of pandocToMarkers. It takes Word
// XML with Zotero citation fields and replaces them with pandoc syntax:
//   [@citekey]                     — basic cite
//   [@citekey, p. 45]             — with locator
//   [-@citekey]                    — suppress author
//   [@key1, p. 45; -@key2]        — multi-cite with semicolons
// The citationKey is looked up from the Zotero library via the URI
// embedded in the field's JSON data.

describe('citationsToPandoc', () => {
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
        delete require.cache[require.resolve('../../chrome/content/citationUtils.js')];
        delete require.cache[require.resolve('../../chrome/content/docxConverter.js')];
        global.CitationUtils = require('../../chrome/content/citationUtils.js');
        DOCXScan = require('../../chrome/content/docxConverter.js');
    });

    it('single Zotero field → [@smith2020, p. 45] with no Word field XML left', async () => {
        // Input: field-zotero-citation.xml (has locator "45", label "page")
        const input = fs.readFileSync(path.join(fixturesDir, 'field-zotero-citation.xml'), 'utf8');
        const result = await DOCXScan.citationsToPandoc(input);
        assert.ok(result.includes('@smith2020'), 'should contain pandoc citekey');
        assert.ok(result.includes('['), 'should have opening bracket');
        assert.ok(result.includes(']'), 'should have closing bracket');
        assert.ok(!result.includes('fldCharType'), 'should not contain Word field structure');
        assert.ok(result.includes('p. 45'), 'should contain page locator');
    });

    it('multi-cite field → [@smith2020, p. 45; -@jones2019] with semicolons', async () => {
        // Input: field-zotero-multicite.xml (smith with locator, jones suppress-author)
        const input = fs.readFileSync(path.join(fixturesDir, 'field-zotero-multicite.xml'), 'utf8');
        const result = await DOCXScan.citationsToPandoc(input);
        assert.ok(result.includes('@smith2020'), 'should contain first citekey');
        assert.ok(result.includes('@jones2019'), 'should contain second citekey');
        assert.ok(result.includes(';'), 'should separate cites with semicolons');
        assert.ok(result.includes('-@jones2019'), 'should have suppress-author on jones');
    });

    it('chapter locator stored as "ch. 3" (pandocToCitationsDirect format) → [@smith2020, ch. 3] not doubled', async () => {
        // pandocToCitationsDirect stores locator as "ch. 3" (with prefix) and label "chapter".
        // citationsToPandoc must not prepend "ch. " again, producing "ch. ch. 3".
        const input = `<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
            `<w:r><w:instrText xml:space="preserve"> ADDIN ZOTERO_ITEM CSL_CITATION ` +
            `{"citationID":"x1","properties":{"plainCitation":"(Smith, 2020)"},` +
            `"citationItems":[{"uris":["http://zotero.org/users/local/h/items/SMITH2020"],` +
            `"locator":"ch. 3","label":"chapter"}]} </w:instrText></w:r>` +
            `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
            `<w:r><w:t>(Smith, 2020)</w:t></w:r>` +
            `<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`;
        const result = await DOCXScan.citationsToPandoc(input);
        assert.ok(result.includes('[@smith2020, ch. 3]'), 'should produce [@smith2020, ch. 3]');
        assert.ok(!result.includes('ch. ch.'), 'should not double the chapter prefix');
    });

    it('native Zotero locator stored as bare "45" with label "page" → [@smith2020, p. 45]', async () => {
        // Native Zotero Word plugin stores locator as a bare number without prefix.
        // citationsToPandoc must prepend the label prefix in that case.
        const input = fs.readFileSync(path.join(fixturesDir, 'field-zotero-citation.xml'), 'utf8');
        const result = await DOCXScan.citationsToPandoc(input);
        assert.ok(result.includes('p. 45'), 'should prepend p. to bare page number');
        assert.ok(!result.includes('p. p.'), 'should not double the prefix');
    });

    it('non-Zotero field (TOC) → left unchanged', async () => {
        const input = fs.readFileSync(path.join(fixturesDir, 'field-non-zotero.xml'), 'utf8');
        const result = await DOCXScan.citationsToPandoc(input);
        assert.ok(result.includes('TOC'));
    });

    it('plain paragraph (no fields) → returned unchanged', async () => {
        const input = fs.readFileSync(path.join(fixturesDir, 'paragraph-simple.xml'), 'utf8');
        const result = await DOCXScan.citationsToPandoc(input);
        assert.equal(result, input);
    });
});
