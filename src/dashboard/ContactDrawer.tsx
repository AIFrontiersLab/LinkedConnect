import { useEffect, useId, useState } from "react";
import type { Activity, ActivityType, Contact } from "../shared/types";
import { CATEGORY_LABELS } from "../shared/types";
import { isFollowUpDue, isNewSinceReview } from "../shared/lifecycle";
import { markReviewed, updateContact } from "../shared/actions";
import { openProfile } from "../shared/navigation";
import { formatDateOnly, formatRelative, formatTimestamp } from "../shared/time";
import { useActions } from "../ui/ActionDialogs";
import { Dialog, Icon, PriorityStar, StatusBadges } from "../ui/components";
import { errorMessage, useDatabase, useToast } from "../ui/hooks";
import { SnoozeButtons } from "./ContactRowActions";

const ACTIVITY_LABELS: Record<ActivityType, string> = {
  CREATED: "Started tracking",
  UPDATED: "Details edited",
  ACCEPTED: "Acceptance confirmed (manual)",
  MESSAGE_SENT: "Message sent (recorded by you)",
  REPLIED: "Reply recorded",
  FOLLOW_UP_SCHEDULED: "Follow-up scheduled",
  FOLLOW_UP_CLEARED: "Reminder cleared",
  ARCHIVED: "Archived",
  RESTORED: "Restored",
  STATUS_CORRECTED: "Status corrected",
  NOTE: "Notes updated",
};

export function ContactDrawer({ contactId, now, onClose }: { contactId: string; now: Date; onClose: () => void }) {
  const { db, run } = useDatabase();
  const contact = db!.contacts.find((c) => c.id === contactId) ?? null;

  // Opening a confirmed acceptance counts as reviewing it.
  useEffect(() => {
    if (contact && isNewSinceReview(contact)) void run((d, at) => markReviewed(d, [contact.id], at), undefined, { silentErrors: true });
  }, [contact, run]);

  if (!contact) {
    return (
      <Dialog open onClose={onClose} title="Contact not found" className="drawer">
        <p>This contact doesn't exist anymore. It may have been deleted in another window.</p>
        <div>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </Dialog>
    );
  }
  return (
    <Dialog open onClose={onClose} title={contact.fullName} className="drawer">
      <DrawerBody contact={contact} now={now} />
    </Dialog>
  );
}

