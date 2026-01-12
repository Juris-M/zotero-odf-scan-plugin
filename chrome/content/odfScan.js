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
    },

    log(msg) {
        Zotero.debug("ODF Scan: " + msg);
    },

    addToWindow(window) {
        let doc = window.document;

        // Check if this is the main Zotero window
        if (doc.getElementById('zotero-itemmenu')) {
            this.addMenuItem(window);
        }
    },

    addToAllWindows() {
        let windows = Zotero.getMainWindows();
        for (let win of windows) {
            this.addToWindow(win);
        }
    },

    addMenuItem(window) {
        let doc = window.document;

        // Find the Tools menu popup
        let menu = doc.getElementById('menu_ToolsPopup');
        if (!menu) {
            this.log("Tools menu not found");
            return;
        }

        // Find the RTF Scan menu item to insert after it
        let rtfMenuElem = doc.getElementById("menu_rtfScan");
        if (!rtfMenuElem) {
            this.log("RTF Scan menu item not found");
            return;
        }

        // Create ODF Scan menu item
        let odfMenuElem = doc.createXULElement('menuitem');
        odfMenuElem.id = 'menu_odfScan';
        odfMenuElem.setAttribute("label", "ODF Scan");
        odfMenuElem.addEventListener('command', () => {
            this.openDialog(window);
        });

        // Insert after RTF Scan menu item
        menu.insertBefore(odfMenuElem, rtfMenuElem.nextSibling);

        // Track the added element
        this.addedElementIDs.push('menu_odfScan');
        this.log("Menu item added successfully");
    },

    openDialog(parentWindow) {
        let dialog = parentWindow.openDialog(
            'chrome://rtf-odf-scan-for-zotero/content/rtfScan.xul',
            'odfScan',
            'chrome,centerscreen,resizable=yes'
        );
        return dialog;
    },

    removeFromWindow(window) {
        let doc = window.document;

        // Remove all added elements
        for (let id of this.addedElementIDs) {
            let elem = doc.getElementById(id);
            if (elem) {
                elem.remove();
            }
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
