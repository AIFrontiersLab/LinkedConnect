import { useEffect, useId, useRef, useState } from "react";
import type { Category, Template } from "../shared/types";
import { CATEGORIES, CATEGORY_LABELS } from "../shared/types";
import { createTemplate, deleteTemplate, duplicateTemplate, updateSettings, updateTemplate } from "../shared/actions";
import { PLACEHOLDERS, PLACEHOLDER_LABELS, placeholderValues, renderTemplate, unresolvedPlaceholders } from "../shared/templates";
import { Dialog, EmptyState, Field, Icon } from "../ui/components";
import { HighlightedText } from "../ui/HighlightedText";
import { useDatabase } from "../ui/hooks";

export function TemplatesView() {
  const { db, run, readOnlyReason } = useDatabase();
  const templates = db!.templates;
  const [selectedId, setSelectedId] = useState<string | null>(templates[0]?.id ?? null);
  const selected = templates.find((t) => t.id === selectedId) ?? null;

  useEffect(() => {
    if (!selected && templates[0]) setSelectedId(templates[0].id);
  }, [selected, templates]);

  async function create() {
    const r = await run((d, now) => createTemplate(d, { name: "New template", body: "Hi {{firstName}},\n\n\n\nBest,\n{{myName}}" }, now), "Template created.");
    if (r.ok) setSelectedId(r.result.id);
  }

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="stack-sm">
        <h1>Message templates</h1>
        <p className="muted">
          Keep messages short and genuine. Placeholders like <code>{"{{firstName}}"}</code> are filled from the contact and from your
          details in Settings. Copying is blocked while any placeholder is still unfilled.
        </p>
      </div>
      <div className="templates-layout">
        <aside className="card stack-sm" aria-label="Templates">
          <div className="row-between">
            <h3>Templates</h3>
            <button type="button" className="btn btn-sm" onClick={() => void create()} disabled={!!readOnlyReason}>
              <Icon name="plus" size={14} /> New
            </button>
          </div>
          {templates.length === 0 ? (
            <p className="small muted">No templates. Create one to get started.</p>
          ) : (
            <ul className="template-list">
              {templates.map((t) => (
                <li key={t.id}>
                  <button type="button" aria-current={t.id === selectedId} onClick={() => setSelectedId(t.id)}>
                    {t.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
        {selected ? (
          <TemplateEditor key={selected.id} template={selected} onDuplicated={setSelectedId} onDeleted={() => setSelectedId(null)} />
        ) : (
          <EmptyState title="No template selected" action={<button type="button" className="btn btn-primary" onClick={() => void create()}>Create template</button>}>
            Templates help you send consistent, personal follow-ups.
          </EmptyState>
        )}
      </div>
      <DefaultTemplates />
    </div>
  );
}

function TemplateEditor({ template, onDuplicated, onDeleted }: { template: Template; onDuplicated: (id: string) => void; onDeleted: () => void }) {
  const { db, run, readOnlyReason } = useDatabase();
  const id = useId();
  const [name, setName] = useState(template.name);
  const [body, setBody] = useState(template.body);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const activeContacts = db!.contacts.filter((c) => !c.archivedAt);
  const [previewId, setPreviewId] = useState<string>(activeContacts[0]?.id ?? "");
  const previewContact = db!.contacts.find((c) => c.id === previewId) ?? null;
  const dirty = name !== template.name || body !== template.body;
  const values = placeholderValues(previewContact, db!.settings);
  const rendered = renderTemplate(body, values);
  const unknown = rendered.unknown;
  const ro = !!readOnlyReason;

  function insert(ph: string) {
    const el = bodyRef.current;
    const token = `{{${ph}}}`;
    if (!el) return setBody((b) => b + token);
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = body.slice(0, start) + token + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  return (
    <section className="card stack" aria-label={`Edit template ${template.name}`}>
      <Field label="Template name" required htmlFor={`${id}-name`}>
        <input id={`${id}-name`} type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} disabled={ro} />
      </Field>
      <div className="field">
        <label htmlFor={`${id}-body`}>Message</label>
        <textarea id={`${id}-body`} ref={bodyRef} rows={9} value={body} onChange={(e) => setBody(e.target.value)} maxLength={8000} disabled={ro} aria-describedby={`${id}-count`} />
        <span className="hint" id={`${id}-count`}>
          {body.length.toLocaleString()} characters in the template · {rendered.text.length.toLocaleString()} in the preview below
        </span>
      </div>
      <div className="stack-sm">
        <span className="label">Insert placeholder</span>
        <div className="row" style={{ gap: 4 }}>
          {PLACEHOLDERS.map((p) => (
            <button key={p} type="button" className="chip" onClick={() => insert(p)} title={PLACEHOLDER_LABELS[p]} disabled={ro}>
              {`{{${p}}}`}
            </button>
          ))}
        </div>
      </div>
      {unknown.length > 0 && (
        <div className="notice notice-warning" role="alert">
          Unsupported placeholder{unknown.length > 1 ? "s" : ""}: {unknown.map((u) => `{{${u}}}`).join(", ")}. These will block copying.
        </div>
      )}

      <div className="stack-sm">
        <div className="row-between">
          <span className="label">Preview</span>
          <div className="row">
            <label htmlFor={`${id}-preview`} className="small">
              Using contact
            </label>
            <select id={`${id}-preview`} value={previewId} onChange={(e) => setPreviewId(e.target.value)} style={{ width: "auto" }}>
              <option value="">(No contact, settings only)</option>
              {activeContacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.fullName}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="preview" aria-live="polite">
          <HighlightedText text={body} values={values} />
        </div>
        {rendered.missing.length > 0 && (
          <p className="small">
            <mark className="ph-missing">Missing</mark> for this contact: {rendered.missing.map((m) => PLACEHOLDER_LABELS[m]).join(", ")}. You
            can fill these in when composing.
          </p>
        )}
        {unresolvedPlaceholders(rendered.text).length === 0 && <p className="small muted">Everything resolves for this contact.</p>}
      </div>

      <div className="row-between">
        <div className="row">
          <button type="button" className="btn" onClick={() => void run((d, now) => duplicateTemplate(d, template.id, now), "Template duplicated.").then((r) => r.ok && onDuplicated(r.result.id))} disabled={ro}>
            Duplicate
          </button>
          <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)} disabled={ro}>
            <Icon name="trash" size={14} /> Delete
          </button>
        </div>
        <div className="row">
          {dirty && (
            <button type="button" className="btn btn-ghost" onClick={() => { setName(template.name); setBody(template.body); }}>
              Discard changes
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            disabled={!dirty || ro || !name.trim()}
            onClick={() => void run((d, now) => updateTemplate(d, template.id, { name, body }, now), "Template saved.")}
          >
            Save template
          </button>
        </div>
      </div>

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete template?" description={`“${template.name}” will be removed. Categories using it as their default will have no default until you pick another.`}>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={() => setConfirmDelete(false)} autoFocus>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() =>
              void run((d) => deleteTemplate(d, template.id), "Template deleted.").then((r) => {
                setConfirmDelete(false);
                if (r.ok) onDeleted();
              })
            }
          >
            Delete template
          </button>
        </div>
      </Dialog>
    </section>
  );
}

function DefaultTemplates() {
  const { db, run, readOnlyReason } = useDatabase();
  const id = useId();
  const { templates, settings } = db!;
  const setDefault = (cat: Category, value: string) =>
    run((d) => updateSettings(d, { defaultTemplateByCategory: { ...d.settings.defaultTemplateByCategory, [cat]: value || null } }), "Default updated.");
  return (
    <section className="card stack" aria-labelledby={`${id}-h`}>
      <div className="stack-sm">
        <h3 id={`${id}-h`}>Default template by category</h3>
        <p className="small muted">Used when you prepare a first message. After the first message, the follow-up template is suggested.</p>
      </div>
      <div className="settings-grid" style={{ gap: 12 }}>
        {CATEGORIES.map((cat) => (
          <Field key={cat} label={CATEGORY_LABELS[cat]} htmlFor={`${id}-${cat}`}>
            <select id={`${id}-${cat}`} value={settings.defaultTemplateByCategory[cat] ?? ""} onChange={(e) => void setDefault(cat, e.target.value)} disabled={!!readOnlyReason}>
              <option value="">(None)</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
        ))}
        <Field label="Follow-up messages" htmlFor={`${id}-followup`}>
          <select
            id={`${id}-followup`}
            value={settings.followUpTemplateId ?? ""}
            onChange={(e) => void run((d) => updateSettings(d, { followUpTemplateId: e.target.value || null }), "Default updated.")}
            disabled={!!readOnlyReason}
          >
            <option value="">(Same as category default)</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </section>
  );
}
