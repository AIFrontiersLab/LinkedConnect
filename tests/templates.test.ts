import { describe, expect, it } from "vitest";
import {
  firstNameOf,
  placeholderValues,
  renderTemplate,
  splitPlaceholders,
  starterTemplates,
  unresolvedPlaceholders,
} from "../src/shared/templates";
import { defaultSettings } from "../src/shared/schema";
import { makeContact } from "./helpers";

const settings = { ...defaultSettings(), myName: "Sam Lee", myTitle: "Architect", myCompany: "Initech", communityUrl: "https://example.org" };

describe("template substitution", () => {
  it("fills known placeholders, including whitespace variants", () => {
    const r = renderTemplate("Hi {{firstName}}, I'm {{ myName }} from {{myCompany}}.", placeholderValues(makeContact(), settings));
    expect(r.text).toBe("Hi Jane, I'm Sam Lee from Initech.");
    expect(r.missing).toEqual([]);
  });

  it("keeps missing values visible and reports them", () => {
    const r = renderTemplate("Hi {{firstName}} at {{company}}", placeholderValues(makeContact({ company: "" }), settings));
    expect(r.text).toBe("Hi Jane at {{company}}");
    expect(r.missing).toEqual(["company"]);
    expect(unresolvedPlaceholders(r.text)).toEqual(["company"]);
  });

  it("reports unknown placeholders and treats them as unresolved", () => {
    const r = renderTemplate("Hello {{nickname}}", placeholderValues(makeContact(), settings));
    expect(r.unknown).toEqual(["nickname"]);
    expect(unresolvedPlaceholders(r.text)).toEqual(["nickname"]);
  });

  it("does not treat substituted user text as new placeholders", () => {
    const r = renderTemplate("Hi {{firstName}}", placeholderValues(makeContact({ firstNameOverride: "Jo" }), settings));
    expect(r.text).toBe("Hi Jo");
    const tricky = renderTemplate("{{company}}", placeholderValues(makeContact({ company: "<b>{{x}}</b>" }), settings));
    expect(tricky.text).toBe("<b>{{x}}</b>");
  });

  it("uses the first-name override when set", () => {
    expect(firstNameOf(makeContact({ fullName: "Dr. Jane Doe" }))).toBe("Dr.");
    expect(firstNameOf(makeContact({ fullName: "Dr. Jane Doe", firstNameOverride: "Jane" }))).toBe("Jane");
  });

  it("splits text into safe segments for highlighting", () => {
    expect(splitPlaceholders("A {{b}} c")).toEqual([
      { kind: "text", value: "A " },
      { kind: "placeholder", value: "{{b}}", name: "b" },
      { kind: "text", value: " c" },
    ]);
  });

  it("starter templates only use supported placeholders and stay short", () => {
    for (const t of starterTemplates("2026-01-01T00:00:00.000Z")) {
      const r = renderTemplate(t.body, placeholderValues(makeContact(), settings));
      expect(r.unknown, t.name).toEqual([]);
      expect(r.missing, t.name).toEqual([]);
      expect(r.text.length, t.name).toBeLessThan(500);
    }
  });
});
