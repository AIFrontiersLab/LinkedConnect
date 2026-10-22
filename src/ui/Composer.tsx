// Message composer: pick a template, edit the draft, copy it and open the profile.
// Nothing here marks a message as sent; that requires the explicit "Mark message sent" step.

import { useEffect, useId, useRef, useState } from "react";
import type { Contact, Settings } from "../shared/types";
import { markReviewed, updateContact, updateSettings } from "../shared/actions";
import { isNewSinceReview } from "../shared/lifecycle";
import {
  isKnownPlaceholder,
  PLACEHOLDER_LABELS,
  placeholderValues,
  renderTemplate,
  suggestedTemplateId,
  unresolvedPlaceholders,
  type Placeholder,
} from "../shared/templates";
import { getRepository } from "../shared/storage";
import { openProfile } from "../shared/navigation";
import { Dialog, Icon, StatusBadges } from "./components";
import { HighlightedText } from "./HighlightedText";
import { copyText } from "./clipboard";
import { useDatabase, useToast, errorMessage } from "./hooks";

const CONTACT_FIELDS: Partial<Record<Placeholder, keyof Contact>> = {
  firstName: "firstNameOverride",
  fullName: "fullName",
  company: "company",
  role: "role",
  connectionReason: "connectionReason",
};
const SETTINGS_FIELDS: Partial<Record<Placeholder, keyof Settings>> = {
  myName: "myName",
  myTitle: "myTitle",
  myCompany: "myCompany",
  communityUrl: "communityUrl",
};

