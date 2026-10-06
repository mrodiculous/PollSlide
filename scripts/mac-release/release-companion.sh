#!/bin/bash
# PollSlide Companion — package, notarize, verify and FILE a Mac release (2026-10-06).
#
#   scripts/mac-release/release-companion.sh "/path/to/exported/PollSlideCompanion.app" [--publish]
#
# Before running: in Xcode, Product → Archive, then Organizer → Distribute App →
# Direct Distribution, wait for "Ready to distribute", Export. Pass the exported .app.
#
# It will:
#   1. check the app: Developer ID (JPGYLW84Z3), hardened runtime, no get-task-allow,
#      notarized (Gatekeeper accepts it), not sandboxed, universal
#   2. refuse if this version + build is already filed (bump the version/build instead)
#   3. build the DMG (app + Applications shortcut), sign it, notarize it, staple it, verify it
#   4. FILE the release in its own folder, so any version can be put back later:
#        ~/Documents/PollSlide Companion Releases/<version> (build <n>)/
#          PollSlideCompanion-<version>-build<n>.dmg   the exact file users download
#          PollSlideCompanion-<version>-build<n>.xcarchive   the Xcode archive (symbols)
#          source-<version>-build<n>.zip               the source it was built from
#          SHA256.txt, RELEASE-INFO.txt
#   5. with --publish: copy the DMG into the website repo as PollSlideCompanion.dmg and set
#      the version on download.html. Nothing is pushed — you push, then Announce in Admin.
#
# Needs the notarytool profile "notary" once:
#   xcrun notarytool store-credentials "notary" --apple-id "YOUR_APPLE_ID" --team-id JPGYLW84Z3
# Testing only: SKIP_NOTARIZE=1 skips Apple's notarization of the DMG (the result is marked
# NOT FOR RELEASE and --publish is refused). RELEASES_DIR overrides the archive folder.
set -euo pipefail

TEAM="JPGYLW84Z3"
IDENTITY="Developer ID Application: Innovative Resources and Investments Inc (JPGYLW84Z3)"
BUNDLE_ID="com.pollslide.PollSlideCompanion"
RELEASES="${RELEASES_DIR:-$HOME/Documents/PollSlide Companion Releases}"
SOURCE_DIR="${SOURCE_DIR:-$HOME/Downloads/PollSlide/xCode App Companion Pollslide/PollSlideCompanion}"
WEBSITE="${WEBSITE_DIR:-$HOME/Documents/GitHub/pollslide-website}"
ARCHIVES="$HOME/Library/Developer/Xcode/Archives"

fail() { echo; echo "✗ $*" >&2; exit 1; }
okm()  { echo "  ✓ $*"; }

APP="${1:-}"; PUBLISH=0
[ "${2:-}" = "--publish" ] && PUBLISH=1
[ -n "$APP" ] && [ -d "$APP" ] && [[ "$APP" == *.app ]] || fail "Give the exported PollSlideCompanion.app as the first argument."
APP="$(cd "$(dirname "$APP")" && pwd)/$(basename "$APP")"
[ "${SKIP_NOTARIZE:-0}" = "1" ] && [ $PUBLISH = 1 ] && fail "--publish is not allowed with SKIP_NOTARIZE=1 (that DMG is not notarized)."

