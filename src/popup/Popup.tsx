import type { Contact } from "../shared/types";
import { isFollowUpDue } from "../shared/lifecycle";
import { summarize, todayList } from "../shared/selectors";
import { openDashboard } from "../shared/navigation";
import { formatRelative } from "../shared/time";
import { AddContactForm } from "../ui/AddContactForm";
import { ActionsProvider, useActions } from "../ui/ActionDialogs";
import { Brand, Icon, StatusBadges } from "../ui/components";
import { DatabaseProvider, ToastProvider, useDatabase, useNow, useTheme } from "../ui/hooks";

export function Popup() {
  return (
    <ToastProvider>
      <DatabaseProvider>
        <ActionsProvider>
          <PopupBody />
        </ActionsProvider>
      </DatabaseProvider>
    </ToastProvider>
  );
}

async function go(hash: string) {
  await openDashboard(hash);
  window.close();
}

function PopupBody() {
  const { db, loadError, readOnlyReason } = useDatabase();
  const actions = useActions();
  const now = useNow();
  useTheme(db?.settings.theme);

  const summary = db ? summarize(db.contacts, now) : null;
  const attention = db ? todayList(db.contacts, now) : [];

  return (
    <div className="popup">
      <header>
        <Brand compact />
        <button type="button" className="btn btn-sm btn-primary" onClick={() => void go("#/today")}>
          <Icon name="dashboard" size={14} /> Open dashboard
        </button>
      </header>
      <main>
        {loadError && (
          <div className="notice notice-error" role="alert">
            Couldn't load your data: {loadError}
          </div>
        )}
        {readOnlyReason && (
          <div className="notice notice-warning" role="alert">
            {readOnlyReason}
          </div>
        )}
        {summary && (
          <section aria-label="Summary" className="mini-stats">
            <button type="button" className="mini-stat" onClick={() => void go("#/ready")}>
              <strong>{summary.readyToMessage}</strong>
              <span>Ready to message</span>
            </button>
            <button type="button" className="mini-stat" onClick={() => void go("#/followups")}>
              <strong>{summary.followUpsDue}</strong>
              <span>Follow-ups due</span>
            </button>
            <button type="button" className="mini-stat" onClick={() => void go("#/pending")}>
              <strong>{summary.pending}</strong>
              <span>Pending requests</span>
            </button>
          </section>
        )}

        <section aria-labelledby="attention-title" className="stack-sm">
          <div className="row-between">
            <h3 id="attention-title">Needs attention</h3>
            {attention.length > 5 && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => void go("#/today")}>
                See all {attention.length}
              </button>
            )}
          </div>
          {db && attention.length === 0 && (
            <p className="muted small">
              Nothing needs attention right now. When someone accepts your request on LinkedIn, find them under Pending requests and mark
              them accepted.
            </p>
          )}
          <ul className="attention-list">
            {attention.slice(0, 5).map((c) => (
              <AttentionItem key={c.id} contact={c} now={now} onSnooze={() => void actions.snooze(c, 1)} />
            ))}
          </ul>
        </section>

        <details className="disclosure card" open>
          <summary>Add connection</summary>
          <div style={{ marginTop: 12 }}>
            <AddContactForm
              prefillFromActiveTab
              onOpenContact={(c) => void go(`#/contact/${encodeURIComponent(c.id)}`)}
              onMarkAccepted={(c) => actions.open("accept", c)}
            />
          </div>
        </details>
        <p className="small muted">
          Acceptances are confirmed manually. When you open this popup, only the current tab's address and title are used to
          suggest details. LinkedConnect never reads page content or sends anything for you.
        </p>
      </main>
    </div>
  );
}

function AttentionItem({ contact, now, onSnooze }: { contact: Contact; now: Date; onSnooze: () => void }) {
  const due = isFollowUpDue(contact, now);
  return (
    <li className="attention-item">
      <div className="grow">
        <div className="row" style={{ gap: 4 }}>
          {contact.priority && (
            <span title="Starred" style={{ color: "#d97706" }}>
              <Icon name="star" filled size={13} />
              <span className="sr-only">Starred</span>
            </span>
          )}
          <span className="name">{contact.fullName}</span>
        </div>
        <div className="small muted">
          {due && contact.nextFollowUpAt ? `Follow-up due ${formatRelative(contact.nextFollowUpAt, now)}` : "Accepted — send your first message"}
        </div>
        <StatusBadges contact={contact} now={now} showNew={false} />
      </div>
      <div className="stack-sm" style={{ alignItems: "flex-end" }}>
        <button type="button" className="btn btn-sm btn-accent" onClick={() => void go(`#/compose/${encodeURIComponent(contact.id)}`)}>
          Message
        </button>
        {due && (
          <button type="button" className="btn btn-sm" onClick={onSnooze} aria-label={`Snooze ${contact.fullName} one day`}>
            Snooze 1d
          </button>
        )}
      </div>
    </li>
  );
}