export function Composer({
  contact,
  onClose,
  onMarkSent,
}: {
  contact: Contact;
  onClose: () => void;
  onMarkSent: (message: { templateId: string | null; text: string }) => void;
}) {
  const { db, run, readOnlyReason } = useDatabase();
  const { notify } = useToast();
  const repo = getRepository();
  const id = useId();
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [dirty, setDirty] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const fallbackRef = useRef<HTMLTextAreaElement>(null);

  const settings = db!.settings;
  const templates = db!.templates;

  const renderFrom = (tid: string | null, c: Contact = contact, s: Settings = settings) => {
    const t = templates.find((x) => x.id === tid);
    return t ? renderTemplate(t.body, placeholderValues(c, s)).text : "";
  };

  // Preparing a message counts as reviewing a newly confirmed acceptance.
  useEffect(() => {
    if (isNewSinceReview(contact)) void run((d, at) => markReviewed(d, [contact.id], at), undefined, { silentErrors: true });
  }, [contact, run]);

  // Restore a saved draft (e.g. after the popup closed), otherwise start from the suggested template.
  useEffect(() => {
    let cancelled = false;
    void repo
      .loadDrafts()
      .catch(() => ({}) as Record<string, never>)
      .then((drafts) => {
        if (cancelled) return;
        const saved = (drafts as Record<string, { templateId: string | null; text: string }>)[contact.id];
        if (saved?.text) {
          setTemplateId(saved.templateId);
          setText(saved.text);
          setDirty(true);
        } else {
          const tid = suggestedTemplateId(contact, settings, templates);
          setTemplateId(tid);
          setText(renderFrom(tid));
        }
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
    // Only on open; later changes are applied explicitly.
  }, [contact.id]);

  const saveDraft = async () => {
    if (!dirty) return;
    try {
      await repo.saveDraft({ contactId: contact.id, templateId, text, updatedAt: new Date().toISOString() });
    } catch (err) {
      setProblem(`Your draft couldn't be saved: ${errorMessage(err)}. Copy it somewhere safe before closing.`);
    }
  };

  useEffect(() => {
    if (!loaded || !dirty) return;
    const h = setTimeout(() => void saveDraft(), 500);
    return () => clearTimeout(h);
  }, [text, templateId, loaded, dirty]);

  useEffect(() => {
    if (fallback) fallbackRef.current?.select();
  }, [fallback]);

  const unresolved = unresolvedPlaceholders(text);
  const canCopy = loaded && text.trim().length > 0 && unresolved.length === 0;

  function chooseTemplate(tid: string) {
    if (dirty && text !== renderFrom(templateId) && !window.confirm("Replace your edited draft with this template?")) return;
    setTemplateId(tid || null);
    setText(renderFrom(tid || null));
    setDirty(true);
  }

  async function copy(): Promise<boolean> {
    setProblem(null);
    if (!canCopy) return false;
    const ok = await copyText(text);
    if (ok) {
      setFallback(false);
      notify("Message copied. Paste it into LinkedIn messaging.");
    } else {
      setFallback(true);
    }
    return ok;
  }

  async function open(): Promise<void> {
    setProblem(null);
    await saveDraft();
    try {
      await openProfile(contact.normalizedProfileUrl);
    } catch (err) {
      setProblem(`Couldn't open the profile: ${errorMessage(err)}. Your draft is still here.`);
    }
  }

  async function copyAndOpen() {
    if (await copy()) await open();
  }

  return (
    <Dialog open onClose={onClose} title={`Message ${contact.fullName}`} className="wide">
      <div className="row">
        <StatusBadges contact={contact} now={new Date()} />
        <span className="muted small">{[contact.role, contact.company].filter(Boolean).join(" · ")}</span>
      </div>

      <div className="field">
        <label htmlFor={`${id}-tpl`}>Template</label>
        <div className="row">
          <select id={`${id}-tpl`} className="grow" style={{ width: "auto" }} value={templateId ?? ""} onChange={(e) => chooseTemplate(e.target.value)}>
            <option value="">(Blank)</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-sm" onClick={() => chooseTemplate(templateId ?? "")} disabled={!templateId}>
            Reset to template
          </button>
        </div>
      </div>

      <div className="field">
        <label htmlFor={`${id}-draft`}>Your message (editable)</label>
        <textarea
          id={`${id}-draft`}
          rows={8}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setDirty(true);
          }}
          aria-describedby={`${id}-count ${id}-missing`}
          disabled={!loaded}
        />
        <span className="hint" id={`${id}-count`}>
          {text.length.toLocaleString()} characters. LinkedIn messages allow far more; connection-request notes are limited to 300.
        </span>
      </div>

      <div id={`${id}-missing`} aria-live="polite">
        {unresolved.length > 0 ? (
          <div className="notice notice-warning stack-sm">
            <strong>
              Fill in {unresolved.length === 1 ? "1 missing field" : `${unresolved.length} missing fields`} before copying:
            </strong>
            {unresolved.map((name) => (
              <MissingField key={name} name={name} contact={contact} disabled={!!readOnlyReason}
                onFill={async (value) => {
                  const cf = isKnownPlaceholder(name) ? CONTACT_FIELDS[name] : undefined;
                  const sf = isKnownPlaceholder(name) ? SETTINGS_FIELDS[name] : undefined;
                  const r = cf
                    ? await run((d, now) => updateContact(d, contact.id, { [cf]: value }, now))
                    : sf
                      ? await run((d) => updateSettings(d, { [sf]: value }))
                      : { ok: true as const };
                  if (r.ok) {
                    setText((t) => t.replace(new RegExp(`\\{\\{\\s*${name}\\s*\\}\\}`, "g"), () => value));
                    setDirty(true);
                  }
                }}
              />
            ))}
            <div className="preview" aria-label="Preview with missing fields highlighted">
              <HighlightedText text={text} />
            </div>
          </div>
        ) : (
          loaded && text.trim() && <p className="small muted"><Icon name="check" size={14} /> All placeholders are filled in.</p>
        )}
      </div>

      {fallback && (
        <div className="notice notice-warning stack-sm" role="alert">
          <strong>Chrome didn't allow automatic copying.</strong>
          <span>The text below is selected. Press ⌘C (Mac) or Ctrl+C (Windows/Linux) to copy it.</span>
          <textarea ref={fallbackRef} readOnly value={text} rows={4} aria-label="Message text to copy manually" onFocus={(e) => e.target.select()} />
        </div>
      )}
      {problem && (
        <div className="notice notice-error" role="alert">
          {problem}
        </div>
      )}

      <div className="dialog-actions">
        <button type="button" className="btn" onClick={() => void copy()} disabled={!canCopy}>
          <Icon name="copy" /> Copy message
        </button>
        <button type="button" className="btn" onClick={() => void open()}>
          <Icon name="external" /> Open LinkedIn profile
        </button>
        <button type="button" className="btn btn-accent" onClick={() => void copyAndOpen()} disabled={!canCopy}>
          <Icon name="copy" /> Copy + open profile
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => onMarkSent({ templateId, text })}
          disabled={!contact.acceptedAt || !!contact.archivedAt || !!readOnlyReason}
          title={!contact.acceptedAt ? "Confirm the acceptance first" : undefined}
        >
          <Icon name="send" /> Mark message sent…
        </button>
      </div>
      <p className="small muted">
        After copying, open their profile, click <em>Message</em> on LinkedIn, paste and send it yourself. Then come back and choose
        “Mark message sent”.
      </p>
    </Dialog>
  );
}

function MissingField({
  name,
  contact,
  onFill,
  disabled,
}: {
  name: string;
  contact: Contact;
  onFill: (value: string) => Promise<void>;
  disabled: boolean;
}) {
  const id = useId();
  const [value, setValue] = useState(() => (name === "firstName" ? contact.fullName.split(/\s+/)[0] ?? "" : ""));
  if (!isKnownPlaceholder(name)) {
    return (
      <div className="small">
        <code>{`{{${name}}}`}</code> isn't a supported placeholder. Edit the draft to remove or replace it.
      </div>
    );
  }
  const where = SETTINGS_FIELDS[name] ? "saved to Settings" : "saved to this contact";
  return (
    <form
      className="row"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) void onFill(value.trim());
      }}
    >
      <label htmlFor={id} className="small" style={{ minWidth: 150 }}>
        <mark className="ph-missing">{`{{${name}}}`}</mark> {PLACEHOLDER_LABELS[name]}
      </label>
      <input id={id} type="text" className="grow" style={{ width: "auto", flex: 1 }} value={value} onChange={(e) => setValue(e.target.value)} />
      <button type="submit" className="btn btn-sm" disabled={!value.trim() || disabled} title={`Fills the draft and is ${where}`}>
        Fill in
      </button>
    </form>
  );
}
