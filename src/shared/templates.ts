// Message templates and placeholder substitution. Rendering is plain-text only.

import type { Category, Contact, Settings, Template } from "./types";

export const PLACEHOLDERS = [
  "firstName",
  "fullName",
  "company",
  "role",
  "connectionReason",
  "myName",
  "myTitle",
  "myCompany",
  "communityUrl",
] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];

export const PLACEHOLDER_LABELS: Record<Placeholder, string> = {
  firstName: "Contact first name",
  fullName: "Contact full name",
  company: "Contact company",
  role: "Contact role/title",
  connectionReason: "Why I connected",
  myName: "My name (Settings)",
  myTitle: "My title (Settings)",
  myCompany: "My company (Settings)",
  communityUrl: "Community URL (Settings)",
};

const PLACEHOLDER_RE = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;

export const STARTER_TEMPLATE_IDS = {
  recruiter: "starter-recruiter",
  engineering: "starter-engineering-leadership",
  client: "starter-potential-client",
  partnership: "starter-business-partnership",
  community: "starter-ai-community",
  followUp: "starter-gentle-follow-up",
} as const;

const STARTERS: Array<{ id: string; name: string; body: string }> = [
  {
    id: STARTER_TEMPLATE_IDS.recruiter,
    name: "Recruiter introduction",
    body:
      "Hi {{firstName}}, thanks for connecting. I'm {{myName}}, {{myTitle}} at {{myCompany}}. " +
      "I'd be glad to stay in touch about roles at {{company}} that could be a good match.\n\nBest,\n{{myName}}",
  },
  {
    id: STARTER_TEMPLATE_IDS.engineering,
    name: "Engineering leadership networking",
    body:
      "Hi {{firstName}}, thanks for accepting my request. I'm {{myName}}, {{myTitle}} at {{myCompany}}. " +
      "I reached out because {{connectionReason}}. I'd value staying connected with you.\n\nBest,\n{{myName}}",
  },
  {
    id: STARTER_TEMPLATE_IDS.client,
    name: "Potential client introduction",
    body:
      "Hi {{firstName}}, thanks for connecting. I'm {{myName}} from {{myCompany}}. " +
      "I reached out because {{connectionReason}}. If it's ever useful, I'm happy to share a little about what we do. No pressure either way.\n\nBest,\n{{myName}}",
  },
  {
    id: STARTER_TEMPLATE_IDS.partnership,
    name: "Business partnership",
    body:
      "Hi {{firstName}}, thanks for connecting. I'm {{myName}}, {{myTitle}} at {{myCompany}}. " +
      "I reached out because {{connectionReason}}. Would you be open to a short conversation to see if there's a fit between our teams?\n\nBest,\n{{myName}}",
  },
  {
    id: STARTER_TEMPLATE_IDS.community,
    name: "AI community welcome",
    body:
      "Hi {{firstName}}, thanks for connecting. I'm {{myName}}. " +
      "I'd like to invite you to our AI community, in case it's of interest: {{communityUrl}}\n\nGlad to be connected.",
  },
  {
    id: STARTER_TEMPLATE_IDS.followUp,
    name: "Gentle follow-up",
    body:
      "Hi {{firstName}}, just following up on my earlier note. No pressure at all; happy to stay connected either way.\n\nBest,\n{{myName}}",
  },
];

export function starterTemplates(nowIso: string): Template[] {
  return STARTERS.map((s) => ({ ...s, isStarter: true, createdAt: nowIso, updatedAt: nowIso }));
}

export function defaultTemplateMapping(): Record<Category, string | null> {
  return {
    RECRUITER: STARTER_TEMPLATE_IDS.recruiter,
    HIRING_LEADER: STARTER_TEMPLATE_IDS.engineering,
    POTENTIAL_CLIENT: STARTER_TEMPLATE_IDS.client,
    BUSINESS_PARTNER: STARTER_TEMPLATE_IDS.partnership,
    AI_COMMUNITY: STARTER_TEMPLATE_IDS.community,
    OTHER: STARTER_TEMPLATE_IDS.engineering,
  };
}

export function firstNameOf(c: Pick<Contact, "fullName" | "firstNameOverride">): string {
  const override = c.firstNameOverride.trim();
  if (override) return override;
  return c.fullName.trim().split(/\s+/)[0] ?? "";
}

export function placeholderValues(
  contact: Contact | null,
  settings: Pick<Settings, "myName" | "myTitle" | "myCompany" | "communityUrl">,
): Record<Placeholder, string> {
  return {
    firstName: contact ? firstNameOf(contact) : "",
    fullName: contact?.fullName.trim() ?? "",
    company: contact?.company.trim() ?? "",
    role: contact?.role.trim() ?? "",
    connectionReason: contact?.connectionReason.trim() ?? "",
    myName: settings.myName.trim(),
    myTitle: settings.myTitle.trim(),
    myCompany: settings.myCompany.trim(),
    communityUrl: settings.communityUrl.trim(),
  };
}

export function isKnownPlaceholder(name: string): name is Placeholder {
  return (PLACEHOLDERS as readonly string[]).includes(name);
}

export interface RenderResult {
  text: string;
  /** Known placeholders whose value is empty; they remain as {{name}} in the text. */
  missing: Placeholder[];
  /** Placeholders that are not supported at all. */
  unknown: string[];
}

/** Substitutes known, non-empty values. Anything unresolved stays visible as {{name}}. */
export function renderTemplate(body: string, values: Record<Placeholder, string>): RenderResult {
  const missing = new Set<Placeholder>();
  const unknown = new Set<string>();
  const text = body.replace(PLACEHOLDER_RE, (match, name: string) => {
    if (!isKnownPlaceholder(name)) {
      unknown.add(name);
      return match;
    }
    const value = values[name];
    if (!value) {
      missing.add(name);
      return `{{${name}}}`;
    }
    return value;
  });
  return { text, missing: [...missing], unknown: [...unknown] };
}

/** Placeholder names still present in a draft. Copying is blocked while this is non-empty. */
export function unresolvedPlaceholders(text: string): string[] {
  const names = new Set<string>();
  for (const m of text.matchAll(PLACEHOLDER_RE)) names.add(m[1]!);
  return [...names];
}

export type Segment = { kind: "text"; value: string } | { kind: "placeholder"; value: string; name: string };

/** Splits text for highlighted (React-escaped) rendering; never produces HTML. */
export function splitPlaceholders(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(PLACEHOLDER_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ kind: "text", value: text.slice(last, idx) });
    out.push({ kind: "placeholder", value: m[0], name: m[1]! });
    last = idx + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", value: text.slice(last) });
  return out;
}

/** Template used for a contact: follow-up template once a message was sent, else category default. */
export function suggestedTemplateId(contact: Contact, settings: Settings, templates: readonly Template[]): string | null {
  const exists = (id: string | null | undefined) => (id && templates.some((t) => t.id === id) ? id : null);
  if (contact.initialMessageSentAt) {
    const f = exists(settings.followUpTemplateId);
    if (f) return f;
  }
  return exists(settings.defaultTemplateByCategory[contact.category]) ?? templates[0]?.id ?? null;
}
