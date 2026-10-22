import { useId, useMemo, useState } from "react";
import type { Category, Contact, LifecycleStatus } from "../shared/types";
import { CATEGORIES, CATEGORY_LABELS, LIFECYCLE_STATUSES, STATUS_LABELS } from "../shared/types";
import { queryContacts, SORT_LABELS, type ContactQuery, type ContactTab, type SortKey } from "../shared/selectors";
import { applyTransition, updateContact } from "../shared/actions";
import { archive } from "../shared/lifecycle";
import { contactsToCsv, csvFileName } from "../shared/csv";
import { formatDateOnly, formatTimestamp, todayInZone } from "../shared/time";
import { downloadFile } from "../ui/clipboard";
import { EmptyState, Icon, PriorityStar, StatusBadges } from "../ui/components";
import { useDatabase } from "../ui/hooks";
import { PrimaryAction } from "./ContactRowActions";

const DEFAULT_SORT: Record<ContactTab, SortKey> = {
  all: "priority",
  pending: "requestDate",
  ready: "priority",
  followups: "nextFollowUp",
  archived: "updated",
};

const EMPTY: Record<ContactTab, { title: string; body: string }> = {
  all: { title: "No contacts yet", body: "Send a connection request on LinkedIn, then add the person here with their profile URL to start tracking." },
  pending: { title: "No pending requests", body: "Requests you track appear here until you confirm that the person accepted." },
  ready: {
    title: "No one is waiting for a first message",
    body: "When someone accepts your request on LinkedIn, open them under Pending requests and choose “Mark accepted”. They'll show up here.",
  },
  followups: { title: "No follow-ups scheduled", body: "After you send a message, schedule a follow-up and it will appear here when it's due." },
  archived: { title: "Nothing archived", body: "Archived contacts keep their full history and can be restored at any time." },
};

