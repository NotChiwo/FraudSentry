# Opening FraudSentry on a computer or phone

FraudSentry runs entirely on your own device. Nothing you check is sent anywhere, and you don't need an account.

Every download below is on the [latest release](https://github.com/NotChiwo/FraudSentry/releases/latest) page, under **Assets**.

## 1. Easiest on any computer: the single HTML file

1. Download `FraudSentry-v10.1.0-offline.html` from the release.
2. Double-click it. It opens in your normal browser (Chrome, Edge, Firefox or Safari).

That's it. The text reader is built in, so it works with no internet. Keep a copy on the laptop as a backup in case the venue's Wi-Fi fails.

## 2. Desktop app (Windows, macOS, Linux)

- **Windows:** run `FraudSentry-Setup-….exe` to install, or `FraudSentry-Portable-….exe` to run without installing. The app isn't code-signed, so Windows SmartScreen warns you the first time: choose **More info → Run anyway**.
- **macOS:** download `…-arm64.dmg` for a Mac with an Apple chip (M1 or later), or `…-x64.dmg` for an Intel Mac. Open it and drag FraudSentry to Applications. The app isn't signed by Apple, so the first time **right-click the app → Open → Open**. If macOS still refuses, open **System Settings → Privacy & Security** and click **Open Anyway**.
- **Linux:** make the `.AppImage` executable (`chmod +x FraudSentry-*.AppImage`) and run it.

## 3. Android phone

1. Download `FraudSentry-android.apk` from the release, on the phone itself or on a computer and then copy it over (USB cable, Google Drive, or Messenger to yourself).
2. Tap the file. When Android asks, allow **Install unknown apps** for the app you opened it with (Files, Chrome, Drive), then tap **Install**. If Play Protect warns about an unknown developer, choose **Install anyway**.
3. Open FraudSentry from the home screen. It only asks for the camera, and it has no internet permission at all.

## iPhone and iPad

There is no iPhone app. Open **https://fraudsentry-bscs.netlify.app/** in Safari, then tap **Share → Add to Home Screen** so it opens like an app. Load it once while online; it is the offline build, so checks keep working after that page has loaded.

## Good to know

- Install and open each app on the demo devices before the defense, so the warnings above are already out of the way.
- Each device keeps its own history. Checks done on the phone don't show up on the laptop.
- Every push also builds the apps under **Actions → Apps → Artifacts**, but those expire after 30 days. The release downloads don't expire.
