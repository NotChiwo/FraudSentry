#!/usr/bin/env bash
# CI smoke test of the Android app on an emulator: install, launch, then drive
# the WebView through its debugging socket (debug builds only) to check that
# FraudSentry loaded from inside the app and opens to Home. Usage: tools/android-smoke.sh app.apk
set -euo pipefail
APK="$1"; PKG=com.fraudsentry.app
adb install -r "$APK"
adb shell pm grant "$PKG" android.permission.CAMERA || true
adb logcat -c || true
adb shell am start -W -n "$PKG/.MainActivity"
PID=""
for i in $(seq 1 30); do PID=$(adb shell pidof "$PKG" | tr -d '\r' || true); [ -n "$PID" ] && break; sleep 1; done
[ -n "$PID" ] || { echo "the app is not running"; adb logcat -d | tail -200; exit 1; }
adb forward tcp:9222 "localabstract:webview_devtools_remote_$PID"
PAGES=""
for i in $(seq 1 45); do PAGES=$(curl -s http://127.0.0.1:9222/json || true); echo "$PAGES" | grep -q 'https://localhost' && break; sleep 2; done
echo "$PAGES"
echo "$PAGES" | grep -q 'https://localhost' || { echo "the FraudSentry page did not load"; adb logcat -d | grep -iE 'chromium|capacitor' | tail -100; exit 1; }
node tools/android-cdp-check.mjs "$(echo "$PAGES" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s).find(x=>x.url.startsWith("https://localhost"));console.log(p.webSocketDebuggerUrl)})')"
adb exec-out screencap -p > android-smoke.png || true
echo "Android smoke test passed"
