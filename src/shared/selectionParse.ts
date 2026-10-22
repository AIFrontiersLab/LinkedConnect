// Parses text the user highlighted or copied from a LinkedIn profile into suggested form values.
// Works on whatever the user chose to give us; the user always reviews the result before saving.

import type { Category } from "./types";

export interface ParsedProfileText {
  fullName: string;
  role: string;
  company: string;
}

const EMPLOYMENT_TYPES = "Full-time|Part-time|Contract|Self-employed|Freelance|Internship|Apprenticeship|Seasonal|Permanent";
const NOISE_LINE =
  /^(?:\(?(?:he|she|they)\/(?:him|her|them|his|hers|theirs)\)?|·|•|1st|2nd|3rd\+?|·\s*(?:1st|2nd|3rd\+?)|contact info|message|connect|follow|following|more|pending|\d[\d,+]*\s+(?:connections|followers|mutual connections?)|open to work|verified)$/i;
// Trailing decorations on a name line: "Jane Doe (She/Her) · 1st"
const NAME_SUFFIX = /\s*(?:\((?:he|she|they)\/\w+\)|(?:he|she|they)\/\w+|·\s*(?:1st|2nd|3rd\+?)|\b(?:1st|2nd|3rd\+?)\b)\s*$/i;
const LEADING_DECORATION = /^\s*(?:\(?(?:he|she|they)\/\w+\)?|·|•|1st|2nd|3rd\+?|\s)+/i;

const clip = (s: string, max = 200) => s.replace(/\s+/g, " ").trim().slice(0, max);

function cleanName(line: string): string {
  let out = line;
  for (let i = 0; i < 3; i++) out = out.replace(NAME_SUFFIX, "");
  return clip(out, 200);
}

/**
 * Right-click selections arrive without line breaks, so text after the company (the company
 * chip repeated, school, location, "Contact info", follower counts) can run into it. Cut it off.
 */
export function trimCompanyTail(raw: string): string {
  let c = raw.replace(/\s+/g, " ").trim();
  c = c.split(/\s+[·•|]\s+/)[0] ?? c;
  c = c.replace(/\s+(?:contact info|\d[\d,+.k]*\s+(?:followers|connections|mutual)).*$/i, "");
  c = c.replace(/\s+(?:[A-Z][\w.'-]*,?\s+){0,4}(?:Bay Area|Metropolitan Area|Metro Area|Area|Region)$/, "");
  // "Acme Analytics Acme Analytics Stanford University" -> "Acme Analytics"
  const words = c.split(" ");
  for (let k = 1; k <= Math.floor(words.length / 2); k++) {
    if (words.slice(0, k).join(" ").toLowerCase() === words.slice(k, 2 * k).join(" ").toLowerCase()) {
      c = words.slice(0, k).join(" ");
      break;
    }
  }
  return clip(c.replace(/[.,;:]+$/, ""));
}

const CATEGORY_RULES: Array<[Category, RegExp]> = [
  ["RECRUITER", /\b(recruit\w*|talent|sourc(?:er|ing)|headhunt\w*|staffing|people partner|hr business partner)\b/i],
  ["BUSINESS_PARTNER", /\b(partnerships?|partner manager|alliances?|business development|channel)\b/i],
  ["HIRING_LEADER", /\b(vp|svp|evp|vice president|director|head of|chief|cto|cio|cpo|engineering manager|hiring manager|manager)\b/i],
  ["AI_COMMUNITY", /\b(ai|a\.i\.|ml|machine learning|llms?|genai|generative|deep learning|data scien\w*|research(?:er)?)\b/i],
];

/** Suggests a category from role/headline keywords; null when there's no clear signal. */
export function suggestCategory(text: string): Category | null {
  for (const [cat, re] of CATEGORY_RULES) if (re.test(text)) return cat;
  return null;
}

/** Splits a headline such as "VP Engineering at Acme | Speaker" into role and company. */
export function splitHeadline(headline: string): { role: string; company: string } {
  const first = headline.split(/\s+[|•]\s+|\s+\|\s*|\s*\|\s+/)[0] ?? "";
  const m = /^(.*?)\s+(?:at|@)\s+(.+)$/i.exec(first) ?? /^(.*?\S)\s*@\s*(\S.*)$/.exec(first);
  if (m && m[1]!.trim() && m[2]!.trim()) {
    return { role: clip(m[1]!), company: trimCompanyTail(m[2]!) };
  }
  return { role: trimCompanyTail(first), company: "" };
}

/**
 * @param text       highlighted or pasted text (line breaks may or may not be preserved)
 * @param knownName  name already known from the tab title, if any; it's preferred and stripped from the text
 */
export function parseProfileText(text: string, knownName = ""): ParsedProfileText {
  const name = clip(knownName);
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !NOISE_LINE.test(l));

  // An Experience entry: "Senior Engineer\nAcme · Full-time\nJan 2020 - Present"
  const typeLine = new RegExp(`^(.+?)\\s*·\\s*(?:${EMPLOYMENT_TYPES})\\b`, "i");
  const ti = lines.findIndex((l) => typeLine.test(l));
  if (ti > 0) {
    const company = clip(typeLine.exec(lines[ti]!)![1]!);
    const role = clip(lines[ti - 1]!);
    const nameLine = ti > 1 ? cleanName(lines[0]!) : "";
    return { fullName: name || nameLine, role, company };
  }

  if (lines.length >= 2) {
    const first = cleanName(lines[0]!);
    const startsWithName = !name || first.toLowerCase() === name.toLowerCase();
    const headline = startsWithName ? lines[1]! : lines[0]!;
    return { fullName: name || first, ...splitHeadline(headline) };
  }

  // Single line (Chrome's right-click selection text often drops line breaks).
  let single = clip(lines[0] ?? "", 1000);
  if (name && single.toLowerCase().startsWith(name.toLowerCase())) single = single.slice(name.length);
  single = single.replace(LEADING_DECORATION, "").trim();
  if (!single) return { fullName: name, role: "", company: "" };
  return { fullName: name, ...splitHeadline(single) };
}
