package com.fraudsentry.app.background;

import android.content.Context;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Suspicious messages found while the app was closed, waiting to be moved into
 * the app's on-device database the next time it opens (drain). Kept in the
 * app's private storage; ordinary messages are never written here.
 */
public final class ScanQueue {
    private static final String FILE = "background-scans.json";
    private static final int MAX = 500;

    public static synchronized void add(Context c, JSONObject item) {
        JSONArray a = read(c);
        a.put(item);
        while (a.length() > MAX) a.remove(0);
        write(c, a);
    }

    public static synchronized int count(Context c) { return read(c).length(); }

    /** Everything waiting, oldest first; the queue is emptied. */
    public static synchronized JSONArray drain(Context c) {
        JSONArray a = read(c);
        write(c, new JSONArray());
        return a;
    }

    private static JSONArray read(Context c) {
        File f = new File(c.getFilesDir(), FILE);
        if (!f.exists()) return new JSONArray();
        try (FileInputStream in = new FileInputStream(f)) {
            byte[] b = new byte[(int) f.length()];
            int off = 0, n;
            while (off < b.length && (n = in.read(b, off, b.length - off)) > 0) off += n;
            return new JSONArray(new String(b, 0, off, StandardCharsets.UTF_8));
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    private static void write(Context c, JSONArray a) {
        File f = new File(c.getFilesDir(), FILE);
        File tmp = new File(c.getFilesDir(), FILE + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(a.toString().getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            return;
        }
        if (!tmp.renameTo(f)) { f.delete(); tmp.renameTo(f); }
    }

    private ScanQueue() {}
}
