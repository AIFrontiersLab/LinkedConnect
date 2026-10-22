// Prefill for the "Add connection" form. Only the active tab's URL and title are read, and only
// when the user opens the popup (the `activeTab` permission). Page content is never read.

import { normalizeProfileUrl } from "./profileUrl";

/**
 * Suggests a name from a LinkedIn tab title such as "(3) Jane Doe | LinkedIn".
 * Returns "" when the title doesn't look like a profile title; the user always confirms it.
 */
export function nameFromTabTitle(title: string | undefined | null): string {
  if (!title) return "";
  const m = /^(?:\(\d+\+?\)\s*)?(.+?)\s*[|–-]\s*LinkedIn\s*$/i.exec(title.trim());
  const name = m?.[1]?.trim() ?? "";
  if (!name || name.length > 120 || /^(linkedin|feed|messaging|notifications|my network)$/i.test(name)) return "";
  return name;
}

export interface TabPrefill {
  profileUrl: string;
  fullName: string;
}

export function prefillFromTab(tab: { url?: string; title?: string } | undefined): TabPrefill | null {
  if (!tab?.url) return null;
  const url = normalizeProfileUrl(tab.url);
  if (!url.ok) return null;
  return { profileUrl: url.normalized, fullName: nameFromTabTitle(tab.title) };
}

export async function readActiveTabPrefill(): Promise<TabPrefill | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return prefillFromTab(tab);
  } catch {
    return null;
  }
}

// ---- Unsaved form draft (survives the popup closing; cleared when Chrome restarts) ----

const FORM_DRAFT_KEY = "lmc:addContactDraft";

function sessionArea(): chrome.storage.StorageArea | null {
  return typeof chrome !== "undefined" && chrome.storage?.session ? chrome.storage.session : null;
}

export async function loadFormDraft<T>(): Promise<T | null> {
  try {
    const area = sessionArea();
    if (!area) return null;
    const out = await area.get(FORM_DRAFT_KEY);
    return (out[FORM_DRAFT_KEY] as T | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function saveFormDraft<T>(draft: T | null): Promise<void> {
  try {
    const area = sessionArea();
    if (!area) return;
    if (draft === null) await area.remove(FORM_DRAFT_KEY);
    else await area.set({ [FORM_DRAFT_KEY]: draft });
  } catch {
    // A draft is a convenience; failing to save it must not block the form.
  }
}

// ---- Hand-off from the right-click menu to the popup / dashboard form ----

export const PENDING_PREFILL_KEY = "lmc:pendingPrefill";
const PENDING_KEY = PENDING_PREFILL_KEY;
const PENDING_MAX_AGE_MS = 2 * 60 * 1000;

export interface PendingPrefill {
  profileUrl: string;
  /** Name suggested from the tab title (only when the page itself is the profile). */
  titleName: string;
  selectionText: string;
  createdAt: number;
  /** Set for "Use highlighted text as company/role": fill just that field. */
  field?: "company" | "role";
}

export async function savePendingPrefill(p: PendingPrefill): Promise<void> {
  await sessionArea()?.set({ [PENDING_KEY]: p });
}

/** Returns and removes a recent right-click hand-off, if any. */
export async function takePendingPrefill(): Promise<PendingPrefill | null> {
  try {
    const area = sessionArea();
    if (!area) return null;
    const out = await area.get(PENDING_KEY);
    const p = out[PENDING_KEY] as PendingPrefill | undefined;
    if (!p) return null;
    await area.remove(PENDING_KEY);
    return Date.now() - p.createdAt <= PENDING_MAX_AGE_MS ? p : null;
  } catch {
    return null;
  }
}
