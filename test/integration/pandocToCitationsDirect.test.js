const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createZoteroMock, createMockItem } = require('../helpers/zotero-mock.js');

// pandocToCitationsDirect() converts pandoc-style citations in Word XML
// directly to Zotero Word fields. Multi-item groups become a single field
// with multiple citationItems. Author-in-text (@key [loc]) becomes the
// author name as plain text followed by a suppress-author field.

describe('pandocToCitationsDirect', () => {
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

    it('[@smith2020] → single Zotero field with one citationItem', async () => {
        const input = '<w:p><w:r><w:t>See [@smith2020].</w:t></w:r></w:p>';
        const result = await DOCXScan.pandocToCitationsDirect(input);
        assert.ok(result.includes('ADDIN ZOTERO_ITEM CSL_CITATION'), 'should produce a Zotero field');
        assert.ok(result.includes('SMITH2020'), 'should reference the item');
        assert.ok(!result.includes('@smith2020'), 'should not contain pandoc syntax');
    });

    it('[@smith2020; @jones2019] → single Zotero field with two citationItems', async () => {
        const input = '<w:p><w:r><w:t>See [@smith2020; @jones2019].</w:t></w:r></w:p>';
        const result = await DOCXScan.pandocToCitationsDirect(input);
        // Both URIs should appear in one field (not two separate fields)
        const fieldMatches = result.match(/ADDIN ZOTERO_ITEM CSL_CITATION/g);
        assert.equal(fieldMatches.length, 1, 'should produce exactly one field');
        assert.ok(result.includes('SMITH2020'), 'should include first item');
        assert.ok(result.includes('JONES2019'), 'should include second item');
    });

    it('[@smith2020, chap. 3] → citationItem has locator "ch. 3" and label "chapter"', async () => {
        const input = '<w:p><w:r><w:t>[@smith2020, chap. 3]</w:t></w:r></w:p>';
        const result = await DOCXScan.pandocToCitationsDirect(input);
        const jsonMatch = result.match(/CSL_CITATION ({.*?}) /);
        assert.ok(jsonMatch, 'should contain citation JSON');
        const data = JSON.parse(jsonMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
        assert.equal(data.citationItems[0].locator, 'ch. 3');
        assert.equal(data.citationItems[0].label, 'chapter');
    });

    it('[see @smith2020 and others] → prefix and suffix in citationItem', async () => {
        const input = '<w:p><w:r><w:t>[see @smith2020 and others]</w:t></w:r></w:p>';
        const result = await DOCXScan.pandocToCitationsDirect(input);
        const jsonMatch = result.match(/CSL_CITATION ({.*?}) /);
        assert.ok(jsonMatch, 'should contain citation JSON');
        const data = JSON.parse(jsonMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
        assert.equal(data.citationItems[0].prefix, 'see');
        assert.equal(data.citationItems[0].suffix, 'and others');
    });

    it('[-@smith2020] → citationItem has suppress-author', async () => {
        const input = '<w:p><w:r><w:t>[-@smith2020]</w:t></w:r></w:p>';
        const result = await DOCXScan.pandocToCitationsDirect(input);
        const jsonMatch = result.match(/CSL_CITATION ({.*?}) /);
        assert.ok(jsonMatch, 'should contain citation JSON');
        const data = JSON.parse(jsonMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
        assert.equal(data.citationItems[0]['suppress-author'], true);
    });

    it('@smith2020 [p. 33] says → author name as plain text + suppress-author field', async () => {
        const input = '<w:p><w:r><w:t>@smith2020 [p. 33] says.</w:t></w:r></w:p>';
        const result = await DOCXScan.pandocToCitationsDirect(input);
        assert.ok(result.includes('Smith'), 'should contain author name as plain text');
        assert.ok(result.includes('ADDIN ZOTERO_ITEM CSL_CITATION'), 'should produce a Zotero field');
        assert.ok(!result.includes('@smith2020'), 'should not contain pandoc syntax');
        const jsonMatch = result.match(/CSL_CITATION ({.*?}) /);
        const data = JSON.parse(jsonMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
        assert.equal(data.citationItems[0]['suppress-author'], true);
        assert.equal(data.citationItems[0].locator, 'p. 33');
        // Space between author name and field, space before trailing text
        assert.ok(result.includes('Smith '), 'should have space after author name');
        assert.ok(result.match(/fldCharType="end".*?<w:t xml:space="preserve"> says\./s), 'should preserve space before "says"');
    });

    it('@smith2020 (no brackets) → author name + suppress-author field with no locator', async () => {
        const input = '<w:p><w:r><w:t>@smith2020 says.</w:t></w:r></w:p>';
        const result = await DOCXScan.pandocToCitationsDirect(input);
        assert.ok(result.includes('Smith'), 'should contain author name as plain text');
        assert.ok(result.includes('ADDIN ZOTERO_ITEM CSL_CITATION'), 'should produce a Zotero field');
        assert.ok(!result.includes('@smith2020'), 'should not contain pandoc syntax');
    });

    it('[-@smith2020] says → space before "says" is preserved', async () => {
        const input = '<w:p><w:r><w:t>[-@smith2020] says.</w:t></w:r></w:p>';
        const result = await DOCXScan.pandocToCitationsDirect(input);
        assert.ok(result.match(/fldCharType="end".*?<w:t xml:space="preserve"> says\./s), 'should preserve space before "says"');
    });
});
