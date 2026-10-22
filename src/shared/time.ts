// Timezone-aware helpers. Timestamps are stored in UTC; date-only fields are calendar days.

const DAY_MS = 24 * 60 * 60 * 1000;

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The configured timezone if valid, otherwise the browser's. */
export function resolveTimeZone(configured: string | undefined | null): string {
  return configured && isValidTimeZone(configured) ? configured : browserTimeZone();
}

export function supportedTimeZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  try {
    return intl.supportedValuesOf?.("timeZone") ?? [];
  } catch {
    return [];
  }
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function zonedParts(epochMs: number, tz: string): ZonedParts {
  let fmt = partsFormatterCache.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsFormatterCache.set(tz, fmt);
  }
  const out: Record<string, number> = {};
  for (const p of fmt.formatToParts(new Date(epochMs))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return {
    year: out.year!,
    month: out.month!,
    day: out.day!,
    hour: out.hour! % 24,
    minute: out.minute!,
    second: out.second!,
  };
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

function offsetMs(epochMs: number, tz: string): number {
  const p = zonedParts(epochMs, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(epochMs / 1000) * 1000;
}

/** Calendar date ("YYYY-MM-DD") of an instant in the given timezone. */
export function dateInZone(instant: Date | string | number, tz: string): string {
  const p = zonedParts(new Date(instant).getTime(), tz);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

export function todayInZone(tz: string, now: Date = new Date()): string {
  return dateInZone(now, tz);
}

/** ISO timestamp -> value for <input type="datetime-local"> in the given timezone. */
export function toZonedInputValue(iso: string | null | undefined, tz: string): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const p = zonedParts(ms, tz);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** <input type="datetime-local"> value interpreted as wall time in `tz` -> ISO UTC. */
export function fromZonedInputValue(value: string, tz: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map((v) => Number(v ?? 0)) as [number, number, number, number, number, number];
  const wallAsUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  if (Number.isNaN(wallAsUtc)) return null;
  // Two passes handle DST transitions: the offset at the guessed instant may differ from the final one.
  let guess = wallAsUtc - offsetMs(wallAsUtc, tz);
  guess = wallAsUtc - offsetMs(guess, tz);
  return new Date(guess).toISOString();
}

export function isDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
}

export function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value));
}

export function formatTimestamp(iso: string | null | undefined, tz: string, withTime = true): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  return new Intl.DateTimeFormat(undefined, {
    timeZone: tz,
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(new Date(ms));
}

/** Date-only values are calendar days; format them without shifting by timezone. */
export function formatDateOnly(value: string | null | undefined): string {
  if (!value || !isDateOnly(value)) return value ?? "";
  return new Intl.DateTimeFormat(undefined, { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" }).format(
    new Date(`${value}T00:00:00Z`),
  );
}

/** Machine-friendly "YYYY-MM-DD HH:mm" in the given timezone (used by CSV export). */
export function formatTimestampPlain(iso: string | null | undefined, tz: string): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const p = zonedParts(ms, tz);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}

/** Short relative description such as "in 3 days" or "2 hours ago". */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const diff = Date.parse(iso) - now.getTime();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (abs < 60 * 60 * 1000) return rtf.format(Math.round(diff / 60000), "minute");
  if (abs < DAY_MS) return rtf.format(Math.round(diff / 3600000), "hour");
  return rtf.format(Math.round(diff / DAY_MS), "day");
}

export function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * DAY_MS);
}

/** Following-day-at-9am style default: `days` from now at 09:00 in tz. */
export function defaultFollowUpInstant(days: number, tz: string, now: Date = new Date()): string {
  const target = dateInZone(addDays(now, days), tz);
  return fromZonedInputValue(`${target}T09:00`, tz) ?? addDays(now, days).toISOString();
}
