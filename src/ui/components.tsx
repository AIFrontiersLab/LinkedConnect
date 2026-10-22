import { useEffect, useId, useRef, type ReactNode } from "react";
import type { Contact } from "../shared/types";
import { STATUS_LABELS } from "../shared/types";
import { isFollowUpDue, isNewSinceReview, isReadyForInitialMessage } from "../shared/lifecycle";

// ---------- Icons (inline SVG, bundled) ----------

const paths = {
  star: "M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.8L12 16.9l-5.25 2.7 1-5.8L3.5 9.7l5.9-.9z",
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  copy: "M8 8h11v12H8zM5 16V4h11",
  plus: "M12 5v14M5 12h14",
  close: "M6 6l12 12M18 6L6 18",
  clock: "M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
  check: "M5 12.5l4.5 4.5L19 7.5",
  send: "M4 12l16-8-6 16-2.5-6.5z",
  dashboard: "M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
  upload: "M12 20V9M7 14l5-5 5 5M5 4h14",
  archive: "M4 5h16v4H4zM6 9v10h12V9M10 13h4",
  trash: "M5 7h14M10 11v6M14 11v6M7 7l1 13h8l1-13M9 7V4h6v3",
  moon: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z",
  sun: "M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6L4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z",
  edit: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  reply: "M10 8L4 13l6 5M4 13h10a6 6 0 0 1 6 6",
  undo: "M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3",
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 16, filled = false }: { name: IconName; size?: number; filled?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name]} />
    </svg>
  );
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand">
      <img src="icons/icon-48.png" alt="" width={compact ? 24 : 28} height={compact ? 24 : 28} />
      <span className="brand-name">
        Linked<span>Connect</span>
      </span>
    </div>
  );
}

// ---------- Status badges (text + color + marker shape) ----------

export function StatusBadge({ contact }: { contact: Contact }) {
  return <span className={`badge badge-${contact.lifecycleStatus}`}>{STATUS_LABELS[contact.lifecycleStatus]}</span>;
}

/** Lifecycle badge plus derived attention badges. */
export function StatusBadges({ contact, now, showNew = true }: { contact: Contact; now: Date; showNew?: boolean }) {
  return (
    <span className="row" style={{ gap: 4 }}>
      <StatusBadge contact={contact} />
      {isFollowUpDue(contact, now) && <span className="badge badge-DUE">Follow-up due</span>}
      {isReadyForInitialMessage(contact) && <span className="badge badge-READY">Ready to message</span>}
      {showNew && isNewSinceReview(contact) && (
        <span className="badge badge-NEW" title="You confirmed this acceptance and haven't opened the contact since">
          New
        </span>
      )}
      {contact.isDemo && <span className="badge badge-DEMO">Demo</span>}
    </span>
  );
}

export function PriorityStar({ on, onToggle, label }: { on: boolean; onToggle?: () => void; label: string }) {
  if (!onToggle) {
    return on ? (
      <span className="star-btn" aria-pressed="true" title="Starred" style={{ color: "#d97706" }}>
        <Icon name="star" filled />
        <span className="sr-only">Starred</span>
      </span>
    ) : (
      <span className="sr-only">Not starred</span>
    );
  }
  return (
    <button
      type="button"
      className="btn btn-ghost btn-icon star-btn"
      aria-pressed={on}
      aria-label={on ? `Unstar ${label}` : `Star ${label}`}
      title={on ? "Starred (priority)" : "Star as priority"}
      onClick={onToggle}
    >
      <Icon name="star" filled={on} />
    </button>
  );
}

// ---------- Dialog (native <dialog>: focus trap, Esc, inert background) ----------

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  className = "",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={className}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <div className="dialog-inner">
          <div className="row-between">
            <h2 id={titleId}>{title}</h2>
            <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close dialog">
              <Icon name="close" />
            </button>
          </div>
          {description && <div className="muted">{description}</div>}
          {children}
        </div>
      )}
    </dialog>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Field({
  label,
  required,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  required?: boolean;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  htmlFor: string;
}) {
  return (
    <div className="field">
      <label htmlFor={htmlFor} className={required ? "required" : undefined}>
        {label}
      </label>
      {children}
      {hint && (
        <span className="hint" id={`${htmlFor}-hint`}>
          {hint}
        </span>
      )}
      {error && (
        <span className="error" id={`${htmlFor}-error`} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
