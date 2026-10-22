import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { Category, Contact } from "../shared/types";
import { CATEGORIES, CATEGORY_LABELS } from "../shared/types";
import { addContact, DuplicateContactError, updateContact, type ContactPatch } from "../shared/actions";
import { normalizeProfileUrl } from "../shared/profileUrl";
import { todayInZone } from "../shared/time";
import { loadFormDraft, readActiveTabPrefill, saveFormDraft, takePendingPrefill, PENDING_PREFILL_KEY, type PendingPrefill } from "../shared/tabPrefill";
import { parseProfileText, suggestCategory, trimCompanyTail } from "../shared/selectionParse";

const clipText = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 200);
import { Field, Icon, StatusBadge } from "./components";
import { useDatabase } from "./hooks";

interface Props {
  onOpenContact: (contact: Contact) => void;
  onMarkAccepted?: (contact: Contact) => void;
  autoFocus?: boolean;
  /** Popup only: suggest URL and name from the LinkedIn profile open in the current tab. */
  prefillFromActiveTab?: boolean;
}

const emptyForm = (today: string) => ({
  profileUrl: "",
  fullName: "",
  company: "",
  role: "",
  category: "RECRUITER" as Category,
  connectionReason: "",
  requestSentAt: today,
  priority: false,
});

type FormState = ReturnType<typeof emptyForm>;

