package com.fraudsentry.app.background;

import android.annotation.SuppressLint;
import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONObject;
import org.json.JSONTokener;

/**
 * Runs FraudSentry's own message analyzer (assets/public/analyzer.js, built
 * from src/background/analyzerEntry.ts) in a hidden WebView, so a message that
 * arrives while the app is closed is checked by exactly the same scam rules as
 * the Check Message page. The WebView cannot load anything from the network.
 */
public final class ScamAnalyzer {
    public interface Callback { void done(JSONObject result); }

    private static final String TAG = "FraudSentryAnalyzer";
    private static final long TIMEOUT_MS = 15000;

    private final Context context;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final List<Runnable> waiting = new ArrayList<>();
    private WebView web;
    private boolean ready = false;
    private boolean failed = false;

    public ScamAnalyzer(Context context) { this.context = context.getApplicationContext(); }

    /** Check one message; the callback runs on the main thread (null if it could not be checked). */
    public void analyze(final String text, final String platform, final Callback cb) {
        main.post(() -> {
            if (failed) { cb.done(null); return; }
            Runnable job = () -> run(text, platform, cb);
            if (ready) job.run(); else { waiting.add(job); start(); }
        });
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void start() {
        if (web != null) return;
        String script;
        try { script = readAsset("public/analyzer.js"); }
        catch (Exception e) { Log.e(TAG, "analyzer.js missing", e); fail(); return; }
        web = new WebView(context);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setBlockNetworkLoads(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setDomStorageEnabled(false);
        web.setWebViewClient(new WebViewClient() {
            @Override public void onPageFinished(WebView view, String url) {
                if (ready || failed) return;
                ready = true;
                List<Runnable> jobs = new ArrayList<>(waiting);
                waiting.clear();
                for (Runnable r : jobs) r.run();
            }
        });
        String html = "<!doctype html><html><head><meta charset=\"utf-8\"><script>"
            + script.replace("</script", "<\\/script")
            + "</script></head><body></body></html>";
        web.loadDataWithBaseURL("https://localhost/analyzer/", html, "text/html", "utf-8", null);
        main.postDelayed(() -> { if (!ready) { Log.e(TAG, "analyzer did not load"); fail(); } }, TIMEOUT_MS);
    }

    private void fail() {
        failed = true;
        List<Runnable> jobs = new ArrayList<>(waiting);
        waiting.clear();
        for (Runnable r : jobs) r.run();   // each job answers null once failed
    }

    private void run(String text, String platform, final Callback cb) {
        if (failed || web == null) { cb.done(null); return; }
        final boolean[] answered = { false };
        String js = "(function(){try{return FraudSentryAnalyze(" + JSONObject.quote(text) + "," + JSONObject.quote(platform) + ");}catch(e){return '';}})()";
        web.evaluateJavascript(js, value -> {
            if (answered[0]) return;
            answered[0] = true;
            cb.done(parse(value));
        });
        main.postDelayed(() -> { if (!answered[0]) { answered[0] = true; cb.done(null); } }, TIMEOUT_MS);
    }

    /** evaluateJavascript returns the JSON-encoded string; decode it, then parse the result object. */
    static JSONObject parse(String value) {
        try {
            if (value == null || value.equals("null")) return null;
            Object v = new JSONTokener(value).nextValue();
            if (!(v instanceof String) || ((String) v).isEmpty()) return null;
            return new JSONObject((String) v);
        } catch (Exception e) {
            return null;
        }
    }

    private String readAsset(String path) throws Exception {
        try (InputStream in = context.getAssets().open(path); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    public void destroy() {
        main.post(() -> {
            if (web != null) { web.destroy(); web = null; }
            ready = false;
            failed = false;
        });
    }
}
