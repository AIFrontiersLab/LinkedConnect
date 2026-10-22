// Confirmation dialogs for lifecycle actions, shared by the popup and dashboard.
// Every status change happens only after an explicit confirmation here.

import { createContext, useCallback, useContext, useId, useMemo, useState, type ReactNode } from "react";
import type { Contact, LifecycleStatus } from "../shared/types";
import { STATUS_LABELS } from "../shared/types";
import { applyTransition, deleteContact } from "../shared/actions";
import {
  archive,
  clearFollowUp,
  correctStatus,
  markAccepted,
  markMessageSent,
  markReplied,
  restore,
  scheduleFollowUp,
} from "../shared/lifecycle";
import { addDays, defaultFollowUpInstant, formatTimestamp, fromZonedInputValue, toZonedInputValue } from "../shared/time";
import { getRepository } from "../shared/storage";
import { Dialog, Field, Icon } from "./components";
import { useDatabase } from "./hooks";
import { Composer } from "./Composer";
import { EditContactDialog } from "./EditContactDialog";

export type ActionKind = "accept" | "sent" | "replied" | "followup" | "correct" | "delete" | "compose" | "edit";

interface Pending {
  kind: ActionKind;
  contactId: string;
  /** For "sent": message details captured by the composer. */
  message?: { templateId: string | null; text: string };
}

interface ActionsApi {
  open(kind: ActionKind, contact: Contact, extra?: Pick<Pending, "message">): void;
  archive(contact: Contact): Promise<void>;
  restore(contact: Contact): Promise<void>;
  snooze(contact: Contact, days: number): Promise<void>;
  clearReminder(contact: Contact): Promise<void>;
}

const ActionsContext = createContext<ActionsApi | null>(null);

export function useActions(): ActionsApi {
  const ctx = useContext(ActionsContext);
  if (!ctx) throw new Error("useActions must be used inside ActionsProvider");
  return ctx;
}

export function ActionsProvider({ children, onDeleted }: { children: ReactNode; onDeleted?: (id: string) => void }) {
  const { db, run } = useDatabase();
  const [pending, setPending] = useState<Pending | null>(null);
  const close = useCallback(() => setPending(null), []);

  const api = useMemo<ActionsApi>(
    () => ({
      open: (kind, contact, extra) => setPending({ kind, contactId: contact.id, ...extra }),
      archive: async (c) => {
        await run((d, now) => applyTransition(d, c.id, (x, n) => archive(x, n), now), `${c.fullName} archived. Reminders cleared; history kept.`);
      },
      restore: async (c) => {
        await run((d, now) => applyTransition(d, c.id, (x, n) => restore(x, n), now), `${c.fullName} restored.`);
      },
      snooze: async (c, days) => {
        await run(
          (d, now) => applyTransition(d, c.id, (x, n) => scheduleFollowUp(x, addDays(now, days).toISOString(), n), now),
          `Follow-up with ${c.fullName} snoozed ${days === 7 ? "one week" : days === 1 ? "one day" : `${days} days`}.`,
        );
      },
      clearReminder: async (c) => {
        await run((d, now) => applyTransition(d, c.id, (x, n) => clearFollowUp(x, n), now), `Reminder for ${c.fullName} cleared.`);
      },
    }),
    [run],
  );

  // Always act on the latest stored version of the contact.
  const contact = pending && db ? db.contacts.find((c) => c.id === pending.contactId) ?? null : null;

  return (
    <ActionsContext.Provider value={api}>
      {children}
      {pending && contact && pending.kind === "accept" && <AcceptDialog contact={contact} onClose={close} />}
      {pending && contact && pending.kind === "sent" && <MessageSentDialog contact={contact} message={pending.message} onClose={close} />}
      {pending && contact && pending.kind === "replied" && <RepliedDialog contact={contact} onClose={close} />}
      {pending && contact && pending.kind === "followup" && <FollowUpDialog contact={contact} onClose={close} />}
      {pending && contact && pending.kind === "correct" && <CorrectStatusDialog contact={contact} onClose={close} />}
      {pending && contact && pending.kind === "delete" && (
        <DeleteDialog
          contact={contact}
          onClose={close}
          onDeleted={() => {
            close();
            onDeleted?.(contact.id);
          }}
        />
      )}
      {pending && contact && pending.kind === "edit" && <EditContactDialog contact={contact} onClose={close} />}
      {pending && contact && pending.kind === "compose" && (
        <Composer
          contact={contact}
          onClose={close}
          onMarkSent={(message) => setPending({ kind: "sent", contactId: contact.id, message })}
        />
      )}
      {pending && !contact && db && (
        <Dialog open title="Contact not found" onClose={close}>
          <p>This contact no longer exists. It may have been deleted in another window.</p>
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={close}>
              Close
            </button>
          </div>
        </Dialog>
      )}
    </ActionsContext.Provider>
  );
}

