#!/bin/bash
# PollSlide Companion — put a FILED version on the website download (2026-10-06).
#
#   scripts/mac-release/rollback-companion.sh                    → lists the filed versions
#   scripts/mac-release/rollback-companion.sh "1.3.4 (build 10)" → makes that the download
#
# Used both to publish a new release and to go back to an older one. It only changes local
# files in the website repo (PollSlideCompanion.dmg + the version on download.html), after
# checking the filed DMG still matches its SHA-256 and is signed and notarized.
# Nothing is pushed: you push, then set the version in Admin (see the end).
set -euo pipefail
RELEASES="${RELEASES_DIR:-$HOME/Documents/PollSlide Companion Releases}"
WEBSITE="${WEBSITE_DIR:-$HOME/Documents/GitHub/pollslide-website}"
fail() { echo; echo "✗ $*" >&2; exit 1; }
okm()  { echo "  ✓ $*"; }

if [ -z "${1:-}" ]; then
  echo "Filed versions (newest last):"
  ls -1 "$RELEASES" | grep -E '^[0-9]+\.[0-9]+(\.[0-9]+)? \(build [0-9]+\)$' | sort -V | sed 's/^/  /'
  echo; echo "Usage: $0 \"<version> (build <n>)\""; exit 0
fi
DIR="$RELEASES/$1"
[ -d "$DIR" ] || fail "No filed release \"$1\". Run without arguments to list them."
VER="${1%% *}"
DMG=$(ls "$DIR"/*.dmg 2>/dev/null | head -1)
[ -n "$DMG" ] || fail "No DMG in $DIR."
grep -q "NOT FOR RELEASE" "$DIR/RELEASE-INFO.txt" 2>/dev/null && fail "$1 is a test build (not notarized). It cannot go on the website."

echo "Putting PollSlide Companion $1 on the website"
( cd "$DIR" && shasum -a 256 -c SHA256.txt >/dev/null 2>&1 ) || fail "The DMG does not match SHA256.txt — the filed copy has changed. Do not ship it."
okm "DMG matches its SHA-256 (unchanged since it was filed)"
xcrun stapler validate -q "$DMG" || fail "The DMG has no valid notarization ticket."
spctl -a -vv -t install "$DMG" 2>&1 | grep -q "accepted" || fail "Gatekeeper rejects the DMG."
okm "signed, notarized, stapled — Gatekeeper accepts it"
MNT=$(hdiutil attach -nobrowse -readonly "$DMG" | tail -1 | awk -F'\t' '{print $NF}')
IV=$(/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" "$MNT/PollSlideCompanion.app/Contents/Info.plist")
hdiutil detach -quiet "$MNT"
[ "$IV" = "$VER" ] || fail "The app inside says $IV, the folder says $VER."
okm "the app inside is $IV"

CUR=$(grep -oE 'id="appVersion">[0-9]+\.[0-9]+(\.[0-9]+)?<' "$WEBSITE/download.html" | head -1 | sed -E 's/.*>([0-9.]+)<.*/\1/')
cp -p "$DMG" "$WEBSITE/PollSlideCompanion.dmg"
okm "pollslide-website/PollSlideCompanion.dmg is now $1 (was $CUR)"
/usr/bin/sed -i '' -E "s#id=\"appVersion\">[0-9]+\.[0-9]+(\.[0-9]+)?<#id=\"appVersion\">$VER<#" "$WEBSITE/download.html"
grep -q "id=\"appVersion\">$VER<" "$WEBSITE/download.html" || fail "Could not set the version on download.html — edit it by hand."
okm "download.html says Version $VER"

echo
echo "Next:"
echo "  1. Push the website repo. Download pollslide.com/PollSlideCompanion.dmg once and check it"
echo "     is $VER (if not, purge that URL in Cloudflare)."
echo "  2. Admin → System health → Mac companion version → $VER → save."
echo "     Going FORWARD: this tells older installed copies to update."
echo "     Going BACK: set it to $VER too, or apps older than the version you removed are told"
echo "     to update to a version that is no longer downloadable. People who already installed"
echo "     the newer version keep it until they reinstall $VER (guide: pollslide.com/mac-update)."
