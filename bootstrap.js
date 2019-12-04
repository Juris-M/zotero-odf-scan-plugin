const {classes: Cc, interfaces: Ci, utils: Cu} = Components;
Cu.import("resource://gre/modules/Services.jsm");

const PREF_BRANCH = "extensions.zotero.";
const PREFS = {
    "ODFScan.rtf.lastInputFiletortf":"",
    "ODFScan.rtf.lastOutputFiletortf":"",
    "ODFScan.odf.lastInputFiletocitations":"",
    "ODFScan.odf.lastOutputFiletocitations":"",
    "ODFScan.odf.lastInputFiletomarkers":"",
    "ODFScan.odf.lastOutputFiletomarkers":"",
    "ODFScan.fileType":"rtf",
    "ODFScan.outputMode":"tortf",
    "translators.ODFScan.useZoteroSelect":false,
    "translators.ODFScan.includeTitle":false
};

const consoleService = Components.classes["@mozilla.org/consoleservice;1"].getService(Components.interfaces.nsIConsoleService);
function logMessage(msg) {
    consoleService.logStringMessage("ODF Scan: " + msg);
}

function setDefaultPrefs() {
    let branch = Services.prefs.getDefaultBranch(PREF_BRANCH);
    for (let [key, val] in Iterator(PREFS)) {
        switch (typeof val) {
        case "boolean":
            branch.setBoolPref(key, val);
            break;
        case "number":
            branch.setIntPref(key, val);
            break;
        case "string":
            branch.setCharPref(key, val);
            break;
        }
    }
}

/**
 * Apply a callback to each open and new browser windows.
 *
 * @usage watchWindows(callback): Apply a callback to each browser window.
 * @param [function] callback: 1-parameter function that gets a browser window.
 */
