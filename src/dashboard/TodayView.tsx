import type { Contact } from "../shared/types";
import { CATEGORY_LABELS } from "../shared/types";
import { isFollowUpDue, isNewSinceReview, isReadyForInitialMessage } from "../shared/lifecycle";
import { summarize, todayList } from "../shared/selectors";
import { markReviewed } from "../shared/actions";
import { formatRelative, formatTimestamp } from "../shared/time";
import { useActions } from "../ui/ActionDialogs";
import { EmptyState, Icon, StatusBadges } from "../ui/components";
import { useDatabase } from "../ui/hooks";
import { PrimaryAction, SnoozeButtons } from "./ContactRowActions";
import type { TabId } from "./Dashboard";

export function TodayView({
  now,
  onOpenContact,
  onAdd,
  onTab,
}: {
  now: Date;
  onOpenContact: (id: string) => void;
  onAdd: () => void;
  onTab: (tab: TabId) => void;
}) {
  const { db, tz, run } = useDatabase();
  const contacts = db!.contacts;
  const list = todayList(contacts, now);
  const fresh = contacts.filter(isNewSinceReview);
  const summary = summarize(contacts, now);
  const upcoming = contacts
    .filter((c) => !c.archivedAt && c.nextFollowUpAt && !isFollowUpDue(c, now))
    .sort((a, b) => Date.parse(a.nextFollowUpAt!) - Date.parse(b.nextFollowUpAt!))
    .slice(0, 5);

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="stack-sm">
        <h1>Who should I follow up with today?</h1>
        <p className="muted">
          Overdue follow-ups and accepted connections still waiting for your first message. Starred contacts come first, then the most
          overdue reminders.
        </p>
      </div>

      {fresh.length > 0 && (
        <section className="card stack-sm" aria-labelledby="fresh-title">
          <div className="row-between">
            <h3 id="fresh-title">New since your last review ({fresh.length})</h3>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => void run((d, at) => markReviewed(d, fresh.map((c) => c.id), at), "Marked as reviewed.")}
            >
              Mark all reviewed
            </button>
          </div>
          <p className="small muted">
            Acceptances you confirmed manually but haven't opened since. LinkedMaven Connect doesn't detect acceptances on its own.
          </p>
          <ul className="attention-list">
            {fresh.map((c) => (
              <li key={c.id} className="attention-item">
                <span className="grow">
                  <button type="button" className="link-btn" onClick={() => onOpenContact(c.id)}>
                    {c.fullName}
                  </button>
                  <span className="small muted"> · confirmed accepted {c.acceptedAt ? formatTimestamp(c.acceptedAt, tz) : ""}</span>
                </span>
                <PrimaryAction contact={c} now={now} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {list.length === 0 ? (
        contacts.length === 0 ? (
          <EmptyState
            title="Start by tracking a connection request"
            action={
              <button type="button" className="btn btn-primary" onClick={onAdd}>
                <Icon name="plus" /> Add your first connection
              </button>
            }
          >
            After you send a request on LinkedIn, paste the person's profile URL here. When they accept, mark it, and LinkedMaven Connect
            will help you send a timely follow-up. Want to look around first? Load demo data in Settings.
          </EmptyState>
        ) : (
          <EmptyState
            title="You're all caught up"
            action={
              summary.pending > 0 ? (
                <button type="button" className="btn" onClick={() => onTab("pending")}>
                  Review {summary.pending} pending request{summary.pending === 1 ? "" : "s"}
                </button>
              ) : undefined
            }
          >
            No follow-ups are due and everyone who accepted has received a first message.
            {summary.pending > 0 && " If someone accepted on LinkedIn, mark it under Pending requests."}
          </EmptyState>
        )
      ) : (
        <ul className="contact-cards" style={{ listStyle: "none", margin: 0, padding: 0 }} aria-label="Contacts to act on today">
          {list.map((c) => (
            <TodayCard key={c.id} contact={c} now={now} tz={tz} onOpen={() => onOpenContact(c.id)} />
          ))}
        </ul>
      )}

      {upcoming.length > 0 && (
        <section className="stack-sm" aria-labelledby="upcoming-title">
          <h3 id="upcoming-title">Coming up</h3>
          <ul className="attention-list">
            {upcoming.map((c) => (
              <li key={c.id} className="attention-item">
                <button type="button" className="link-btn" onClick={() => onOpenContact(c.id)}>
                  {c.fullName}
                </button>
                <span className="small muted">
                  {formatTimestamp(c.nextFollowUpAt, tz)} ({formatRelative(c.nextFollowUpAt!, now)})
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function TodayCard({ contact: c, now, tz, onOpen }: { contact: Contact; now: Date; tz: string; onOpen: () => void }) {
  const actions = useActions();
  const due = isFollowUpDue(c, now);
  const ready = isReadyForInitialMessage(c);
  return (
    <li className="card contact-card">
      <div className="stack-sm grow">
        <div className="row">
          {c.priority && (
            <span style={{ color: "#d97706" }} title="Starred">
              <Icon name="star" filled />
              <span className="sr-only">Starred</span>
            </span>
          )}
          <button type="button" className="link-btn" style={{ fontSize: 15 }} onClick={onOpen}>
            {c.fullName}
          </button>
          <span className="muted small">{[c.role, c.company, CATEGORY_LABELS[c.category]].filter(Boolean).join(" · ")}</span>
        </div>
        <StatusBadges contact={c} now={now} />
        <p className="small">
          {due && c.nextFollowUpAt && (
            <>
              Follow-up was due <strong>{formatTimestamp(c.nextFollowUpAt, tz)}</strong> ({formatRelative(c.nextFollowUpAt, now)}).{" "}
            </>
          )}
          {ready && c.acceptedAt && (
            <>
              Accepted {formatTimestamp(c.acceptedAt, tz, false)}; no message recorded yet.
            </>
          )}
        </p>
        {c.connectionReason && <p className="small muted">Why you connected: {c.connectionReason}</p>}
      </div>
      <div className="stack-sm" style={{ alignItems: "flex-end" }}>
        <div className="row">
          <PrimaryAction contact={c} now={now} size="md" />
          <button type="button" className="btn" onClick={() => actions.open("sent", c)}>
            Mark message sent…
          </button>
        </div>
        {due && (
          <div className="row">
            <SnoozeButtons contact={c} />
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => void actions.clearReminder(c)}>
              Clear
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
