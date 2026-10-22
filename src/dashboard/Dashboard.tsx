import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { summarize } from "../shared/selectors";
import { ActionsProvider, useActions } from "../ui/ActionDialogs";
import { AddContactForm } from "../ui/AddContactForm";
import { Brand, Dialog, Icon } from "../ui/components";
import { DatabaseProvider, ToastProvider, useDatabase, useNow, useTheme } from "../ui/hooks";
import { updateSettings } from "../shared/actions";
import { ContactDrawer } from "./ContactDrawer";
import { ContactsView } from "./ContactsView";
import { SettingsView } from "./SettingsView";
import { TemplatesView } from "./TemplatesView";
import { TodayView } from "./TodayView";

export const TABS = [
  { id: "today", label: "Today" },
  { id: "all", label: "All contacts" },
  { id: "pending", label: "Pending requests" },
  { id: "ready", label: "Ready to message" },
  { id: "followups", label: "Follow-ups" },
  { id: "archived", label: "Archived" },
  { id: "templates", label: "Templates" },
  { id: "settings", label: "Settings" },
] as const;
export type TabId = (typeof TABS)[number]["id"];

interface Route {
  tab: TabId;
  contactId: string | null;
  composeId: string | null;
  add?: boolean;
}

function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "contact" && parts[1]) return { tab: "all", contactId: parts[1], composeId: null };
  if (parts[0] === "add") return { tab: "today", contactId: null, composeId: null, add: true };
  if (parts[0] === "compose" && parts[1]) return { tab: "today", contactId: null, composeId: parts[1] };
  const tab = (TABS.find((t) => t.id === parts[0])?.id ?? "today") as TabId;
  const contactId = parts[1] === "contact" && parts[2] ? parts[2] : null;
  return { tab, contactId, composeId: null };
}

