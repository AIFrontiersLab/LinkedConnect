// Excel-friendly CSV export: UTF-8 with BOM, CRLF rows, RFC 4180 quoting and
// neutralization of spreadsheet formula injection.

import type { Contact } from "./types";
import { CATEGORY_LABELS, STATUS_LABELS } from "./types";
import { isFollowUpDue, isReadyForInitialMessage } from "./lifecycle";
import { firstNameOf } from "./templates";
import { formatTimestampPlain } from "./time";

export const UTF8_BOM = "﻿";

/**
 * Values starting with these characters can be interpreted as formulas by Excel, Sheets etc.
 * Such values are prefixed with an apostrophe so they display as text.
 */
const FORMULA_TRIGGER = /^[=+\-@\t\r＝＋－＠]/;

export function neutralizeFormula(value: string): string {
  return FORMULA_TRIGGER.test(value) ? `'${value}` : value;
}

export function escapeCsvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Cell for user-controlled text: neutralize first, then escape. */
export function csvCell(value: string | null | undefined): string {
  return escapeCsvField(neutralizeFormula(value ?? ""));
}

export function toCsv(rows: ReadonlyArray<ReadonlyArray<string>>): string {
  return UTF8_BOM + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function contactsToCsv(contacts: readonly Contact[], tz: string, now: Date = new Date()): string {
  const t = (iso: string | null) => formatTimestampPlain(iso, tz);
  const zone = `(${tz})`;
  const header = [
    "Full name",
    "First name",
    "Company",
    "Role / title",
    "Category",
    "Status",
    "Follow-up due",
    "Ready to message",
    "Starred",
    "LinkedIn profile URL",
    "Why I connected",
    "Notes",
    "Request sent date",
    `Accepted at ${zone}`,
    "Acceptance source",
    `First message sent at ${zone}`,
    `Last message sent at ${zone}`,
    `Replied at ${zone}`,
    `Next follow-up ${zone}`,
    `Archived at ${zone}`,
    `Created at ${zone}`,
    `Updated at ${zone}`,
  ];
  const rows = contacts.map((c) => [
    c.fullName,
    firstNameOf(c),
    c.company,
    c.role,
    CATEGORY_LABELS[c.category],
    STATUS_LABELS[c.lifecycleStatus],
    isFollowUpDue(c, now) ? "Yes" : "No",
    isReadyForInitialMessage(c) ? "Yes" : "No",
    c.priority ? "Yes" : "No",
    c.normalizedProfileUrl,
    c.connectionReason,
    c.notes,
    c.requestSentAt,
    t(c.acceptedAt),
    c.acceptanceSource === "MANUAL" ? "Manual confirmation" : "",
    t(c.initialMessageSentAt),
    t(c.lastMessageSentAt),
    t(c.repliedAt),
    t(c.nextFollowUpAt),
    t(c.archivedAt),
    t(c.createdAt),
    t(c.updatedAt),
  ]);
  return toCsv([header, ...rows]);
}

export function csvFileName(today: string): string {
  return `linkedmaven-connections-${today}.csv`;
}
