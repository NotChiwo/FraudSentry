package com.fraudsentry.app.background;

import android.content.Context;
import android.content.SharedPreferences;
import java.util.HashSet;
import java.util.Set;

/** The Phone Protection settings and counters (SharedPreferences, on the phone only). */
public final class ProtectionSettings {
    static final String PREFS = "fraudsentry_background";

    private final SharedPreferences p;
    public ProtectionSettings(Context c) { p = c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    public boolean enabled() { return p.getBoolean("enabled", false); }
    public boolean watchAll() { return p.getBoolean("watchAll", false); }
    public boolean screenshots() { return p.getBoolean("screenshots", false); }
    /** the lowest level that posts a warning: "medium", "high" or "critical" */
    public String alertLevel() { return p.getString("alertLevel", "high"); }

    /** the known apps that are watched (the defaults until the user changes them) */
    public Set<String> apps() {
        Set<String> s = p.getStringSet("apps", null);
        if (s != null) return new HashSet<>(s);
        Set<String> d = new HashSet<>();
        for (WatchedApps.App a : WatchedApps.KNOWN.values()) if (a.defaultOn) d.add(a.pkg);
        return d;
    }

    public boolean watches(String pkg) {
        if (WatchedApps.KNOWN.containsKey(pkg)) return apps().contains(pkg);
        return watchAll();
    }

    public void save(Boolean enabled, Set<String> apps, Boolean watchAll, String alertLevel, Boolean screenshots) {
        SharedPreferences.Editor e = p.edit();
        if (enabled != null) e.putBoolean("enabled", enabled);
        if (apps != null) e.putStringSet("apps", new HashSet<>(apps));
        if (watchAll != null) e.putBoolean("watchAll", watchAll);
        if (alertLevel != null && (alertLevel.equals("medium") || alertLevel.equals("high") || alertLevel.equals("critical"))) e.putString("alertLevel", alertLevel);
        if (screenshots != null) e.putBoolean("screenshots", screenshots);
        e.apply();
    }

    public long checked() { return p.getLong("checked", 0); }
    public long flagged() { return p.getLong("flagged", 0); }
    public long alerted() { return p.getLong("alerted", 0); }
    public long lastCheckedAt() { return p.getLong("lastCheckedAt", 0); }

    public void countChecked() { p.edit().putLong("checked", checked() + 1).putLong("lastCheckedAt", System.currentTimeMillis()).apply(); }
    public void countFlagged() { p.edit().putLong("flagged", flagged() + 1).apply(); }
    public void countAlerted() { p.edit().putLong("alerted", alerted() + 1).apply(); }

    /** 0 low, 1 medium, 2 high, 3 critical */
    public static int rank(String level) {
        if ("critical".equals(level)) return 3;
        if ("high".equals(level)) return 2;
        if ("medium".equals(level)) return 1;
        return 0;
    }
}
