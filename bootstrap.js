var PREF_BRANCH = "extensions.zotero.";
var PREFS = {
    "ODFScan.rtf.lastInputFiletortf": "",
    "ODFScan.rtf.lastOutputFiletortf": "",
    "ODFScan.odf.lastInputFiletocitations": "",
    "ODFScan.odf.lastOutputFiletocitations": "",
    "ODFScan.odf.lastInputFiletomarkers": "",
    "ODFScan.odf.lastOutputFiletomarkers": "",
    "ODFScan.fileType": "odf",
    "ODFScan.outputMode": "tocitations",
    "translators.ODFScan.useZoteroSelect": false,
    "translators.ODFScan.includeTitle": false
};

var ODFScan = null;

function log(msg) {
    Zotero.debug("ODF Scan: " + msg);
}

function setDefaultPrefs() {
    let branch = Services.prefs.getDefaultBranch(PREF_BRANCH);
    for (let key in PREFS) {
        let val = PREFS[key];
        switch (typeof val) {
            case "boolean":
                branch.setBoolPref(key, val);
                break;
            case "number":
                branch.setIntPref(key, val);
                break;
            case "string":
                try {
                    branch.setCharPref(key, val);
                } catch (e) {
                    branch.setStringPref(key, val);
                }
                break;
        }
    }
}

function installTranslator() {
    log("Installing ODF scan translator");
    try {
        // Use resource:// URL which is properly registered in chrome.manifest
        let translatorPath = "resource://rtf-odf-scan-for-zotero/translators/Scannable%20Cite.js";
        let data = Zotero.File.getContentsFromURL(translatorPath);
        data = data.match(/^([\s\S]+?}\n\n)([\s\S]+)/);
        if (!data) {
            log("Failed to parse translator file");
            return;
        }

        data = {
            header: JSON.parse(data[1]),
            code: data[2],
        };

        log("Preparing translator installation");
        let pw = new Zotero.ProgressWindow();
        pw.changeHeadline("ODF Scan: waiting for Zotero...");
        pw.addDescription("Waiting for Zotero translator framework to initialize...");
        pw.show();

        Zotero.Schema.schemaUpdatePromise.then(function() {
            log("Zotero ready");
            pw.startCloseTimer(500);
            Zotero.Translators.save(data.header, data.code).then(function() {
                Zotero.Translators.reinit();
                log("Translator installed");
            });
        }).catch(function(err) {
            log("Translator install failed: " + err);
        });
    } catch (e) {
        log("Error installing translator: " + e);
    }
}

async function install() {
    log("Install hook called");
    await Zotero.Schema.schemaUpdatePromise;
    installTranslator();
}

async function startup({ id, version, rootURI }) {
    log("Starting ODF Scan plugin version " + version);

    setDefaultPrefs();

    // Load main plugin code
    Services.scriptloader.loadSubScript(rootURI + "chrome/content/odfScan.js");

    // Initialize plugin object
    if (typeof Zotero_ODFScan !== 'undefined') {
        ODFScan = Zotero_ODFScan;
        ODFScan.init({ id, version, rootURI });
        ODFScan.addToAllWindows();
        await ODFScan.main();
    }
}

function onMainWindowLoad({ window }) {
    if (ODFScan) {
        ODFScan.addToWindow(window);
    }
}

function onMainWindowUnload({ window }) {
    if (ODFScan) {
        ODFScan.removeFromWindow(window);
    }
}

function shutdown() {
    log("Shutting down ODF Scan plugin");
    if (ODFScan) {
        ODFScan.removeFromAllWindows();
        ODFScan = null;
    }
}

function uninstall() {
    log("Uninstall hook called");
}
