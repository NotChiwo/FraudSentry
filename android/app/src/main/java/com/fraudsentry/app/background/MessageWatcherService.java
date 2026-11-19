package com.fraudsentry.app.background;

import android.app.Notification;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.os.Parcelable;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import java.util.LinkedHashMap;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Phone Protection: reads the text of new notifications from the watched apps
 * (SMS, Messenger, Viber, …) while FraudSentry is closed, checks each message
 * with the app's own analyzer, and
 *   - posts a warning when it is at or above the chosen risk level, and
 *   - keeps only suspicious messages (Medium or higher) for the app's records.
 * Ordinary messages are checked and forgotten. Nothing leaves the phone: the
 * app has no internet permission. Needs the user to allow Notification access.
 */
public class MessageWatcherService extends NotificationListenerService {
    private static MessageWatcherService current;
    private static final int MIN_LENGTH = 8;

    private final Map<String, Boolean> seen = new LinkedHashMap<String, Boolean>(64, 0.75f, true) {
        @Override protected boolean removeEldestEntry(Map.Entry<String, Boolean> e) { return size() > 300; }
    };
    private ScamAnalyzer analyzer;
    private ScreenshotWatcher screenshots;

    @Override
    public void onListenerConnected() {
        current = this;
        analyzer = new ScamAnalyzer(this);
        screenshots = new ScreenshotWatcher(this);
        refresh();
    }

    @Override
    public void onListenerDisconnected() {
        if (current == this) current = null;
        if (screenshots != null) screenshots.update(false);
        if (analyzer != null) analyzer.destroy();
    }

    /** Settings changed in the app (e.g. screenshots on/off). */
    public static void refreshIfRunning() {
        MessageWatcherService s = current;
        if (s != null) s.refresh();
    }

    public static boolean isConnected() { return current != null; }

    private void refresh() {
        ProtectionSettings s = new ProtectionSettings(this);
        if (screenshots != null) screenshots.update(s.enabled() && s.screenshots());
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        try {
            handle(sbn);
        } catch (Exception ignored) {
            // never let one odd notification stop the watcher
        }
    }

    private void handle(StatusBarNotification sbn) {
        ProtectionSettings settings = new ProtectionSettings(this);
        if (!settings.enabled() || analyzer == null) return;
        final String pkg = sbn.getPackageName();
        if (pkg == null || pkg.equals(getPackageName()) || !settings.watches(pkg)) return;
        Notification n = sbn.getNotification();
        if (n == null || sbn.isOngoing() || (n.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return;
        String cat = n.category;
        if (cat != null && (cat.equals(Notification.CATEGORY_CALL) || cat.equals(Notification.CATEGORY_PROGRESS)
            || cat.equals(Notification.CATEGORY_TRANSPORT) || cat.equals(Notification.CATEGORY_SERVICE) || cat.equals(Notification.CATEGORY_ALARM))) return;

        Bundle x = n.extras;
        if (x == null) return;
        String[] msg = newestMessage(x);
        String text = msg[0];
        String sender = msg[1];
        if (text == null) text = str(x.getCharSequence(Notification.EXTRA_BIG_TEXT));
        if (text == null) text = str(x.getCharSequence(Notification.EXTRA_TEXT));
        if (sender == null) sender = str(x.getCharSequence(Notification.EXTRA_CONVERSATION_TITLE));
        if (sender == null) sender = str(x.getCharSequence(Notification.EXTRA_TITLE));
        if (text == null || text.trim().length() < MIN_LENGTH) return;
        text = text.trim();

        String key = pkg + "|" + text.hashCode();
        if (seen.containsKey(key)) return;
        seen.put(key, Boolean.TRUE);

        final String appName = appLabel(pkg);
        final String from = sender;
        final String platform = WatchedApps.platformOf(pkg);
        analyzer.analyze(text, platform, r -> {
            if (r == null) return;
            ProtectionSettings s = new ProtectionSettings(this);
            s.countChecked();
            String level = r.optString("threatLevel", "low");
            int rank = ProtectionSettings.rank(level);
            if (rank < 1) return;                       // ordinary message: forgotten
            try {
                r.put("origin", "background");
                r.put("sourceApp", appName);
                r.put("sourcePackage", pkg);
                if (from != null) r.put("sender", from);
            } catch (Exception ignored) { }
            ScanQueue.add(this, r);
            s.countFlagged();
            if (rank >= ProtectionSettings.rank(s.alertLevel())) {
                Notifier.warn(this, r.optString("id"), level, r.optString("scamType"), appName, from, firstReason(r), false);
                s.countAlerted();
            }
        });
    }

    /** From a chat-style notification: the newest message's text and sender. */
    private static String[] newestMessage(Bundle x) {
        Parcelable[] ms = x.getParcelableArray(Notification.EXTRA_MESSAGES);
        if (ms == null || ms.length == 0) return new String[] { null, null };
        Parcelable last = ms[ms.length - 1];
        if (!(last instanceof Bundle)) return new String[] { null, null };
        Bundle b = (Bundle) last;
        return new String[] { str(b.getCharSequence("text")), str(b.getCharSequence("sender")) };
    }

    static String firstReason(JSONObject r) {
        JSONArray f = r.optJSONArray("flags");
        if (f != null && f.length() > 0) {
            JSONObject o = f.optJSONObject(0);
            if (o != null && !o.optString("reason").isEmpty()) return o.optString("reason");
        }
        return r.optString("explanation", "");
    }

    private String appLabel(String pkg) {
        WatchedApps.App known = WatchedApps.KNOWN.get(pkg);
        if (known != null) return known.label;
        try {
            PackageManager pm = getPackageManager();
            ApplicationInfo ai = pm.getApplicationInfo(pkg, 0);
            return String.valueOf(pm.getApplicationLabel(ai));
        } catch (Exception e) {
            return pkg;
        }
    }

    private static String str(CharSequence c) {
        if (c == null) return null;
        String s = c.toString();
        return s.isEmpty() ? null : s;
    }
}
