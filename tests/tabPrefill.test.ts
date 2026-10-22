import { describe, expect, it } from "vitest";
import { nameFromTabTitle, prefillFromTab } from "../src/shared/tabPrefill";

describe("active tab prefill", () => {
  it("suggests a name from LinkedIn profile titles", () => {
    expect(nameFromTabTitle("Jane Doe | LinkedIn")).toBe("Jane Doe");
    expect(nameFromTabTitle("(3) Jane Doe | LinkedIn")).toBe("Jane Doe");
    expect(nameFromTabTitle("(99+) José García - LinkedIn")).toBe("José García");
    expect(nameFromTabTitle("Feed | LinkedIn")).toBe("");
    expect(nameFromTabTitle("Some other site")).toBe("");
    expect(nameFromTabTitle(undefined)).toBe("");
  });

  it("only prefills from valid person-profile URLs", () => {
    expect(prefillFromTab({ url: "https://www.linkedin.com/in/jane-doe/?miniProfileUrn=x", title: "(2) Jane Doe | LinkedIn" })).toEqual({
      profileUrl: "https://www.linkedin.com/in/jane-doe",
      fullName: "Jane Doe",
      selectionText: "",
    });
    expect(prefillFromTab({ url: "https://www.linkedin.com/company/acme", title: "Acme | LinkedIn" })).toBeNull();
    expect(prefillFromTab({ url: "https://linkedin.com.evil.com/in/jane", title: "Jane | LinkedIn" })).toBeNull();
    expect(prefillFromTab({ title: "Jane | LinkedIn" })).toBeNull();
    expect(prefillFromTab(undefined)).toBeNull();
  });
});
