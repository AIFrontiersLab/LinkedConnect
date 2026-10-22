import type { Contact } from "../shared/types";
import { isFollowUpDue, isReadyForInitialMessage } from "../shared/lifecycle";
import { useActions } from "../ui/ActionDialogs";
import { Icon } from "../ui/components";
import { useDatabase } from "../ui/hooks";

/** The single most useful next step for a contact, shown in tables and lists. */
export function PrimaryAction({ contact, now, size = "sm" }: { contact: Contact; now: Date; size?: "sm" | "md" }) {
  const actions = useActions();
  const { readOnlyReason } = useDatabase();
  const cls = `btn ${size === "sm" ? "btn-sm" : ""}`;
  const label = contact.fullName;
  if (readOnlyReason) return null;
  if (contact.archivedAt) {
    return (
      <button type="button" className={cls} onClick={() => void actions.restore(contact)} aria-label={`Restore ${label}`}>
        <Icon name="undo" size={14} /> Restore
      </button>
    );
  }
  if (contact.lifecycleStatus === "REQUEST_SENT") {
    return (
      <button type="button" className={`${cls} btn-accent`} onClick={() => actions.open("accept", contact)} aria-label={`Mark ${label} accepted`}>
        <Icon name="check" size={14} /> Mark accepted
      </button>
    );
  }
  if (isReadyForInitialMessage(contact) || isFollowUpDue(contact, now)) {
    return (
      <button type="button" className={`${cls} btn-accent`} onClick={() => actions.open("compose", contact)} aria-label={`Prepare message for ${label}`}>
        <Icon name="send" size={14} /> {isReadyForInitialMessage(contact) ? "Prepare message" : "Prepare follow-up"}
      </button>
    );
  }
  return (
    <button type="button" className={cls} onClick={() => actions.open("followup", contact)} aria-label={`Schedule follow-up for ${label}`}>
      <Icon name="clock" size={14} /> {contact.nextFollowUpAt ? "Reschedule" : "Schedule follow-up"}
    </button>
  );
}

export function SnoozeButtons({ contact }: { contact: Contact }) {
  const actions = useActions();
  return (
    <span className="row" role="group" aria-label={`Snooze ${contact.fullName}`} style={{ gap: 4 }}>
      <span className="small muted">Snooze:</span>
      <button type="button" className="btn btn-sm" onClick={() => void actions.snooze(contact, 1)} aria-label={`Snooze ${contact.fullName} one day`}>
        1d
      </button>
      <button type="button" className="btn btn-sm" onClick={() => void actions.snooze(contact, 3)} aria-label={`Snooze ${contact.fullName} three days`}>
        3d
      </button>
      <button type="button" className="btn btn-sm" onClick={() => void actions.snooze(contact, 7)} aria-label={`Snooze ${contact.fullName} one week`}>
        1w
      </button>
    </span>
  );
}
