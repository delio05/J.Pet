#!/bin/bash
# 編譯成 OrbPet.app（雙擊即可執行）
set -euo pipefail
cd "$(dirname "$0")"

APP="build/OrbPet.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

swiftc -O -swift-version 5 -framework IOKit main.swift -o "$APP/Contents/MacOS/OrbPet"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>OrbPet</string>
  <key>CFBundleIdentifier</key><string>local.orbpet</string>
  <key>CFBundleExecutable</key><string>OrbPet</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

codesign --force -s - "$APP" >/dev/null 2>&1 || true
echo "Built $APP"

# 安裝到「應用程式」資料夾，之後可用 Spotlight / Launchpad 搜尋 OrbPet 開啟
mkdir -p "$HOME/Applications"
rm -rf "$HOME/Applications/OrbPet.app"
ditto "$APP" "$HOME/Applications/OrbPet.app"
echo "Installed ~/Applications/OrbPet.app"