function useDateTimeField(initialIso: string) {
  const { tz } = useDatabase();
  const [value, setValue] = useState(() => toZonedInputValue(initialIso, tz));
  const iso = fromZonedInputValue(value, tz);
  return { value, setValue, iso, tz };
}

function AcceptDialog({ contact, onClose }: { contact: Contact; onClose: () => void }) {
  const { run } = useDatabase();
  const id = useId();
  const when = useDateTimeField(new Date().toISOString());
  const [busy, setBusy] = useState(false);
  async function confirm() {
    if (!when.iso) return;
    setBusy(true);
    const r = await run(
      (d, now) => applyTransition(d, contact.id, (c, n, tz) => markAccepted(c, when.iso!, n, tz), now),
      `${contact.fullName} marked as accepted. They're now in “Ready to message”.`,
    );
    setBusy(false);
    if (r.ok) onClose();
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title="Confirm acceptance"
      description={
        <>
          Confirm that <strong>{contact.fullName}</strong> accepted your connection request on LinkedIn. LinkedMaven Connect
          doesn't check LinkedIn; this is recorded as a manual confirmation.
        </>
      }
    >
      <Field label={`Accepted on (${when.tz})`} htmlFor={`${id}-at`} hint="Defaults to now. Change it if they accepted earlier.">
        <input id={`${id}-at`} type="datetime-local" value={when.value} onChange={(e) => when.setValue(e.target.value)} />
      </Field>
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn-accent" onClick={() => void confirm()} disabled={busy || !when.iso}>
          <Icon name="check" /> Confirm accepted
        </button>
      </div>
    </Dialog>
  );
}