PL="$APP/Contents/Info.plist"
VER=$(/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" "$PL")
BUILD=$(/usr/libexec/PlistBuddy -c "Print CFBundleVersion" "$PL")
BID=$(/usr/libexec/PlistBuddy -c "Print CFBundleIdentifier" "$PL")
echo "PollSlide Companion $VER (build $BUILD)"
echo
echo "1. Checking the app"
[ "$BID" = "$BUNDLE_ID" ] || fail "Bundle id is $BID, expected $BUNDLE_ID."
okm "bundle id $BID"
SIG=$(codesign -dv --verbose=4 "$APP" 2>&1) || fail "The app is not signed."
grep -q "Authority=$IDENTITY" <<<"$SIG" || fail "Not signed with $IDENTITY."
grep -q "TeamIdentifier=$TEAM" <<<"$SIG" || fail "Team is not $TEAM."
okm "signed: Developer ID, team $TEAM"
grep -q "flags=.*runtime" <<<"$SIG" || fail "Hardened runtime is off (notarization requires it)."
okm "hardened runtime"
ENT=$(codesign -d --entitlements - "$APP" 2>/dev/null || true)
grep -q "get-task-allow" <<<"$ENT" && fail "The app has get-task-allow (a debug build). Use Product → Archive + Direct Distribution, not Build/Run."
okm "no get-task-allow (not a debug build)"
grep -q "com.apple.security.app-sandbox" <<<"$ENT" && fail "The app is sandboxed — the sandbox breaks QR detection (see build 10). Remove it."
okm "not sandboxed"
codesign --verify --deep --strict "$APP" 2>/dev/null || fail "codesign --verify --deep --strict failed."
okm "signature verifies (deep, strict)"
GK=$(spctl -a -vv -t exec "$APP" 2>&1 || true)
if grep -q "source=Notarized Developer ID" <<<"$GK"; then okm "Gatekeeper: Notarized Developer ID"
elif [ "${SKIP_NOTARIZE:-0}" = "1" ]; then echo "  ! Gatekeeper does not accept the app as notarized (allowed only because SKIP_NOTARIZE=1)"
else fail "Gatekeeper does not accept the app as notarized:
$GK
Export it again from Organizer → Direct Distribution after it shows 'Ready to distribute'."; fi
if xcrun stapler validate "$APP" >/dev/null 2>&1; then okm "notarization ticket stapled to the app"; else echo "  · no ticket stapled to the app itself (fine — the DMG is stapled below)"; fi
ARCHS=$(lipo -archs "$APP/Contents/MacOS/"* 2>/dev/null || true)
[[ "$ARCHS" == *arm64* && "$ARCHS" == *x86_64* ]] || fail "Not universal (archs: $ARCHS)."
okm "universal ($ARCHS)"

echo
echo "2. Checking it is a new release"
DEST="$RELEASES/$VER (build $BUILD)"
[ -e "$DEST" ] && fail "\"$DEST\" already exists. Every release needs a new build number (and usually a new version) — bump it in Xcode and archive again."
okm "$VER (build $BUILD) is not filed yet"
LAST=$(ls -1 "$RELEASES" 2>/dev/null | grep -E '^[0-9]+\.[0-9]+(\.[0-9]+)? \(build [0-9]+\)$' | sort -V | tail -1 || true)
if [ -n "$LAST" ]; then
  LV="${LAST%% *}"
  if [ "$(printf '%s\n%s\n' "$LV" "$VER" | sort -V | tail -1)" != "$VER" ] || [ "$LV" = "$VER" ]; then
    echo "  ! The newest filed release is $LAST. $VER is not higher — installed apps will not be told to update."
    read -r -p "    Continue anyway? Type YES: " a; [ "$a" = "YES" ] || fail "Stopped."
  else okm "newer than the last filed release ($LAST)"; fi
fi

echo
echo "3. Building the DMG"
WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
mkdir "$WORK/dmg"
ditto "$APP" "$WORK/dmg/PollSlideCompanion.app"
ln -s /Applications "$WORK/dmg/Applications"
DMG="$WORK/PollSlideCompanion-$VER-build$BUILD.dmg"
hdiutil create -quiet -volname "PollSlide Companion" -srcfolder "$WORK/dmg" -ov -format UDZO "$DMG"
okm "DMG built (app + Applications shortcut)"
codesign --sign "$IDENTITY" --timestamp "$DMG"
okm "DMG signed"
if [ "${SKIP_NOTARIZE:-0}" = "1" ]; then
  echo "  ! SKIP_NOTARIZE=1 — DMG NOT notarized. This is a test build: do not upload it."
else
  echo "  … sending the DMG to Apple for notarization (usually 1–5 minutes)"
  xcrun notarytool submit "$DMG" --keychain-profile notary --wait | tee "$WORK/notary.txt"
  grep -q "status: Accepted" "$WORK/notary.txt" || fail "Apple did not accept the DMG. See: xcrun notarytool log <submission id> --keychain-profile notary"
  okm "notarized by Apple"
  xcrun stapler staple -q "$DMG" || fail "Stapling failed."
  xcrun stapler validate -q "$DMG" || fail "Staple does not validate."
  okm "ticket stapled to the DMG"
  spctl -a -vv -t install "$DMG" 2>&1 | grep -q "accepted" || fail "Gatekeeper rejects the DMG."
  okm "Gatekeeper accepts the DMG"
fi
# Mount it and check the app inside is the one we checked.
MNT=$(hdiutil attach -nobrowse -readonly "$DMG" | tail -1 | awk -F'\t' '{print $NF}')
IV=$(/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" "$MNT/PollSlideCompanion.app/Contents/Info.plist")
IB=$(/usr/libexec/PlistBuddy -c "Print CFBundleVersion" "$MNT/PollSlideCompanion.app/Contents/Info.plist")
LINK=$(readlink "$MNT/Applications" || true)
hdiutil detach -quiet "$MNT"
[ "$IV" = "$VER" ] && [ "$IB" = "$BUILD" ] && [ "$LINK" = "/Applications" ] || fail "The DMG contents are not right ($IV/$IB, Applications → $LINK)."
okm "DMG opens: PollSlideCompanion.app $IV (build $IB) + Applications shortcut"

echo
echo "4. Filing the release"
mkdir -p "$DEST"
cp -p "$DMG" "$DEST/"
DMGN="$(basename "$DMG")"
( cd "$DEST" && shasum -a 256 "$DMGN" > SHA256.txt )
okm "$DMGN"
# The Xcode archive with this exact version + build (newest first).
XA=""
while IFS= read -r a; do
  av=$(/usr/libexec/PlistBuddy -c "Print ApplicationProperties:CFBundleShortVersionString" "$a/Info.plist" 2>/dev/null || true)
  ab=$(/usr/libexec/PlistBuddy -c "Print ApplicationProperties:CFBundleVersion" "$a/Info.plist" 2>/dev/null || true)
  if [ "$av" = "$VER" ] && [ "$ab" = "$BUILD" ]; then XA="$a"; break; fi
done < <(find "$ARCHIVES" -maxdepth 2 -name "*.xcarchive" -print0 2>/dev/null | xargs -0 ls -dt 2>/dev/null)
if [ -n "$XA" ]; then cp -Rp "$XA" "$DEST/PollSlideCompanion-$VER-build$BUILD.xcarchive"; okm "Xcode archive ($(basename "$XA"))"
else echo "  ! no Xcode archive found for $VER (build $BUILD) in $ARCHIVES"; fi
# The source it was built from (no personal Xcode state, no build products).
if [ -d "$SOURCE_DIR" ]; then
  ( cd "$SOURCE_DIR" && zip -qr "$DEST/source-$VER-build$BUILD.zip" . -x "*/xcuserdata/*" "*.DS_Store" ".git/*" "build/*" "DerivedData/*" )
  okm "source-$VER-build$BUILD.zip"
  SV=$(grep -m1 "MARKETING_VERSION" "$SOURCE_DIR/PollSlide Companion.xcodeproj/project.pbxproj" | sed 's/.*= *//;s/;//')
  [ "$SV" = "$VER" ] || echo "  ! the source folder says MARKETING_VERSION $SV, the app says $VER — check the source zip is the right one"
else echo "  ! source folder not found ($SOURCE_DIR) — no source zip"; fi
NOT="yes — DMG notarized by Apple and stapled; app accepted by Gatekeeper as Notarized Developer ID"
[ "${SKIP_NOTARIZE:-0}" = "1" ] && NOT="NO — TEST BUILD (SKIP_NOTARIZE=1). NOT FOR RELEASE."
cat > "$DEST/RELEASE-INFO.txt" <<EOF
PollSlide Companion $VER (build $BUILD)
Filed:      $(date '+%Y-%m-%d %H:%M')
File:       $DMGN   (SHA-256 in SHA256.txt)
Signed:     $IDENTITY
Notarized:  $NOT
Runtime:    hardened, no get-task-allow, not sandboxed · $ARCHS
Archive:    ${XA:+PollSlideCompanion-$VER-build$BUILD.xcarchive (from $(basename "$XA"))}${XA:-none found}
Source:     source-$VER-build$BUILD.zip

What changed (write it here):

To put this version back on the website:
  scripts/mac-release/rollback-companion.sh "$VER (build $BUILD)"
EOF
okm "RELEASE-INFO.txt (add what changed)"
echo
echo "Filed in: $DEST"

if [ $PUBLISH = 1 ]; then
  echo
  echo "5. Putting it on the website (local files only — nothing is pushed)"
  cp -p "$DEST/$DMGN" "$WEBSITE/PollSlideCompanion.dmg"
  okm "pollslide-website/PollSlideCompanion.dmg = $VER (build $BUILD)"
  /usr/bin/sed -i '' -E "s/Version [0-9]+\.[0-9]+(\.[0-9]+)? · Free · macOS/Version $VER · Free · macOS/" "$WEBSITE/download.html"
  grep -q "Version $VER · Free · macOS" "$WEBSITE/download.html" || fail "Could not set the version on download.html — edit it by hand."
  okm "download.html says Version $VER"
  echo
  echo "Next: push the website, download pollslide.com/PollSlideCompanion.dmg once to check it is"
  echo "$VER (purge it in Cloudflare if not), THEN Admin → System health → Mac companion → Announce $VER."
else
  echo
  echo "Not published. When you are ready:  scripts/mac-release/rollback-companion.sh \"$VER (build $BUILD)\""
  echo "(the same script puts ANY filed version on the website — newer or older)."
fi
