// ============================================================
// FraudSentry — Utility Helpers
// ============================================================
import { RiskLevel } from '../types';

export function formatPHP(amount: number): string {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2 }).format(amount);
}
export function formatNumber(num: number): string {
  return new Intl.NumberFormat('en-US').format(num);
}
export function formatPercentage(value: number, decimals = 1): string {
  return `${(value * 100).toFixed(decimals)}%`;
}
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024, sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
export function formatRelativeTime(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return new Date(timestamp).toLocaleDateString('en-PH');
}
export function formatDateTime(timestamp: string): string {
  return new Date(timestamp).toLocaleString('en-PH', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export const RISK_META: Record<RiskLevel, { label: string; hex: string; soft: string }> = {
  low:      { label: 'Low Risk',      hex: '#10b981', soft: 'rgba(16,185,129,0.12)' },
  medium:   { label: 'Medium Risk',   hex: '#f59e0b', soft: 'rgba(245,158,11,0.12)' },
  high:     { label: 'High Risk',     hex: '#fb923c', soft: 'rgba(251,146,60,0.12)' },
  critical: { label: 'Critical Risk', hex: '#ef4444', soft: 'rgba(239,68,68,0.12)' },
};

export function scoreToRiskLevel(score: number): RiskLevel {
  if (score >= 0.7) return 'critical';
  if (score >= 0.45) return 'high';
  if (score >= 0.22) return 'medium';
  return 'low';
}
export const RISK_RANK: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };
export function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_RANK[a] >= RISK_RANK[b] ? a : b;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
export function generateId(prefix = 'id'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
export function downloadBlob(content: BlobPart, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
export const CHART_COLORS = {
  primary: '#2563eb', secondary: '#6366f1', success: '#10b981',
  warning: '#f59e0b', danger: '#ef4444', info: '#3b82f6',
};