function MessageSentDialog({
  contact,
  message,
  onClose,
}: {
  contact: Contact;
  message?: { templateId: string | null; text: string };
  onClose: () => void;
}) {
  const { run, db } = useDatabase();
  const id = useId();
  const when = useDateTimeField(new Date().toISOString());
  const days = db?.settings.defaultFollowUpDays ?? 7;
  const [remind, setRemind] = useState(contact.lifecycleStatus !== "REPLIED");
  const follow = useDateTimeField(defaultFollowUpInstant(days, when.tz));
  const [busy, setBusy] = useState(false);
  const isFirst = !contact.initialMessageSentAt;

  async function confirm() {
    if (!when.iso || (remind && !follow.iso)) return;
    setBusy(true);
    const r = await run(
      (d, now) =>
        applyTransition(
          d,
          contact.id,
          (c, n, tz) =>
            markMessageSent(
              c,
              { sentAt: when.iso!, templateId: message?.templateId ?? null, messageText: message?.text, followUpAt: remind ? follow.iso : null },
              n,
              tz,
            ),
          now,
        ),
      `Recorded: message sent to ${contact.fullName}.${remind ? " Follow-up scheduled." : ""}`,
    );
    setBusy(false);
    if (r.ok) {
      await getRepository().clearDraft(contact.id).catch(() => undefined);
      onClose();
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={isFirst ? "Record message sent" : "Record follow-up message sent"}
      description={
        <>
          Only confirm after you've sent the message to <strong>{contact.fullName}</strong> on LinkedIn yourself. Copying the text
          or opening the profile doesn't count as sending.
        </>
      }
    >
      <Field label={`Sent on (${when.tz})`} htmlFor={`${id}-sent`}>
        <input id={`${id}-sent`} type="datetime-local" value={when.value} onChange={(e) => when.setValue(e.target.value)} />
      </Field>
      <label className="checkbox">
        <input type="checkbox" checked={remind} onChange={(e) => setRemind(e.target.checked)} />
        Remind me to follow up
      </label>
      {remind && (
        <Field label={`Follow up on (${follow.tz})`} htmlFor={`${id}-follow`} hint={`Default: ${days} days from now at 9:00.`}>
          <input id={`${id}-follow`} type="datetime-local" value={follow.value} onChange={(e) => follow.setValue(e.target.value)} />
        </Field>
      )}
      {contact.nextFollowUpAt && (
        <p className="small muted">The current reminder ({formatTimestamp(contact.nextFollowUpAt, when.tz)}) will be replaced.</p>
      )}
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void confirm()} disabled={busy || !when.iso || (remind && !follow.iso)}>
          <Icon name="send" /> I sent it
        </button>
      </div>
    </Dialog>
  );
}

function RepliedDialog({ contact, onClose }: { contact: Contact; onClose: () => void }) {
  const { run } = useDatabase();
  const id = useId();
  const when = useDateTimeField(new Date().toISOString());
  const [busy, setBusy] = useState(false);
  async function confirm() {
    if (!when.iso) return;
    setBusy(true);
    const r = await run(
      (d, now) => applyTransition(d, contact.id, (c, n, tz) => markReplied(c, when.iso!, n, tz), now),
      `${contact.fullName} marked as replied. Reminder cleared.`,
    );
    setBusy(false);
    if (r.ok) onClose();
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title="Mark as replied"
      description={
        <>
          Record that <strong>{contact.fullName}</strong> replied. Any scheduled follow-up reminder will be cleared; you can schedule a
          new one afterwards if you want.
        </>
      }
    >
      <Field label={`Replied on (${when.tz})`} htmlFor={`${id}-at`}>
        <input id={`${id}-at`} type="datetime-local" value={when.value} onChange={(e) => when.setValue(e.target.value)} />
      </Field>
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void confirm()} disabled={busy || !when.iso}>
          <Icon name="reply" /> Mark replied
        </button>
      </div>
    </Dialog>
  );
}

function FollowUpDialog({ contact, onClose }: { contact: Contact; onClose: () => void }) {
  const { run, db, tz } = useDatabase();
  const actions = useActions();
  const id = useId();
  const days = db?.settings.defaultFollowUpDays ?? 7;
  const when = useDateTimeField(contact.nextFollowUpAt ?? defaultFollowUpInstant(days, tz));
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!when.iso) return;
    setBusy(true);
    const r = await run(
      (d, now) => applyTransition(d, contact.id, (c, n) => scheduleFollowUp(c, when.iso!, n), now),
      `Follow-up with ${contact.fullName} set for ${formatTimestamp(when.iso, when.tz)}.`,
    );
    setBusy(false);
    if (r.ok) onClose();
  }
  const quick = async (n: number) => {
    await actions.snooze(contact, n);
    onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={contact.nextFollowUpAt ? "Reschedule follow-up" : "Schedule follow-up"}
      description={
        <>
          Set when you want to be reminded about <strong>{contact.fullName}</strong>. Reminders show on the dashboard and toolbar badge,
          and as desktop notifications if enabled in Settings.
        </>
      }
    >
      <Field label={`Follow up on (${when.tz})`} htmlFor={`${id}-at`}>
        <input id={`${id}-at`} type="datetime-local" value={when.value} onChange={(e) => when.setValue(e.target.value)} />
      </Field>
      <div className="stack-sm">
        <span className="label">Or snooze from now</span>
        <div className="row">
          <button type="button" className="btn btn-sm" onClick={() => void quick(1)}>
            1 day
          </button>
          <button type="button" className="btn btn-sm" onClick={() => void quick(3)}>
            3 days
          </button>
          <button type="button" className="btn btn-sm" onClick={() => void quick(7)}>
            1 week
          </button>
        </div>
      </div>
      <div className="dialog-actions">
        {contact.nextFollowUpAt && (
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => {
              void actions.clearReminder(contact).then(onClose);
            }}
          >
            Clear reminder
          </button>
        )}
        <span className="grow" />
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy || !when.iso}>
          <Icon name="clock" /> Save reminder
        </button>
      </div>
    </Dialog>
  );
}

