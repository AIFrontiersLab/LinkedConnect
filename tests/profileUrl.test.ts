import { describe, expect, it } from "vitest";
import { findDuplicate, normalizeProfileUrl } from "../src/shared/profileUrl";

const ok = (input: string) => {
  const r = normalizeProfileUrl(input);
  if (!r.ok) throw new Error(`expected ok for ${input}: ${r.error}`);
  return r.normalized;
};
const rejected = (input: string) => expect(normalizeProfileUrl(input).ok, input).toBe(false);

describe("normalizeProfileUrl", () => {
  it("normalizes standard, regional, mobile and schemeless URLs to https://www.linkedin.com/in/slug", () => {
    expect(ok("https://www.linkedin.com/in/jane-doe")).toBe("https://www.linkedin.com/in/jane-doe");
    expect(ok("http://linkedin.com/in/jane-doe/")).toBe("https://www.linkedin.com/in/jane-doe");
    expect(ok("https://uk.linkedin.com/in/jane-doe?trk=abc#about")).toBe("https://www.linkedin.com/in/jane-doe");
    expect(ok("https://m.linkedin.com/in/Jane-Doe")).toBe("https://www.linkedin.com/in/jane-doe");
    expect(ok("  linkedin.com/in/jane-doe  ")).toBe("https://www.linkedin.com/in/jane-doe");
    expect(ok("https://WWW.LINKEDIN.COM/in/jane-doe///")).toBe("https://www.linkedin.com/in/jane-doe");
  });

  it("drops sub-pages of a profile but keeps the slug", () => {
    expect(ok("https://www.linkedin.com/in/jane-doe-12345/details/experience/")).toBe(
      "https://www.linkedin.com/in/jane-doe-12345",
    );
  });

  it("handles percent-encoded unicode slugs consistently", () => {
    const a = ok("https://www.linkedin.com/in/jos%C3%A9-garc%C3%ADa");
    const b = ok("https://www.linkedin.com/in/José-García");
    expect(a).toBe(b);
    expect(a).toBe("https://www.linkedin.com/in/jos%C3%A9-garc%C3%ADa");
  });

  it("validates the hostname exactly, rejecting lookalikes", () => {
    rejected("https://linkedin.com.evil.com/in/jane-doe");
    rejected("https://evil-linkedin.com/in/jane-doe");
    rejected("https://www.linkedin.co/in/jane-doe");
    rejected("https://notlinkedin.com/in/jane-doe");
    rejected("https://www.evil.com/?u=https://www.linkedin.com/in/jane-doe");
    rejected("https://www.linkedin.com@evil.com/in/jane-doe");
    rejected("https://user:pw@www.linkedin.com/in/jane-doe");
    rejected("https://www.linkedin.com:8443/in/jane-doe");
    rejected("https://foo.bar.linkedin.com/in/jane-doe");
  });

  it("rejects company pages, other paths and non-http schemes", () => {
    rejected("https://www.linkedin.com/company/acme");
    rejected("https://www.linkedin.com/feed/");
    rejected("https://www.linkedin.com/in/");
    rejected("https://www.linkedin.com/school/mit");
    rejected("javascript:alert(1)");
    rejected("ftp://www.linkedin.com/in/jane-doe");
    rejected("https://www.linkedin.com/in/<script>");
    rejected("");
  });
});

describe("findDuplicate", () => {
  const contacts = [
    { id: "a", normalizedProfileUrl: "https://www.linkedin.com/in/jane-doe" },
    { id: "b", normalizedProfileUrl: "https://www.linkedin.com/in/john-roe" },
  ];
  it("matches on the normalized URL", () => {
    expect(findDuplicate(contacts, ok("uk.linkedin.com/in/Jane-Doe/?x=1"))?.id).toBe("a");
    expect(findDuplicate(contacts, ok("linkedin.com/in/someone-else"))).toBeUndefined();
  });
  it("can exclude the record being edited", () => {
    expect(findDuplicate(contacts, "https://www.linkedin.com/in/jane-doe", "a")).toBeUndefined();
  });
});
