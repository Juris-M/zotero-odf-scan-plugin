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
 
 
/**
 * Front end for recognizing PDFs
 * @namespace
 */
var Zotero_RTFScan = new function() {
	const ACCEPT_ICON =  "chrome://zotero/skin/rtfscan-accept.png";
	const LINK_ICON = "chrome://zotero/skin/rtfscan-link.png";
	const BIBLIOGRAPHY_PLACEHOLDER = "\\{Bibliography\\}";
	
	var inputFile = null, outputFile = null;
	var unmappedCitationsItem, ambiguousCitationsItem, mappedCitationsItem;
	var unmappedCitationsChildren, ambiguousCitationsChildren, mappedCitationsChildren;
	var citations, citationItemIDs, allCitedItemIDs, contents;

	// Load in the localization stringbundle for use by getString(name)
	var stringBundleService =
		Components.classes["@mozilla.org/intl/stringbundle;1"]
		.getService(Components.interfaces.nsIStringBundleService);
	var localeService = Components.classes['@mozilla.org/intl/nslocaleservice;1'].
		getService(Components.interfaces.nsILocaleService);
	var appLocale = localeService.getApplicationLocale();
	
	var _localizedStringBundle = stringBundleService.createBundle(
		"chrome://rtf-odf-scan-for-zotero/locale/zotero.properties", appLocale);
		

	function _getString(name, params){
		try {
			if (params != undefined){
				if (typeof params != 'object'){
					params = [params];
				}
				var l10n = _localizedStringBundle.formatStringFromName(name, params, params.length);
			}
			else {
				var l10n = _localizedStringBundle.GetStringFromName(name);
			}
		}
		catch (e){
			throw ('Localized string not available for ' + name);
		}
		return l10n;
	}
	
	
	/** INTRO PAGE UI **/
	
	/**
	 * Called when the first page is shown; loads target file from preference, if one is set
	 */
	this.introPageShowing = function() {
		var fileType = Zotero.Prefs.get("ODFScan.fileType");
		var outputMode = Zotero.Prefs.get("ODFScan.outputMode");
		var mode_string = [fileType];
		if (outputMode) {
			mode_string.push(outputMode);
		}
		var mode_string = mode_string.join("-");
		var selectedNode = document.getElementById("file-type-selector-" + mode_string);
		var selector = document.getElementById("file-type-selector");
		selector.selectedItem = selectedNode;
		this.fileTypeSwitch(selectedNode.value);
		document.getElementById("choose-input-file").focus();
	}
	
	/**
	 * Called when the first page is hidden
	 */
	this.introPageAdvanced = function() {
		// get file type
		var fileType = Zotero.Prefs.get("ODFScan.fileType");
		var outputMode = Zotero.Prefs.get("ODFScan.outputMode");
		Zotero.Prefs.set("ODFScan."+fileType+".lastInputFile" + outputMode, inputFile.path);
		Zotero.Prefs.set("ODFScan."+fileType+".lastOutputFile" + outputMode, outputFile.path);
	}
	
	/**
	 * Called to select the file to be processed
	 */
	this.chooseInputFile = function() {
		// Hide any error message
		document.getElementById("odf-file-error-message").setAttribute("hidden", "true");
		// get file type
		var fileType = Zotero.Prefs.get("ODFScan.fileType");
		// display file picker
		const nsIFilePicker = Components.interfaces.nsIFilePicker;
		var fp = Components.classes["@mozilla.org/filepicker;1"]
				.createInstance(nsIFilePicker);
		fp.init(window, _getString("ODFScan.openTitle"), nsIFilePicker.modeOpen);
		
		var fileExt = fileType;
		if (fileType === 'odf') {
			fileExt = 'odt';
		} else {
			fp.appendFilters(nsIFilePicker.filterAll);
		}
		fp.appendFilter(_getString("ODFScan." + fileType), "*." + fileExt);
		
		// Set directory if possible
		var outputMode = Zotero.Prefs.get("ODFScan.outputMode");
		var inputPath = Zotero.Prefs.get("ODFScan."+fileType+".lastInputFile" + outputMode);
		if (inputPath) {
			if (!inputFile) {
				inputFile = Components.classes["@mozilla.org/file/local;1"].createInstance(Components.interfaces.nsILocalFile);
				inputFile.initWithPath(inputPath);
			}
			fp.displayDirectory = inputFile.parent;
		}

		var rv = fp.show();
		if (rv == nsIFilePicker.returnOK || rv == nsIFilePicker.returnReplace) {
			inputFile = fp.file;
			_updatePath();
		}
	}
	
	/**
	 * Called to select the output file
	 */
	this.chooseOutputFile = function() {
		var fileType = Zotero.Prefs.get("ODFScan.fileType");
		var outputMode = Zotero.Prefs.get("ODFScan.outputMode");
		var fileExt = fileType;
		if (fileType === "odf") {
			fileExt = "odt";
		}
		const nsIFilePicker = Components.interfaces.nsIFilePicker;
		var fp = Components.classes["@mozilla.org/filepicker;1"]
				.createInstance(nsIFilePicker);
		fp.init(window, _getString("ODFScan.saveTitle"), nsIFilePicker.modeSave);
		fp.appendFilter(_getString("ODFScan." + fileType), "*." + fileExt);
		if(inputFile) {
			var leafName = inputFile.leafName;
			var dotIndex = leafName.lastIndexOf(".");
			if(dotIndex != -1) {
				leafName = leafName.substr(0, dotIndex);
			}
			var suffix = _getString("ODFScan."+fileType+".scannedFileSuffix" + outputMode);
			fp.defaultString = leafName+" "+ suffix +"."+fileExt;
		} else {
			fp.defaultString = "Untitled." + fileExt;
		}
		
		// Set directory if possible
		var outputMode = Zotero.Prefs.get("ODFScan.outputMode");
		var outputPath = Zotero.Prefs.get("ODFScan."+fileType+".lastOutputFile" + outputMode);
		if (outputPath) {
			if (!outputFile) {
				outputFile = Components.classes["@mozilla.org/file/local;1"].createInstance(Components.interfaces.nsILocalFile);
				outputFile.initWithPath(outputPath);
			}
			fp.displayDirectory = outputFile.parent;
		}

		var rv = fp.show();
		if (rv == nsIFilePicker.returnOK || rv == nsIFilePicker.returnReplace) {				
			outputFile = fp.file;
			_updatePath();
		}
	}
	
	/**
	 * Called to update the path label in the dialog box
	 * @private
	 */
	function _updatePath() {
		document.documentElement.canAdvance = inputFile && outputFile;
		if(inputFile && inputFile.path) {
			document.getElementById("input-path").value = inputFile.path;
			document.getElementById("choose-output-file").disabled = false;
		} else {
			document.getElementById("input-path").value = _getString("ODFScan.file.noneSelected.label");
			document.getElementById("choose-output-file").disabled = true;
		}
		if(outputFile) {
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
		if (!inputFile) {
			inputFile = Components.classes["@mozilla.org/file/local;1"].createInstance(Components.interfaces.nsILocalFile);
		}
		if (!outputFile) {
			outputFile = Components.classes["@mozilla.org/file/local;1"].createInstance(Components.interfaces.nsILocalFile);
		}
		var fileType = Zotero.Prefs.get("ODFScan.fileType");
		var outputMode = Zotero.Prefs.get("ODFScan.outputMode");
		var inputPath = Zotero.Prefs.get("ODFScan."+fileType+".lastInputFile" + outputMode);
		if(inputPath) {
			document.getElementById("input-path").value = inputPath;
			inputFile.initWithPath(inputPath);
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

		var outputMode = Zotero.Prefs.get("ODFScan.outputMode");

		document.getElementById("odf-file-error-message").setAttribute("hidden", "true");

		// wait a ms so that UI thread gets updated
		if (Zotero.Prefs.get('ODFScan.fileType') === 'rtf') {
			window.setTimeout(function() { _scanRTF() }, 1);
		} else {
			window.setTimeout(function() { _scanODF(outputMode) }, 1);
		}
	}

	/**
	 * s = "Why do we do this entirely in SQL? Because we're crazy. Crazy like foxes."
	 * s.replace(/in SQL/, "with regular expressions");
	 */
	function _scanODF(outputMode) {
		var reverse_conversion = false;
		if (outputMode === "tomarkers") {
			reverse_conversion = true;
		}
		// when scanning is complete, go to citations page
		document.documentElement.canAdvance = false;

		var tmplCitation = "<text:reference-mark-start text:name=\"ZOTERO_ITEM {&quot;properties&quot;:{&quot;formattedCitation&quot;:&quot;%{1}s&quot;},&quot;citationItems&quot;:%{2}s} RND%{3}s\"/>%{4}s<text:reference-mark-end text:name=\"ZOTERO_ITEM {&quot;properties&quot;:{&quot;formattedCitation&quot;:&quot;%{5}s&quot;},&quot;citationItems&quot;:%{6}s} RND%{7}s\"/>"
		var tmplText = "{ %{1}s | %{2}s | %{3}s | %{4}s |%{5}s}";

		var rexPref = /<meta:user-defined meta:name="ZOTERO_PREF[^<]*?<\/meta:user-defined>/;
		var rexLabels = /^((?:art|ch|Ch|subch|col|fig|l|n|no|op|p|pp|para|subpara|pt|r|sec|subsec|Sec|sv|sch|tit|vrs|vol)\\.)\\s+(.*)/;
		var rexBalancedTags = /(.*)<([^\/>][-:a-zA-Z0-9]*)[^>]*>([^>]*)<\/([-:a-zA-Z0-9]*)[^>]*>(.*)/;
		var rexLink = /(<[^>]*xlink:href=\"([^\"]*)\"[^>]*>)\s*{([^\|{}]*)\|([^\|}]*)\|([^\|}]*)\|([^\|}]*)}\s*(<[^>]*>)/;
		var rexLink2 = /(<[^>]*xlink:href=\"([^\"]*)\"[^>]*>)\s*(?:<[^\/>]+>)\s*{([^\|{}]*)\|([^\|}]*)\|([^\|}]*)\|([^\|}]*)}\s*(?:<\/[^\/>]+>)\s*(<[^>]*>)/;
		var rexNativeLink = /<text:reference-mark-start[^>]*ZOTERO_ITEM\s+(?:CSL_CITATION\s+)*([^>]*)\s+[^ ]*\/>(.*?)<text:reference-mark-end[^>]*\/>/;
		var checkStringRex = /(<[^\/>][^>]*>)*{[^<>\|]*|[^<>\|]*|[^<>\|]*|[^<>\|]*|[^<>\|]*}(<\/[^>]*>)*/;
		var openTagSplitter = /(<[^\/>][^>]*>)/;
		var closeTagSplitter = /(<\/[^>]*>)/;
		var rexSingleton = /<[^>]*\/>/g;
		var rexSpace = /<text:s\/>/g;
		var rexPlainTextLinks = /({[^\|{}]*\|[^\|}]*\|[^\|}]*\|[^\|}]*\|[^\|}]*})/;
		var rexWrappedLinks = /(<[^>]*xlink:href=\"[^\"]*\"[^>]*>\s*(?:<[^\/>]+>)?\s*{[^\|{}]*\|[^\|}]*\|[^\|}]*\|[^\|}]*}\s*(?:<\/[^\/>]+>)?\s*<[^>]*>)/;
		var rexNativeLinks = /(<text:reference-mark-start[^>]*ZOTERO_ITEM\s+(?:CSL_CITATION\s+)*[^>]*\/>.*?<text:reference-mark-end[^>]*\/>)/;
		var rexCite = /({[^<>\|]*\|[^<>\|]*\|[^<>\|]*\|[^<>\|]*\|[^<>\|]*})/;
		var rexCiteExtended = /(<\/?text:span[^>]*>{[^<>\|]*\|[^<>\|]*\|[^<>\|]*\|[^<>\|]*\|[^<>\|]*}<\/?text:span[^>]*>)/;
		var rexCiteExtendedParts = /(<text:span[^>]*>)({[^<>\|]*\|[^<>\|]*\|[^<>\|]*\|[^<>\|]*\|[^<>\|]*})(<\/text:span>)/;
		var rexCiteExtendedPartsReverse = /(<\/text:span>)({[^<>\|]*\|[^<>\|]*\|[^<>\|]*\|[^<>\|]*\|[^<>\|]*})(<text:span[^>]*>)/;

		var rexFixMarkupBold = /[\*][\*](.*?)[\*][\*]/;
		var rexFixMarkupItalic = /\*(.*?)\*/;

		var rexTextAll = /{\s*([^|{}]*)\|\s*([^|}]*)\s*\|\s*([^|}]*)\s*\|([^|}]*?)\s*\|\s*([^|}]*)\s*}/g;
		var rexText = /{\s*([^|{}]*)\|\s*([^|}]*)\s*\|\s*([^|}]*)\s*\|([^|}]*?)\s*\|\s*([^|}]*)\s*}/;
		var rexTextPlain = /{[^|{}]*\|[^|}]*\|[^|}]*\|[^|}]*\|[^|}]*}/;
		var rexEmptyBalanceSpan = /^<text:span[^>]*><\/text:span[^>]*>$/;

		var labels = {article: "art",
					  chapter: "ch",
					  Chapter: "Ch",
					  subchapter: "subch",
					  column: "col",
					  figure: "fig",
					  line: "l",
					  note: "n",
					  issue: "no",
					  opus: "op",
					  page: "p",
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
					 }

		var Fragment = function(txt) {
			this.txt = txt;
			this.newtxt = txt;
		}

		Fragment.prototype.removeBalancedTags = function (str) {
			while (true) {
				var m = str.match(rexBalancedTags);
				if (m) {
					if (m[2] === m[4]) {
						str = str.replace(rexBalancedTags, "$1$3$5");
					} else {
						// If tags are mismatched the file is corrupt.
						// Do not make the situation worse.
						throw "Mismatched tags: "+m[2]+" "+m[4]+". Original document is corrupt. Aborting."
					}
				} else {
					break;
				}
			}
			return str;
		}

		Fragment.prototype.normalizeStringMarks = function() {
			// Normalize intended rexText entries
			//  replace XML space with space
			this.newtxt = this.newtxt.replace(rexSpace, " ");
			// replace other singletons with empty string
			this.newtxt = this.newtxt.replace(rexSingleton, "");
			// remove balanced braces
			this.newtxt = this.removeBalancedTags(this.newtxt);
			// move open tags to the end
			var newlst = [];
			var lst = this.newtxt.split(openTagSplitter);
			for (var i=0,ilen=lst.length;i<ilen;i+=2) {
				newlst.push(lst[i]);
			}
			for (var i=1,ilen=lst.length;i<ilen;i+=2) {
				newlst.push(lst[i]);
			}
			this.newtxt = newlst.join("");
			// move close tags to the front
			var newlst = []
			var lst = this.newtxt.split(closeTagSplitter);
			for (var i=1,ilen=lst.length;i<ilen;i+=2) {
				newlst.push(lst[i]);
			}
			for (var i=0,ilen=lst.length;i<ilen;i+=2) {
				newlst.push(lst[i]);
			}
			this.newtxt = newlst.join("");
		}

		Fragment.prototype.normalizeLinkedMarks = function () {
			this.newtxt = this.newtxt.replace(rexLink, "{$1$3|$4|$5|$6|$2$7}");
			this.newtxt = this.newtxt.replace(rexLink2, "{$1$3|$4|$5|$6|$2$7}");
		}

		Fragment.prototype.normalizeNativeMarks = function () {
			// Normalize all rexNative entries to rexText
			var m = this.newtxt.match(rexNativeLink);
			if (m) {
				var m_citation = m[1];
				var m_plaintext = this.removeBalancedTags(m[2]);
				var replacement = "";
				var obj_txt = m_citation.replace("&quot;", '"', "g");
				var obj = JSON.parse(obj_txt);
				var count = 1;
				for (var i=0,ilen=obj.citationItems.length;i<ilen;i+=1) {
					var item = obj.citationItems[i];
					if (i === 0 && item["suppress-author"]) {
						m_plaintext = "-" + m_plaintext;
					}
					var isUser = false;
					if (item.uri && item.uri.length) {
						// if has uri, get value, identify as user or group, and fashion zotero://select ref
						var uri = item.uri
						var key = [];
						if ("object" === typeof item.uri) {
							uri = uri[0];
						}
						var m_uri = uri.match(/\/(users|groups)\/([0-9]*|local)\/items\/(.+)/);
						if (m_uri) {
							if (m_uri[1] === "users") {
								isUser = true;
								// Here is where the information loss from using zotero://select shines through.
								if (m_uri[2] === "local" || Zotero.Prefs.get("translators.ODFScan.useZoteroSelect")) {
									key.push("0");
								} else {
									key.push(m_uri[2]);
								}
							} else {
								var libID;
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
						var isUser = true;
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
					for (var j=0,jlen=3;j<jlen;j+=1) {
						var key = ["prefix","locator","suffix"][j];
						if ("undefined" === typeof item[key]) {
							item[key] = "";
						}
					}
					// remapping of locator label is tricky.
					if ("undefined" !== typeof item.label && item.locator) {
						var mm = item.locator.match(rexLabels);
						if (!mm) {
							item.locator = labels[item["label"]] + ". " + item["locator"];
						}
					}
					for (var j=0,jlen=3;j<jlen;j+=1) {
					var key = ["prefix","suffix","locator"][j];
						if ("string" === typeof item[key]) {
							item[key] = item[key].replace("&quot;",'"', "g");
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
		}

		Fragment.prototype.finalize = function (msg) {
			var m = this.newtxt.match(checkStringRex);
			if (m) {
				this.txt = this.newtxt.replace("\n"," ","g");
				if (msg) {
					dump("XXX [" + msg + "]: " + this.txt+"\n");
				}
			}
		}

		var ODFConv = function () {}

		ODFConv.prototype.convert = function () {
			this.rands = {};
			this.readZipfileContent();

			// Wipe out any font definitions in the style, they can mess things up pretty badly
			this.content = this.content.replace(/\s+fo:font-family="[^"]*"/g, "");
            
			// Matches wrapped text links
			var lst = this.content.split(rexWrappedLinks);
			for (var i=0,ilen=lst.length;i<ilen;i+=1) {
				lst[i] = new Fragment(lst[i]);
			}
			for (var i=lst.length-2;i>-1;i+=-2) {
				lst[i].normalizeLinkedMarks();
				lst[i].finalize()
			}
			this.rejoin(lst);

			// Matches plain text links
			var lst = this.content.split(rexPlainTextLinks);
			for (var i=0,ilen=lst.length;i<ilen;i+=1) {
				lst[i] = new Fragment(lst[i]);
			}
			for (var i=lst.length-2;i>-1;i+=-2) {
				lst[i].normalizeStringMarks();
				lst[i].finalize();
			}
			this.rejoin(lst);

			// Matches native links
			var lst = this.content.split(rexNativeLinks);
			for (var i=0,ilen=lst.length;i<ilen;i+=1) {
				lst[i] = new Fragment(lst[i]);
			}
			for (var i=lst.length-2;i>-1;i+=-2) {
				lst[i].normalizeNativeMarks();
				lst[i].finalize()
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
		}

		ODFConv.prototype.rejoin = function (lst) {
			this.content = [lst[i].txt for (i in lst)].join("");
		}

		ODFConv.prototype.tidy = function () {
			// Eliminate empty balance spans between cites
			var lst = this.content.split(rexCite);
			for (var i=2,ilen=lst.length;i<ilen;i+=2) {
				if (lst[i].match(rexEmptyBalanceSpan)) {
					lst[i] = "";
				}
			}
			// Remove simple spans surrounding cites
			var lst = this.content.split(rexCiteExtended);
			for (var i=1,ilen=lst.length;i<ilen;i+=2) {
				var m = lst[i].match(rexCiteExtendedParts);
				if (m) {
					lst[i] = m[2];
				}
				m = lst[i].match(rexCiteExtendedPartsReverse);
				if (m) {
					lst[i] = m[2];
				}
			}
			this.content = lst.join("");
		}

		ODFConv.prototype.composeCitations = function () {
			// Split file string to twin lists
			// and reverse iterate over cites (master recomposition loop)
			// compose items
			// compose citation
			// recompose document
			var ret = [];
			var items = [];
			// Some jiggery-pokery is needed to get a nested
			// list out of JavaScript regexp (as from Python re.findall)
			var m = [];
			var m_all = this.content.match(rexTextAll);
			for (var i=0,ilen=m_all.length;i<ilen;i+=1) {
				var subm = [];
				var m_one = m_all[i].match(rexText);
				for (var j=1,jlen=m_one.length;j<jlen;j+=1) {
					subm.push(m_one[j]);
				}
				m.push(subm);
			}
			var lst = this.content.split(rexTextPlain);
			ret.push(lst.slice(-1)[0]);
			var placeholder = [];
			for (var i=m.length-1;i>-1;i+=-1) {
				var item = {};
				var plaintextcite = m[i][1].replace(/^\s+/,"").replace(/\s+$/,"");
				if (plaintextcite && plaintextcite[0] === "-") {
					item["suppress-author"] = true;
					plaintextcite = plaintextcite.slice(1);
				}
				placeholder.push(plaintextcite);
				var link = this.fixMarkup(m[i][4]).replace(/^\s+/,"").replace(/\s+$/,"");
				
				item.prefix = this.fixMarkup(m[i][0]).replace(/^\s+/,"");
				item.locator = this.fixMarkup(m[i][2]).replace(/^\s+/,"").replace(/\s+$/,"");
				item.suffix = this.fixMarkup(m[i][3]).replace(/\s+$/,"");
				// extract the key
				var params = {};
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
				var myid = link.slice(params.offset);
				var myidlst = myid.split(params.splitter);
				if (myidlst.length === 2) {
					// the real deal. construct uris
					item.key = myidlst[1];
					if (myidlst[0] == "0" || params.isUserItem) {
						var userID = Zotero.userID;
						if (userID === false) {
							userID = "local";
						}
						item.uri = ['http://zotero.org/users/' + userID + '/items/' + myidlst[1]];
						item.uris = item.uri.slice();
					} else {
						var groupID = myidlst[0];
						if (params.fromZoteroSelect) {
							groupID = Zotero.Groups.getGroupIDFromLibraryID(myidlst[0]);
						}
						item.uri = ['http://zotero.org/groups/' + groupID + '/items/' + myidlst[1]]
						item.uris = item.uri.slice();
					}
				} else {
					// punt
					item.key = myidlst[0];
				}
				items = [item].concat(items);
				if (lst[i]) {
					var placeholder = placeholder.join("; ");
					var escapedPlaceholder = placeholder.replace('"', '\\&quot;', 'g');
					var items = JSON.stringify(items);
					items = items.replace("\\\\&quot;", "\\&quot;", "g");
					items = items.replace('"', '&quot;', "g");
					var randstr = this.generateRandomString();
					var citation = tmplCitation.replace("%{1}s", escapedPlaceholder)
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
			ret.reverse()
			this.content = ret.join("");

		}

		ODFConv.prototype.fixMarkup = function (str) {
			str = str.replace(rexFixMarkupBold, "&lt;b&gt;$1&lt;/b&gt;");
			str = str.replace(rexFixMarkupItalic, "&lt;i&gt;$1&lt;/i&gt;");
			str = str.replace('&quot;', "\\&quot;", "g");
			str = str.replace('"', "\\&quot;", "g");
			return str;
		}

		ODFConv.prototype.generateRandomString = function (str) {
			var randstr;
			while (true) {
				var nums = [49,50,51,52,53,54,55,56,57,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,97,98,99,100,101,102,103,104,105,106,107,108,109,110,111,112,113,114,115,116,117,118,119,120,121,122];
				randstr = "";
				for (var i=0,ilen=10;i<ilen;i+=1) {
					randstr += String.fromCharCode(nums[parseInt(Math.random() * 61)]);
				}
				if (!this.rands[randstr]) {
					this.rands[randstr] = true;
					break;
				}
			}
			return randstr;
		}

		ODFConv.prototype.readZipfileContent = function () {
			// Scrub any meta string lying around
			this.meta = false;

			// grab a toolkit for file path manipulation
			Components.utils.import("resource://gre/modules/FileUtils.jsm");
			Components.utils.import("resource://gre/modules/NetUtil.jsm");

			// grab the content.xml and meta.xml out of the input file
			var zipReader = _getReader();
			this.content = _getEntryContent("content.xml");
			if (zipReader.hasEntry("meta.xml")) {
				this.meta = _getEntryContent("meta.xml");
			}
			zipReader.close();

			function _getEntryContent(fileName) {
				var inputStream = zipReader.getInputStream(fileName);
				return Zotero.File.getContents(inputStream);
			}
			
			function _getReader () {
				var zipReader = Components.classes["@mozilla.org/libjar/zip-reader;1"]
					.createInstance(Components.interfaces.nsIZipReader);			
				zipReader.open(inputFile);
				return zipReader;
			}

		}


		ODFConv.prototype.purgeConfig = function () {
			// Scrub configuration from meta.xml
			if (this.meta) {
				this.meta = this.meta.replace(rexPref, "");
			}
		}


		ODFConv.prototype.writeZipfileContent = function () {

			// Remove target file it already exists
			if (outputFile.exists()) {
				outputFile.remove(false);
			}

			// Copy input file to the new location
			inputFile.copyTo(outputFile.parent,outputFile.leafName);

			// get zip writer
			zipWriter = _getWriter();

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
				var zipWriter = Components.classes["@mozilla.org/zipwriter;1"]
					.createInstance(Components.interfaces.nsIZipWriter);
				// 0x02 = Read and Write
				zipWriter.open(outputFile, 0x04 );
				return zipWriter;
			}

			function _addToZipFile(fileName, data) {
				var converter = Components.classes["@mozilla.org/intl/scriptableunicodeconverter"].
					createInstance(Components.interfaces.nsIScriptableUnicodeConverter);
				converter.charset = "UTF-8";
				var istream = converter.convertToInputStream(data);
				zipWriter.addEntryStream(fileName, 0, 9, istream, false);
			}

		}

		ODFConv.prototype.purgeStyles = function () {

			var decodeXML = Components.classes["@mozilla.org/xmlextras/domparser;1"]
				.createInstance(Components.interfaces.nsIDOMParser);
			var encodeXML = new XMLSerializer();

			var doc = decodeXML.parseFromString(this.content,'application/xml');
			var noteBodies = doc.getElementsByTagName("text:note-body");
			var stylesUsedInNotes = {};

			collectNoteStyles();
			fixStyleNodes();
			this.content = encodeXML.serializeToString(doc,'application/xml');

			function collectNoteStyles () {
				for (var i=0,ilen=noteBodies.length;i<ilen;i++) {
					var node = noteBodies[i];
					inspectNote(node);
				}
			}
			
			function inspectNote(node) {
				if (node.hasAttribute("text:style-name")) {
					var styleName = node.getAttribute("text:style-name").toString();
					if (styleName !== "Footnote") {
						stylesUsedInNotes[styleName] = true;
					}
				}
				for (var i=0,ilen=node.childNodes.length;i<ilen;i++) {
					var child = node.childNodes[i];
					if (!child.tagName) continue;
					inspectNote(child);
				}
			}
			
			function fixStyleNodes() {
				var styleNodes = doc.getElementsByTagName("style:style");
				for (var i=0,ilen=styleNodes.length;i<ilen;i++) {
					var styleNode = styleNodes[i];
					var styleName = styleNode.getAttribute("style:name").toString();
					if (stylesUsedInNotes[styleName]) {
						fixStyleNode(styleNode);
					}
				}
			}

			function fixStyleNode(node) {
				var textPropertyNodes = node.getElementsByTagName("style:text-properties");
				for (var i=0,ilen=textPropertyNodes.length;i<ilen;i++) {
					var textPropertyNode = textPropertyNodes[i];
					var unwantedAttributes = ["style:font-name","fo:font-size","style:font-size-asian"];
					for (var j=0,jlen=unwantedAttributes.length;j<jlen;j++) {
						var attributeName = unwantedAttributes[j];
						if (textPropertyNode.hasAttribute(attributeName)) {
							textPropertyNode.removeAttribute(attributeName);
						}
					}
				}
			}
			
		}
		
		var odfConv = new ODFConv();
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

	/**
	 * Scans file for citations, then proceeds to next wizard page.
	 */
	function _scanRTF() {
		// set up globals
		citations = [];
		citationItemIDs = {};
	
		unmappedCitationsItem = document.getElementById("unmapped-citations-item");
		ambiguousCitationsItem = document.getElementById("ambiguous-citations-item");
		mappedCitationsItem = document.getElementById("mapped-citations-item");
		unmappedCitationsChildren = document.getElementById("unmapped-citations-children");
		ambiguousCitationsChildren = document.getElementById("ambiguous-citations-children");
		mappedCitationsChildren = document.getElementById("mapped-citations-children");
		
		// set up regular expressions
		// this assumes that names are >=2 chars or only capital initials and that there are no
		// more than 4 names
		const nameRe = "(?:[^ .,;]{2,} |[A-Z].? ?){0,3}[A-Z][^ .,;]+";
		const creatorRe = '((?:(?:'+nameRe+', )*'+nameRe+'(?:,? and|,? \\&|,) )?'+nameRe+')(,? et al\\.?)?';
		// TODO: localize "and" term
		const creatorSplitRe = /(?:,| *(?:and|\&)) +/g;
		var citationRe = new RegExp('(\\\\\\{|; )('+creatorRe+',? (?:"([^"]+)(?:,"|",) )?([0-9]{4})[a-z]?)(?:,(?: pp?\.?)? ([^ )]+))?(?=;|\\\\\\})|(([A-Z][^ .,;]+)(,? et al\\.?)? (\\\\\\{([0-9]{4})[a-z]?\\\\\\}))', "gm");
		
		// read through RTF file and display items as they're found
		// we could read the file in chunks, but unless people start having memory issues, it's
		// probably faster and definitely simpler if we don't
		contents = Zotero.File.getContents(inputFile).replace(/([^\\\r])\r?\n/, "$1 ").replace("\\'92", "'", "g").replace("\\rquote ", "’");
		var m;
		var lastCitation = false;
		while((m = citationRe.exec(contents))) {
			// determine whether suppressed or standard regular expression was used
			if(m[2]) {	// standard parenthetical
				var citationString = m[2];
				var creators = m[3];
				var etAl = !!m[4];
				var title = m[5];
				var date = m[6];
				var pages = m[7];
				var start = citationRe.lastIndex-m[0].length;
				var end = citationRe.lastIndex+2;
			} else {	// suppressed
				var citationString = m[8];
				var creators = m[9];
				var etAl = !!m[10];
				var title = false;
				var date = m[12];
				var pages = false;
				var start = citationRe.lastIndex-m[11].length;
				var end = citationRe.lastIndex;
			}
			citationString = citationString.replace("\\{", "{", "g").replace("\\}", "}", "g");
			var suppressAuthor = !m[2];
			
			if(lastCitation && lastCitation.end >= start) {
				// if this citation is just an extension of the last, add items to it
				lastCitation.citationStrings.push(citationString);
				lastCitation.pages.push(pages);
				lastCitation.end = end;
			} else {
				// otherwise, add another citation
				var lastCitation = {"citationStrings":[citationString], "pages":[pages], "start":start,
					"end":end, "suppressAuthor":suppressAuthor};
				citations.push(lastCitation);
			}
			
			// only add each citation once
			if(citationItemIDs[citationString]) continue;
			//Zotero.debug("Found citation "+citationString);
			
			// for each individual match, look for an item in the database
			var s = new Zotero.Search;
			creators = creators.replace(".", "");			
			// TODO: localize "et al." term
			creators = creators.split(creatorSplitRe);
			
			for(var i=0; i<creators.length; i++) {
				if(!creators[i]) {
					if(i == creators.length-1) {
						break;
					} else {
						creators.splice(i, 1);
					}
				}
				
				var spaceIndex = creators[i].lastIndexOf(" ");
				var lastName = spaceIndex == -1 ? creators[i] : creators[i].substr(spaceIndex+1);
				s.addCondition("lastName", "contains", lastName);
			}
			if(title) s.addCondition("title", "contains", title);
			s.addCondition("date", "is", date);
			var ids = s.search();
			//Zotero.debug("Mapped to "+ids);
			citationItemIDs[citationString] = ids;
			
			if(!ids) {	// no mapping found
				unmappedCitationsChildren.appendChild(_generateItem(citationString, ""));
				unmappedCitationsItem.hidden = undefined;
			} else {	// some mapping found
				var items = Zotero.Items.get(ids);
				if(items.length > 1) {
					// check to see how well the author list matches the citation
					var matchedItems = [];
					for(var i=0; i<items.length; i++) {
						if(_matchesItemCreators(creators, items[i])) matchedItems.push(items[i]);
					}
					
					if(matchedItems.length != 0) items = matchedItems;
				}
				
				if(items.length == 1) {	// only one mapping					
					mappedCitationsChildren.appendChild(_generateItem(citationString, items[0].getField("title")));
					citationItemIDs[citationString] = [items[0].id];
					mappedCitationsItem.hidden = undefined;
				} else {				// ambiguous mapping
					var treeitem = _generateItem(citationString, "");
					
					// generate child items
					var treeitemChildren = document.createElement('treechildren');
					treeitem.appendChild(treeitemChildren);
					for(var i=0; i<items.length; i++) {
						treeitemChildren.appendChild(_generateItem("", items[i].getField("title"), true));
					}
					
					treeitem.setAttribute("container", "true");
					treeitem.setAttribute("open", "true");
					ambiguousCitationsChildren.appendChild(treeitem);
					ambiguousCitationsItem.hidden = undefined;
				}
			}
		}
		
		// when scanning is complete, go to citations page
		document.documentElement.canAdvance = true;
		document.documentElement.advance();
	}
	
	function _generateItem(citationString, itemName, accept) {
		var treeitem = document.createElement('treeitem');
		var treerow = document.createElement('treerow');
		
		var treecell = document.createElement('treecell');
		treecell.setAttribute("label", citationString);
		treerow.appendChild(treecell);
		
		var treecell = document.createElement('treecell');
		treecell.setAttribute("label", itemName);
		treerow.appendChild(treecell);
		
		var treecell = document.createElement('treecell');
		treecell.setAttribute("src", accept ? ACCEPT_ICON : LINK_ICON);
		treerow.appendChild(treecell);
		
		treeitem.appendChild(treerow);		
		return treeitem;
	}
	
	function _matchesItemCreators(creators, item, etAl) {
		var itemCreators = item.getCreators();
		var primaryCreators = [];
		var primaryCreatorTypeID = Zotero.CreatorTypes.getPrimaryIDForType(item.itemTypeID);
		
		// use only primary creators if primary creators exist
		for(var i=0; i<itemCreators.length; i++) {
			if(itemCreators[i].creatorTypeID == primaryCreatorTypeID) {
				primaryCreators.push(itemCreators[i]);
			}
		}
		// if primaryCreators matches the creator list length, or if et al is being used, use only
		// primary creators
		if(primaryCreators.length == creators.length || etAl) itemCreators = primaryCreators;
		
		// for us to have an exact match, either the citation creator list length has to match the
		// item creator list length, or et al has to be used
		if(itemCreators.length == creators.length || (etAl && itemCreators.length > creators.length)) {
			var matched = true;
			for(var i=0; i<creators.length; i++) {
				// check each item creator to see if it matches
				matched = matched && _matchesItemCreator(creators[i], itemCreators[i]);
				if(!matched) break;
			}
			return matched;
		}
		
		return false;
	}
	
	function _matchesItemCreator(creator, itemCreator) {
		// make sure last name matches
		var lowerLast = itemCreator.ref.lastName.toLowerCase();
		if(lowerLast != creator.substr(-lowerLast.length).toLowerCase()) return false;
		
		// make sure first name matches, if it exists
		if(creator.length > lowerLast.length) {
			var firstName = Zotero.Utilities.trim(creator.substr(0, creator.length-lowerLast.length));
			if(firstName.length) {
				// check to see whether the first name is all initials
				const initialRe = /^(?:[A-Z]\.? ?)+$/;
				var m = initialRe.exec(firstName);
				if(m) {
					var initials = firstName.replace(/[^A-Z]/g, "");
					var itemInitials = [name[0].toUpperCase() for each (name in itemCreator.ref.firstName.split(/ +/g))].join("");
					if(initials != itemInitials) return false;
				} else {
					// not all initials; verify that the first name matches
					var firstWord = firstName.substr(0, itemCreator.ref.firstName).toLowerCase();
					var itemFirstWord = itemCreator.ref.firstName.substr(0, itemCreator.ref.firstName.indexOf(" ")).toLowerCase();
					if(firstWord != itemFirstWord) return false;
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
		if (Zotero.Prefs.get("ODFScan.fileType") === 'rtf') {
			_refreshCanAdvance();
		} else {
			// skip this step for ODF conversion
			document.documentElement.canAdvance = true;
			document.documentElement.advance();
		}
	}
	
	/** 
	 * Called when the citations page is rewound. Removes all citations from the list, clears
	 * globals, and returns to intro page.
	 */
	this.citationsPageRewound = function() {
		// skip back to intro page
		document.documentElement.currentPage = document.getElementById('intro-page');
		
		// remove children from tree
		while(unmappedCitationsChildren.hasChildNodes()) {
			unmappedCitationsChildren.removeChild(unmappedCitationsChildren.firstChild);
		}
		while(ambiguousCitationsChildren.hasChildNodes()) {
			ambiguousCitationsChildren.removeChild(ambiguousCitationsChildren.firstChild);
		}
		while(mappedCitationsChildren.hasChildNodes()) {
			mappedCitationsChildren.removeChild(mappedCitationsChildren.firstChild);
		}
		// hide headings
		unmappedCitationsItem.hidden = ambiguousCitationsItem.hidden = mappedCitationsItem.hidden = true;
		
		return false;
	}
	
	/**
	 * Called when a tree item is clicked to remap a citation, or accept a suggestion for an 
	 * ambiguous citation
	 */
	this.treeClick = function(event) {
		var tree = document.getElementById("tree");
		
		// get clicked cell
		var row = { }, col = { }, child = { };
		tree.treeBoxObject.getCellAt(event.clientX, event.clientY, row, col, child);
		
		// figure out which item this corresponds to
		row = row.value;
		var level = tree.view.getLevel(row);
		if(col.value.index == 2 && level > 0) {
			var iconColumn = col.value;
			var itemNameColumn = iconColumn.getPrevious();
			var citationColumn = itemNameColumn.getPrevious();
			
			if(level == 2) {		// ambiguous citation item
				// get relevant information
				var parentIndex = tree.view.getParentIndex(row);
				var citation = tree.view.getCellText(parentIndex, citationColumn);
				var itemName = tree.view.getCellText(row, itemNameColumn);
				
				// update item name on parent and delete children
				tree.view.setCellText(parentIndex, itemNameColumn, itemName);
				var treeitem = tree.view.getItemAtIndex(row);
				treeitem.parentNode.parentNode.removeChild(treeitem.parentNode);
				
				// update array
				citationItemIDs[citation] = [citationItemIDs[citation][row-parentIndex-1]];
			} else {				// mapped or unmapped citation, or ambiguous citation parent
				var citation = tree.view.getCellText(row, citationColumn);
				var io = {singleSelection:true};
				if(citationItemIDs[citation] && citationItemIDs[citation].length == 1) {	// mapped citation
					// specify that item should be selected in window
					io.select = citationItemIDs[citation];
				}
				
				window.openDialog('chrome://zotero/content/selectItemsDialog.xul', '', 'chrome,modal', io);
				
				if(io.dataOut && io.dataOut.length) {
					var selectedItemID = io.dataOut[0];
					var selectedItem = Zotero.Items.get(selectedItemID);
					
					var treeitem = tree.view.getItemAtIndex(row);
					
					// remove any children (if ambiguous)
					var children = treeitem.getElementsByTagName("treechildren");
					if(children.length) treeitem.removeChild(children[0]);
					
					// update item name
					tree.view.setCellText(row, itemNameColumn, selectedItem.getField("title"));
					
					// update array
					citationItemIDs[citation] = [selectedItemID];
				}
			}
		}
		_refreshCanAdvance();
	}
	
	/**
	 * Determines whether the button to advance the wizard should be enabled or not based on whether
	 * unmapped citations exist, and sets the status appropriately
	 */
	function _refreshCanAdvance() {
		var canAdvance = true;
		for each(var itemList in citationItemIDs) {
			if(itemList.length != 1) {
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
		if (Zotero.Prefs.get("ODFScan.fileType") === 'rtf') {
			Zotero_File_Interface_Bibliography.init();
		} else {
			// skip this step for ODF conversion
			document.documentElement.canAdvance = true;
			document.documentElement.advance();
		}
	}
	
	/**
	 * Called when style page is hidden to save preferences.
	 */
	this.stylePageAdvanced = function() {
		if (Zotero.Prefs.get("ODFScan.fileType") === 'rtf') {
			Zotero.Prefs.set("export.lastStyle", document.getElementById("style-listbox").selectedItem.value);
		}
	}

	/**
	 * Switches between RTF and ODF file mode.
	 */
	this.fileTypeSwitch = function (mode) {
		if (!mode) {
			mode = "rtf";
		}
		mode = mode.split("-");
		var fileType = mode[0];
		var outputMode = mode[1];
		if (!outputMode) {
			// Keep things sane
			mode = "rtf";
			outputMode = "tortf";
		}
		var nodeIdStubs = [
			"file-type-description",
			"choose-input-file",
			"choose-output-file"
		];
		for (var i=0,ilen=nodeIdStubs.length;i<ilen;i+=1) {
			var elems = document.getElementsByClassName(nodeIdStubs[i]);
			for (var j=0,jlen=elems.length;j<jlen;j+=1) {
				var elem = elems[j];
				if (elem.id === (nodeIdStubs[i] + '-' + fileType)) {
					elem.hidden = false;
				} else {
					elem.hidden = true;
				}
			}
		}
		Zotero.Prefs.set("ODFScan.fileType", fileType);
		Zotero.Prefs.set("ODFScan.outputMode", outputMode)
		_refreshPath();
	}

	/** FORMAT PAGE UI **/
	
	this.formatPageShowing = function() {
		if (Zotero.Prefs.get("ODFScan.fileType") === 'rtf') {
			// can't advance
			document.documentElement.canAdvance = false;
			
			// wait a ms so that UI thread gets updated
			window.setTimeout(function() { _formatRTF() }, 1);
		} else {
			// skip this step for ODF conversion
			document.documentElement.canAdvance = true;
			document.documentElement.advance();
		}
	}
	
	function _formatRTF() {
		// load style and create ItemSet with all items
		var zStyle = Zotero.Styles.get(document.getElementById("style-listbox").selectedItem.value)
		var style = zStyle.getCiteProc();
		style.setOutputFormat("rtf");
		var isNote = style.class == "note";
		
		// create citations
		var k = 0;
		var cslCitations = [];
		var itemIDs = {};
		var shouldBeSubsequent = {};
		for(var i=0; i<citations.length; i++) {
			var citation = citations[i];
			var cslCitation = {"citationItems":[], "properties":{}};
			if(isNote) {
				cslCitation.properties.noteIndex = i;
			}
			
			// create citation items
			for(var j=0; j<citation.citationStrings.length; j++) {
				var citationItem = {};
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
		
		itemIDs = [itemID for(itemID in itemIDs)];
		//Zotero.debug(itemIDs);
		
		// prepare the list of rendered citations
		var citationResults = style.rebuildProcessorState(cslCitations, "rtf");
		
		// format citations
		var contentArray = [];
		var lastEnd = 0;
		for(var i=0; i<citations.length; i++) {
			var citation = citationResults[i][2];
			//Zotero.debug("Formatted "+citation);
			
			// if using notes, we might have to move the note after the punctuation
			if(isNote && citations[i].start != 0 && contents[citations[i].start-1] == " ") {
				contentArray.push(contents.substring(lastEnd, citations[i].start-1));
			} else {
				contentArray.push(contents.substring(lastEnd, citations[i].start));
			}
			
			lastEnd = citations[i].end;
			if(isNote && citations[i].end < contents.length && ".,!?".indexOf(contents[citations[i].end]) !== -1) {
				contentArray.push(contents[citations[i].end]);
				lastEnd++;
			}
			
			if(isNote) {
				if(document.getElementById("displayAs").selectedIndex) {	// endnotes
					contentArray.push("{\\super\\chftn}\\ftnbj {\\footnote\\ftnalt {\\super\\chftn } "+citation+"}");
				} else {													// footnotes
					contentArray.push("{\\super\\chftn}\\ftnbj {\\footnote {\\super\\chftn } "+citation+"}");
				}
			} else {
				contentArray.push(citation);
			}
		}
		contentArray.push(contents.substring(lastEnd));
		contents = contentArray.join("");
		
		// add bibliography
		if(zStyle.hasBibliography) {
			var bibliography = Zotero.Cite.makeFormattedBibliography(style, "rtf");
			bibliography = bibliography.substring(5, bibliography.length-1);
			// fix line breaks
			var linebreak = "\r\n";
			if(contents.indexOf("\r\n") == -1) {
				bibliography = bibliography.replace("\r\n", "\n", "g");
				linebreak = "\n";
			}
			
			if(contents.indexOf(BIBLIOGRAPHY_PLACEHOLDER) !== -1) {
				contents = contents.replace(BIBLIOGRAPHY_PLACEHOLDER, bibliography);
			} else {
				// add two newlines before bibliography
				bibliography = linebreak+"\\"+linebreak+"\\"+linebreak+bibliography;
				
				// add bibliography automatically inside last set of brackets closed
				const bracketRe = /^\{+/;
				var m = bracketRe.exec(contents);
				if(m) {
					var closeBracketRe = new RegExp("(\\}{"+m[0].length+"}\\s*)$");
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
}