function watchWindows(callback) {
    // Travelling object used to store original attribute values
    // needed for uninstall
    let tabCallbackInfo = {};
    // Wrap the callback in a function that ignores failures
    function watcher(window) {
        try {
            // Now that the window has loaded, only handle browser windows
            let {documentElement} = window.document;
            if (documentElement.getAttribute("windowtype") == "navigator:browser"
        || documentElement.getAttribute("windowtype") === "zotero:basicViewer") {
                let menuElem = window.document.getElementById("menu_rtfScan");
                if (!menuElem) return;
                let cmdElem = window.document.getElementById("cmd_zotero_rtfScan");
                let windowUtils = window.QueryInterface(Components.interfaces.nsIInterfaceRequestor)
                    .getInterface(Components.interfaces.nsIDOMWindowUtils);
                let windowID = windowUtils.outerWindowID;
                tabCallbackInfo[windowID] = {
                    oldLabel:menuElem.getAttribute("label"),
                    oldRtfScanCommand:cmdElem.getAttribute("oncommand"),
                    children: {}
                };
                if (window.gBrowser && window.gBrowser.tabContainer) {

                    let tabContainer = window.gBrowser.tabContainer;

                    // Tab monitor callback wrapper. Sets aside enough information
                    // to shut down listeners on plugin uninstall or disable. Tabs in
                    // which Zotero/MLZ are not detected are sniffed at, then ignored
                    function tabSelect (event) {

                        // Capture a pointer to this tab window for use in the setTimeout,
                        // and make a note of the tab windowID (needed for uninstall)
                        let contentWindow = window.content;
                        let windowUtils = contentWindow.QueryInterface(Components.interfaces.nsIInterfaceRequestor)
                            .getInterface(Components.interfaces.nsIDOMWindowUtils);
                        let contentWindowID = windowUtils.outerWindowID;

                        // Only once for per tab in this browser window
                        if (tabCallbackInfo[windowID].children[contentWindowID]) return;

                        // Allow a little time for the window to start. If recognition
                        // fails on tab open, a later select will still pick it up
                        window.setTimeout(function(contentWindow,tabCallbackInfo,windowID,contentWindowID,callback) {
                            let menuElem = contentWindow.document.getElementById("menu_rtfScan");
                            if (!menuElem) return;
                            // Children are Zotero tab instances and only one can exist
                            for (let key in tabCallbackInfo[windowID].children) {
                                delete tabCallbackInfo[windowID].children[key];
                            }
                            tabCallbackInfo[windowID].children[contentWindowID] = true;
                            callback(contentWindow);
                        }, 1000, contentWindow,tabCallbackInfo,windowID,contentWindowID,callback);
                    }

                    // Modify tabs
                    // tabOpen event implies tabSelect, so this is enough
                    tabContainer.addEventListener("TabSelect", tabSelect, false);

                    // Function to remove listener on uninstall
                    tabCallbackInfo[windowID].removeListener = function () {
                        tabContainer.removeEventListener("TabSelect", tabSelect);
                    };
                }

                // Modify the chrome window itself
                callback(window);
            }
        }
        catch (ex) {
            dump("ERROR (rtf-odf-scan-for-zotero): in watcher(): "+ex);
        }
    }

    // Wait for the window to finish loading before running the callback
    function runOnLoad(window) {
    // Listen for one load event before checking the window type
    // ODF Scan: run until we find both the main window and a tab ...
        window.addEventListener("load", function runOnce() {
            window.removeEventListener("load", runOnce, false);
            watcher(window);
        }, false);
    }

    // Add functionality to existing windows
    let windows = Services.wm.getEnumerator(null);
    while (windows.hasMoreElements()) {
    // Only run the watcher immediately if the window is completely loaded
        let window = windows.getNext();
        if (window.document.readyState == "complete") {
            watcher(window);
        } else {
            // Wait for the window to load before continuing
            runOnLoad(window);
        }
    }

    // Watch for new browser windows opening then wait for it to load
    function windowWatcher(subject, topic) {
        if (topic == "domwindowopened")
            runOnLoad(subject);
    }
    Services.ww.registerNotification(windowWatcher);

    // Make sure to stop watching for windows if we're unloading
    unload(function() {

        Services.ww.unregisterNotification(windowWatcher);

        function restoreRtfScan (win,oldStuff) {
            let menuElem = win.document.getElementById("menu_rtfScan");
            if (!menuElem) return;
            let cmdElem = win.document.getElementById("cmd_zotero_rtfScan");
            menuElem.setAttribute("label",oldStuff.oldLabel);
            cmdElem.setAttribute("oncommand", oldStuff.oldRtfScanCommand);
        }

        try {
            let someWindow = Services.wm.getMostRecentWindow(null);
            let windowUtils = someWindow.QueryInterface(Components.interfaces.nsIInterfaceRequestor)
                .getInterface(Components.interfaces.nsIDOMWindowUtils);
            for (let windowID in tabCallbackInfo) {

                // Get our main window
                let win = windowUtils.getOuterWindowWithId(parseInt(windowID,10));
                if (!win) continue;

                // Remove listener
                tabCallbackInfo[windowID].removeListener();

                // Restore behaviour of RTF Scan in the chrome document pane
                restoreRtfScan(win, tabCallbackInfo[windowID]);

                // Tick through the affected child tabs of this browser window
                // restoring behaviour there too
                for (let contentWindowID in tabCallbackInfo[windowID].children) {

                    // Get content window
                    let contentWin = windowUtils.getOuterWindowWithId(parseInt(contentWindowID,10));
                    if (!contentWin) continue;

                    // Restore old behaviour
                    restoreRtfScan(contentWin, tabCallbackInfo[windowID]);
                }
            }
        } catch (e) {
            dump("ERROR (rtf-odf-scan-for-zotero): in unload(): "+e+"\n");
        }
        tabCallbackInfo = {};
    });
}


/**
 * Save callbacks to run when unloading. Optionally scope the callback to a
 * container, e.g., window. Provide a way to run all the callbacks.
 *
 * @usage unload(): Run all callbacks and release them.
 *
 * @usage unload(callback): Add a callback to run on unload.
 * @param [function] callback: 0-parameter function to call on unload.
 * @return [function]: A 0-parameter function that undoes adding the callback.
 *
 * @usage unload(callback, container) Add a scoped callback to run on unload.
 * @param [function] callback: 0-parameter function to call on unload.
 * @param [node] container: Remove the callback when this container unloads.
 * @return [function]: A 0-parameter function that undoes adding the callback.
 */
