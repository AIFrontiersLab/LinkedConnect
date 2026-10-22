import { describe, expect, it } from "vitest";
import { parseProfileText, splitHeadline } from "../src/shared/selectionParse";

describe("headline splitting", () => {
  it("splits role and company on at / @ / |", () => {
    expect(splitHeadline("VP Engineering at Acme")).toEqual({ role: "VP Engineering", company: "Acme" });
    expect(splitHeadline("Recruiter @ Initech | Hiring ML engineers")).toEqual({ role: "Recruiter", company: "Initech" });
    expect(splitHeadline("Founder @Globex")).toEqual({ role: "Founder", company: "Globex" });
    expect(splitHeadline("Helping teams ship AI | ex-Google")).toEqual({ role: "Helping teams ship AI", company: "" });
  });
});

describe("profile text parsing", () => {
  it("parses a copied header block with line breaks and noise", () => {
    const text = "Jane Doe (She/Her) · 1st\nVP Engineering at Acme Analytics | Speaker\nSan Francisco Bay Area\nContact info\n500+ connections";
    expect(parseProfileText(text)).toEqual({ fullName: "Jane Doe", role: "VP Engineering", company: "Acme Analytics" });
  });

  it("prefers the tab-title name and handles single-line selections", () => {
    expect(parseProfileText("Jane Doe She/Her · 1st VP Engineering at Acme", "Jane Doe")).toEqual({
      fullName: "Jane Doe",
      role: "VP Engineering",
      company: "Acme",
    });
    expect(parseProfileText("Technical Recruiter at Example Labs", "Avery Sample")).toEqual({
      fullName: "Avery Sample",
      role: "Technical Recruiter",
      company: "Example Labs",
    });
  });

  it("parses an Experience entry", () => {
    const text = "Senior Software Engineer\nNorthwind · Full-time\nJan 2022 - Present · 2 yrs 10 mos\nSeattle, Washington";
    expect(parseProfileText(text, "Sam Lee")).toEqual({ fullName: "Sam Lee", role: "Senior Software Engineer", company: "Northwind" });
  });

  it("returns empty fields rather than guessing from nothing", () => {
    expect(parseProfileText("", "")).toEqual({ fullName: "", role: "", company: "" });
  });
});

describe("run-on right-click selections", () => {
  it("stops the company at the repeated company chip, school, location and contact info", () => {
    const text =
      "Jane Doe She/Her · 1st VP Engineering at Acme Analytics Acme Analytics Stanford University San Francisco Bay Area · Contact info 500+ connections";
    expect(parseProfileText(text, "Jane Doe")).toEqual({ fullName: "Jane Doe", role: "VP Engineering", company: "Acme Analytics" });
  });
  it("trims location and counts from a company", () => {
    expect(splitHeadline("Recruiter at Initech Austin, Texas Metropolitan Area Contact info").company).toBe("Initech");
    expect(splitHeadline("Founder @ Globex 2,300 followers").company).toBe("Globex");
  });
});

describe("category suggestion", () => {
  it("maps common roles", async () => {
    const { suggestCategory } = await import("../src/shared/selectionParse");
    expect(suggestCategory("Senior Technical Recruiter")).toBe("RECRUITER");
    expect(suggestCategory("Talent Acquisition Partner")).toBe("RECRUITER");
    expect(suggestCategory("Head of Partnerships")).toBe("BUSINESS_PARTNER");
    expect(suggestCategory("VP Engineering")).toBe("HIRING_LEADER");
    expect(suggestCategory("Engineering Manager")).toBe("HIRING_LEADER");
    expect(suggestCategory("ML Engineer")).toBe("AI_COMMUNITY");
    expect(suggestCategory("Software Engineer")).toBeNull();
  });
});