function useRoute() {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const onHash = () => setRoute(parseHash(location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const navigate = useCallback((hash: string) => {
    if (location.hash !== hash) location.hash = hash;
    else setRoute(parseHash(hash));
  }, []);
  return { route, navigate };
}

export function Dashboard() {
  const { route, navigate } = useRoute();
  return (
    <ToastProvider>
      <DatabaseProvider>
        <ActionsProvider onDeleted={() => navigate(`#/${route.tab}`)}>
          <DashboardBody route={route} navigate={navigate} />
        </ActionsProvider>
      </DatabaseProvider>
    </ToastProvider>
  );
}

function DashboardBody({ route, navigate }: { route: Route; navigate: (hash: string) => void }) {
  const { db, loadError, readOnlyReason, notes, run } = useDatabase();
  const actions = useActions();
  const now = useNow();
  const [adding, setAdding] = useState(false);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  useTheme(db?.settings.theme);

  // "#/compose/<id>" (from the popup) opens the composer once the data is loaded.
  useEffect(() => {
    if (!route.composeId || !db) return;
    const c = db.contacts.find((x) => x.id === route.composeId);
    navigate("#/today");
    if (c) actions.open("compose", c);
  }, [route.composeId, db, actions, navigate]);

  // "#/add" (right-click fallback when the popup can't open) opens the Add form.
  useEffect(() => {
    if (!route.add) return;
    navigate("#/today");
    setAdding(true);
  }, [route.add, navigate]);

  useEffect(() => {
    const label = TABS.find((t) => t.id === route.tab)?.label ?? "";
    document.title = `${label} · LinkedConnect`;
  }, [route.tab]);

  const openContact = useCallback((id: string) => navigate(`#/${route.tab}/contact/${encodeURIComponent(id)}`), [navigate, route.tab]);
  const closeContact = useCallback(() => navigate(`#/${route.tab}`), [navigate, route.tab]);
  const setTab = (tab: TabId) => navigate(`#/${tab}`);

  function onTabKey(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = -1;
    if (e.key === "ArrowRight") next = (index + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    tabRefs.current[next]?.focus();
    setTab(TABS[next]!.id);
  }

  const summary = db ? summarize(db.contacts, now) : null;
  const counts: Partial<Record<TabId, number>> = summary
    ? { today: summary.actionable, pending: summary.pending, ready: summary.readyToMessage, followups: summary.followUpsDue }
    : {};
  const theme = db?.settings.theme ?? "system";
  const nextTheme = theme === "system" ? "dark" : theme === "dark" ? "light" : "system";

  return (
    <div className="app">
      <header className="app-header">
        <Brand />
        <div className="row">
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => void run((d) => updateSettings(d, { theme: nextTheme }))}
            aria-label={`Theme: ${theme}. Switch to ${nextTheme}.`}
            title={`Theme: ${theme}`}
          >
            <Icon name={theme === "dark" ? "moon" : "sun"} /> {theme === "system" ? "Auto" : theme === "dark" ? "Dark" : "Light"}
          </button>
          <button type="button" className="btn btn-accent" onClick={() => setAdding(true)} disabled={!!readOnlyReason}>
            <Icon name="plus" /> Add connection
          </button>
        </div>
      </header>

      <main className="app-main">
        {loadError && (
          <div className="notice notice-error" role="alert">
            Couldn't load your data: {loadError}. Nothing has been changed. Try reloading this page.
          </div>
        )}
        {readOnlyReason && (
          <div className="notice notice-warning" role="alert">
            {readOnlyReason}
          </div>
        )}
        {notes.length > 0 && (
          <div className="notice notice-warning" role="status">
            Some stored records were invalid and were set aside (not deleted). See Settings → Data &amp; storage.
          </div>
        )}

        {summary && (
          <section className="summary-cards" aria-label="Summary">
            <SummaryCard label="Requests pending" value={summary.pending} dot="var(--s-request-dot)" onClick={() => setTab("pending")} />
            <SummaryCard label="Accepted, message pending" value={summary.readyToMessage} dot="var(--s-accepted-dot)" onClick={() => setTab("ready")} />
            <SummaryCard label="Follow-ups due" value={summary.followUpsDue} dot="var(--s-due-dot)" onClick={() => setTab("followups")} />
            <SummaryCard label="Replied" value={summary.replied} dot="var(--s-replied-dot)" onClick={() => setTab("all")} />
            <SummaryCard label="Total active contacts" value={summary.active} dot="var(--teal-500)" onClick={() => setTab("all")} />
          </section>
        )}

        <nav className="tabs" role="tablist" aria-label="Dashboard sections">
          {TABS.map((t, i) => (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              id={`tab-${t.id}`}
              role="tab"
              type="button"
              className="tab"
              aria-selected={route.tab === t.id}
              aria-controls="tabpanel"
              tabIndex={route.tab === t.id ? 0 : -1}
              onClick={() => setTab(t.id)}
              onKeyDown={(e) => onTabKey(e, i)}
            >
              {t.label}
              {counts[t.id] ? (
                <span className="count" aria-label={`${counts[t.id]} items`}>
                  {counts[t.id]}
                </span>
              ) : null}
            </button>
          ))}
        </nav>

        <section id="tabpanel" role="tabpanel" aria-labelledby={`tab-${route.tab}`} className="stack" tabIndex={-1}>
          {!db ? (
            <p className="muted">Loading…</p>
          ) : route.tab === "today" ? (
            <TodayView now={now} onOpenContact={openContact} onAdd={() => setAdding(true)} onTab={setTab} />
          ) : route.tab === "templates" ? (
            <TemplatesView />
          ) : route.tab === "settings" ? (
            <SettingsView />
          ) : (
            <ContactsView key={route.tab} tab={route.tab} now={now} onOpenContact={openContact} onAdd={() => setAdding(true)} />
          )}
        </section>
      </main>

      {db && route.contactId && <ContactDrawer contactId={route.contactId} now={now} onClose={closeContact} />}

      <Dialog open={adding} onClose={() => setAdding(false)} title="Add connection" description="Track a connection request you've already sent on LinkedIn.">
        <AddContactForm
          autoFocus
          onOpenContact={(c) => {
            setAdding(false);
            openContact(c.id);
          }}
          onMarkAccepted={(c) => {
            setAdding(false);
            actions.open("accept", c);
          }}
        />
      </Dialog>
    </div>
  );
}

function SummaryCard({ label, value, dot, onClick }: { label: string; value: number; dot: string; onClick: () => void }) {
  return (
    <button type="button" className="summary-card" style={{ ["--dot" as string]: dot }} onClick={onClick}>
      <strong>{value}</strong>
      <span>{label}</span>
    </button>
  );
}
