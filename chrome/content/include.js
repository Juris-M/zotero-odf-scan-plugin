var Zotero = Components.classes["@zotero.org/Zotero;1"]
				// Currently uses only nsISupports
				//.getService(Components.interfaces.chnmIZoteroService).
				.getService(Components.interfaces.nsISupports)
				.wrappedJSObject;

// Use the bibliography code from the application
if ("undefined" === typeof Zotero_File_Interface_Bibliography) {
    const loader = Components.classes["@mozilla.org/moz/jssubscript-loader;1"]
        .getService(Components.interfaces.mozIJSSubScriptLoader);
    loader.loadSubScript("chrome://zotero/content/bibliography.js");
}

