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

describe("highlighted top card with line breaks", () => {
  it("takes the company from the company box when the headline has none", () => {
    const text =
      "Peter Kappes\n· 2nd\nRobotics, Construction, Automation, Tech | Humanoids & Robotics\nKappes 'n' Beans\nBoise State University\nBoise, Idaho, United States\n·\nContact info\n49,916 followers\n500+ connections";
    expect(parseProfileText(text, "Peter Kappes")).toEqual({
      fullName: "Peter Kappes",
      role: "Robotics, Construction, Automation, Tech",
      company: "Kappes 'n' Beans",
    });
  });

  it("skips pronouns, schools, locations and mutual connections", () => {
    const text =
      "Sivasankar Natarajan\nHe/Him\n· 2nd\nTechnical Director | Cloud & AI\nAnna University\nAcme Corp, Inc.\nChennai, Tamil Nadu\nContact info\nAnurag and 3 other mutual connections";
    expect(parseProfileText(text)).toEqual({ fullName: "Sivasankar Natarajan", role: "Technical Director", company: "Acme Corp, Inc" });
  });

  it("prefers 'at Company' in the headline", () => {
    expect(parseProfileText("Jane Doe\nVP Engineering at Acme\nGlobex\nSan Francisco Bay Area").company).toBe("Acme");
  });

  it("works when the selection starts at the headline", () => {
    expect(parseProfileText("Talent Partner\nInitech\nAustin, Texas", "Sam Lee")).toEqual({ fullName: "Sam Lee", role: "Talent Partner", company: "Initech" });
  });
});
