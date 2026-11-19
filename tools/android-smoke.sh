#!/usr/bin/env bash
# CI smoke test of the Android app on an emulator: install, launch, then drive
# the WebView through its debugging socket (debug builds only) to check that
# FraudSentry loaded from inside the app and opens to Home; then Phone
# Protection end to end: allow Notification access, post a scam notification
# and expect it to be checked, kept and warned about; share a text to the app
# and expect it checked at once. Usage: tools/android-smoke.sh app.apk
set -euo pipefail
APK="$1"; PKG=com.fraudsentry.app
adb install -r "$APK"
adb shell pm grant "$PKG" android.permission.CAMERA || true
adb shell pm grant "$PKG" android.permission.POST_NOTIFICATIONS || true
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
# the app's page (not Phone Protection's hidden analyzer page, https://localhost/analyzer/)
page_ws() {
  curl -s http://127.0.0.1:9222/json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s).find(x=>x.url.startsWith("https://localhost")&&!x.url.includes("/analyzer/"));console.log(p.webSocketDebuggerUrl)})'
}
node tools/android-cdp-check.mjs "$(page_ws)" home

# Phone Protection: a scam notification from another app is checked in the background
adb shell cmd notification allow_listener "$PKG/$PKG.background.MessageWatcherService"
sleep 4
adb shell cmd notification post -S bigtext -t GCASH-ALERT fs_smoke "'GCash: Your account will be suspended today. Verify your identity at http://gcash-verify-ph.xyz/login and enter the OTP we sent.'"
node tools/android-cdp-check.mjs "$(page_ws)" watched
WARN=$(adb shell dumpsys notification --noredact | grep -c "Possible" || true)
echo "FraudSentry warnings posted: $WARN"
[ "$WARN" -ge 1 ] || { echo "no scam warning was posted"; adb shell dumpsys notification --noredact | grep -A3 fraudsentry | head -60; exit 1; }
adb exec-out screencap -p > android-smoke-protection.png || true

# Share → FraudSentry: shared text is checked at once
adb shell am start -W -n "$PKG/.MainActivity" -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT "'BDO: Your account is locked. Click this link to update your details: http://bdo-online-support.top/verify'"
sleep 2
node tools/android-cdp-check.mjs "$(page_ws)" shared
adb exec-out screencap -p > android-smoke.png || true
echo "Android smoke test passed"
