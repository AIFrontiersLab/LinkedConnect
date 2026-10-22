// Manifest V3 service worker. It holds no long-lived state: every wake-up re-reads
// chrome.storage.local and reconciles the badge, the next alarm and desktop notifications.
// Listeners are registered synchronously at top level so Chrome can wake the worker for them.

import { getRepository, subscribeToDatabase } from "../shared/storage";
import { countActionable, isFollowUpDue, isReadyForInitialMessage } from "../shared/lifecycle";
import {
  NOTIFICATION_PREFIX_CONTACT,
  NOTIFICATION_SUMMARY,
  badgeText,
  nextReminderTime,
  planNotifications,
  type PlannedNotification,
} from "../shared/reminders";
import { hasNotificationPermission, openDashboard } from "../shared/navigation";
import { nameFromTabTitle, savePendingPrefill, type PendingPrefill } from "../shared/tabPrefill";
import { normalizeProfileUrl } from "../shared/profileUrl";
import type { Database } from "../shared/types";

const ALARM_NEXT = "lmc-next-reminder";
const ALARM_SWEEP = "lmc-sweep";
const SWEEP_MINUTES = 30;
const BADGE_COLOR = "#C2410C";

let running: Promise<void> | null = null;
let rerun = false;

/** Coalesces bursts of triggers (e.g. several storage writes) into at most one queued rerun. */
function reconcile(reason: string): Promise<void> {
  if (running) {
    rerun = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        rerun = false;
        await reconcileOnce(reason);
      } while (rerun);
    } catch (err) {
      console.error("[LinkedMaven] reconcile failed", reason, err);
    } finally {
      running = null;
    }
  })();
  return running;
}

async function reconcileOnce(reason: string) {
  const repo = getRepository();
  const loaded = await repo.load();
  const now = new Date();
  await updateBadge(loaded.db, now);
  await scheduleNextAlarm(loaded.db, now);
  if (loaded.readOnlyReason) return;

  const notificationsOn = loaded.db.settings.desktopReminders && !!chrome.notifications && (await hasNotificationPermission());
  if (!notificationsOn) return;

  const preview = planNotifications(loaded.db.contacts, loaded.db.reminders.notifiedKeys, now);
  const keysChanged = preview.notifiedKeys.join() !== loaded.db.reminders.notifiedKeys.join();
  if (!preview.notification && !keysChanged) return; // avoid writes that would retrigger onChanged

  // Re-plan under the lock so concurrent wake-ups never notify the same reminder twice.
  const { result: toShow } = await repo.mutate((db, at) => {
    const plan = planNotifications(db.contacts, db.reminders.notifiedKeys, at);
    db.reminders.notifiedKeys = plan.notifiedKeys;
    db.reminders.lastReconciledAt = at.toISOString();
    return plan.notification;
  });
  if (toShow) await showNotification(toShow, reason);
}

async function updateBadge(db: Database, now: Date) {
  const count = countActionable(db.contacts, now);
  const due = db.contacts.filter((c) => isFollowUpDue(c, now)).length;
  const ready = db.contacts.filter(isReadyForInitialMessage).length;
  await chrome.action.setBadgeText({ text: badgeText(count) });
  await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
  if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: "#FFFFFF" });
  await chrome.action.setTitle({
    title:
      count === 0
        ? "LinkedMaven Connect: nothing needs attention"
        : `LinkedMaven Connect: ${count} contact${count === 1 ? "" : "s"} need attention (${ready} ready to message, ${due} follow-up${due === 1 ? "" : "s"} due)`,
  });
}

async function scheduleNextAlarm(db: Database, now: Date) {
  const next = nextReminderTime(db.contacts, now);
  const existing = await chrome.alarms.get(ALARM_NEXT);
  if (next === null) {
    if (existing) await chrome.alarms.clear(ALARM_NEXT);
    return;
  }
  if (!existing || Math.abs(existing.scheduledTime - next) > 1000) {
    await chrome.alarms.create(ALARM_NEXT, { when: next });
  }
}

async function ensureSweepAlarm() {
  // A periodic safety net: keeps the badge right across day changes and alarm loss after restarts.
  const existing = await chrome.alarms.get(ALARM_SWEEP);
  if (!existing) await chrome.alarms.create(ALARM_SWEEP, { periodInMinutes: SWEEP_MINUTES, delayInMinutes: 1 });
}

