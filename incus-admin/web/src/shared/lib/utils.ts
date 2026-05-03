import type {ClassValue} from "clsx";
import {  clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function fmtBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024));
  const val = bytes / 1024**i;
  return `${val.toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}

export function formatCurrency(amount: number, currency: string = "USD", locale?: string): string {
  const l = locale ?? (typeof navigator !== "undefined" ? navigator.language : "en-US");
  return new Intl.NumberFormat(l, { style: "currency", currency }).format(amount);
}

/**
 * Format an ISO 8601 timestamp into the user's locale string.
 * Returns "—" for null / undefined / empty values.
 *
 * Wrapping `new Date()` in a utility moves the call out of component bodies
 * so React's `react/purity` lint rule does not fire on what is in fact a
 * pure operation.
 */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

/** Like `formatDateTime` but date-only — `new Date(iso).toLocaleDateString()`. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString();
}

/** Time-only — `new Date(iso).toLocaleTimeString()`. */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString();
}

/** First-letter uppercase；空串原样返回。多处 i18n key 拼接用。 */
export function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
