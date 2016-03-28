#!/bin/bash

set -e

# Release-dance code goes here.

# Constants
PRODUCT="Zotero ODF Scan"
IS_BETA="false"
FORK="zotero-odf-scan-plugin"
BRANCH="master"
CLIENT="zotero-odf-scan"
VERSION_ROOT="1.0."
SIGNED_STUB="rtfodf_scan_for_zotero-"

function fix-content () {
    cat about.tmpl | sed -e "s/##REVISION##/${VERSION}/" > chrome/content/about.xul
}

function xx-make-the-bundle () {
    find . -name '.git' -prune -o \
        -name '.gitignore' -prune -o \
        -name '.gitmodules' -prune -o \
        -name '*~' -prune -o \
        -name '*.bak' -prune -o \
        -name '.git' -prune -o \
        -name 'attic' -prune -o \
        -name 'version' -prune -o \
        -name 'releases' -prune -o \
        -name 'jm-sh' -prune -o \
        -name 'build.sh' -prune -o \
        -print \
        | xargs zip "${XPI_FILE}" >> "${LOG_FILE}"
}

function build-the-plugin () {
        set-install-version
        xx-make-the-bundle
    }
    
. jm-sh/frontend.sh
