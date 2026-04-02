const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const DOCXScan = require('../../chrome/content/citationUtils.js');

// httpURIToShort() converts a full HTTP Zotero URI to the short zu:/zg: form
// that rtfScan.js markers require. It is purely string-based (no item lookup).

describe('httpURIToShort', () => {
    it('local user library URI → zu:0:KEY', () => {
        const uri = 'http://zotero.org/users/local/eYQ3lo9I/items/SMITH2020';
        assert.equal(DOCXScan.httpURIToShort(uri), 'zu:0:SMITH2020');
    });

    it('synced user library URI → zu:USERID:KEY', () => {
        const uri = 'http://zotero.org/users/12345/items/SMITH2020';
        assert.equal(DOCXScan.httpURIToShort(uri), 'zu:12345:SMITH2020');
    });

    it('group library URI → zg:GROUPID:KEY', () => {
        const uri = 'http://zotero.org/groups/67890/items/JONES2019';
        assert.equal(DOCXScan.httpURIToShort(uri), 'zg:67890:JONES2019');
    });

    it('already-short zu: URI → returned unchanged', () => {
        const uri = 'zu:0:SMITH2020';
        assert.equal(DOCXScan.httpURIToShort(uri), 'zu:0:SMITH2020');
    });

    it('already-short zg: URI → returned unchanged', () => {
        const uri = 'zg:67890:JONES2019';
        assert.equal(DOCXScan.httpURIToShort(uri), 'zg:67890:JONES2019');
    });

    it('zotero://select URI → returned unchanged', () => {
        const uri = 'zotero://select/library/items/SMITH2020';
        assert.equal(DOCXScan.httpURIToShort(uri), 'zotero://select/library/items/SMITH2020');
    });
});
