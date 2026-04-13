#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
APP_NAME="Ronda"
APP_BUNDLE="$PROJECT_DIR/$APP_NAME.app"
BUILD_DIR="$SCRIPT_DIR/build"

echo "==> Building $APP_NAME.app..."

# Clean
rm -rf "$BUILD_DIR" "$APP_BUNDLE"
mkdir -p "$BUILD_DIR"

# Compile Swift
echo "    Compiling Swift..."
swiftc \
    -o "$BUILD_DIR/Ronda" \
    -framework Cocoa \
    -framework WebKit \
    -O \
    "$SCRIPT_DIR/main.swift"

echo "    Binary size: $(du -h "$BUILD_DIR/Ronda" | cut -f1)"

# Assemble .app bundle
echo "    Assembling $APP_NAME.app..."
mkdir -p "$APP_BUNDLE/Contents/MacOS"
mkdir -p "$APP_BUNDLE/Contents/Resources/web/icons"

# Copy binary
cp "$BUILD_DIR/Ronda" "$APP_BUNDLE/Contents/MacOS/Ronda"

# Copy web assets
cp "$PROJECT_DIR/index.html"     "$APP_BUNDLE/Contents/Resources/web/"
cp "$PROJECT_DIR/manifest.json"  "$APP_BUNDLE/Contents/Resources/web/"
cp "$PROJECT_DIR/sw.js"          "$APP_BUNDLE/Contents/Resources/web/"
cp "$PROJECT_DIR/icons/"*.png    "$APP_BUNDLE/Contents/Resources/web/icons/" 2>/dev/null || true

# Create Info.plist
cat > "$APP_BUNDLE/Contents/Info.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>
    <string>Ronda</string>
    <key>CFBundleDisplayName</key>
    <string>Ronda</string>
    <key>CFBundleIdentifier</key>
    <string>com.ronda.feedreader</string>
    <key>CFBundleVersion</key>
    <string>1.0</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0</string>
    <key>CFBundleExecutable</key>
    <string>Ronda</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>LSMinimumSystemVersion</key>
    <string>12.0</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>NSAppTransportSecurity</key>
    <dict>
        <key>NSAllowsArbitraryLoads</key>
        <true/>
    </dict>
</dict>
</plist>
PLIST

# Generate .icns from PNG
echo "    Generating app icon..."
ICONSET="$BUILD_DIR/AppIcon.iconset"
mkdir -p "$ICONSET"
SRC_ICON="$PROJECT_DIR/icons/icon-512.png"
if [ -f "$SRC_ICON" ]; then
    sips -z 16 16   "$SRC_ICON" --out "$ICONSET/icon_16x16.png"     >/dev/null 2>&1
    sips -z 32 32   "$SRC_ICON" --out "$ICONSET/icon_16x16@2x.png"  >/dev/null 2>&1
    sips -z 32 32   "$SRC_ICON" --out "$ICONSET/icon_32x32.png"     >/dev/null 2>&1
    sips -z 64 64   "$SRC_ICON" --out "$ICONSET/icon_32x32@2x.png"  >/dev/null 2>&1
    sips -z 128 128 "$SRC_ICON" --out "$ICONSET/icon_128x128.png"   >/dev/null 2>&1
    sips -z 256 256 "$SRC_ICON" --out "$ICONSET/icon_128x128@2x.png" >/dev/null 2>&1
    sips -z 256 256 "$SRC_ICON" --out "$ICONSET/icon_256x256.png"   >/dev/null 2>&1
    sips -z 512 512 "$SRC_ICON" --out "$ICONSET/icon_256x256@2x.png" >/dev/null 2>&1
    cp "$SRC_ICON"              "$ICONSET/icon_512x512.png"
    cp "$SRC_ICON"              "$ICONSET/icon_512x512@2x.png"
    iconutil -c icns -o "$APP_BUNDLE/Contents/Resources/AppIcon.icns" "$ICONSET" 2>/dev/null || true
fi

# Clean build dir
rm -rf "$BUILD_DIR"

echo ""
echo "==> Done! $APP_NAME.app created at:"
echo "    $APP_BUNDLE"
echo ""
# Auto-install to /Applications (remove old first to avoid macOS merge cache)
if [ -d "/Applications/$APP_NAME.app" ]; then
    rm -rf "/Applications/$APP_NAME.app"
fi
cp -R "$APP_BUNDLE" "/Applications/$APP_NAME.app"
echo "    Installed to /Applications/$APP_NAME.app"
echo "    To run now: open /Applications/$APP_NAME.app"