export function ContactsView({
  tab,
  now,
  onOpenContact,
  onAdd,
}: {
  tab: ContactTab;
  now: Date;
  onOpenContact: (id: string) => void;
  onAdd: () => void;
}) {
  const { db, tz, run, readOnlyReason } = useDatabase();
  const id = useId();
  const [query, setQuery] = useState<ContactQuery>({ search: "", status: "", category: "", sort: DEFAULT_SORT[tab] });
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const all = db!.contacts;
  const rows = useMemo(() => queryContacts(all, tab, query, now), [all, tab, query, now]);
  const tabTotal = useMemo(() => queryContacts(all, tab, { search: "", status: "", category: "", sort: "name" }, now).length, [all, tab, now]);
  const visibleSelected = rows.filter((c) => selected.has(c.id));
  const filtered = query.search || query.status || query.category;

  const set = <K extends keyof ContactQuery>(k: K, v: ContactQuery[K]) => setQuery((q) => ({ ...q, [k]: v }));
  const toggle = (cid: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(cid)) n.delete(cid);
      else n.add(cid);
      return n;
    });
  const allChecked = rows.length > 0 && visibleSelected.length === rows.length;

  function exportCsv(list: Contact[]) {
    downloadFile(csvFileName(todayInZone(tz, now)), contactsToCsv(list, tz, now), "text/csv;charset=utf-8");
  }

  async function bulkArchive() {
    const ids = visibleSelected.filter((c) => !c.archivedAt).map((c) => c.id);
    if (!ids.length) return;
    const r = await run(
      (d, at) => {
        for (const cid of ids) applyTransition(d, cid, (c, n) => archive(c, n), at);
        return ids.length;
      },
      (n) => `Archived ${n} contact${n === 1 ? "" : "s"}. History kept.`,
    );
    if (r.ok) setSelected(new Set());
  }

  if (tabTotal === 0) {
    const e = EMPTY[tab];
    return (
      <EmptyState
        title={e.title}
        action={
          tab === "all" || tab === "pending" ? (
            <button type="button" className="btn btn-primary" onClick={onAdd} disabled={!!readOnlyReason}>
              <Icon name="plus" /> Add connection
            </button>
          ) : undefined
        }
      >
        {e.body}
      </EmptyState>
    );
  }

  return (
    <div className="stack">
      <div className="toolbar" role="search">
        <div className="field search">
          <label htmlFor={`${id}-q`}>Search</label>
          <input
            id={`${id}-q`}
            type="search"
            placeholder="Name, company, notes or URL"
            value={query.search}
            onChange={(e) => set("search", e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={`${id}-status`}>Status</label>
          <select id={`${id}-status`} value={query.status} onChange={(e) => set("status", e.target.value as LifecycleStatus | "FOLLOW_UP_DUE" | "")}>
            <option value="">Any status</option>
            {LIFECYCLE_STATUSES.filter((s) => (tab === "archived" ? s === "ARCHIVED" : s !== "ARCHIVED")).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
            {tab !== "archived" && <option value="FOLLOW_UP_DUE">Follow-up due</option>}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${id}-cat`}>Category</label>
          <select id={`${id}-cat`} value={query.category} onChange={(e) => set("category", e.target.value as Category | "")}>
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${id}-sort`}>Sort by</label>
          <select id={`${id}-sort`} value={query.sort} onChange={(e) => set("sort", e.target.value as SortKey)}>
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <option key={k} value={k}>
                {SORT_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="btn" onClick={() => exportCsv(rows)} disabled={rows.length === 0}>
          <Icon name="download" /> Export view (CSV)
        </button>
      </div>

      <div className="row-between" aria-live="polite">
        <span className="small muted">
          Showing {rows.length} of {tabTotal}
          {filtered ? " (filtered)" : ""}
        </span>
        {visibleSelected.length > 0 && (
          <div className="row" role="group" aria-label="Bulk actions">
            <span className="small">
              <strong>{visibleSelected.length}</strong> selected
            </span>
            {tab !== "archived" && (
              <button type="button" className="btn btn-sm" onClick={() => void bulkArchive()} disabled={!!readOnlyReason}>
                <Icon name="archive" size={14} /> Archive selected
              </button>
            )}
            <button type="button" className="btn btn-sm" onClick={() => exportCsv(visibleSelected)}>
              <Icon name="download" size={14} /> Export selected
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSelected(new Set())}>
              Clear selection
            </button>
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No matches"
          action={
            <button type="button" className="btn" onClick={() => setQuery({ search: "", status: "", category: "", sort: query.sort })}>
              Clear filters
            </button>
          }
        >
          No contacts in this view match your search and filters.
        </EmptyState>
      ) : (
        <div className="table-wrap responsive">
          <table className="contacts">
            <caption className="sr-only">Contacts</caption>
            <thead>
              <tr>
                <th scope="col" style={{ width: 36 }}>
                  <input
                    type="checkbox"
                    aria-label="Select all contacts in this view"
                    checked={allChecked}
                    onChange={() => setSelected(allChecked ? new Set() : new Set(rows.map((c) => c.id)))}
                  />
                </th>
                <th scope="col">Name</th>
                <th scope="col">Company</th>
                <th scope="col">Category</th>
                <th scope="col">Status</th>
                <th scope="col">Request date</th>
                <th scope="col">Accepted</th>
                <th scope="col">Next follow-up</th>
                <th scope="col">Priority</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>
                    <input type="checkbox" aria-label={`Select ${c.fullName}`} checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                  </td>
                  <td data-label="Name">
                    <button type="button" className="link-btn" onClick={() => onOpenContact(c.id)}>
                      {c.fullName}
                    </button>
                    {c.role && <span className="cell-sub">{c.role}</span>}
                  </td>
                  <td data-label="Company">{c.company || <span className="muted">—</span>}</td>
                  <td data-label="Category" className="nowrap">
                    {CATEGORY_LABELS[c.category]}
                  </td>
                  <td data-label="Status">
                    <StatusBadges contact={c} now={now} />
                  </td>
                  <td data-label="Request date" className="nowrap">
                    {formatDateOnly(c.requestSentAt)}
                  </td>
                  <td data-label="Accepted" className="nowrap">
                    {c.acceptedAt ? formatTimestamp(c.acceptedAt, tz, false) : <span className="muted">—</span>}
                  </td>
                  <td data-label="Next follow-up" className="nowrap">
                    {c.nextFollowUpAt ? formatTimestamp(c.nextFollowUpAt, tz) : <span className="muted">—</span>}
                  </td>
                  <td data-label="Priority">
                    <PriorityStar
                      on={c.priority}
                      label={c.fullName}
                      onToggle={readOnlyReason ? undefined : () => void run((d, at) => updateContact(d, c.id, { priority: !c.priority }, at))}
                    />
                  </td>
                  <td data-label="Actions">
                    <div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                      <PrimaryAction contact={c} now={now} />
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => onOpenContact(c.id)} aria-label={`Details for ${c.fullName}`}>
                        Details
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
