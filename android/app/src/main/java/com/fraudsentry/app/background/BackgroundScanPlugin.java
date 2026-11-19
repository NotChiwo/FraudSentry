package com.fraudsentry.app.background;

import android.Manifest;
import android.app.NotificationManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.HashSet;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The app's side of Phone Protection (window.Capacitor.Plugins.BackgroundScan):
 * status and settings, the permission screens, moving the suspicious messages
 * found in the background into the app (drain), and things shared to the app
 * (Share → FraudSentry, Select text → "Check with FraudSentry", a tapped
 * warning or screenshot offer).
 */
@CapacitorPlugin(
    name = "BackgroundScan",
    permissions = {
        @Permission(alias = "notifications", strings = { "android.permission.POST_NOTIFICATIONS" }),
        @Permission(alias = "photos", strings = { "android.permission.READ_MEDIA_IMAGES" }),
        @Permission(alias = "photosLegacy", strings = { Manifest.permission.READ_EXTERNAL_STORAGE }),
    }
)
public class BackgroundScanPlugin extends Plugin {
    private static final int MAX_IMAGE_BYTES = 15 * 1024 * 1024;
    private static final String SAMPLE_SCAM =
        "GCash: Your account will be suspended today. Verify your identity at http://gcash-verify-ph.xyz/login and enter the OTP we sent.";

    /** What was shared to / opened in the app and not yet taken by the web side. */
    private JSObject pending;
    private Uri pendingImage;
    private ScamAnalyzer analyzer;

