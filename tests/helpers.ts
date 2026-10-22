import type { Contact, Database } from "../src/shared/types";
import { createEmptyDatabase } from "../src/shared/schema";

export const NOW = new Date("2026-10-21T15:00:00.000Z");
export const TZ = "America/New_York";

export function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: "c1",
    profileUrl: "https://www.linkedin.com/in/jane-doe",
    normalizedProfileUrl: "https://www.linkedin.com/in/jane-doe",
    fullName: "Jane Doe",
    firstNameOverride: "",
    company: "Acme",
    role: "VP Engineering",
    category: "HIRING_LEADER",
    connectionReason: "you lead the platform team",
    notes: "",
    priority: false,
    lifecycleStatus: "REQUEST_SENT",
    requestSentAt: "2026-10-10",
    acceptedAt: null,
    acceptanceSource: null,
    initialMessageSentAt: null,
    lastMessageSentAt: null,
    repliedAt: null,
    nextFollowUpAt: null,
    archivedAt: null,
    createdAt: "2026-10-10T12:00:00.000Z",
    updatedAt: "2026-10-10T12:00:00.000Z",
    lastReviewedAt: null,
    isDemo: false,
    ...overrides,
  };
}

export function makeDb(contacts: Contact[] = []): Database {
  const db = createEmptyDatabase(NOW.toISOString());
  db.settings.timeZone = TZ;
  db.contacts = contacts;
  return db;
}
