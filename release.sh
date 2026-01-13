#!/bin/bash
set -euo pipefail

# Release script for ODF Scan plugin
# Usage: ./release.sh <version> [--draft]
# Example: ./release.sh 2.1.0
# Example: ./release.sh 2.1.0 --draft

# Check if version argument provided
if [ -z "${1:-}" ]; then
    echo "Error: Version number required"
    echo "Usage: ./release.sh <version> [--draft]"
    echo "Example: ./release.sh 2.1.0"
    exit 1
fi

VERSION="$1"
DRAFT_FLAG=""

# Check for --draft flag
if [ "${2:-}" = "--draft" ]; then
    DRAFT_FLAG="--draft"
    echo "Creating draft release..."
else
    echo "Creating public release..."
fi

# Validate version format (semantic versioning)
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Error: Version must be in format X.Y.Z (e.g., 2.1.0)"
    exit 1
fi

echo "================================================"
echo "Releasing ODF Scan Plugin v$VERSION"
echo "================================================"

# Check we're on the correct branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$CURRENT_BRANCH" != "master" ]] && [[ "$CURRENT_BRANCH" != "main" ]]; then
    read -p "Warning: Not on master/main branch (currently on $CURRENT_BRANCH). Continue? [y/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Check for uncommitted changes
if [ -n "$(git status --untracked-files=no --porcelain)" ]; then
    echo "Error: Uncommitted changes in tracked files"
    git status --short
    exit 1
fi

# Check if gh CLI is installed
if ! command -v gh &> /dev/null; then
    echo "Error: GitHub CLI (gh) is not installed"
    echo "Install from: https://cli.github.com/"
    exit 1
fi

# Update version in files
echo ""
echo "Step 1: Updating version in package.json and manifest.json..."
sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" package.json
sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" manifest.json

# Update updates.json
echo "Step 2: Updating updates.json..."
XPI_FILE="zotero-odf-scan-v${VERSION}.xpi"
UPDATE_URL="https://github.com/Juris-M/zotero-odf-scan-plugin/releases/download/v${VERSION}/${XPI_FILE}"

# Create temporary updates.json with new version
cat > updates.json <<EOF
{
  "addons": {
    "rtf-odf-scan-for-zotero@mystery-lab.com": {
      "updates": [
        {
          "version": "$VERSION",
          "update_link": "$UPDATE_URL",
          "applications": {
            "zotero": {
              "strict_min_version": "7.0",
              "strict_max_version": "8.0.*"
            }
          }
        }
      ]
    }
  }
}
EOF

echo "Updated updates.json for Zotero 7/8 compatibility"

# Build the XPI
echo ""
echo "Step 3: Building XPI..."
bash build.sh

# Verify XPI was created
if [ ! -f "$XPI_FILE" ]; then
    echo "Error: Build failed - $XPI_FILE not found"
    exit 1
fi

# Calculate SHA256 hash
echo ""
echo "Step 4: Calculating SHA256 hash..."
if command -v sha256sum &> /dev/null; then
    HASH=$(sha256sum "$XPI_FILE" | awk '{print $1}')
elif command -v shasum &> /dev/null; then
    HASH=$(shasum -a 256 "$XPI_FILE" | awk '{print $1}')
else
    echo "Warning: Neither sha256sum nor shasum found, skipping hash calculation"
    HASH="(hash not calculated)"
fi
echo "SHA256: $HASH"

# Update updates.json with hash
if [ "$HASH" != "(hash not calculated)" ]; then
    # Add update_hash to updates.json
    sed -i "s|\"applications\"|\"update_hash\": \"sha256:$HASH\",\n          \"applications\"|" updates.json
fi

# Commit version changes
echo ""
echo "Step 5: Committing version updates..."
git add package.json manifest.json updates.json
git commit -m "Release v$VERSION"

# Create and push tag
echo ""
echo "Step 6: Creating git tag..."
git tag -a "v$VERSION" -m "Release v$VERSION"

echo ""
read -p "Push commits and tags to GitHub? [y/N] " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    git push origin "$CURRENT_BRANCH"
    git push origin "v$VERSION"
else
    echo "Skipping push. Remember to run:"
    echo "  git push origin $CURRENT_BRANCH"
    echo "  git push origin v$VERSION"
fi

# Create GitHub release
echo ""
echo "Step 7: Creating GitHub release..."

RELEASE_NOTES="Release v$VERSION for Zotero 7/8

## Installation

1. Download the XPI file below
2. In Zotero: Tools → Add-ons
3. Click the gear icon → Install Add-on From File
4. Select the downloaded XPI file

## Changes

See the commit history for detailed changes.

## Verification

SHA256: \`$HASH\`"

if [ -z "$DRAFT_FLAG" ]; then
    gh release create "v$VERSION" "$XPI_FILE" \
        --title "v$VERSION" \
        --notes "$RELEASE_NOTES"
else
    gh release create "v$VERSION" "$XPI_FILE" \
        --title "v$VERSION" \
        --notes "$RELEASE_NOTES" \
        --draft
fi

echo ""
echo "================================================"
echo "✓ Release v$VERSION created successfully!"
echo "================================================"
echo ""
echo "XPI file: $XPI_FILE"
echo "SHA256: $HASH"
echo ""

if [ -z "$DRAFT_FLAG" ]; then
    echo "Release is now live at:"
    echo "https://github.com/Juris-M/zotero-odf-scan-plugin/releases/tag/v$VERSION"
else
    echo "Draft release created. Review and publish at:"
    echo "https://github.com/Juris-M/zotero-odf-scan-plugin/releases"
fi