    @Override
    public void load() {
        Notifier.channels(getContext());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        String type = intent.getType();
        JSObject p = null;
        if (intent.hasExtra(Notifier.EXTRA_OPEN_MESSAGE)) {
            p = new JSObject().put("type", "open").put("id", intent.getStringExtra(Notifier.EXTRA_OPEN_MESSAGE));
        } else if (intent.hasExtra(Notifier.EXTRA_CHECK_IMAGE)) {
            pendingImage = Uri.parse(intent.getStringExtra(Notifier.EXTRA_CHECK_IMAGE));
            p = new JSObject().put("type", "image").put("name", "screenshot.png");
        } else if (Intent.ACTION_PROCESS_TEXT.equals(action)) {
            CharSequence t = intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT);
            if (t != null) p = new JSObject().put("type", "text").put("text", t.toString());
        } else if (Intent.ACTION_SEND.equals(action) && type != null) {
            if (type.startsWith("text/")) {
                CharSequence t = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
                String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
                if (t != null) p = new JSObject().put("type", "text").put("text", (subject != null && !t.toString().contains(subject) ? subject + "\n" : "") + t);
            } else if (type.startsWith("image/")) {
                Uri u = intent.getParcelableExtra(Intent.EXTRA_STREAM);
                if (u != null) { pendingImage = u; p = new JSObject().put("type", "image").put("name", "shared-image"); }
            }
        }
        if (p == null) return;
        pending = p;
        // handled: don't act on it again if the activity is recreated
        intent.setAction(Intent.ACTION_MAIN);
        intent.removeExtra(Notifier.EXTRA_OPEN_MESSAGE);
        intent.removeExtra(Notifier.EXTRA_CHECK_IMAGE);
        notifyListeners("incoming", new JSObject());
    }

    @PluginMethod
    public void takeShared(PluginCall call) {
        JSObject p = pending;
        Uri img = pendingImage;
        pending = null;
        pendingImage = null;
        if (p == null) { call.resolve(new JSObject()); return; }
        if ("image".equals(p.getString("type")) && img != null) {
            try {
                p.put("imageDataUrl", readImage(img));
            } catch (Exception e) {
                call.resolve(new JSObject().put("type", "error").put("message", "Could not open that image: " + e.getMessage()));
                return;
            }
        }
        call.resolve(p);
    }

    private String readImage(Uri u) throws Exception {
        Context c = getContext();
        String mime = c.getContentResolver().getType(u);
        if (mime == null || !mime.startsWith("image/")) mime = "image/png";
        try (InputStream in = c.getContentResolver().openInputStream(u); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            if (in == null) throw new Exception("not found");
            byte[] buf = new byte[65536];
            int n, total = 0;
            while ((n = in.read(buf)) > 0) {
                total += n;
                if (total > MAX_IMAGE_BYTES) throw new Exception("the image is larger than 15 MB");
                out.write(buf, 0, n);
            }
            return "data:" + mime + ";base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
        }
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        Context c = getContext();
        ProtectionSettings s = new ProtectionSettings(c);
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        JSObject r = new JSObject();
        r.put("supported", true);
        r.put("notificationAccess", hasNotificationAccess(c));
        r.put("listenerConnected", MessageWatcherService.isConnected());
        r.put("notificationsAllowed", nm != null && nm.areNotificationsEnabled());
        r.put("photosAllowed", ScreenshotWatcher.canRead(c));
        r.put("enabled", s.enabled());
        r.put("watchAll", s.watchAll());
        r.put("alertLevel", s.alertLevel());
        r.put("screenshots", s.screenshots());
        r.put("apps", new JSArray(s.apps()));
        r.put("checked", s.checked());
        r.put("flagged", s.flagged());
        r.put("alerted", s.alerted());
        r.put("lastCheckedAt", s.lastCheckedAt());
        r.put("queued", ScanQueue.count(c));
        r.put("sdk", Build.VERSION.SDK_INT);
        call.resolve(r);
    }

    static boolean hasNotificationAccess(Context c) {
        String flat = Settings.Secure.getString(c.getContentResolver(), "enabled_notification_listeners");
        if (flat == null) return false;
        ComponentName me = new ComponentName(c, MessageWatcherService.class);
        for (String part : flat.split(":")) {
            ComponentName cn = ComponentName.unflattenFromString(part);
            if (me.equals(cn)) return true;
        }
        return false;
    }

    @PluginMethod
    public void setConfig(PluginCall call) {
        Set<String> apps = null;
        JSArray a = call.getArray("apps", null);
        if (a != null) {
            apps = new HashSet<>();
            for (int i = 0; i < a.length(); i++) {
                String p = a.optString(i, null);
                if (p != null && WatchedApps.KNOWN.containsKey(p)) apps.add(p);
            }
        }
        new ProtectionSettings(getContext()).save(call.getBoolean("enabled", null), apps, call.getBoolean("watchAll", null),
            call.getString("alertLevel", null), call.getBoolean("screenshots", null));
        MessageWatcherService.refreshIfRunning();
        getStatus(call);
    }

    @PluginMethod
    public void listApps(PluginCall call) {
        PackageManager pm = getContext().getPackageManager();
        Set<String> on = new ProtectionSettings(getContext()).apps();
        JSArray list = new JSArray();
        for (WatchedApps.App a : WatchedApps.KNOWN.values()) {
            boolean installed;
            try { pm.getApplicationInfo(a.pkg, 0); installed = true; } catch (PackageManager.NameNotFoundException e) { installed = false; }
            list.put(new JSObject().put("pkg", a.pkg).put("label", a.label).put("platform", a.platform)
                .put("installed", installed).put("watched", on.contains(a.pkg)).put("defaultOn", a.defaultOn));
        }
        call.resolve(new JSObject().put("apps", list));
    }

    @PluginMethod
    public void openNotificationAccess(PluginCall call) {
        Context c = getContext();
        Intent i = null;
        if (Build.VERSION.SDK_INT >= 30) {
            i = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS)
                .putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, new ComponentName(c, MessageWatcherService.class).flattenToString());
        }
        if (!start(i) && !start(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))) {
            call.reject("Could not open the notification access settings");
            return;
        }
        call.resolve();
    }

    /** App info, for "Allow restricted settings" (Android 13+, app installed from an APK). */
    @PluginMethod
    public void openAppInfo(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
        if (start(i)) call.resolve(); else call.reject("Could not open app info");
    }

    private boolean start(Intent i) {
        if (i == null) return false;
        try {
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getContext().checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
            requestPermissionForAlias("notifications", call, "afterPermission");
            return;
        }
        NotificationManager nm = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null && !nm.areNotificationsEnabled() && Build.VERSION.SDK_INT >= 26) {
            start(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName()));
        }
        getStatus(call);
    }

    @PluginMethod
    public void requestPhotos(PluginCall call) {
        if (ScreenshotWatcher.canRead(getContext())) { afterPermission(call); return; }
        requestPermissionForAlias(Build.VERSION.SDK_INT >= 33 ? "photos" : "photosLegacy", call, "afterPermission");
    }

    @PermissionCallback
    private void afterPermission(PluginCall call) {
        MessageWatcherService.refreshIfRunning();
        getStatus(call);
    }

    /** Move the suspicious messages found in the background into the app. */
    @PluginMethod
    public void drain(PluginCall call) {
        JSONArray items = ScanQueue.drain(getContext());
        try {
            call.resolve(new JSObject().put("items", new JSArray(items.toString())));
        } catch (Exception e) {
            call.resolve(new JSObject().put("items", new JSArray()));
        }
    }

    private ScamAnalyzer analyzer() {
        if (analyzer == null) analyzer = new ScamAnalyzer(getContext());
        return analyzer;
    }

    /** Check a text with the background analyzer now (used by the self-test and the CI smoke test). */
    @PluginMethod
    public void analyzeNow(final PluginCall call) {
        String text = call.getString("text", "");
        String platform = call.getString("platform", "SMS");
        analyzer().analyze(text, platform, r -> {
            if (r == null) call.reject("The background analyzer could not check the message");
            else call.resolve(new JSObject().put("json", r.toString()));
        });
    }

    /** Show what a warning looks like: checks a sample scam text and posts a [Test] warning. Nothing is saved. */
    @PluginMethod
    public void testAlert(final PluginCall call) {
        analyzer().analyze(SAMPLE_SCAM, "SMS", r -> {
            if (r == null) { call.reject("The background analyzer could not check the sample"); return; }
            Notifier.warn(getContext(), "test", r.optString("threatLevel"), r.optString("scamType"), "Messages (SMS)", "GCASH-ALERT",
                MessageWatcherService.firstReason(r), true);
            call.resolve(new JSObject().put("threatLevel", r.optString("threatLevel")).put("scamType", r.optString("scamType")));
        });
    }

    @Override
    protected void handleOnDestroy() {
        if (analyzer != null) analyzer.destroy();
    }
}
