// LinkedIn person-profile URL validation and normalization.
// Only the URL's structure is checked; nothing about the person is inferred from it.

export type ProfileUrlResult =
  | { ok: true; normalized: string; slug: string }
  | { ok: false; error: string };

const CANONICAL_HOST = "www.linkedin.com";
// Regional hosts look like "uk.linkedin.com" or "de.linkedin.com"; "m." is the mobile site.
const ALLOWED_SUBDOMAIN = /^(?:www|m|[a-z]{2})$/;
const SLUG_PATTERN = /^[\p{L}\p{N}_-]{2,100}$/u;

function isLinkedInHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === "linkedin.com") return true;
  if (!host.endsWith(".linkedin.com")) return false;
  const sub = host.slice(0, -".linkedin.com".length);
  return ALLOWED_SUBDOMAIN.test(sub);
}

export function normalizeProfileUrl(input: string): ProfileUrlResult {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: "Enter a LinkedIn profile URL." };
  if (/\s/.test(trimmed)) return { ok: false, error: "The URL must not contain spaces." };

  // Allow pasting without a scheme ("linkedin.com/in/jane-doe").
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, error: "That doesn't look like a valid URL." };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, error: "Only http(s) LinkedIn profile links are supported." };
  }
  if (url.username || url.password || url.port) {
    return { ok: false, error: "LinkedIn profile links don't include credentials or ports." };
  }
  if (!isLinkedInHost(url.hostname)) {
    return { ok: false, error: "The link must be on linkedin.com." };
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[0]?.toLowerCase() !== "in" || segments.length < 2) {
    return {
      ok: false,
      error: "Use a person's profile link in the form linkedin.com/in/their-name (company and other pages aren't supported).",
    };
  }

  let slug: string;
  try {
    slug = decodeURIComponent(segments[1]!);
  } catch {
    return { ok: false, error: "The profile name in the URL is malformed." };
  }
  slug = slug.normalize("NFC").toLowerCase();
  if (!SLUG_PATTERN.test(slug)) {
    return { ok: false, error: "The profile name in the URL contains unsupported characters." };
  }

  // Extra segments (e.g. /in/jane/details/experience) and query/fragment are dropped.
  return { ok: true, slug, normalized: `https://${CANONICAL_HOST}/in/${encodeURIComponent(slug)}` };
}

/** Finds an existing contact with the same normalized profile URL. */
export function findDuplicate<T extends { id: string; normalizedProfileUrl: string }>(
  contacts: readonly T[],
  normalizedUrl: string,
  excludeId?: string,
): T | undefined {
  return contacts.find((c) => c.normalizedProfileUrl === normalizedUrl && c.id !== excludeId);
}
