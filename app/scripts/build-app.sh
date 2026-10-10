#!/bin/bash
# Собирает «Nessy Orch.app» (release, ad-hoc подпись) в app/build/. Запуск: scripts/build-app.sh [--run]
set -euo pipefail
cd "$(dirname "$0")/.."
NAME="Nessy Orch"
BUNDLE_ID="com.nessy.orch.app"
OUT="build/$NAME.app"

swift build -c release
BIN="$(swift build -c release --show-bin-path)/NessyOrch"

rm -rf "$OUT"
mkdir -p "$OUT/Contents/MacOS" "$OUT/Contents/Resources"
cp "$BIN" "$OUT/Contents/MacOS/NessyOrch"

# иконка
ICONSET="build/AppIcon.iconset"
rm -rf "$ICONSET"
swift scripts/make-icon.swift "$ICONSET"
iconutil -c icns "$ICONSET" -o "$OUT/Contents/Resources/AppIcon.icns"

cat > "$OUT/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleName</key><string>$NAME</string>
	<key>CFBundleDisplayName</key><string>$NAME</string>
	<key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
	<key>CFBundleExecutable</key><string>NessyOrch</string>
	<key>CFBundleIconFile</key><string>AppIcon</string>
	<key>CFBundlePackageType</key><string>APPL</string>
	<key>CFBundleShortVersionString</key><string>0.1.0</string>
	<key>CFBundleVersion</key><string>1</string>
	<key>CFBundleDevelopmentRegion</key><string>ru</string>
	<key>CFBundleLocalizations</key><array><string>ru</string><string>en</string></array>
	<key>LSMinimumSystemVersion</key><string>26.0</string>
	<key>LSApplicationCategoryType</key><string>public.app-category.developer-tools</string>
	<key>NSHighResolutionCapable</key><true/>
	<key>NSSupportsAutomaticTermination</key><false/>
	<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
	<key>CFBundleURLTypes</key>
	<array><dict>
		<key>CFBundleURLName</key><string>$BUNDLE_ID</string>
		<key>CFBundleURLSchemes</key><array><string>nessy-orch</string></array>
	</dict></array>
</dict>
</plist>
PLIST

codesign --force --deep --sign - "$OUT" >/dev/null
echo "✓ $OUT"
if [[ "${1:-}" == "--run" ]]; then open "$OUT"; fi
