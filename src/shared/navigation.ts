// Opening extension pages and LinkedIn profiles. No "tabs" permission is needed: we only create
// or update tabs, and find our own dashboard tab via chrome.runtime.getContexts.

export function dashboardUrl(hash = ""): string {
  return chrome.runtime.getURL(`dashboard.html${hash}`);
}

/** Focuses an existing dashboard tab (navigating it to `hash`) or opens a new one. */
export async function openDashboard(hash = ""): Promise<void> {
  const base = chrome.runtime.getURL("dashboard.html");
  try {
    const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.TAB] });
    const existing = contexts.find((c) => c.documentUrl?.startsWith(base) && c.tabId >= 0);
    if (existing) {
      await chrome.tabs.update(existing.tabId, { active: true, ...(hash ? { url: dashboardUrl(hash) } : {}) });
      if (existing.windowId >= 0) await chrome.windows.update(existing.windowId, { focused: true });
      return;
    }
  } catch {
    // Fall through to opening a new tab.
  }
  await chrome.tabs.create({ url: dashboardUrl(hash) });
}

/** Opens a saved profile URL in a new tab. Only stored, normalized LinkedIn URLs are passed here. */
export async function openProfile(normalizedProfileUrl: string): Promise<void> {
  const url = new URL(normalizedProfileUrl);
  if (url.protocol !== "https:" || url.hostname !== "www.linkedin.com" || !url.pathname.startsWith("/in/")) {
    throw new Error("The saved profile URL is not a LinkedIn profile link.");
  }
  await chrome.tabs.create({ url: url.toString(), active: true });
}

export async function requestNotificationPermission(): Promise<boolean> {
  try {
    return await chrome.permissions.request({ permissions: ["notifications"] });
  } catch {
    return false;
  }
}

export async function hasNotificationPermission(): Promise<boolean> {
  try {
    return await chrome.permissions.contains({ permissions: ["notifications"] });
  } catch {
    return false;
  }
}

export async function removeNotificationPermission(): Promise<void> {
  try {
    await chrome.permissions.remove({ permissions: ["notifications"] });
  } catch {
    // Not fatal: the setting is what gates reminders.
  }
}
