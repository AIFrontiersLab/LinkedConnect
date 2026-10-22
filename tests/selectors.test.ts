import { describe, expect, it } from "vitest";
import { queryContacts, summarize, todayList } from "../src/shared/selectors";
import { makeContact, NOW } from "./helpers";

const c = (id: string, o: Parameters<typeof makeContact>[0] = {}) =>
  makeContact({ id, fullName: id, normalizedProfileUrl: `https://www.linkedin.com/in/${id}`, ...o });
const accepted = { lifecycleStatus: "ACCEPTED" as const, acceptedAt: "2026-10-15T00:00:00.000Z", acceptanceSource: "MANUAL" as const };

describe("today list and summary", () => {
  const contacts = [
    c("ready", accepted),
    c("starred-ready", { ...accepted, priority: true }),
    c("overdue", { nextFollowUpAt: "2026-10-19T00:00:00.000Z" }),
    c("more-overdue", { nextFollowUpAt: "2026-10-18T00:00:00.000Z" }),
    c("future", { nextFollowUpAt: "2026-10-30T00:00:00.000Z" }),
    c("archived", { ...accepted, archivedAt: NOW.toISOString(), lifecycleStatus: "ARCHIVED" }),
  ];

  it("orders starred first, then overdue reminders, then ready", () => {
    expect(todayList(contacts, NOW).map((x) => x.id)).toEqual(["starred-ready", "more-overdue", "overdue", "ready"]);
  });

  it("summarizes counts", () => {
    expect(summarize(contacts, NOW)).toMatchObject({ pending: 3, readyToMessage: 2, followUpsDue: 2, active: 5, actionable: 4 });
  });

  it("searches name, company, notes and URL, and filters by status", () => {
    const list = [c("alice", { company: "Initech" }), c("bob", { notes: "met at meetup" }), c("carol")];
    const q = { search: "", status: "" as const, category: "" as const, sort: "name" as const };
    expect(queryContacts(list, "all", { ...q, search: "initech" }, NOW).map((x) => x.id)).toEqual(["alice"]);
    expect(queryContacts(list, "all", { ...q, search: "MEETUP" }, NOW).map((x) => x.id)).toEqual(["bob"]);
    expect(queryContacts(list, "all", { ...q, search: "in/carol" }, NOW).map((x) => x.id)).toEqual(["carol"]);
    expect(queryContacts(contacts, "all", { ...q, status: "FOLLOW_UP_DUE" }, NOW)).toHaveLength(2);
  });
});
