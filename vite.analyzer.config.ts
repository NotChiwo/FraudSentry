// Builds the background message analyzer (src/background/analyzerEntry.ts) as
// one plain script, dist-offline/analyzer.js, next to the offline app. The
// Android app runs it in a hidden WebView to check incoming messages.
// Run after the offline build (it does not empty the folder).
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist-offline",
    emptyOutDir: false,
    copyPublicDir: false,
    lib: { entry: "src/background/analyzerEntry.ts", name: "FraudSentryAnalyzer", formats: ["iife"], fileName: () => "analyzer.js" },
  },
});
