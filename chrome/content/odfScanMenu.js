/*
    ***** BEGIN LICENSE BLOCK *****

    Copyright © 2009 Center for History and New Media
                     George Mason University, Fairfax, Virginia, USA
                     http://zotero.org

    This file is part of Zotero.

    Zotero is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    Zotero is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with Zotero.  If not, see <http://www.gnu.org/licenses/>.

    ***** END LICENSE BLOCK *****
*/

/**
 * @fileOverview Menu integration for ODF Scan plugin
 */

var Zotero_ODFScan = {
    id: null,
    version: null,
    rootURI: null,
    initialized: false,
    addedElementIDs: [],

    init({ id, version, rootURI }) {
        if (this.initialized) return;
        this.id = id;
        this.version = version;
        this.rootURI = rootURI;
        this.initialized = true;
        this.log("Menu integration initialized");
    },

    log(msg) {
        Zotero.debug("ODF Scan: " + msg);
    },

    addToAllWindows() {
        let windows = Zotero.getMainWindows();
        for (let win of windows) {
            this.addToWindow(win);
        }
    },

    addToWindow(window) {
        let doc = window.document;

        // Check if already added to this window
        if (doc.getElementById('menu_odfScan')) {
            this.log("Menu item already exists in this window");
            return;
        }

        // Find the RTF Scan menu item in the Tools menu
        let rtfMenuElem = doc.getElementById('menu_rtfScan');
        if (!rtfMenuElem) {
            this.log("RTF Scan menu item not found, can't add ODF Scan");
            return;
        }

        let menu = rtfMenuElem.parentNode;

        // Create ODF Scan menu item
        let odfMenuElem = doc.createXULElement('menuitem');
        odfMenuElem.setAttribute('id', 'menu_odfScan');
        odfMenuElem.setAttribute('label', 'ODF Scan');
        odfMenuElem.setAttribute('class', 'menuitem-non-iconic');
        odfMenuElem.addEventListener('command', () => {
            this.openDialog(window);
        });

        // Insert after RTF Scan
        menu.insertBefore(odfMenuElem, rtfMenuElem.nextSibling);

        // Track the added element ID (only once)
        if (!this.addedElementIDs.includes('menu_odfScan')) {
            this.addedElementIDs.push('menu_odfScan');
        }
        this.log("Menu item added successfully");
    },

    openDialog(parentWindow) {
        // Use chrome:// URL (registered in bootstrap.js)
        // Note: Files must be .xhtml in Zotero 7
        let dialogURL = 'chrome://odf-scan/content/odfScan.xhtml';
        this.log("Opening dialog: " + dialogURL);
        let dialog = parentWindow.openDialog(
            dialogURL,
            'odfScan',
            'chrome,centerscreen,resizable=yes'
        );
        return dialog;
    },

    removeFromWindow(window) {
        let doc = window.document;
        for (let id of this.addedElementIDs) {
            let elem = doc.getElementById(id);
            if (elem) elem.remove();
        }
    },

    removeFromAllWindows() {
        let windows = Zotero.getMainWindows();
        for (let win of windows) {
            this.removeFromWindow(win);
        }
    },

    async main() {
        this.log("ODF Scan plugin initialized");
    }
};