function unload(callback, container) {
    // Initialize the array of unloaders on the first usage
    let unloaders = unload.unloaders;
    if (unloaders == null)
        unloaders = unload.unloaders = [];

    // Calling with no arguments runs all the unloader callbacks
    if (callback == null) {
        unloaders.slice().forEach(function(unloader) { unloader(); });
        unloaders.length = 0;
        return;
    }

    // The callback is bound to the lifetime of the container if we have one
    if (container != null) {
    // Remove the unloader when the container unloads
        container.addEventListener("unload", removeUnloader, false);

        // Wrap the callback to additionally remove the unload listener
        let origCallback = callback;
        callback = function() {
            container.removeEventListener("unload", removeUnloader, false);
            let tabContainer = container.gBrowser.tabContainer;
            tabContainer.removeEventListener("TabSelect", container.tabSelect);
            origCallback();
        };
    }

    // Wrap the callback in a function that ignores failures
    function unloader() {
        try {
            callback();
        }
        catch (ex) {}
    }
    unloaders.push(unloader);

    // Provide a way to remove the unloader
    function removeUnloader() {
        let index = unloaders.indexOf(unloader);
        if (index != -1)
            unloaders.splice(index, 1);
    }
    return removeUnloader;
}

/**
 * Change the menu and slot in a new command
 */
function changeButtonText(window) {
    logMessage("changeButtonText");
    // Change text in Zotero RTF Scan button
    let menuElem = window.document.getElementById("menu_rtfScan");
    let cmdElem = window.document.getElementById("cmd_zotero_rtfScan");
    menuElem.setAttribute("label", "RTF/ODF Scan");
    cmdElem.setAttribute("oncommand","window.openDialog('chrome://rtf-odf-scan-for-zotero/content/rtfScan.xul', 'rtfScan', 'chrome,centerscreen')");
    // Restore of original behaviour is handled elsewhere
    unload(function() {}, window);
}

function installTranslator() {
    let Zotero = Cc["@zotero.org/Zotero;1"]
        .getService(Ci.nsISupports)
        .wrappedJSObject;

    logMessage("installing ODF scan translator");
    let data = Zotero.File.getContentsFromURL("resource://rtf-odf-scan-for-zotero/translators/Scannable%20Cite.js");
    data = data.match(/^([\s\S]+?}\n\n)([\s\S]+)/);
    data = {
        header: JSON.parse(data[1]),
        code: data[2],
    };

    logMessage("popping up window");
    let pw = new Zotero.ProgressWindow();
    pw.changeHeadline("ODF Scan: waiting for Zotero...");
    pw.addDescription("Waiting for Zotero translator framework to initialize...");
    pw.show();

    Zotero.Schema.schemaUpdatePromise.then(function() {
        logMessage("Zotero ready");
        pw.startCloseTimer(500);
        Zotero.Translators.save(data.header, data.code).then(function() {
            Zotero.Translators.reinit();
            logMessage("translator installed");
        });
    }).catch(function(err) {
        logMessage("translator install failed: " + err);
    });
}

/**
 * Handle the add-on being activated on install/enable
 */
function startup(data, reason) {
    logMessage("startup");
    // Shift all open and new browser windows
    setDefaultPrefs();
    watchWindows(changeButtonText);
}

/**
 * Handle the add-on being deactivated on uninstall/disable
 */
function shutdown(data, reason) {
    // Clean up with unloaders when we're deactivating
    if (reason != APP_SHUTDOWN) unload();
}

/**
 * Handle the add-on being installed
 */
function install(data, reason) {
    logMessage("install");
    watchWindows(installTranslator);
}

/**
 * Handle the add-on being uninstalled
 */
function uninstall(data, reason) {}