const CORRECTION_EFFECTS: Record<Exclude<LifecycleStatus, "ARCHIVED">, string> = {
  REQUEST_SENT: "Clears the acceptance date, message dates and reply date.",
  ACCEPTED: "Clears message dates and reply date.",
  MESSAGE_SENT: "Clears the reply date.",
  REPLIED: "",
};

function CorrectStatusDialog({ contact, onClose }: { contact: Contact; onClose: () => void }) {
  const { run } = useDatabase();
  const order = ["REQUEST_SENT", "ACCEPTED", "MESSAGE_SENT", "REPLIED"] as const;
  const options = order.slice(0, Math.max(0, order.indexOf(contact.lifecycleStatus as (typeof order)[number])));
  const [target, setTarget] = useState<(typeof order)[number] | null>(options[options.length - 1] ?? null);
  const name = useId();
  async function confirm() {
    if (!target) return;
    const r = await run(
      (d, now) => applyTransition(d, contact.id, (c, n) => correctStatus(c, target, n), now),
      `Status corrected to “${STATUS_LABELS[target]}”.`,
    );
    if (r.ok) onClose();
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title="Correct status"
      description="Use this if a status was recorded by mistake. Later-stage dates are cleared so the record stays consistent. The correction is logged in the activity history."
    >
      {options.length === 0 ? (
        <p>There's no earlier status to go back to.</p>
      ) : (
        <fieldset className="stack-sm" style={{ border: "none", padding: 0, margin: 0 }}>
          <legend className="label">Move {contact.fullName} back to</legend>
          {options.map((s) => (
            <label key={s} className="checkbox" style={{ alignItems: "flex-start" }}>
              <input type="radio" name={name} checked={target === s} onChange={() => setTarget(s)} />
              <span>
                <span className={`badge badge-${s}`}>{STATUS_LABELS[s]}</span>
                <span className="small muted" style={{ display: "block" }}>
                  {CORRECTION_EFFECTS[s]}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn-danger" onClick={() => void confirm()} disabled={!target}>
          <Icon name="undo" /> Apply correction
        </button>
      </div>
    </Dialog>
  );
}

function DeleteDialog({ contact, onClose, onDeleted }: { contact: Contact; onClose: () => void; onDeleted: () => void }) {
  const { run } = useDatabase();
  async function confirm() {
    const r = await run((d) => deleteContact(d, contact.id), `${contact.fullName} deleted.`);
    if (r.ok) onDeleted();
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title="Delete contact?"
      description={
        <>
          This permanently removes <strong>{contact.fullName}</strong> and their activity history from this browser. To keep the history,
          archive instead. Consider exporting a backup first.
        </>
      }
    >
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onClose} autoFocus>
          Cancel
        </button>
        <button type="button" className="btn btn-danger" onClick={() => void confirm()}>
          <Icon name="trash" /> Delete permanently
        </button>
      </div>
    </Dialog>
  );
}
