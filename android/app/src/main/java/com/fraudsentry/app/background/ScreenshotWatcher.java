package com.fraudsentry.app.background;

import android.content.Context;
import android.content.pm.PackageManager;
import android.database.ContentObserver;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;

/**
 * Notices a new screenshot (only while Phone Protection and "Offer to check new
 * screenshots" are on, and photo access is allowed) and posts a notification
 * offering to check it. Nothing is read or uploaded unless the user taps it.
 */
public final class ScreenshotWatcher extends ContentObserver {
    private static final long RECENT_SECONDS = 20;

    private final Context context;
    private boolean registered = false;
    private long lastOffered = -1;

    public ScreenshotWatcher(Context context) {
        super(new Handler(Looper.getMainLooper()));
        this.context = context.getApplicationContext();
    }

    public void update(boolean on) {
        if (on && !registered && canRead(context)) {
            context.getContentResolver().registerContentObserver(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, true, this);
            registered = true;
        } else if (!on && registered) {
            context.getContentResolver().unregisterContentObserver(this);
            registered = false;
        }
    }

    public static boolean canRead(Context c) {
        String p = Build.VERSION.SDK_INT >= 33 ? "android.permission.READ_MEDIA_IMAGES" : "android.permission.READ_EXTERNAL_STORAGE";
        return c.checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onChange(boolean selfChange, Uri uri) {
        ProtectionSettings s = new ProtectionSettings(context);
        if (!s.enabled() || !s.screenshots()) return;
        String[] cols = Build.VERSION.SDK_INT >= 29
            ? new String[] { MediaStore.Images.Media._ID, MediaStore.Images.Media.DISPLAY_NAME, MediaStore.Images.Media.DATE_ADDED, MediaStore.Images.Media.RELATIVE_PATH }
            : new String[] { MediaStore.Images.Media._ID, MediaStore.Images.Media.DISPLAY_NAME, MediaStore.Images.Media.DATE_ADDED, MediaStore.Images.Media.DATA };
        try (Cursor c = context.getContentResolver().query(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, cols, null, null, MediaStore.Images.Media.DATE_ADDED + " DESC")) {
            if (c == null || !c.moveToFirst()) return;
            long id = c.getLong(0);
            String name = c.getString(1);
            long added = c.getLong(2);
            String path = c.getString(3);
            if (id == lastOffered) return;
            if (System.currentTimeMillis() / 1000 - added > RECENT_SECONDS) return;
            String where = ((name == null ? "" : name) + " " + (path == null ? "" : path)).toLowerCase();
            if (!where.contains("screenshot")) return;
            lastOffered = id;
            Uri item = Uri.withAppendedPath(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, String.valueOf(id));
            Notifier.offerScreenshot(context, item.toString());
        } catch (Exception ignored) {
            // no photo access, or the media store is busy: skip this one
        }
    }
}