function DrawerBody({ contact: c, now }: { contact: Contact; now: Date }) {
  const { db, tz, run, readOnlyReason } = useDatabase();
  const actions = useActions();
  const { notify } = useToast();
  const id = useId();
  const [notes, setNotes] = useState(c.notes);
  const [notesBase, setNotesBase] = useState(c.notes);
  // Pick up note edits made in another window unless the user has unsaved changes here.
  useEffect(() => {
    if (c.notes !== notesBase) {
      if (notes === notesBase) setNotes(c.notes);
      setNotesBase(c.notes);
    }
  }, [c.notes, notes, notesBase]);
  const notesDirty = notes !== c.notes;
  const ro = !!readOnlyReason;

  const activities = db!.activities
    .filter((a) => a.contactId === c.id)
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  const templateName = (tid?: string) => db!.templates.find((t) => t.id === tid)?.name;
  const t = (iso: string | null) => (iso ? formatTimestamp(iso, tz) : "—");

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="row-between">
        <StatusBadges contact={c} now={now} />
        <PriorityStar
          on={c.priority}
          label={c.fullName}
          onToggle={ro ? undefined : () => void run((d, at) => updateContact(d, c.id, { priority: !c.priority }, at))}
        />
      </div>

      {!ro && (
        <section className="stack-sm" aria-label="Actions">
          {c.archivedAt ? (
            <div className="row">
              <button type="button" className="btn btn-primary" onClick={() => void actions.restore(c)}>
                <Icon name="undo" /> Restore contact
              </button>
            </div>
          ) : (
            <>
              <div className="row">
                {c.lifecycleStatus === "REQUEST_SENT" && (
                  <button type="button" className="btn btn-accent" onClick={() => actions.open("accept", c)}>
                    <Icon name="check" /> Mark accepted
                  </button>
                )}
                {c.acceptedAt && (
                  <>
                    <button type="button" className="btn btn-accent" onClick={() => actions.open("compose", c)}>
                      <Icon name="send" /> Prepare message
                    </button>
                    <button type="button" className="btn" onClick={() => actions.open("sent", c)}>
                      Mark message sent…
                    </button>
                    {!c.repliedAt && (
                      <button type="button" className="btn" onClick={() => actions.open("replied", c)}>
                        <Icon name="reply" /> Mark replied
                      </button>
                    )}
                  </>
                )}
              </div>
              <div className="row">
                <button type="button" className="btn" onClick={() => actions.open("followup", c)}>
                  <Icon name="clock" /> {c.nextFollowUpAt ? "Reschedule follow-up" : "Schedule follow-up"}
                </button>
                {c.nextFollowUpAt && <SnoozeButtons contact={c} />}
              </div>
            </>
          )}
        </section>
      )}

      <section className="stack-sm" aria-labelledby={`${id}-details`}>
        <div className="row-between">
          <h3 id={`${id}-details`} className="section-title">
            Details
          </h3>
          <div className="row">
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => openProfile(c.normalizedProfileUrl).catch((err) => notify(errorMessage(err), "error"))}
            >
              <Icon name="external" size={14} /> Open LinkedIn profile
            </button>
            {!ro && (
              <button type="button" className="btn btn-sm" onClick={() => actions.open("edit", c)}>
                <Icon name="edit" size={14} /> Edit
              </button>
            )}
          </div>
        </div>
        <dl className="facts">
          <dt>Profile</dt>
          <dd>{c.normalizedProfileUrl}</dd>
          <dt>Company</dt>
          <dd>{c.company || "—"}</dd>
          <dt>Role</dt>
          <dd>{c.role || "—"}</dd>
          <dt>Category</dt>
          <dd>{CATEGORY_LABELS[c.category]}</dd>
          {c.firstNameOverride && (
            <>
              <dt>First name</dt>
              <dd>{c.firstNameOverride}</dd>
            </>
          )}
          <dt>Why I connected</dt>
          <dd className="pre-wrap">{c.connectionReason || "—"}</dd>
          <dt>Request sent</dt>
          <dd>{formatDateOnly(c.requestSentAt)}</dd>
          <dt>Accepted</dt>
          <dd>{c.acceptedAt ? `${t(c.acceptedAt)} (confirmed manually)` : "Not yet confirmed"}</dd>
          <dt>First message</dt>
          <dd>{t(c.initialMessageSentAt)}</dd>
          <dt>Last message</dt>
          <dd>{t(c.lastMessageSentAt)}</dd>
          <dt>Replied</dt>
          <dd>{t(c.repliedAt)}</dd>
          <dt>Next follow-up</dt>
          <dd>
            {c.nextFollowUpAt ? (
              <>
                {t(c.nextFollowUpAt)} ({formatRelative(c.nextFollowUpAt, now)}){isFollowUpDue(c, now) && " — due"}
                {!ro && (
                  <>
                    {" "}
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => void actions.clearReminder(c)}>
                      Clear
                    </button>
                  </>
                )}
              </>
            ) : (
              "None"
            )}
          </dd>
          {c.archivedAt && (
            <>
              <dt>Archived</dt>
              <dd>{t(c.archivedAt)}</dd>
            </>
          )}
          <dt>Times shown in</dt>
          <dd>{tz}</dd>
        </dl>
      </section>

      <section className="stack-sm" aria-labelledby={`${id}-notes-h`}>
        <h3 id={`${id}-notes-h`} className="section-title">
          <label htmlFor={`${id}-notes`}>Notes</label>
        </h3>
        <textarea id={`${id}-notes`} rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={20000} disabled={ro} />
        <div className="row-between">
          <span className="small muted" aria-live="polite">
            {notesDirty ? "Unsaved changes" : "Saved"}
          </span>
          <div className="row">
            {notesDirty && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setNotes(c.notes)}>
                Discard
              </button>
            )}
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={!notesDirty || ro}
              onClick={() => void run((d, at) => updateContact(d, c.id, { notes }, at), "Notes saved.")}
            >
              Save notes
            </button>
          </div>
        </div>
      </section>

      <section className="stack-sm" aria-labelledby={`${id}-history`}>
        <h3 id={`${id}-history`} className="section-title">
          Activity
        </h3>
        {activities.length === 0 ? (
          <p className="muted small">No activity recorded.</p>
        ) : (
          <ol className="timeline">
            {activities.map((a) => (
              <TimelineItem key={a.id} activity={a} tz={tz} templateName={templateName(a.templateId)} />
            ))}
          </ol>
        )}
      </section>

      {!ro && (
        <section className="stack-sm" aria-labelledby={`${id}-manage`}>
          <h3 id={`${id}-manage`} className="section-title">
            Manage
          </h3>
          <div className="row">
            {!c.archivedAt && c.lifecycleStatus !== "REQUEST_SENT" && (
              <button type="button" className="btn btn-sm" onClick={() => actions.open("correct", c)}>
                <Icon name="undo" size={14} /> Correct status…
              </button>
            )}
            {!c.archivedAt && (
              <button type="button" className="btn btn-sm" onClick={() => void actions.archive(c)}>
                <Icon name="archive" size={14} /> Archive
              </button>
            )}
            <button type="button" className="btn btn-sm btn-danger" onClick={() => actions.open("delete", c)}>
              <Icon name="trash" size={14} /> Delete…
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function TimelineItem({ activity: a, tz, templateName }: { activity: Activity; tz: string; templateName?: string }) {
  return (
    <li>
      <div>
        <strong>{ACTIVITY_LABELS[a.activityType]}</strong>
        {templateName && <span className="small muted"> · template “{templateName}”</span>}
      </div>
      <div className="when">{formatTimestamp(a.timestamp, tz)}</div>
      {a.note && (
        <div className="small pre-wrap">
          {/* Notes may embed ISO timestamps; show them in the configured timezone. */}
          {a.note.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, (m) => formatTimestamp(m, tz))}
        </div>
      )}
      {a.messageText && (
        <details className="small">
          <summary>Message text</summary>
          <div className="preview">{a.messageText}</div>
        </details>
      )}
    </li>
  );
}
