package com.fraudsentry.app.background;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * The messaging, e-mail and payment apps the background check knows by name,
 * with the platform name the message analyzer uses for each, and whether it
 * is watched by default. Any other app is watched only when the user turns on
 * "Watch all other apps".
 */
public final class WatchedApps {
    public static final class App {
        public final String pkg, label, platform;
        public final boolean defaultOn;
        App(String pkg, String label, String platform, boolean defaultOn) {
            this.pkg = pkg; this.label = label; this.platform = platform; this.defaultOn = defaultOn;
        }
    }

    public static final Map<String, App> KNOWN = new LinkedHashMap<>();
    private static void add(String pkg, String label, String platform, boolean on) { KNOWN.put(pkg, new App(pkg, label, platform, on)); }
    static {
        add("com.google.android.apps.messaging", "Messages (SMS)", "SMS", true);
        add("com.samsung.android.messaging", "Samsung Messages (SMS)", "SMS", true);
        add("com.android.mms", "Messaging (SMS)", "SMS", true);
        add("com.android.messaging", "Messaging (SMS)", "SMS", true);
        add("com.facebook.orca", "Messenger", "Messenger", true);
        add("com.facebook.mlite", "Messenger Lite", "Messenger", true);
        add("com.viber.voip", "Viber", "Viber", true);
        add("org.telegram.messenger", "Telegram", "Telegram", true);
        add("com.whatsapp", "WhatsApp", "WhatsApp", true);
        add("com.whatsapp.w4b", "WhatsApp Business", "WhatsApp", true);
        add("com.google.android.gm", "Gmail", "Email", true);
        add("com.microsoft.office.outlook", "Outlook", "Email", false);
        add("com.facebook.katana", "Facebook", "Facebook", false);
        add("com.instagram.android", "Instagram", "Unknown", false);
        add("com.discord", "Discord", "Discord", false);
        add("jp.naver.line.android", "LINE", "Unknown", false);
        add("com.globe.gcash.android", "GCash", "Unknown", false);
        add("com.paymaya", "Maya", "Unknown", false);
        add("com.shopee.ph", "Shopee", "Unknown", false);
        add("com.lazada.android", "Lazada", "Unknown", false);
    }

    public static String platformOf(String pkg) {
        App a = KNOWN.get(pkg);
        return a == null ? "Unknown" : a.platform;
    }

    private WatchedApps() {}
}