export function AddContactForm({ onOpenContact, onMarkAccepted, autoFocus, prefillFromActiveTab }: Props) {
  const { run, tz, db, readOnlyReason } = useDatabase();
  const id = useId();
  const today = todayInZone(tz);
  const [form, setForm] = useState(() => emptyForm(today));
  const [errors, setErrors] = useState<Partial<Record<keyof typeof form, string>>>({});
  const [duplicate, setDuplicate] = useState<Contact | null>(null);
  const [saved, setSaved] = useState<Contact | null>(null);
  const [busy, setBusy] = useState(false);
  const [origin, setOrigin] = useState<"draft" | "tab" | "selection" | "paste" | "company" | "role" | null>(null);
  const [pasteText, setPasteText] = useState("");
  const draftReady = useRef(false);
  const categoryTouched = useRef(false);
  const [categorySuggested, setCategorySuggested] = useState(false);
  const suggest = (role: string, text: string): Category | null =>
    categoryTouched.current ? null : suggestCategory(role) ?? suggestCategory(text);

  // Restore an unsaved entry (the popup closes whenever it loses focus), otherwise
  // suggest details from the LinkedIn profile open in the current tab.
  useEffect(() => {
    let cancelled = false;
    let stopListening = () => {};
    void (async () => {
      const applyPending = (pending: PendingPrefill, base: FormState | null = null) => {
        if (pending.field) {
          // "Use highlighted text as company/role": fill one field of the entry in progress.
          const value = pending.field === "company" ? trimCompanyTail(pending.selectionText) : clipText(pending.selectionText);
          setForm((current) => {
            let f = base ?? current;
            const inProgress = f.profileUrl ? normalizeProfileUrl(f.profileUrl) : null;
            if (pending.profileUrl && inProgress?.ok && inProgress.normalized !== pending.profileUrl) {
              f = emptyForm(today); // the entry in progress was for someone else
            }
            return {
              ...f,
              profileUrl: f.profileUrl || pending.profileUrl,
              fullName: f.fullName || pending.titleName,
              [pending.field!]: value,
            };
          });
          if (pending.field === "role") {
            const cat = suggest(clipText(pending.selectionText), "");
            if (cat) {
              setForm((f) => ({ ...f, category: cat }));
              setCategorySuggested(true);
            }
          }
          setOrigin(pending.field);
          return;
        }
        // From the right-click menu: URL from the page or link, details from the highlighted text.
        const parsed = parseProfileText(pending.selectionText, pending.titleName);
        const cat = suggest(parsed.role, pending.selectionText);
        setForm({
          ...emptyForm(today),
          profileUrl: pending.profileUrl,
          fullName: parsed.fullName,
          role: parsed.role,
          company: parsed.company,
          ...(cat ? { category: cat } : {}),
        });
        setCategorySuggested(!!cat);
        setOrigin("selection");
      };
      const pending = await takePendingPrefill();
      const draft = await loadFormDraft<FormState>();
      if (cancelled) return;
      if (!pending) {
        // The right-click hand-off may still be being written as the popup opens; take it when it lands.
        const onChange = (changes: Record<string, chrome.storage.StorageChange>) => {
          if (!changes[PENDING_PREFILL_KEY]?.newValue) return;
          void takePendingPrefill().then((late) => {
            if (late && !cancelled) applyPending(late);
          });
        };
        chrome.storage?.session?.onChanged.addListener(onChange);
        stopListening = () => chrome.storage?.session?.onChanged.removeListener(onChange);
        setTimeout(() => stopListening(), 5000);
      }
      if (pending) {
        const hasDraft = !!draft && !!(draft.profileUrl || draft.fullName || draft.company || draft.role);
        applyPending(pending, pending.field && hasDraft ? { ...emptyForm(today), ...draft! } : null);
      } else if (draft && (draft.profileUrl || draft.fullName || draft.company || draft.role || draft.connectionReason)) {
        setForm({ ...emptyForm(today), ...draft });
        setOrigin("draft");
      } else if (prefillFromActiveTab) {
        const tab = await readActiveTabPrefill();
        if (!cancelled && tab?.selectionText.trim()) {
          // Highlighted the profile, then clicked the icon: same as right-click → Add.
          applyPending({ profileUrl: tab.profileUrl, titleName: tab.fullName, selectionText: tab.selectionText, createdAt: Date.now() });
        } else if (!cancelled && tab) {
          setForm((f) => ({ ...f, profileUrl: tab.profileUrl, fullName: f.fullName || tab.fullName }));
          setOrigin("tab");
        }
      }
      draftReady.current = true;
    })();
    return () => {
      cancelled = true;
      stopListening();
    };
    // Runs once when the form opens.
  }, []);

  // Save as you type so switching tabs doesn't lose anything.
  useEffect(() => {
    if (!draftReady.current) return;
    const blank = JSON.stringify(form) === JSON.stringify(emptyForm(today));
    const h = setTimeout(() => void saveFormDraft(blank ? null : form), 200);
    return () => clearTimeout(h);
  }, [form, today]);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
    if (key === "profileUrl") setDuplicate(null);
    setSaved(null);
  };

  const urlCheck = form.profileUrl.trim() ? normalizeProfileUrl(form.profileUrl) : null;

  // Show "already tracked" as soon as a valid URL matches, including prefilled ones.
  const matchUrl = urlCheck?.ok ? urlCheck.normalized : null;
  useEffect(() => {
    if (matchUrl && db) setDuplicate(db.contacts.find((c) => c.normalizedProfileUrl === matchUrl) ?? null);
  }, [matchUrl, db]);

  function applyPasted(text: string) {
    setPasteText(text);
    if (!text.trim()) return;
    const parsed = parseProfileText(text, form.fullName);
    const cat = suggest(parsed.role, text);
    setForm((f) => ({
      ...f,
      fullName: f.fullName || parsed.fullName,
      role: parsed.role || f.role,
      company: parsed.company || f.company,
      ...(cat ? { category: cat } : {}),
    }));
    if (cat) setCategorySuggested(true);
    setOrigin("paste");
    setSaved(null);
  }

  function clearForm() {
    setForm(emptyForm(today));
    setErrors({});
    setDuplicate(null);
    setOrigin(null);
    setPasteText("");
    categoryTouched.current = false;
    setCategorySuggested(false);
    void saveFormDraft(null);
  }

  function checkUrl() {
    if (!urlCheck) return;
    if (!urlCheck.ok) {
      setErrors((e) => ({ ...e, profileUrl: urlCheck.error }));
      return;
    }
    const existing = db?.contacts.find((c) => c.normalizedProfileUrl === urlCheck.normalized);
    setDuplicate(existing ?? null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const nextErrors: typeof errors = {};
    const url = normalizeProfileUrl(form.profileUrl);
    if (!url.ok) nextErrors.profileUrl = url.error;
    if (!form.fullName.trim()) nextErrors.fullName = "Enter the person's full name as shown on LinkedIn.";
    if (!form.requestSentAt) nextErrors.requestSentAt = "Choose the date you sent the request.";
    else if (form.requestSentAt > today) nextErrors.requestSentAt = "The request date can't be in the future.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      document.getElementById(`${id}-${Object.keys(nextErrors)[0]}`)?.focus();
      return;
    }
    setBusy(true);
    const r = await run((d, now) => addContact(d, form, now), undefined, { silentErrors: true });
    setBusy(false);
    if (r.ok) {
      setSaved(r.result);
      clearForm();
      document.getElementById(`${id}-profileUrl`)?.focus();
    } else if (r.error instanceof DuplicateContactError) {
      setDuplicate(r.error.existing);
    } else {
      setErrors({ profileUrl: r.error instanceof Error ? r.error.message : String(r.error) });
    }
  }

  async function updateExisting(existing: Contact) {
    const patch: ContactPatch = { category: form.category };
    if (form.fullName.trim()) patch.fullName = form.fullName;
    if (form.company.trim()) patch.company = form.company;
    if (form.role.trim()) patch.role = form.role;
    if (form.connectionReason.trim()) patch.connectionReason = form.connectionReason;
    if (form.priority) patch.priority = true;
    const r = await run((d, now) => updateContact(d, existing.id, patch, now), `Updated ${existing.fullName}.`);
    if (r.ok) clearForm();
  }

  const fid = (k: string) => `${id}-${k}`;
  const describedBy = (k: keyof typeof form) =>
    [errors[k] ? `${fid(k)}-error` : "", `${fid(k)}-hint`].filter(Boolean).join(" ") || undefined;

  return (
    <form className="stack" onSubmit={submit} noValidate aria-label="Add connection">
      {origin && !saved && (
        <div className="notice notice-info small row-between" role="status">
          <span>
            {origin === "draft"
              ? "Restored what you were typing."
              : origin === "tab"
                ? "Filled from the LinkedIn profile in your current tab. Check the name before saving."
                : origin === "company" || origin === "role"
                  ? `${origin === "company" ? "Company" : "Role"} set from the text you highlighted.`
                  : "Filled from the text you selected. Check name, role and company before saving."}
          </span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={clearForm}>
            Clear form
          </button>
        </div>
      )}
      {saved && (
        <div className="notice notice-success" role="status">
          <strong>Saved.</strong> {saved.fullName} is now tracked as <StatusBadge contact={saved} />.{" "}
          <button type="button" className="btn btn-sm" onClick={() => onOpenContact(saved)}>
            View contact
          </button>
        </div>
      )}
      <Field
        label="LinkedIn profile URL"
        required
        htmlFor={fid("profileUrl")}
        error={errors.profileUrl}
        hint={urlCheck?.ok ? `Will be saved as ${urlCheck.normalized}` : "Example: https://www.linkedin.com/in/jane-doe"}
      >
        <input
          id={fid("profileUrl")}
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          autoFocus={autoFocus}
          value={form.profileUrl}
          onChange={(e) => set("profileUrl", e.target.value)}
          onBlur={checkUrl}
          aria-invalid={!!errors.profileUrl}
          aria-describedby={describedBy("profileUrl")}
          aria-required="true"
        />
      </Field>

      {duplicate && (
        <div className="notice notice-warning stack-sm" role="alert">
          <div>
            <strong>{duplicate.fullName}</strong> is already tracked (<StatusBadge contact={duplicate} />).
          </div>
          <div className="row">
            <button type="button" className="btn btn-sm" onClick={() => onOpenContact(duplicate)}>
              Open existing record
            </button>
            <button type="button" className="btn btn-sm" onClick={() => void updateExisting(duplicate)} disabled={!!readOnlyReason}>
              Update it with these details
            </button>
            {onMarkAccepted && duplicate.lifecycleStatus === "REQUEST_SENT" && (
              <button type="button" className="btn btn-sm btn-accent" onClick={() => onMarkAccepted(duplicate)}>
                <Icon name="check" /> Mark accepted
              </button>
            )}
          </div>
        </div>
      )}

      <Field label="Full name" required htmlFor={fid("fullName")} error={errors.fullName}>
        <input
          id={fid("fullName")}
          type="text"
          autoComplete="off"
          value={form.fullName}
          onChange={(e) => set("fullName", e.target.value)}
          aria-invalid={!!errors.fullName}
          aria-describedby={describedBy("fullName")}
          aria-required="true"
          maxLength={200}
        />
      </Field>
      <details className="disclosure">
        <summary className="small">Paste profile text to fill name, role and company</summary>
        <div className="field" style={{ marginTop: 8 }}>
          <label htmlFor={fid("paste")} className="sr-only">
            Profile text
          </label>
          <textarea
            id={fid("paste")}
            rows={3}
            style={{ minHeight: 64 }}
            placeholder={"Copy the top of their profile (name and headline) or an Experience entry, then paste it here."}
            value={pasteText}
            onChange={(e) => applyPasted(e.target.value)}
          />
          <span className="hint">Parsed in this browser only. Check the fields below before saving.</span>
        </div>
      </details>
      <div className="grid-2">
        <Field label="Company" htmlFor={fid("company")}>
          <input id={fid("company")} type="text" value={form.company} onChange={(e) => set("company", e.target.value)} maxLength={200} />
        </Field>
        <Field label="Role / title" htmlFor={fid("role")}>
          <input id={fid("role")} type="text" value={form.role} onChange={(e) => set("role", e.target.value)} maxLength={200} />
        </Field>
      </div>
      <div className="grid-2">
        <Field label="Category" required htmlFor={fid("category")} hint={categorySuggested ? "Suggested from their role; change if needed." : undefined}>
          <select
            id={fid("category")}
            value={form.category}
            onChange={(e) => {
              categoryTouched.current = true;
              setCategorySuggested(false);
              set("category", e.target.value as Category);
            }}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Request sent" required htmlFor={fid("requestSentAt")} error={errors.requestSentAt}>
          <input
            id={fid("requestSentAt")}
            type="date"
            value={form.requestSentAt}
            max={today}
            onChange={(e) => set("requestSentAt", e.target.value)}
            aria-invalid={!!errors.requestSentAt}
            aria-describedby={describedBy("requestSentAt")}
          />
        </Field>
      </div>
      <Field label="Why I connected" htmlFor={fid("connectionReason")} hint="Used for {{connectionReason}}, e.g. “you lead the data platform team”.">
        <textarea
          id={fid("connectionReason")}
          rows={2}
          style={{ minHeight: 56 }}
          value={form.connectionReason}
          onChange={(e) => set("connectionReason", e.target.value)}
          maxLength={2000}
          aria-describedby={`${fid("connectionReason")}-hint`}
        />
      </Field>
      <div className="row-between">
        <label className="checkbox">
          <input type="checkbox" checked={form.priority} onChange={(e) => set("priority", e.target.checked)} />
          <Icon name="star" filled={form.priority} /> Priority
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy || !!readOnlyReason}>
          <Icon name="plus" /> {busy ? "Saving…" : "Save connection"}
        </button>
      </div>
    </form>
  );
}
