// ============================================================
// FraudSentry — the background message analyzer (Android)
//
// Built into its own small script (vite.analyzer.config.ts →
// dist-offline/analyzer.js, then assets/public/analyzer.js in the APK).
// The Android notification listener (MessageWatcherService.java) loads it
// into a hidden WebView and calls FraudSentryAnalyze() for every incoming
// message, so background checks use EXACTLY the same scam rules as the
// Check Message page — there is no second copy of the rules in Java.
// ============================================================
import { analyzeMessageText } from '../message-check/messageAnalysis';
import type { MessagePlatform } from '../shared/types';

const PLATFORMS: MessagePlatform[] = ['SMS', 'Messenger', 'Facebook', 'WhatsApp', 'Telegram', 'Discord', 'Viber', 'Email', 'Unknown'];

/** Analyze one incoming message; returns the MessageScanResult as JSON. */
export function analyzeForBackground(text: string, platform: string): string {
  const p = (PLATFORMS as string[]).includes(platform) ? (platform as MessagePlatform) : 'Unknown';
  return JSON.stringify(analyzeMessageText(String(text ?? ''), p));
}

(globalThis as unknown as { FraudSentryAnalyze: typeof analyzeForBackground }).FraudSentryAnalyze = analyzeForBackground;
