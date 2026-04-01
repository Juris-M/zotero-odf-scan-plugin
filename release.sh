#!/bin/bash
set -euo pipefail

# Release script for ODF Scan plugin
# Usage: ./release.sh <version> [--draft] [--notes-file FILE]
# Example: ./release.sh 2.1.0
# Example: ./release.sh 2.1.0 --draft
# Example: ./release.sh 2.1.0 --notes-file my-notes.md
#
# Changelog: by default the script extracts the ## [VERSION] section from
# CHANGELOG.md (Keep a Changelog format). Use --notes-file to override.

# Check if version argument provided
if [ -z "${1:-}" ]; then
    echo "Error: Version number required"
    echo "Usage: ./release.sh <version> [--draft] [--notes-file FILE]"
    echo "Example: ./release.sh 2.1.0"
    exit 1
fi

VERSION="$1"
DRAFT_FLAG=""
NOTES_FILE=""

# Parse remaining flags
shift
while [[ $# -gt 0 ]]; do
    case "$1" in
        --draft)
            DRAFT_FLAG="--draft"
            ;;
        --notes-file)
            if [ -z "${2:-}" ]; then
                echo "Error: --notes-file requires a filename argument"
                exit 1
            fi
            NOTES_FILE="$2"
            shift
            ;;
        *)
            echo "Error: Unknown argument: $1"
            echo "Usage: ./release.sh <version> [--draft] [--notes-file FILE]"
            exit 1
            ;;
    esac
    shift
done

if [ -n "$DRAFT_FLAG" ]; then
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
echo "Step 1: Updating version in package.json, manifest.json, and CITATION.cff..."
sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" package.json
sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" manifest.json
sed -i "s/^version: .*/version: $VERSION/" CITATION.cff

# Update updates.json (root copy and docs/ copy served via GitHub Pages)
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
              "strict_max_version": "9.0.*"
            }
          }
        }
      ]
    }
  }
}
EOF

echo "Updated updates.json for Zotero 7-9 compatibility"

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

# Sync docs/updates.json (served via GitHub Pages at the update_url)
cp updates.json docs/updates.json

# Commit version changes
echo ""
echo "Step 5: Committing version updates..."
git add package.json manifest.json updates.json docs/updates.json CITATION.cff
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

# Build changelog section for release notes
# Priority: --notes-file flag > CHANGELOG.md section > fallback message
if [ -n "$NOTES_FILE" ]; then
    if [ ! -f "$NOTES_FILE" ]; then
        echo "Error: Notes file not found: $NOTES_FILE"
        exit 1
    fi
    CHANGELOG_BODY=$(cat "$NOTES_FILE")
    echo "Using changelog from: $NOTES_FILE"
elif [ -f "CHANGELOG.md" ]; then
    # Extract the section for this version: lines between ## [VERSION] and the next ## [
    CHANGELOG_BODY=$(awk "/^## \[${VERSION}\]/{found=1; next} found && /^## \[/{exit} found{print}" CHANGELOG.md)
    if [ -n "$CHANGELOG_BODY" ]; then
        echo "Extracted changelog from CHANGELOG.md"
    else
        echo "Warning: No ## [$VERSION] section found in CHANGELOG.md, using fallback"
        CHANGELOG_BODY="See the commit history for detailed changes."
    fi
else
    CHANGELOG_BODY="See the commit history for detailed changes."
fi

# Create GitHub release
echo ""
echo "Step 7: Creating GitHub release..."

RELEASE_NOTES="## Installation

1. Download the XPI file below
2. In Zotero: Tools → Add-ons
3. Click the gear icon → Install Add-on From File
4. Select the downloaded XPI file

## Changes

${CHANGELOG_BODY}

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
