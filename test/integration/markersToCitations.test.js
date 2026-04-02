const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createZoteroMock, createMockItem } = require('../helpers/zotero-mock.js');

const fixturesDir = path.join(__dirname, '..', 'fixtures');

// markersToCitations() converts pipe-separated scannable cite markers
// into Zotero Word field XML (ADDIN ZOTERO_ITEM CSL_CITATION ...).
// Marker format: { prefix | cite | locator | suffix | uri }
// Suppress-author is signaled by a leading '-' in the cite field.
// Adjacent markers (only XML between them) become a single Word field
// with multiple citationItems, matching Zotero's own multi-item format.

describe('markersToCitations', () => {
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
        delete require.cache[require.resolve('../../chrome/content/citationUtils.js')];
        delete require.cache[require.resolve('../../chrome/content/docxConverter.js')];
        global.CitationUtils = require('../../chrome/content/citationUtils.js');
        DOCXScan = require('../../chrome/content/docxConverter.js');
    });

    it('basic marker → Zotero field with ADDIN ZOTERO_ITEM', async () => {
        const input = '<w:r><w:t>{ | Smith, A Great Paper (2020) | | |zu:0:SMITH2020}</w:t></w:r>';
        const result = await DOCXScan.markersToCitations(input);
        assert.ok(result.includes('ADDIN ZOTERO_ITEM'), 'should produce a Zotero Word field');
        assert.ok(result.includes('fldCharType=&quot;begin&quot;') || result.includes('fldCharType="begin"'), 'should have fldChar begin');
    });

    it('marker with suppress-author (leading dash) → "suppress-author":true in citationData', async () => {
        // The JSON is XML-escaped in instrText, so " becomes &quot;
        const input = fs.readFileSync(path.join(fixturesDir, 'paragraph-marker-suppress.xml'), 'utf8');
        const result = await DOCXScan.markersToCitations(input);
        assert.ok(result.includes('&quot;suppress-author&quot;:true'), 'suppress-author flag must be set');
        assert.ok(result.includes('ADDIN ZOTERO_ITEM'), 'should still produce a Zotero field');
    });

    it('marker without leading dash → no suppress-author in citationData', async () => {
        const input = '<w:r><w:t>{ | Smith, A Great Paper (2020) | | |zu:0:SMITH2020}</w:t></w:r>';
        const result = await DOCXScan.markersToCitations(input);
        assert.ok(!result.includes('suppress-author'), 'suppress-author must not be set for normal marker');
    });

    it('marker with locator → locator preserved in citationData', async () => {
        // The JSON is XML-escaped in instrText, so " becomes &quot;
        const input = '<w:r><w:t>{ | Smith, A Great Paper (2020) | p. 45 | |zu:0:SMITH2020}</w:t></w:r>';
        const result = await DOCXScan.markersToCitations(input);
        assert.ok(result.includes('&quot;locator&quot;:&quot;p. 45&quot;'), 'locator should appear in citationData');
    });

    it('marker with prefix "see" → prefix in citationItem', async () => {
        const input = '<w:r><w:t>{ see | Smith, A Great Paper (2020) | | |zu:0:SMITH2020}</w:t></w:r>';
        const result = await DOCXScan.markersToCitations(input);
        assert.ok(result.includes('&quot;prefix&quot;:&quot;see&quot;'), 'prefix must appear in citationItem JSON');
    });

    it('marker with suffix "note" → suffix in citationItem', async () => {
        const input = '<w:r><w:t>{ | Smith, A Great Paper (2020) | | note |zu:0:SMITH2020}</w:t></w:r>';
        const result = await DOCXScan.markersToCitations(input);
        assert.ok(result.includes('&quot;suffix&quot;:&quot;note&quot;'), 'suffix must appear in citationItem JSON');
    });

    it('plain text (no markers) → returned unchanged', async () => {
        const input = '<w:p><w:r><w:t>No citations here.</w:t></w:r></w:p>';
        const result = await DOCXScan.markersToCitations(input);
        assert.equal(result, input);
    });

    it('text with trailing space before marker → space preserved (xml:space="preserve" added)', async () => {
        // w:t without xml:space="preserve" ending with a space before the marker:
        // OOXML trims trailing whitespace unless preserve is set.
        const input = '<w:r><w:t>See { | Smith (2020) | | |zu:0:SMITH2020}</w:t></w:r>';
        const result = await DOCXScan.markersToCitations(input);
        // The w:t containing "See " must have xml:space="preserve" so the space isn't trimmed
        assert.ok(
            result.includes('<w:t xml:space="preserve">See </w:t>'),
            'w:t with trailing space must get xml:space="preserve"'
        );
    });

    it('two adjacent markers (citationsToMarkers output) → single Word field with two citationItems', async () => {
        // citationsToMarkers() produces one <w:r><w:t>{ marker}</w:t></w:r> per item.
        // markersToCitations() must detect these as adjacent and merge into one field.
        const input =
            '<w:r><w:t>{ | (Smith, 2020; Jones, 2019) | | |zu:0:SMITH2020}</w:t></w:r>' +
            '<w:r><w:t>{ | (Smith, 2020; Jones, 2019) | | |zu:0:JONES2019}</w:t></w:r>';
        const result = await DOCXScan.markersToCitations(input);

        // Must produce exactly ONE Word field (one begin, one end)
        const beginCount = (result.match(/fldCharType=.begin./g) || []).length;
        assert.equal(beginCount, 1, 'adjacent markers must produce a single Word field');

        // That field must contain both URIs in its citationItems JSON
        assert.ok(result.includes('SMITH2020'), 'first item URI must be in field');
        assert.ok(result.includes('JONES2019'), 'second item URI must be in field');
    });

    it('two non-adjacent markers (text between them) → two separate Word fields', async () => {
        const input =
            '<w:t>{ | Smith (2020) | | |zu:0:SMITH2020} and { | Jones (2019) | | |zu:0:JONES2019}</w:t>';
        const result = await DOCXScan.markersToCitations(input);
        const beginCount = (result.match(/fldCharType=.begin./g) || []).length;
        assert.equal(beginCount, 2, 'non-adjacent markers must produce two separate Word fields');
    });
});
