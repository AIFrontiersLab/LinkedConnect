// Core data model. Field naming conventions:
//   *Date   / requestSentAt  -> date-only string "YYYY-MM-DD" (no timezone; a calendar day)
//   *At (all others)         -> ISO-8601 UTC timestamp string, e.g. "2026-10-21T17:05:00.000Z"
// Timestamps are displayed in the timezone configured in Settings.

export const SCHEMA_VERSION = 1;

export const CATEGORIES = [
  "RECRUITER",
  "HIRING_LEADER",
  "POTENTIAL_CLIENT",
  "BUSINESS_PARTNER",
  "AI_COMMUNITY",
  "OTHER",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  RECRUITER: "Recruiter",
  HIRING_LEADER: "Hiring Leader",
  POTENTIAL_CLIENT: "Potential Client",
  BUSINESS_PARTNER: "Business Partner",
  AI_COMMUNITY: "AI Community",
  OTHER: "Other",
};

export const LIFECYCLE_STATUSES = ["REQUEST_SENT", "ACCEPTED", "MESSAGE_SENT", "REPLIED", "ARCHIVED"] as const;
export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];

export const STATUS_LABELS: Record<LifecycleStatus, string> = {
  REQUEST_SENT: "Request sent",
  ACCEPTED: "Accepted",
  MESSAGE_SENT: "Message sent",
  REPLIED: "Replied",
  ARCHIVED: "Archived",
};

/** Only manual confirmation exists in this version; no automatic detection is performed. */
export type AcceptanceSource = "MANUAL";

/** ISO-8601 UTC timestamp. */
export type Timestamp = string;
/** Calendar date "YYYY-MM-DD". */
export type DateOnly = string;

export interface Contact {
  id: string;
  /** URL as entered by the user (kept for reference). */
  profileUrl: string;
  /** Canonical https://www.linkedin.com/in/{slug} form; the duplicate key. */
  normalizedProfileUrl: string;
  fullName: string;
  /** Used for {{firstName}} when the first token of fullName is unsuitable. */
  firstNameOverride: string;
  company: string;
  role: string;
  category: Category;
  connectionReason: string;
  notes: string;
  priority: boolean;
  lifecycleStatus: LifecycleStatus;
  requestSentAt: DateOnly;
  acceptedAt: Timestamp | null;
  acceptanceSource: AcceptanceSource | null;
  initialMessageSentAt: Timestamp | null;
  lastMessageSentAt: Timestamp | null;
  repliedAt: Timestamp | null;
  nextFollowUpAt: Timestamp | null;
  archivedAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  /** Set when the user opens the contact after an acceptance was confirmed. */
  lastReviewedAt: Timestamp | null;
  /** True for records created by "Load demo data". */
  isDemo: boolean;
}

export const ACTIVITY_TYPES = [
  "CREATED",
  "UPDATED",
  "ACCEPTED",
  "MESSAGE_SENT",
  "REPLIED",
  "FOLLOW_UP_SCHEDULED",
  "FOLLOW_UP_CLEARED",
  "ARCHIVED",
  "RESTORED",
  "STATUS_CORRECTED",
  "NOTE",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export interface Activity {
  id: string;
  contactId: string;
  activityType: ActivityType;
  timestamp: Timestamp;
  templateId?: string;
  messageText?: string;
  note?: string;
}

export interface Template {
  id: string;
  name: string;
  body: string;
  /** Starter templates ship with the extension; they are still fully editable and deletable. */
  isStarter: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type ThemePreference = "system" | "light" | "dark";

export interface Settings {
  myName: string;
  myTitle: string;
  myCompany: string;
  communityUrl: string;
  /** IANA timezone, e.g. "America/New_York". Empty means "use the browser timezone". */
  timeZone: string;
  theme: ThemePreference;
  desktopReminders: boolean;
  defaultFollowUpDays: number;
  defaultTemplateByCategory: Record<Category, string | null>;
  followUpTemplateId: string | null;
}

export interface ReminderState {
  /** Reminder identifiers ("contactId|nextFollowUpAt") already notified; prevents duplicate alerts. */
  notifiedKeys: string[];
  lastReconciledAt: Timestamp | null;
}

export interface Database {
  schemaVersion: number;
  /** Incremented on every committed mutation. */
  revision: number;
  contacts: Contact[];
  activities: Activity[];
  templates: Template[];
  settings: Settings;
  reminders: ReminderState;
  /** Records that failed validation during migration. Kept, never silently dropped. */
  quarantine: unknown[];
}

export interface Draft {
  contactId: string;
  templateId: string | null;
  text: string;
  updatedAt: Timestamp;
}
