// Demo data for trying the extension. Only loaded when the user clicks "Load demo data";
// every record is flagged isDemo so it can be removed in one step.

import type { Category, Database } from "./types";
import { addContact, applyTransition, DuplicateContactError } from "./actions";
import { archive, markAccepted, markMessageSent, markReplied } from "./lifecycle";
import { addDays, dateInZone, resolveTimeZone } from "./time";

interface DemoSeed {
  slug: string;
  name: string;
  company: string;
  role: string;
  category: Category;
  reason: string;
  daysAgo: number;
  priority?: boolean;
  /** Days ago the acceptance happened, if accepted. */
  acceptedDaysAgo?: number;
  messagedDaysAgo?: number;
  /** Follow-up offset from now in days (negative = overdue). */
  followUpInDays?: number;
  repliedDaysAgo?: number;
  archived?: boolean;
}

const SEEDS: DemoSeed[] = [
  { slug: "demo-avery-sample", name: "Avery Sample (demo)", company: "Example Labs", role: "Technical Recruiter", category: "RECRUITER", reason: "you recruit for platform engineering roles", daysAgo: 2 },
  { slug: "demo-jordan-placeholder", name: "Jordan Placeholder (demo)", company: "Acme Analytics", role: "VP Engineering", category: "HIRING_LEADER", reason: "you lead the data platform team", daysAgo: 6, priority: true, acceptedDaysAgo: 1 },
  { slug: "demo-riley-example", name: "Riley Example (demo)", company: "Northwind Retail", role: "Head of Operations", category: "POTENTIAL_CLIENT", reason: "your team is modernizing its analytics stack", daysAgo: 10, acceptedDaysAgo: 4 },
  { slug: "demo-sam-testcase", name: "Sam Testcase (demo)", company: "Contoso Partners", role: "Partnerships Lead", category: "BUSINESS_PARTNER", reason: "you run the partner program", daysAgo: 20, acceptedDaysAgo: 18, messagedDaysAgo: 14, followUpInDays: -2 },
  { slug: "demo-casey-mock", name: "Casey Mock (demo)", company: "", role: "ML Engineer", category: "AI_COMMUNITY", reason: "you write about applied AI", daysAgo: 15, priority: true, acceptedDaysAgo: 12, messagedDaysAgo: 10, followUpInDays: 3 },
  { slug: "demo-morgan-fixture", name: "Morgan Fixture (demo)", company: "Fabrikam", role: "Director of Engineering", category: "HIRING_LEADER", reason: "you're hiring staff engineers", daysAgo: 30, acceptedDaysAgo: 28, messagedDaysAgo: 25, repliedDaysAgo: 22 },
  { slug: "demo-taylor-sandbox", name: "Taylor Sandbox (demo)", company: "Tailspin Toys", role: "Talent Partner", category: "RECRUITER", reason: "", daysAgo: 45, archived: true },
];

export function loadDemoData(db: Database, now: Date): { added: number; skipped: number } {
  const tz = resolveTimeZone(db.settings.timeZone);
  let added = 0;
  let skipped = 0;
  const at = (daysAgo: number) => addDays(now, -daysAgo).toISOString();
  for (const s of SEEDS) {
    let id: string;
    try {
      id = addContact(
        db,
        {
          profileUrl: `https://www.linkedin.com/in/${s.slug}`,
          fullName: s.name,
          company: s.company,
          role: s.role,
          category: s.category,
          connectionReason: s.reason,
          requestSentAt: dateInZone(addDays(now, -s.daysAgo), tz),
          priority: s.priority,
          notes: "Demo record. Remove with Settings → Remove demo data.",
        },
        now,
        { isDemo: true },
      ).id;
    } catch (err) {
      if (err instanceof DuplicateContactError) {
        skipped++;
        continue;
      }
      throw err;
    }
    added++;
    if (s.acceptedDaysAgo !== undefined) applyTransition(db, id, (c, n, z) => markAccepted(c, at(s.acceptedDaysAgo!), n, z), now);
    if (s.messagedDaysAgo !== undefined) {
      const followUpAt = s.followUpInDays !== undefined ? addDays(now, s.followUpInDays).toISOString() : null;
      applyTransition(db, id, (c, n, z) => markMessageSent(c, { sentAt: at(s.messagedDaysAgo!), followUpAt }, n, z), now);
    }
    if (s.repliedDaysAgo !== undefined) applyTransition(db, id, (c, n, z) => markReplied(c, at(s.repliedDaysAgo!), n, z), now);
    if (s.archived) applyTransition(db, id, (c, n) => archive(c, n), now);
  }
  return { added, skipped };
}

export function removeDemoData(db: Database): number {
  const demoIds = new Set(db.contacts.filter((c) => c.isDemo).map((c) => c.id));
  db.contacts = db.contacts.filter((c) => !demoIds.has(c.id));
  db.activities = db.activities.filter((a) => !demoIds.has(a.contactId));
  db.reminders.notifiedKeys = db.reminders.notifiedKeys.filter((k) => !demoIds.has(k.split("|")[0]!));
  return demoIds.size;
}
