# Changelog

All notable changes to this project will be documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [3.1.1] - 2026-04-01

### Fixed
- \u2068\u2069 characters in converted pandoc citations
- pandoc citations with multiple items convert to individual, not mulitple items (causing failure when using refresh immediately)


## [3.1.0] - 2026-03-24

### Fixed
- DOCX scan now processes footnotes and endnotes (citations in footnotes were silently skipped)
- Marker-to-citation conversion falls back to URI-only field when item is not in the currently loaded library, matching ODF behaviour
- Friendly error message when the output file is locked or open in another application (DOCX and ODF)
- Dialog now respects Zotero's dark mode

## [3.0.0] - 2024-12-01

### Changed
- Migrated to Zotero 7 bootstrap plugin architecture
- Replaced wizard-based UI with a single-page dialog
- Added DOCX (.docx) support alongside existing ODF (.odt/.fodt) support
- Added pandoc citation format support (markers ↔ Zotero citations, both ODF and DOCX)
- Localization converted to Fluent (.ftl) format for Zotero 7 compatibility
- Chrome package now registered programmatically (no chrome.manifest)
