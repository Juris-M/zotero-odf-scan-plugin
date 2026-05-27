const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createZoteroMock, createMockItem } = require('../helpers/zotero-mock.js');
const CitationUtils = require('../../chrome/content/citationUtils.js');
global.CitationUtils = CitationUtils;
const DOCXScan = require('../../chrome/content/docxConverter.js');

// markersToCitations() converts { prefix | cite | locator | suffix | uri } markers
// embedded in Word XML into proper Zotero Word fields. The tricky cases handled here:
//
// 1. Word may inject <w:proofErr/> elements or split text across multiple <w:r> runs
//    within a marker. The captured fields must be stripped of XML tags before use,
//    otherwise XML markup ends up embedded in the JSON formattedCitation field.
//
// 2. Markers in different paragraphs or footnotes must become separate citations.
//    The adjacency check must not merge across </w:p> boundaries.
//
// 3. Adjacent markers in the SAME paragraph should still be grouped into a single
//    citation with multiple citationItems (round-trip of multi-item citations).

function setupZotero(itemsByKey = {}) {
    global.Zotero = createZoteroMock({ items: itemsByKey });
}

// Helper: extract the ADDIN ZOTERO_ITEM CSL_CITATION JSON objects from output XML.
// Returns an array of parsed citation data objects in document order.
function extractCitationJsons(xml) {
    const results = [];
    const re = /ADDIN ZOTERO_ITEM CSL_CITATION\s+(\{[\s\S]*?\})\s*<\/w:instrText/g;
    let m;
    while ((m = re.exec(xml)) !== null) {
        // Unescape XML entities that escapeXml() applied to the JSON
        const unescaped = m[1]
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>');
        results.push(JSON.parse(unescaped));
    }
    return results;
}