async function showNotification(n: PlannedNotification, reason: string) {
  try {
    // Replace any earlier summary rather than stacking alerts.
    if (n.id === NOTIFICATION_SUMMARY) await chrome.notifications.clear(NOTIFICATION_SUMMARY);
    await chrome.notifications.create(n.id, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
      title: n.title,
      message: n.message,
      contextMessage: "LinkedMaven Connect",
      priority: 1,
    });
  } catch (err) {
    console.warn("[LinkedMaven] notification failed", reason, err);
  }
}

function notificationTarget(id: string): string {
  if (id.startsWith(NOTIFICATION_PREFIX_CONTACT)) {
    return `#/contact/${encodeURIComponent(id.slice(NOTIFICATION_PREFIX_CONTACT.length))}`;
  }
  return "#/followups";
}

let notificationListenersAdded = false;
function addNotificationListeners() {
  if (notificationListenersAdded || !chrome.notifications?.onClicked) return;
  notificationListenersAdded = true;
  chrome.notifications.onClicked.addListener((id) => {
    if (!id.startsWith(NOTIFICATION_PREFIX_CONTACT) && id !== NOTIFICATION_SUMMARY) return;
    void chrome.notifications.clear(id);
    void openDashboard(notificationTarget(id));
  });
}

// ---- Right-click "Add to LinkedMaven Connect" ----
// Chrome passes only the page/link URL and the text the user highlighted; the page is never read.

const MENU_ID = "lmc-add-contact";

function createContextMenu() {
  // One item for LinkedIn pages: works on a profile page (highlighted text or anywhere) and on
  // profile links elsewhere on LinkedIn (search results, "More profiles", ...).
  const documentUrlPatterns = ["https://*.linkedin.com/*", "https://linkedin.com/*"];
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_ID, title: "Add to LinkedMaven Connect", contexts: ["selection", "page", "link"], documentUrlPatterns });
    // Headlines often don't name the company; highlight it (e.g. the company box) and send it to the field.
    chrome.contextMenus.create({ id: `${MENU_ID}:company`, title: "Use highlighted text as company", contexts: ["selection"], documentUrlPatterns });
    chrome.contextMenus.create({ id: `${MENU_ID}:role`, title: "Use highlighted text as role", contexts: ["selection"], documentUrlPatterns });
  });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const menuId = String(info.menuItemId);
  if (!menuId.startsWith(MENU_ID)) return;
  const field: PendingPrefill["field"] = menuId === `${MENU_ID}:company` ? "company" : menuId === `${MENU_ID}:role` ? "role" : undefined;
  const page = normalizeProfileUrl(info.pageUrl ?? "");
  const link = info.linkUrl ? normalizeProfileUrl(info.linkUrl) : null;
  // A link to a different profile wins; a link to this same profile counts as the page.
  const otherProfileLink = link?.ok && (!page.ok || link.normalized !== page.normalized) ? link.normalized : null;
  const pending = {
    profileUrl: otherProfileLink ?? (page.ok ? page.normalized : ""),
    // The tab title names the profile you're on, not a profile you right-clicked a link to.
    titleName: otherProfileLink ? "" : nameFromTabTitle(tab?.title),
    selectionText: info.selectionText ?? "",
    createdAt: Date.now(),
    ...(field ? { field } : {}),
  };
  // openPopup must be called synchronously within the click; fall back to the dashboard.
  const opened = chrome.action.openPopup ? chrome.action.openPopup().then(() => true, () => false) : Promise.resolve(false);
  void savePendingPrefill(pending).then(async () => {
    if (!(await opened)) await openDashboard("#/add");
  });
});

// ---- Top-level listener registration ----

chrome.runtime.onInstalled.addListener(async (details) => {
  createContextMenu();
  // Writing once applies schema migrations and seeds starter templates on first install.
  try {
    await getRepository().mutate(() => undefined);
  } catch (err) {
    console.error("[LinkedMaven] initial migration failed", err);
  }
  await ensureSweepAlarm();
  await reconcile(`installed:${details.reason}`);
});

chrome.runtime.onStartup.addListener(async () => {
  // Reminders that came due while Chrome was closed are reconciled here.
  await ensureSweepAlarm();
  await reconcile("startup");
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NEXT || alarm.name === ALARM_SWEEP) void reconcile(`alarm:${alarm.name}`);
});

subscribeToDatabase(() => void reconcile("storage"));

chrome.permissions.onAdded.addListener((p) => {
  if (p.permissions?.includes("notifications")) {
    addNotificationListeners();
    void reconcile("permission-added");
  }
});

chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
  if (typeof msg === "object" && msg && (msg as { type?: string }).type === "reconcile") {
    void reconcile("message").then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});

addNotificationListeners();
// Service worker restarts: refresh derived state on every wake.
void ensureSweepAlarm();
void reconcile("worker-start");
