#!/bin/bash
# Собирает «TClaude-Orch.app» (release, ad-hoc подпись) в app/build/. Запуск: scripts/build-app.sh [--run]
set -euo pipefail
cd "$(dirname "$0")/.."
NAME="TClaude-Orch"
BUNDLE_ID="com.nessy.orch.app"
OUT="build/$NAME.app"

swift build -c release
BIN="$(swift build -c release --show-bin-path)/NessyOrch"

rm -rf "$OUT"
mkdir -p "$OUT/Contents/MacOS" "$OUT/Contents/Resources"
cp "$BIN" "$OUT/Contents/MacOS/NessyOrch"

# сервер и CLI внутрь приложения: при запуске приложение ставит ссылку ~/.local/bin/nessy-orch и (по желанию) службу launchd
# (tsc без очистки dist: не ломаем уже запущенные демо/тесты, которые читают dist/test)
ROOT="$(cd .. && pwd)"
(cd "$ROOT" && npx --no-install tsc -p tsconfig.json)
ORCH="$OUT/Contents/Resources/orch"
mkdir -p "$ORCH/bin" "$ORCH/dist"
cp -R "$ROOT/dist/src" "$ORCH/dist/src"
cp -R "$ROOT/dist/shared" "$ORCH/dist/shared"
cp -R "$ROOT/roles" "$ORCH/roles"
cp "$ROOT/package.json" "$ORCH/package.json"
# плагин nessy — самодостаточный (скилл, команды, хуки сессий и CLI в bin/ с собранным кодом): приложение копирует его в ~/.claude/skills/nessy,
# и Claude Code подхватывает его как плагин при любом запуске claude. Версия содержит номер сборки — по ней приложение обновляет копию.
PLUGIN="$ORCH/plugin"
mkdir -p "$PLUGIN"
cp -R "$ROOT/plugins/nessy/." "$PLUGIN/"
mkdir -p "$PLUGIN/dist"
cp -R "$ROOT/dist/src" "$PLUGIN/dist/src"
cp -R "$ROOT/dist/shared" "$PLUGIN/dist/shared"
chmod +x "$PLUGIN/bin/nessy-orch"
BUILD="$(git -C "$ROOT" rev-list --count HEAD 2>/dev/null || echo 0).$(date +%y%m%d%H%M)"
python3 - "$PLUGIN/.claude-plugin/plugin.json" "$BUILD" <<'PY'
import json, sys
p, build = sys.argv[1], sys.argv[2]
d = json.load(open(p))
d["version"] = "1.0." + build
open(p, "w").write(json.dumps(d, ensure_ascii=False, indent=2) + "\n")
PY
cp "$ROOT/bin/nessy-orch" "$ORCH/bin/nessy-orch"
chmod +x "$ORCH/bin/nessy-orch" "$ORCH/dist/src/main.js" "$ORCH/dist/src/interfaces/cli/main.js"

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
	<key>CFBundleDocumentTypes</key>
	<array><dict>
		<key>CFBundleTypeName</key><string>Folder</string>
		<key>CFBundleTypeRole</key><string>Viewer</string>
		<key>LSItemContentTypes</key><array><string>public.folder</string></array>
		<key>LSHandlerRank</key><string>Alternate</string>
	</dict></array>
	<key>NSServices</key>
	<array><dict>
		<key>NSMenuItem</key><dict><key>default</key><string>Открыть в $NAME</string></dict>
		<key>NSMessage</key><string>openInTClaude</string>
		<key>NSPortName</key><string>NessyOrch</string>
		<key>NSSendFileTypes</key><array><string>public.item</string></array>
	</dict></array>
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
