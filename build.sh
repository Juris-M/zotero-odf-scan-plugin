#!/bin/bash
set -euo pipefail

# Build script for ODF Scan plugin (Zotero 7/8)
# Simple shell version without version management

echo "Building ODF Scan plugin..."

# Get version from package.json
VERSION=$(grep '"version"' package.json | sed 's/.*: "\(.*\)",/\1/')
XPI="zotero-odf-scan-v${VERSION}.xpi"

# Remove old XPI files
rm -f *.xpi
echo "Removed old XPI files"

# Create temp directory for staging
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

echo "Staging files..."

# Copy files to temp directory
cp -r chrome "$TEMP_DIR/"
cp -r resource "$TEMP_DIR/"
cp chrome.manifest "$TEMP_DIR/"
cp bootstrap.js "$TEMP_DIR/"
cp manifest.json "$TEMP_DIR/"

# Create XPI (which is just a ZIP file)
cd "$TEMP_DIR"
zip -r "$XPI" . -q
cd - > /dev/null

# Move XPI to project root
mv "$TEMP_DIR/$XPI" .

echo "Built $XPI successfully!"
echo ""
echo "To install:"
echo "  1. Open Zotero"
echo "  2. Tools → Add-ons"
echo "  3. Install Add-on From File"
echo "  4. Select $XPI"