describe('markersToCitations', () => {
    describe('XML tags embedded in marker fields (Word proofErr / split runs)', () => {
        it('strips <w:proofErr/> from cite field — formattedCitation contains plain text only', async () => {
            setupZotero();
            // Simulate Word splitting the marker across runs with a proofErr in the cite field
            const xml =
                '<w:p><w:r><w:t>{ |</w:t></w:r>' +
                '<w:proofErr w:type="gramEnd"/>' +
                '<w:r><w:t xml:space="preserve"> Smith, 2020 | | |zotero://select/library/items/ABCD1234}</w:t></w:r></w:p>';

            const result = await DOCXScan.markersToCitations(xml);
            const citations = extractCitationJsons(result);

            assert.equal(citations.length, 1, 'should produce exactly one citation');
            const fc = citations[0].properties.formattedCitation;
            assert.ok(!fc.includes('<'), `formattedCitation must not contain XML tags, got: ${fc}`);
            assert.ok(fc.includes('Smith, 2020'), `formattedCitation should contain "Smith, 2020", got: ${fc}`);
        });

        it('strips XML tags from URI field — item lookup uses clean URI', async () => {
            setupZotero();
            // URI split across runs with spellStart/spellEnd proofErr
            const xml =
                '<w:p><w:r><w:t>{ | Jones, 2021 | | |</w:t></w:r>' +
                '<w:proofErr w:type="spellStart"/>' +
                '<w:r><w:t>zotero</w:t></w:r>' +
                '<w:proofErr w:type="spellEnd"/>' +
                '<w:r><w:t>://select/library/items/WXYZ5678}</w:t></w:r></w:p>';

            const result = await DOCXScan.markersToCitations(xml);
            const citations = extractCitationJsons(result);

            assert.equal(citations.length, 1);
            // URI in citationItems should be clean (no XML markup)
            const uri = citations[0].citationItems[0].uris[0];
            assert.ok(!uri.includes('<'), `URI must not contain XML tags, got: ${uri}`);
            assert.ok(uri.includes('WXYZ5678'), `URI should contain the item key, got: ${uri}`);
        });
    });

    describe('grouping: markers in separate paragraphs must not merge', () => {
        it('two markers in different <w:p> elements produce two separate citations', async () => {
            setupZotero();
            const xml =
                '<w:p><w:r><w:t>{ | Smith, 2020 | | |zu:0:AAAA1111}</w:t></w:r></w:p>' +
                '<w:p><w:r><w:t>{ | Jones, 2021 | | |zu:0:BBBB2222}</w:t></w:r></w:p>';

            const result = await DOCXScan.markersToCitations(xml);
            const citations = extractCitationJsons(result);

            assert.equal(citations.length, 2, 'each paragraph marker must become its own citation');
            assert.equal(citations[0].citationItems.length, 1);
            assert.equal(citations[1].citationItems.length, 1);
        });

        it('four markers across four footnotes produce four separate citations', async () => {
            setupZotero();
            // Simplified version of the FootnotesWord.docx footnotes.xml structure
            const xml =
                '<w:footnote w:id="1"><w:p><w:r><w:t>{ | A, 2010 | | |zu:0:AAAA1111}</w:t></w:r></w:p></w:footnote>' +
                '<w:footnote w:id="2"><w:p><w:r><w:t>{ | B, 2011 | | |zu:0:BBBB2222}</w:t></w:r></w:p></w:footnote>' +
                '<w:footnote w:id="3"><w:p><w:r><w:t>{ | C, 2012 | | |zu:0:CCCC3333}</w:t></w:r></w:p></w:footnote>' +
                '<w:footnote w:id="4"><w:p><w:r><w:t>{ | D, 2013 | | |zu:0:DDDD4444}</w:t></w:r></w:p></w:footnote>';

            const result = await DOCXScan.markersToCitations(xml);
            const citations = extractCitationJsons(result);

            assert.equal(citations.length, 4, 'each footnote marker must become its own citation');
            for (const c of citations) {
                assert.equal(c.citationItems.length, 1, 'each citation should have exactly one item');
            }
        });
    });

    describe('grouping: adjacent markers in the same paragraph stay merged', () => {
        it('two adjacent markers in one <w:p> become a single citation with two items', async () => {
            setupZotero();
            const xml =
                '<w:p><w:r><w:t>' +
                '{ | Smith, 2020 | | |zu:0:AAAA1111}' +
                '{ | Jones, 2021 | | |zu:0:BBBB2222}' +
                '</w:t></w:r></w:p>';

            const result = await DOCXScan.markersToCitations(xml);
            const citations = extractCitationJsons(result);

            assert.equal(citations.length, 1, 'adjacent markers should merge into one citation');
            assert.equal(citations[0].citationItems.length, 2, 'merged citation should have two items');
        });

        it('last footnote with two adjacent markers → one citation, other footnotes separate', async () => {
            setupZotero();
            const xml =
                '<w:footnote w:id="1"><w:p><w:r><w:t>{ | A, 2010 | | |zu:0:AAAA1111}</w:t></w:r></w:p></w:footnote>' +
                '<w:footnote w:id="2"><w:p><w:r><w:t>' +
                '{ | B, 2011 | | |zu:0:BBBB2222}{ | C, 2012 | | |zu:0:CCCC3333}' +
                '</w:t></w:r></w:p></w:footnote>';

            const result = await DOCXScan.markersToCitations(xml);
            const citations = extractCitationJsons(result);

            assert.equal(citations.length, 2, 'should be two citations: one per footnote');
            assert.equal(citations[0].citationItems.length, 1, 'first footnote: single item');
            assert.equal(citations[1].citationItems.length, 2, 'second footnote: two adjacent markers merged');
        });
    });

    describe('stripXmlTags helper', () => {
        it('removes all XML tags leaving only text', () => {
            assert.equal(
                DOCXScan.stripXmlTags('<w:proofErr w:type="gramEnd"/><w:r><w:t> Smith, 2020 </w:t></w:r>'),
                ' Smith, 2020 '
            );
        });

        it('returns plain string unchanged', () => {
            assert.equal(DOCXScan.stripXmlTags('zotero://select/library/items/ABC123'), 'zotero://select/library/items/ABC123');
        });

        it('handles mixed XML and text (split URI across runs)', () => {
            assert.equal(
                DOCXScan.stripXmlTags('zotero</w:t></w:r><w:r><w:t>://select/library/items/ABC123'),
                'zotero://select/library/items/ABC123'
            );
        });
    });
});
