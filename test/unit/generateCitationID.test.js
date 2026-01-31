const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const DOCXScan = require('../../chrome/content/docxScan.js');

// generateCitationID() creates a random 8-character alphanumeric string
// used as the citationID in CSL citation JSON. Each Zotero citation field
// needs a unique ID so Zotero can track and update it later.

describe('generateCitationID', () => {
    it('returns exactly 8 characters', () => {
        const id = DOCXScan.generateCitationID();
        assert.equal(id.length, 8);
    });

    it('only contains letters and digits (A-Z, a-z, 0-9)', () => {
        const id = DOCXScan.generateCitationID();
        assert.match(id, /^[A-Za-z0-9]{8}$/);
    });

    it('20 consecutive calls produce 20 unique IDs', () => {
        const ids = new Set();
        for (let i = 0; i < 20; i++) {
            ids.add(DOCXScan.generateCitationID());
        }
        // With 62^8 (~218 trillion) possibilities, collisions are negligible
        assert.equal(ids.size, 20);
    });
});
