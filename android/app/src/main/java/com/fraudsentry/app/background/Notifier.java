package com.fraudsentry.app.background;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import com.fraudsentry.app.MainActivity;

/** The warnings FraudSentry posts: a possible scam message, and "check this new screenshot?". */
public final class Notifier {
    public static final String CH_WARNINGS = "scam_warnings";
    public static final String CH_SCREENSHOTS = "screenshots";
    public static final String EXTRA_OPEN_MESSAGE = "fs_open_message";
    public static final String EXTRA_CHECK_IMAGE = "fs_check_image";

    static void channels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        NotificationChannel w = new NotificationChannel(CH_WARNINGS, "Scam warnings", NotificationManager.IMPORTANCE_HIGH);
        w.setDescription("A message you received looks like a scam or phishing.");
        nm.createNotificationChannel(w);
        NotificationChannel s = new NotificationChannel(CH_SCREENSHOTS, "Screenshot checks", NotificationManager.IMPORTANCE_DEFAULT);
        s.setDescription("Offers to check a new screenshot of a payment receipt.");
        nm.createNotificationChannel(s);
    }

    @SuppressWarnings("deprecation")
    private static Notification.Builder builder(Context c, String channel) {
        channels(c);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, channel) : new Notification.Builder(c);
        if (Build.VERSION.SDK_INT < 26) b.setPriority(CH_WARNINGS.equals(channel) ? Notification.PRIORITY_HIGH : Notification.PRIORITY_DEFAULT);
        return b.setSmallIcon(android.R.drawable.ic_dialog_alert).setAutoCancel(true);
    }

    private static PendingIntent open(Context c, String extra, String value) {
        Intent i = new Intent(c, MainActivity.class)
            .setAction(Intent.ACTION_VIEW)
            .putExtra(extra, value)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(c, (extra + value).hashCode(), i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /** "Possible phishing — in Messages from 0917…: <first reason>". Tapping opens the result. */
    public static void warn(Context c, String messageId, String level, String scamType, String app, String sender, String reason, boolean test) {
        String what = scamType == null || scamType.isEmpty() || scamType.equals("None Detected") ? "Suspicious message" : "Possible " + scamType.toLowerCase();
        String title = (test ? "[Test] " : "") + what + " (" + level + " risk)";
        StringBuilder body = new StringBuilder("In ").append(app);
        if (sender != null && !sender.isEmpty()) body.append(" from ").append(sender);
        if (reason != null && !reason.isEmpty()) body.append(": ").append(reason);
        String more = body + "\nDon't click its links, reply, or send money or an OTP. Tap to see why FraudSentry flagged it.";
        Notification n = builder(c, CH_WARNINGS)
            .setContentTitle(title)
            .setContentText(body.toString())
            .setStyle(new Notification.BigTextStyle().bigText(more))
            .setCategory(Notification.CATEGORY_MESSAGE)
            .setContentIntent(open(c, EXTRA_OPEN_MESSAGE, messageId == null ? "" : messageId))
            .build();
        post(c, ("w" + messageId).hashCode(), n);
    }

    public static void offerScreenshot(Context c, String uri) {
        Notification n = builder(c, CH_SCREENSHOTS)
            .setContentTitle("New screenshot — is it a payment receipt?")
            .setContentText("Tap to check it with FraudSentry.")
            .setContentIntent(open(c, EXTRA_CHECK_IMAGE, uri))
            .build();
        post(c, 7001, n);
    }

    private static void post(Context c, int id, Notification n) {
        try {
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null && nm.areNotificationsEnabled()) nm.notify(id, n);
        } catch (SecurityException ignored) {
            // notifications not allowed: the flagged message is still saved for the app
        }
    }

    private Notifier() {}
}
