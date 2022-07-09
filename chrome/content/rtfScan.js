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
 * @fileOverview Tools for automatically retrieving a citation for the given PDF
 */

 try {
    // Zotero 6
    var FilePicker = require('zotero/modules/filePicker').default;
}
catch (e) {
    // Zotero 5
    var FilePicker = require('zotero/filePicker').default;
}


/**
 * Front end for recognizing PDFs
 * @namespace
 */
var Zotero_ODFScan = new function() {
    const ACCEPT_ICON =  "chrome://zotero/skin/rtfscan-accept.png";
    const LINK_ICON = "chrome://zotero/skin/rtfscan-link.png";
    const BIBLIOGRAPHY_PLACEHOLDER = "\\{Bibliography\\}";

    let inputFile = null, outputFile = null;
    let unmappedCitationsItem, ambiguousCitationsItem, mappedCitationsItem;
    let unmappedCitationsChildren, ambiguousCitationsChildren, mappedCitationsChildren;
    let citations, citationItemIDs, allCitedItemIDs, contents;

    // Load in the localization stringbundle for use by getString(name)
    let stringBundleService =
    Components.classes["@mozilla.org/intl/stringbundle;1"]
        .getService(Components.interfaces.nsIStringBundleService);
    let _localizedStringBundle = stringBundleService.createBundle(
        "chrome://rtf-odf-scan-for-zotero/locale/zotero.properties");


    function _getString(name, params){
        let l10n;
        try {
            if (params != undefined){
                if (typeof params != "object"){
                    params = [params];
                }
                l10n = _localizedStringBundle.formatStringFromName(name, params, params.length);
            }
            else {
                l10n = _localizedStringBundle.GetStringFromName(name);
            }
        }
        catch (e){
            throw ("Localized string not available for " + name);
        }
        return l10n;
    }


    /** INTRO PAGE UI **/

    /**
   * Called when the first page is shown; loads target file from preference, if one is set
   */
    this.introPageShowing = function() {
        let fileType = Zotero.Prefs.get("ODFScan.fileType");
        let outputMode = Zotero.Prefs.get("ODFScan.outputMode");
        let mode_string = [fileType];
        if (outputMode) {
            mode_string.push(outputMode);
        }
        mode_string = mode_string.join("-");
        let selectedNode = document.getElementById("file-type-selector-" + mode_string);
        let selector = document.getElementById("file-type-selector");
        selector.selectedItem = selectedNode;
        this.fileTypeSwitch(selectedNode.value);
        document.getElementById("choose-input-file").focus();
    };

    /**
   * Called when the first page is hidden
   */
    this.introPageAdvanced = function() {
    // get file type
        let fileType = Zotero.Prefs.get("ODFScan.fileType");
        let outputMode = Zotero.Prefs.get("ODFScan.outputMode");
        Zotero.Prefs.set("ODFScan."+fileType+".lastInputFile" + outputMode, inputFile.path);
        Zotero.Prefs.set("ODFScan."+fileType+".lastOutputFile" + outputMode, outputFile.path);
    };

    /**
   * Called to select the file to be processed
   */
    this.chooseInputFile = async function () {
    // Hide any error message
        document.getElementById("odf-file-error-message").setAttribute("hidden", "true");
        // get file type
        let fileType = Zotero.Prefs.get("ODFScan.fileType");
        // display file picker
        let fp = new FilePicker();
        fp.init(window, _getString("ODFScan.openTitle"), fp.modeOpen);

        let fileExt = fileType;
        if (fileType === "odf") {
            fileExt = "odt";
        } else {
            fp.appendFilters(fp.filterAll);
        }
        fp.appendFilter(_getString("ODFScan." + fileType), "*." + fileExt);

        // Set directory if possible
        let outputMode = Zotero.Prefs.get("ODFScan.outputMode");
        let inputPath = Zotero.Prefs.get("ODFScan."+fileType+".lastInputFile" + outputMode);
        if (inputPath) {
            if (!inputFile) {
                inputFile = Zotero.File.pathToFile(inputPath);
            }
            fp.displayDirectory = inputFile.parent;
        }

        let rv = await fp.show();
        if (rv == fp.returnOK || rv == fp.returnReplace) {
            inputFile = Zotero.File.pathToFile(fp.file);
            _updatePath();
        }
    };

    /**
   * Called to select the output file
   */
    this.chooseOutputFile = async function() {
        let fileType = Zotero.Prefs.get("ODFScan.fileType");
        let outputMode = Zotero.Prefs.get("ODFScan.outputMode");
        let fileExt = fileType;
        if (fileType === "odf") {
            fileExt = "odt";
        }
        let fp = new FilePicker();
        fp.init(window, _getString("ODFScan.saveTitle"), fp.modeSave);
        fp.appendFilter(_getString("ODFScan." + fileType), "*." + fileExt);
        if (inputFile) {
            let leafName = inputFile.leafName;
            let dotIndex = leafName.lastIndexOf(".");
            if (dotIndex != -1) {
                leafName = leafName.substr(0, dotIndex);
            }
            let suffix = (" " + _getString("ODFScan."+fileType+".scannedFileSuffix" + outputMode));
            if (fileType === "odf") {
                let suffixMatchers = [ " " + _getString("ODFScan.odf.scannedFileSuffixtomarkers"), " " + _getString("ODFScan.odf.scannedFileSuffixtocitations") ];
                for (let suffixMatcher of suffixMatchers) {
                    if (leafName.slice(-suffixMatcher.length, leafName.length) == suffixMatcher) {
                        leafName = leafName.slice(0, -suffixMatcher.length);
                    }
                }
            }
            fp.defaultString = leafName + suffix + "." + fileExt;
        } else {
            fp.defaultString = "Untitled." + fileExt;
        }

        // Set directory if possible
        outputMode = Zotero.Prefs.get("ODFScan.outputMode");
        let outputPath = Zotero.Prefs.get("ODFScan."+fileType+".lastOutputFile" + outputMode);
        if (outputPath) {
            if (!outputFile) {
                outputFile = Zotero.File.pathToFile(outputPath);
            }
            fp.displayDirectory = outputFile.parent;
        }

        let rv = await fp.show();
        if (rv == fp.returnOK || rv == fp.returnReplace) {
            outputFile = Zotero.File.pathToFile(fp.file);
            _updatePath();
        }
    };

    /**
   * Called to update the path label in the dialog box
   * @private
   */
    function _updatePath() {
        document.documentElement.canAdvance = inputFile && outputFile;
        if (inputFile && inputFile.path) {
            document.getElementById("input-path").value = inputFile.path;
            document.getElementById("choose-output-file").disabled = false;
        } else {
            document.getElementById("input-path").value = _getString("ODFScan.file.noneSelected.label");
            document.getElementById("choose-output-file").disabled = true;
        }
        if (outputFile) {
            document.getElementById("output-path").value = outputFile.path;
        } else {
            document.getElementById("output-path").value = _getString("ODFScan.file.noneSelected.label");
        }
    }

    /**
   * Called to refresh the path label in the dialog box when switching modes
   * @private
   */

    function _refreshPath() {
        let fileType = Zotero.Prefs.get("ODFScan.fileType");
        let outputMode = Zotero.Prefs.get("ODFScan.outputMode");
        let inputPath = Zotero.Prefs.get("ODFScan."+fileType+".lastInputFile" + outputMode);
        if (inputPath) {
            document.getElementById("input-path").value = inputPath;
            inputFile = Zotero.File.pathToFile(inputPath);
        } else {
            inputFile = null;
            document.getElementById("input-path").value = _getString("ODFScan.file.noneSelected.label");
        }
        outputFile = null;
        _updatePath();
    }

    /** SCAN PAGE UI **/

    /**
   * Called when second page is shown.
   */
    this.scanPageShowing = function() {
    // can't advance
        document.documentElement.canAdvance = false;

        let outputMode = Zotero.Prefs.get("ODFScan.outputMode");

        document.getElementById("odf-file-error-message").setAttribute("hidden", "true");

        // wait a ms so that UI thread gets updated
		window.setTimeout(function() { _scanODF(outputMode); }, 1);
    };

    /**
   * s = "Why do we do this entirely in SQL? Because we're crazy. Crazy like foxes."
   * s.replace(/in SQL/, "with regular expressions");
   */
    function _scanODF(outputMode) {
        let reverse_conversion = false;
        if (outputMode === "tomarkers") {
            reverse_conversion = true;
        }
        // when scanning is complete, go to citations page
        document.documentElement.canAdvance = false;

        let tmplCitation = "<text:reference-mark-start text:name=\"ZOTERO_ITEM {&quot;properties&quot;:{&quot;formattedCitation&quot;:&quot;%{1}s&quot;},&quot;citationItems&quot;:%{2}s} RND%{3}s\"/>%{4}s<text:reference-mark-end text:name=\"ZOTERO_ITEM {&quot;properties&quot;:{&quot;formattedCitation&quot;:&quot;%{5}s&quot;},&quot;citationItems&quot;:%{6}s} RND%{7}s\"/>";
        let tmplText = "{ %{1}s | %{2}s | %{3}s | %{4}s |%{5}s}";

        let rexPref = /<meta:user-defined meta:name="ZOTERO_PREF[^<]*?<\/meta:user-defined>/;
        let rexLabels = /^((?:art|ch|Ch|subch|col|fig|l|n|no|op|p|pp|para|subpara|pt|r|sec|subsec|Sec|sv|sch|tit|vrs|vol)\\.)\\s+(.*)/;
        let rexBalancedTags = /(.*)<([-:a-zA-Z0-9]*)[^\/>]*>([^<]*)<\/([-:a-zA-Z0-9]*)[^>]*>(.*)/;
        let rexLink = /(<[^>]*xlink:href=\"([^\"]*)\"[^>]*>)\s*{([^\|{}]*)\|([^\|}]*)\|([^\|}]*)\|([^\|}]*)}\s*(<[^>]*>)/;
        let rexLink2 = /(<[^>]*xlink:href=\"([^\"]*)\"[^>]*>)\s*(?:<[^\/>]+>)\s*{([^\|{}]*)\|([^\|}]*)\|([^\|}]*)\|([^\|}]*)}\s*(?:<\/[^\/>]+>)\s*(<[^>]*>)/;
        let rexNativeLink = /<text:reference-mark-start[^>]*ZOTERO_ITEM\s+(?:CSL_CITATION\s+)*([^>]*)\s+[^ ]*\/>(.*?)<text:reference-mark-end[^>]*\/>/;
        let checkStringRex = /(<[^\/>][^>]*>)*{[^<>\|]*|[^<>\|]*|[^<>\|]*|[^<>\|]*|[^<>\|]*}(<\/[^>]*>)*/;
        let openTagSplitter = /(<[^\/>][^>]*>)/;
        let closeTagSplitter = /(<\/[^>]*>)/;
        let rexSingleton = /<[^>]*\/>/g;
        let rexSpace = /<text:s\/>/g;
        let rexPlainTextLinks = /({[^\|{}]*\|[^\|}]*\|[^\|}]*\|[^\|}]*\|[^\|}]*})/;
        let rexWrappedLinks = /(<[^>]*xlink:href=\"[^\"]*\"[^>]*>\s*(?:<[^\/>]+>)?\s*{[^\|{}]*\|[^\|}]*\|[^\|}]*\|[^\|}]*}\s*(?:<\/[^\/>]+>)?\s*<[^>]*>)/;
        let rexNativeLinks = /(<text:reference-mark-start[^>]*ZOTERO_ITEM\s+(?:CSL_CITATION\s+)*[^>]*\/>.*?<text:reference-mark-end[^>]*\/>)/;
        let rexCite = /({[^<>\|]*\|[^<>\|]*\|[^<>\|]*\|[^<>\|]*\|[^<>\|]*})/;
        let rexCiteExtended = /(<\/?text:span[^>]*>{[^<>\|]*\|[^<>\|]*\|[^<>\|]*\|[^<>\|]*\|[^<>\|]*}<\/?text:span[^>]*>)/;
        let rexCiteExtendedParts = /(<text:span[^>]*>)({[^<>\|]*\|[^<>\|]*\|[^<>\|]*\|[^<>\|]*\|[^<>\|]*})(<\/text:span>)/;
        let rexCiteExtendedPartsReverse = /(<\/text:span>)({[^<>\|]*\|[^<>\|]*\|[^<>\|]*\|[^<>\|]*\|[^<>\|]*})(<text:span[^>]*>)/;

        let rexFixMarkupBold = /[\*][\*](.*?)[\*][\*]/;
        let rexFixMarkupItalic = /\*(.*?)\*/;

        let rexTextAll = /{\s*([^|{}]*)\|\s*([^|}]*)\s*\|\s*([^|}]*)\s*\|([^|}]*?)\s*\|\s*([^|}]*)\s*}/g;
        let rexText = /{\s*([^|{}]*)\|\s*([^|}]*)\s*\|\s*([^|}]*)\s*\|([^|}]*?)\s*\|\s*([^|}]*)\s*}/;
        let rexTextPlain = /{[^|{}]*\|[^|}]*\|[^|}]*\|[^|}]*\|[^|}]*}/;
        let rexEmptyBalanceSpan = /^<text:span[^>]*><\/text:span[^>]*>$/;

        let labels = {article: "art",
            chapter: "ch",
            Chapter: "Ch",
            subchapter: "subch",
            column: "col",
            figure: "fig",
            line: "l",
            note: "n",
            issue: "no",
            opus: "op",
            // page: "p",
            page: "pp",
            paragraph: "para",
            subparagraph: "subpara",
            part: "pt",
            rule: "r",
            section: "sec",
            subsection: "subsec",
            Section: "Sec",
            "sub-verbo": "sv",
            schedule: "sch",
            title: "tit",
            verse: "vrs",
            volume: "vol"
        };

        let Fragment = function(txt) {
            this.txt = txt;
            this.newtxt = txt;
        };

        Fragment.prototype.removeBalancedTags = function (str) {
            while (true) {
                let m = str.match(rexBalancedTags);
                if (m) {
                    if (m[2] === m[4]) {
                        str = str.replace(rexBalancedTags, "$1$3$5");
                    } else {
                        // If tags are mismatched the file is corrupt.
                        // Do not make the situation worse.
                        throw "Mismatched tags: "+m[2]+" "+m[4]+". Original document is corrupt. Aborting.";
                    }
                } else {
                    break;
                }
            }
            return str;
        };

        Fragment.prototype.normalizeStringMarks = function() {
            // Normalize intended rexText entries
            //  replace XML space with space
            this.newtxt = this.newtxt.replace(rexSpace, " ");
            // replace other singletons with empty string
            this.newtxt = this.newtxt.replace(rexSingleton, "");
            // remove balanced braces
            this.newtxt = this.removeBalancedTags(this.newtxt);
            // move open tags to the end
            let newlst = [];
            let lst = this.newtxt.split(openTagSplitter);
            for (let i=0,ilen=lst.length;i<ilen;i+=2) {
                newlst.push(lst[i]);
            }
            for (let i=1,ilen=lst.length;i<ilen;i+=2) {
                newlst.push(lst[i]);
            }
            this.newtxt = newlst.join("");
            // move close tags to the front
            newlst = [];
            lst = this.newtxt.split(closeTagSplitter);
            for (let i=1,ilen=lst.length;i<ilen;i+=2) {
                newlst.push(lst[i]);
            }
            for (let i=0,ilen=lst.length;i<ilen;i+=2) {
                newlst.push(lst[i]);
            }
            this.newtxt = newlst.join("");
        };

        Fragment.prototype.normalizeLinkedMarks = function () {
            this.newtxt = this.newtxt.replace(rexLink, "{$1$3|$4|$5|$6|$2$7}");
            this.newtxt = this.newtxt.replace(rexLink2, "{$1$3|$4|$5|$6|$2$7}");
        };

        Fragment.prototype.normalizeNativeMarks = function () {
            // Normalize all rexNative entries to rexText
            let m = this.newtxt.match(rexNativeLink);
            if (m) {
                let m_citation = m[1];
                let m_plaintext = this.removeBalancedTags(m[2]);
                let replacement = "";
                let obj_txt = m_citation.split("&quot;").join("\"");
                let obj = JSON.parse(obj_txt);
                let count = 1;
                for (let i=0,ilen=obj.citationItems.length;i<ilen;i+=1) {
                    let item = obj.citationItems[i];
                    if (i === 0 && item["suppress-author"]) {
                        m_plaintext = "-" + m_plaintext;
                    }
                    let isUser = false;
                    // Zotero 6+ has only item.uris
                    if ((item.uri && item.uri.length) || (item.uris && item.uris.length)) {
                        // if has uri, get value, identify as user or group, and fashion zotero://select ref
                        let uri = item.uri;
                        if (!uri) {
                            uri = item.uris
                        }
                        let key = [];
                        let m_uri = false;
                        if ("object" === typeof uri) {
                            for (let u of uri) {
                                if (u) {
                                    m_uri = u.match(/\/(users|groups)\/([0-9]+|local(?:\/[^/]+)?)\/items\/(.+)/);
                                    if (m_uri) {
                                        break;
                                    }
                                }
                            }
                        }
                        if (m_uri) {
                            if (m_uri[1] === "users") {
                                isUser = true;
                                // Here is where the information loss from using zotero://select shines through.
                                if (m_uri[2].includes("local") || Zotero.Prefs.get("translators.ODFScan.useZoteroSelect")) {
                                    key.push("0");
                                } else {
                                    key.push(m_uri[2]);
                                }
                            } else {
                                let libID;
                                if (Zotero.Prefs.get("translators.ODFScan.useZoteroSelect")) {
                                    libID = Zotero.Groups.getLibraryIDFromGroupID(m_uri[2]);
                                } else {
                                    libID = m_uri[2];
                                }
                                key.push(libID);
                            }
                            key.push(m_uri[3]);
                            if (Zotero.Prefs.get("translators.ODFScan.useZoteroSelect")) {
                                item.key = key.join("_");
                            } else {
                                item.key = key.join(":");
                            }
                        }
                    } else {
                        // if no uri, assume user library
                        // (shouldn't really be doing this on item, the semantics differ; but
                        // we throw the item object away, so no harm done)
                        // (In any case, we should not reach this.)
                        isUser = true;
                        if (Zotero.Prefs.get("translators.ODFScan.useZoteroSelect")) {
                            item.key = "0_" + item.key;
                        } else {
                            item.key = "0:" + item.key;
                        }
                    }
                    if (Zotero.Prefs.get("translators.ODFScan.useZoteroSelect")) {
                        item.key = "zotero://select/items/" + item.key;
                    } else if (isUser) {
                        item.key = "zu:" + item.key;
                    } else {
                        item.key = "zg:" + item.key;
                    }
                    for (let j=0,jlen=3;j<jlen;j+=1) {
                        const key = ["prefix","locator","suffix"][j];
                        if ("undefined" === typeof item[key]) {
                            item[key] = "";
                        }
                    }
                    // remapping of locator label is tricky.
                    if ("undefined" !== typeof item.label && item.locator) {
                        let mm = item.locator.match(rexLabels);
                        if (!mm) {
                            item.locator = labels[item["label"]] + ". " + item["locator"];
                        }
                    }
                    for (let j=0,jlen=3;j<jlen;j+=1) {
                        const key = ["prefix","suffix","locator"][j];
                        if ("string" === typeof item[key]) {
                            item[key] = item[key].split("&quot;").join("\"");
                            item[key] = item[key].replace(/&lt;i&gt;(.*?)&lt;\/i&gt;/g, "*$1*");
                            item[key] = item[key].replace(/&lt;b&gt;(.*?)&lt;\/b&gt;/g, "**$1**");
                        }
                    }
                    replacement += tmplText.replace("%{1}s", item.prefix)
                        .replace("%{2}s", m_plaintext)
                        .replace("%{3}s", item.locator)
                        .replace("%{4}s", item.suffix)
                        .replace("%{5}s", item.key);
                    count += 1;
                }
                this.newtxt = replacement;
            }
        };

        Fragment.prototype.finalize = function (msg) {
            let m = this.newtxt.match(checkStringRex);
            if (m) {
                this.txt = this.newtxt.split(/[\n\r]+/).join(" ");
                if (msg) {
                    dump("XXX [" + msg + "]: " + this.txt+"\n");
                }
            }
        };

        let ODFConv = function () {};

        ODFConv.prototype.convert = function () {
            this.rands = {};
            this.readZipfileContent();

            // Wipe out any font definitions in the style, they can mess things up pretty badly
            this.content = this.content.replace(/\s+fo:font-family="[^"]*"/g, "");

            // Matches wrapped text links
            let lst = this.content.split(rexWrappedLinks);
            for (let i=0,ilen=lst.length;i<ilen;i+=1) {
                lst[i] = new Fragment(lst[i]);
            }
            for (let i=lst.length-2;i>-1;i+=-2) {
                lst[i].normalizeLinkedMarks();
                lst[i].finalize();
            }
            this.rejoin(lst);

            // Matches plain text links
            lst = this.content.split(rexPlainTextLinks);
            for (let i=0,ilen=lst.length;i<ilen;i+=1) {
                lst[i] = new Fragment(lst[i]);
            }
            for (let i=lst.length-2;i>-1;i+=-2) {
                lst[i].normalizeStringMarks();
                lst[i].finalize();
            }
            this.rejoin(lst);

            // Matches native links
            lst = this.content.split(rexNativeLinks);
            for (let i=0,ilen=lst.length;i<ilen;i+=1) {
                lst[i] = new Fragment(lst[i]);
            }
            for (let i=lst.length-2;i>-1;i+=-2) {
                lst[i].normalizeNativeMarks();
                lst[i].finalize();
            }
            this.rejoin(lst);

            this.tidy();

            // Maybe convert to live cites
            if (!reverse_conversion) {
                this.composeCitations();
            }

            this.purgeStyles();
            this.purgeConfig();
            this.writeZipfileContent();
            return true;
        };

        ODFConv.prototype.rejoin = function (lst) {
            this.content = lst.map(function(obj){
                return obj.txt;
            }).join("");
        };

        ODFConv.prototype.tidy = function () {
            // Eliminate empty balance spans between cites
            let lst = this.content.split(rexCite);
            for (let i=2,ilen=lst.length;i<ilen;i+=2) {
                if (lst[i].match(rexEmptyBalanceSpan)) {
                    lst[i] = "";
                }
            }
            // Remove simple spans surrounding cites
            lst = this.content.split(rexCiteExtended);
            for (let i=1,ilen=lst.length;i<ilen;i+=2) {
                let m = lst[i].match(rexCiteExtendedParts);
                if (m) {
                    lst[i] = m[2];
                }
                m = lst[i].match(rexCiteExtendedPartsReverse);
                if (m) {
                    lst[i] = m[2];
                }
            }
            this.content = lst.join("");
        };

        ODFConv.prototype.composeCitations = function () {
            // Split file string to twin lists
            // and reverse iterate over cites (master recomposition loop)
            // compose items
            // compose citation
            // recompose document
            let ret = [];
            let items = [];
            // Some jiggery-pokery is needed to get a nested
            // list out of JavaScript regexp (as from Python re.findall)
            let m = [];
            let m_all = this.content.match(rexTextAll);
            for (let i=0,ilen=m_all.length;i<ilen;i+=1) {
                let subm = [];
                let m_one = m_all[i].match(rexText);
                for (let j=1,jlen=m_one.length;j<jlen;j+=1) {
                    subm.push(m_one[j]);
                }
                m.push(subm);
            }
            let lst = this.content.split(rexTextPlain);
            ret.push(lst.slice(-1)[0]);
            let placeholder = [];
            for (let i=m.length-1;i>-1;i+=-1) {
                let item = {};
                let plaintextcite = m[i][1].replace(/^\s+/,"").replace(/\s+$/,"").split("\"").join("");
                if (plaintextcite && plaintextcite[0] === "-") {
                    item["suppress-author"] = true;
                    plaintextcite = plaintextcite.slice(1);
                }
                placeholder.push(plaintextcite);
                let link = this.fixMarkup(m[i][4]).replace(/^\s+/,"").replace(/\s+$/,"");

                item.prefix = this.fixMarkup(m[i][0]).replace(/^\s+/,"");
                item.locator = this.fixMarkup(m[i][2]).replace(/^\s+/,"").replace(/\s+$/,"");
                item.suffix = this.fixMarkup(m[i][3]).replace(/\s+$/,"");
                // extract the key
                let params = {};
                if (link.slice(0,22) === "zotero://select/items/") {
                    params.offset = 22;
                    params.splitter = "_";
                    params.fromZoteroSelect = true;
                } else {
                    // Assuming two-char prefix, like zu: or zg:
                    // By flagging the app as well as the library type,
                    // we leave the door open on support for eclectic
                    // citation sources (mixing embedded metadata from
                    // Zotero, Papers, Mendeley, etc). Not practical
                    // yet, but one day ...
                    params.offset = 3;
                    params.splitter = ":";
                    params.fromZoteroSelect = false;
                    if (link.slice(1,2) === "u") {
                        params.isUserItem = true;
                    }
                }
                let myid = link.slice(params.offset);
                let myidlst = myid.split(params.splitter);
                if (myidlst.length === 2) {
                    // the real deal. construct uris
                    item.key = myidlst[1];
                    if (params.isUserItem) {
                        // If we ever want to go back to using the local UserID, this should work
                        // let userID = Zotero.Users.getCurrentUserID();
                        if (myidlst[0] == "0") {
                            userID = 'local/' + Zotero.Users.getLocalUserKey();
                        }
                        else {
                            userID = myidlst[0];
                        }                            
                        item.uri = ["http://zotero.org/users/" + userID + "/items/" + myidlst[1]];
                        item.uris = item.uri.slice();
                    } else {
                        let groupID = myidlst[0];
                        if (params.fromZoteroSelect) {
                            groupID = Zotero.Groups.getGroupIDFromLibraryID(myidlst[0]);
                        }
                        item.uri = ["http://zotero.org/groups/" + groupID + "/items/" + myidlst[1]];
                        item.uris = item.uri.slice();
                    }
                } else {
                    // punt
                    item.key = myidlst[0];
                }
                items = [item].concat(items);
                if (lst[i]) {
                    placeholder = placeholder.join("; ")
                        .split("\"").join("")
                        .split(/[\\]*&quot;/).join("");
                    let escapedPlaceholder = placeholder.split("&").join("&amp;");
                    items = JSON.stringify(items);
                    items = items.split("\\\\&quot;").join("\\&quot;");
                    items = items.split("\"").join("&quot;");
                    let randstr = this.generateRandomString();
                    let citation = tmplCitation.replace("%{1}s", escapedPlaceholder)
                        .replace("%{2}s",items)
                        .replace("%{3}s",randstr)
                        .replace("%{4}s",placeholder)
                        .replace("%{5}s",escapedPlaceholder)
                        .replace("%{6}s",items)
                        .replace("%{7}s",randstr);
                    //Zotero.debug(citation)
                    ret.push(citation);
                    ret.push(lst[i]);
                    items = [];
                    placeholder = [];
                }

            }
            ret.reverse();
            this.content = ret.join("");

        };

        ODFConv.prototype.fixMarkup = function (str) {
            str = str.replace(rexFixMarkupBold, "&lt;b&gt;$1&lt;/b&gt;");
            str = str.replace(rexFixMarkupItalic, "&lt;i&gt;$1&lt;/i&gt;");
            str = str.split("&quot;").join("\\&quot;");
            str = str.split("\"").join("\\&quot;");
            return str;
        };

        ODFConv.prototype.generateRandomString = function (str) {
            let randstr;
            while (true) {
                let nums = [49,50,51,52,53,54,55,56,57,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,97,98,99,100,101,102,103,104,105,106,107,108,109,110,111,112,113,114,115,116,117,118,119,120,121,122];
                randstr = "";
                for (let i=0,ilen=10;i<ilen;i+=1) {
                    randstr += String.fromCharCode(nums[parseInt(Math.random() * 61)]);
                }
                if (!this.rands[randstr]) {
                    this.rands[randstr] = true;
                    break;
                }
            }
            return randstr;
        };

        ODFConv.prototype.readZipfileContent = function () {
            // Scrub any meta string lying around
            this.meta = false;

            // grab a toolkit for file path manipulation
            Components.utils.import("resource://gre/modules/FileUtils.jsm");
            Components.utils.import("resource://gre/modules/NetUtil.jsm");

            // grab the content.xml and meta.xml out of the input file
            let zipReader = _getReader();
            this.content = _getEntryContent("content.xml");
            if (zipReader.hasEntry("meta.xml")) {
                this.meta = _getEntryContent("meta.xml");
            }
            zipReader.close();

            function _getEntryContent(fileName) {
                let inputStream = zipReader.getInputStream(fileName);
                return Zotero.File.getContents(inputStream);
            }

            function _getReader () {
                let zipReader = Components.classes["@mozilla.org/libjar/zip-reader;1"]
                    .createInstance(Components.interfaces.nsIZipReader);
                zipReader.open(inputFile);
                return zipReader;
            }

        };


        ODFConv.prototype.purgeConfig = function () {
            // Scrub configuration from meta.xml
            if (this.meta) {
                this.meta = this.meta.replace(rexPref, "");
            }
        };


        ODFConv.prototype.writeZipfileContent = function () {

            // Remove target file it already exists
            if (outputFile.exists()) {
                outputFile.remove(false);
            }

            // Copy input file to the new location
            inputFile.copyTo(outputFile.parent,outputFile.leafName);

            // get zip writer
            const zipWriter = _getWriter();

            // Remove context.xml and meta.xml
            zipWriter.removeEntry("content.xml", false);
            if (this.meta) {
                zipWriter.removeEntry("meta.xml", false);
            }

            // Add our own context.xml and meta.xml
            _addToZipFile("content.xml",this.content);
            if (this.meta) {
                _addToZipFile("meta.xml",this.meta);
            }
            zipWriter.close();

            function _getWriter() {
                let zipWriter = Components.classes["@mozilla.org/zipwriter;1"]
                    .createInstance(Components.interfaces.nsIZipWriter);
                // 0x02 = Read and Write
                zipWriter.open(outputFile, 0x04 );
                return zipWriter;
            }

            function _addToZipFile(fileName, data) {
                let converter = Components.classes["@mozilla.org/intl/scriptableunicodeconverter"].
                    createInstance(Components.interfaces.nsIScriptableUnicodeConverter);
                converter.charset = "UTF-8";
                let istream = converter.convertToInputStream(data);
                zipWriter.addEntryStream(fileName, 0, 9, istream, false);
            }

        };

        ODFConv.prototype.purgeStyles = function () {

            let decodeXML = Components.classes["@mozilla.org/xmlextras/domparser;1"]
                .createInstance(Components.interfaces.nsIDOMParser);
            let encodeXML = new XMLSerializer();

            let doc = decodeXML.parseFromString(this.content,"application/xml");
            let noteBodies = doc.getElementsByTagName("text:note-body");
            let stylesUsedInNotes = {};

            collectNoteStyles();
            fixStyleNodes();
            this.content = encodeXML.serializeToString(doc,"application/xml");

            function collectNoteStyles () {
                for (let i=0,ilen=noteBodies.length;i<ilen;i++) {
                    let node = noteBodies[i];
                    inspectNote(node);
                }
            }

            function inspectNote(node) {
                if (node.hasAttribute("text:style-name")) {
                    let styleName = node.getAttribute("text:style-name").toString();
                    if (styleName !== "Footnote") {
                        stylesUsedInNotes[styleName] = true;
                    }
                }
                for (let i=0,ilen=node.childNodes.length;i<ilen;i++) {
                    let child = node.childNodes[i];
                    if (!child.tagName) continue;
                    inspectNote(child);
                }
            }

            function fixStyleNodes() {
                let styleNodes = doc.getElementsByTagName("style:style");
                for (let i=0,ilen=styleNodes.length;i<ilen;i++) {
                    let styleNode = styleNodes[i];
                    let styleName = styleNode.getAttribute("style:name").toString();
                    if (stylesUsedInNotes[styleName]) {
                        fixStyleNode(styleNode);
                    }
                }
            }

            function fixStyleNode(node) {
                let textPropertyNodes = node.getElementsByTagName("style:text-properties");
                for (let i=0,ilen=textPropertyNodes.length;i<ilen;i++) {
                    let textPropertyNode = textPropertyNodes[i];
                    let unwantedAttributes = ["style:font-name","fo:font-size","style:font-size-asian"];
                    for (let j=0,jlen=unwantedAttributes.length;j<jlen;j++) {
                        let attributeName = unwantedAttributes[j];
                        if (textPropertyNode.hasAttribute(attributeName)) {
                            textPropertyNode.removeAttribute(attributeName);
                        }
                    }
                }
            }

        };

        let odfConv = new ODFConv();
        try {
            if (odfConv.convert()) {
                document.documentElement.canAdvance = true;
                document.documentElement.advance();
            }
        } catch (e) {
            // Just replace the content with an error message?
            Zotero.debug("ERROR (rtf-odf-scan-for-zotero): "+e);
            document.getElementById("odf-file-error-message").setAttribute("hidden", "false");
            document.documentElement.canRewind = true;
            document.documentElement.rewind();
            document.documentElement.canAdvance = false;
        }
    }

    function _generateItem(citationString, itemName, accept) {
        const treeitem = document.createElement("treeitem");
        const treerow = document.createElement("treerow");

        let treecell = document.createElement("treecell");
        treecell.setAttribute("label", citationString);
        treerow.appendChild(treecell);

        treecell = document.createElement("treecell");
        treecell.setAttribute("label", itemName);
        treerow.appendChild(treecell);

        treecell = document.createElement("treecell");
        treecell.setAttribute("src", accept ? ACCEPT_ICON : LINK_ICON);
        treerow.appendChild(treecell);

        treeitem.appendChild(treerow);
        return treeitem;
    }

    function _matchesItemCreators(creators, item, etAl) {
        let itemCreators = item.getCreators();
        let primaryCreators = [];
        let primaryCreatorTypeID = Zotero.CreatorTypes.getPrimaryIDForType(item.itemTypeID);

        // use only primary creators if primary creators exist
        for (let i=0; i<itemCreators.length; i++) {
            if (itemCreators[i].creatorTypeID == primaryCreatorTypeID) {
                primaryCreators.push(itemCreators[i]);
            }
        }
        // if primaryCreators matches the creator list length, or if et al is being used, use only
        // primary creators
        if (primaryCreators.length == creators.length || etAl) itemCreators = primaryCreators;

        // for us to have an exact match, either the citation creator list length has to match the
        // item creator list length, or et al has to be used
        if (itemCreators.length == creators.length || (etAl && itemCreators.length > creators.length)) {
            let matched = true;
            for (let i=0; i<creators.length; i++) {
                // check each item creator to see if it matches
                matched = matched && _matchesItemCreator(creators[i], itemCreators[i]);
                if (!matched) break;
            }
            return matched;
        }

        return false;
    }

    function _matchesItemCreator(creator, itemCreator) {
    // make sure last name matches
        let lowerLast = itemCreator.ref.lastName.toLowerCase();
        if (lowerLast != creator.substr(-lowerLast.length).toLowerCase()) return false;

        // make sure first name matches, if it exists
        if (creator.length > lowerLast.length) {
            let firstName = Zotero.Utilities.trim(creator.substr(0, creator.length-lowerLast.length));
            if (firstName.length) {
                // check to see whether the first name is all initials
                const initialRe = /^(?:[A-Z]\.? ?)+$/;
                let m = initialRe.exec(firstName);
                if (m) {
                    let initials = firstName.replace(/[^A-Z]/g, "");
                    let itemInitials = itemCreator.ref.firstName.split(/ +/g).map(function(name){
                        return name[0].toUpperCase();
                    }).join("");
                    if (initials != itemInitials) return false;
                } else {
                    // not all initials; verify that the first name matches
                    let firstWord = firstName.substr(0, itemCreator.ref.firstName).toLowerCase();
                    let itemFirstWord = itemCreator.ref.firstName.substr(0, itemCreator.ref.firstName.indexOf(" ")).toLowerCase();
                    if (firstWord != itemFirstWord) return false;
                }
            }
        }

        return true;
    }

    /** CITATIONS PAGE UI **/

    /**
   * Called when citations page is shown to determine whether user can immediately advance.
   */
    this.citationsPageShowing = function() {
        if (Zotero.Prefs.get("ODFScan.fileType") === "rtf") {
            _refreshCanAdvance();
        } else {
            // skip this step for ODF conversion
            document.documentElement.canAdvance = true;
            document.documentElement.advance();
        }
    };

    /**
   * Called when the citations page is rewound. Removes all citations from the list, clears
   * globals, and returns to intro page.
   */
    this.citationsPageRewound = function() {
    // skip back to intro page
        document.documentElement.currentPage = document.getElementById("intro-page");

        // remove children from tree
        while (unmappedCitationsChildren.hasChildNodes()) {
            unmappedCitationsChildren.removeChild(unmappedCitationsChildren.firstChild);
        }
        while (ambiguousCitationsChildren.hasChildNodes()) {
            ambiguousCitationsChildren.removeChild(ambiguousCitationsChildren.firstChild);
        }
        while (mappedCitationsChildren.hasChildNodes()) {
            mappedCitationsChildren.removeChild(mappedCitationsChildren.firstChild);
        }
        // hide headings
        unmappedCitationsItem.hidden = ambiguousCitationsItem.hidden = mappedCitationsItem.hidden = true;

        return false;
    };

    /**
   * Called when a tree item is clicked to remap a citation, or accept a suggestion for an
   * ambiguous citation
   */
    this.treeClick = function(event) {
        let tree = document.getElementById("tree");

        // get clicked cell
        let row = { }, col = { }, child = { };
        tree.treeBoxObject.getCellAt(event.clientX, event.clientY, row, col, child);

        // figure out which item this corresponds to
        row = row.value;
        let level = tree.view.getLevel(row);
        if (col.value.index == 2 && level > 0) {
            let iconColumn = col.value;
            let itemNameColumn = iconColumn.getPrevious();
            let citationColumn = itemNameColumn.getPrevious();

            if (level == 2) {    // ambiguous citation item
                // get relevant information
                let parentIndex = tree.view.getParentIndex(row);
                const citation = tree.view.getCellText(parentIndex, citationColumn);
                const itemName = tree.view.getCellText(row, itemNameColumn);

                // update item name on parent and delete children
                tree.view.setCellText(parentIndex, itemNameColumn, itemName);
                const treeitem = tree.view.getItemAtIndex(row);
                treeitem.parentNode.parentNode.removeChild(treeitem.parentNode);

                // update array
                citationItemIDs[citation] = [citationItemIDs[citation][row-parentIndex-1]];
            } else {        // mapped or unmapped citation, or ambiguous citation parent
                let citation = tree.view.getCellText(row, citationColumn);
                let io = {singleSelection:true};
                if (citationItemIDs[citation] && citationItemIDs[citation].length == 1) {  // mapped citation
                    // specify that item should be selected in window
                    io.select = citationItemIDs[citation];
                }

                window.openDialog("chrome://zotero/content/selectItemsDialog.xul", "", "chrome,modal", io);

                if (io.dataOut && io.dataOut.length) {
                    let selectedItemID = io.dataOut[0];
                    let selectedItem = Zotero.Items.get(selectedItemID);

                    const treeitem = tree.view.getItemAtIndex(row);

                    // remove any children (if ambiguous)
                    let children = treeitem.getElementsByTagName("treechildren");
                    if (children.length) treeitem.removeChild(children[0]);

                    // update item name
                    tree.view.setCellText(row, itemNameColumn, selectedItem.getField("title"));

                    // update array
                    citationItemIDs[citation] = [selectedItemID];
                }
            }
        }
        _refreshCanAdvance();
    };

    /**
   * Determines whether the button to advance the wizard should be enabled or not based on whether
   * unmapped citations exist, and sets the status appropriately
   */
    function _refreshCanAdvance() {
        let canAdvance = true;
        for (let i=0,ilen=citationItemIDs.length;i<ilen;i++) {
            let itemList = citationItemIDs[i];
            if (itemList.length != 1) {
                canAdvance = false;
                break;
            }
        }

        document.documentElement.canAdvance = canAdvance;
    }

    /** STYLE PAGE UI **/

    /**
   * Called when style page is shown to add styles to listbox.
   */
    this.stylePageShowing = function() {
        if (Zotero.Prefs.get("ODFScan.fileType") === "rtf") {
            Zotero_File_Interface_Bibliography.init();
        } else {
            // skip this step for ODF conversion
            document.documentElement.canAdvance = true;
            document.documentElement.advance();
        }
    };

    /**
   * Called when style page is hidden to save preferences.
   */
    this.stylePageAdvanced = function() {
        if (Zotero.Prefs.get("ODFScan.fileType") === "rtf") {
            Zotero.Prefs.set("export.lastStyle", document.getElementById("style-listbox").selectedItem.value);
        }
    };

    /**
   * Switches between file modes
   */
    this.fileTypeSwitch = function (mode) {
        if (!mode) {
            mode = "odf-tocitations";
        }
        mode = mode.split("-");
        let fileType = mode[0];
        let outputMode = mode[1];
        if (!outputMode) {
            // Keep things sane
            mode = "odf-tocitations";
            outputMode = "tocitations";
        }
        let nodeIdStubs = [
            "file-type-description",
            "choose-input-file",
            "choose-output-file"
        ];
        for (let i=0,ilen=nodeIdStubs.length;i<ilen;i+=1) {
            let elems = document.getElementsByClassName(nodeIdStubs[i]);
            for (let j=0,jlen=elems.length;j<jlen;j+=1) {
                let elem = elems[j];
                if (elem.id === (nodeIdStubs[i] + "-" + fileType)) {
                    elem.hidden = false;
                } else {
                    elem.hidden = true;
                }
            }
        }
        Zotero.Prefs.set("ODFScan.fileType", fileType);
        Zotero.Prefs.set("ODFScan.outputMode", outputMode);
        _refreshPath();
    };

    /** FORMAT PAGE UI **/

    this.formatPageShowing = function() {
        if (Zotero.Prefs.get("ODFScan.fileType") === "rtf") {
            // can't advance
            document.documentElement.canAdvance = false;

            // wait a ms so that UI thread gets updated
            window.setTimeout(function() { _formatRTF(); }, 1);
        } else {
            // skip this step for ODF conversion
            document.documentElement.canAdvance = true;
            document.documentElement.advance();
        }
    };

    function _formatRTF() {
    // load style and create ItemSet with all items
        let zStyle = Zotero.Styles.get(document.getElementById("style-listbox").selectedItem.value);
        let style = zStyle.getCiteProc();
        style.setOutputFormat("rtf");
        let isNote = style.class == "note";

        // create citations
        let k = 0;
        let cslCitations = [];
        let itemIDs = {};
        let shouldBeSubsequent = {};
        for (let i=0; i<citations.length; i++) {
            let citation = citations[i];
            let cslCitation = {"citationItems":[], "properties":{}};
            if (isNote) {
                cslCitation.properties.noteIndex = i;
            }

            // create citation items
            for (let j=0; j<citation.citationStrings.length; j++) {
                let citationItem = {};
                citationItem.id = citationItemIDs[citation.citationStrings[j]][0];
                itemIDs[citationItem.id] = true;
                citationItem.locator = citation.pages[j];
                citationItem.label = "page";
                citationItem["suppress-author"] = citation.suppressAuthor && !isNote;
                cslCitation.citationItems.push(citationItem);
            }

            cslCitations.push(cslCitation);
        }
        //Zotero.debug(cslCitations);

        itemIDs = itemIDs.map(function(obj){
            return obj;
        });
        //Zotero.debug(itemIDs);

        // prepare the list of rendered citations
        let citationResults = style.rebuildProcessorState(cslCitations, "rtf");

        // format citations
        let contentArray = [];
        let lastEnd = 0;
        for (let i=0; i<citations.length; i++) {
            const citation = citationResults[i][2];
            //Zotero.debug("Formatted "+citation);

            // if using notes, we might have to move the note after the punctuation
            if (isNote && citations[i].start != 0 && contents[citations[i].start-1] == " ") {
                contentArray.push(contents.substring(lastEnd, citations[i].start-1));
            } else {
                contentArray.push(contents.substring(lastEnd, citations[i].start));
            }

            lastEnd = citations[i].end;
            if (isNote && citations[i].end < contents.length && ".,!?".indexOf(contents[citations[i].end]) !== -1) {
                contentArray.push(contents[citations[i].end]);
                lastEnd++;
            }

            if (isNote) {
                if (document.getElementById("displayAs").selectedIndex) {  // endnotes
                    contentArray.push("{\\super\\chftn}\\ftnbj {\\footnote\\ftnalt {\\super\\chftn } "+citation+"}");
                } else {                          // footnotes
                    contentArray.push("{\\super\\chftn}\\ftnbj {\\footnote {\\super\\chftn } "+citation+"}");
                }
            } else {
                contentArray.push(citation);
            }
        }
        contentArray.push(contents.substring(lastEnd));
        contents = contentArray.join("");

        // add bibliography
        if (zStyle.hasBibliography) {
            let bibliography = Zotero.Cite.makeFormattedBibliography(style, "rtf");
            bibliography = bibliography.substring(5, bibliography.length-1);
            // fix line breaks
            let linebreak = "\r\n";
            if (contents.indexOf("\r\n") == -1) {
                bibliography = bibliography.split("\r\n").join("\n");
                linebreak = "\n";
            }

            if (contents.indexOf(BIBLIOGRAPHY_PLACEHOLDER) !== -1) {
                contents = contents.replace(BIBLIOGRAPHY_PLACEHOLDER, bibliography);
            } else {
                // add two newlines before bibliography
                bibliography = linebreak+"\\"+linebreak+"\\"+linebreak+bibliography;

                // add bibliography automatically inside last set of brackets closed
                const bracketRe = /^\{+/;
                let m = bracketRe.exec(contents);
                if (m) {
                    let closeBracketRe = new RegExp("(\\}{"+m[0].length+"}\\s*)$");
                    contents = contents.replace(closeBracketRe, bibliography+"$1");
                } else {
                    contents += bibliography;
                }
            }
        }

        Zotero.File.putContents(outputFile, contents);

        document.documentElement.canAdvance = true;
        document.documentElement.advance();
    }
};
