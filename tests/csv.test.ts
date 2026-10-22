import { describe, expect, it } from "vitest";
import { contactsToCsv, csvCell, escapeCsvField, neutralizeFormula, toCsv, UTF8_BOM } from "../src/shared/csv";
import { makeContact, NOW } from "./helpers";

describe("CSV escaping", () => {
  it("quotes fields containing commas, quotes and newlines", () => {
    expect(escapeCsvField("plain")).toBe("plain");
    expect(escapeCsvField("a,b")).toBe('"a,b"');
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
    expect(escapeCsvField("line1\r\nline2")).toBe('"line1\r\nline2"');
  });

  it("neutralizes formula injection", () => {
    for (const v of ["=1+1", "+SUM(A1)", "-2+3", "@cmd", "\tx", "\rx", "＝1+1"]) {
      expect(neutralizeFormula(v).startsWith("'"), v).toBe(true);
    }
    expect(neutralizeFormula("Acme")).toBe("Acme");
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`);
  });

  it("writes a BOM and CRLF line endings", () => {
    expect(toCsv([["a", "b"], ["c", "d"]])).toBe(`${UTF8_BOM}a,b\r\nc,d\r\n`);
  });

  it("exports contacts with readable headings, timezone context and safe values", () => {
    const csv = contactsToCsv(
      [
        makeContact({
          fullName: "=Jane, Doe",
          notes: 'Met "online"\nfollow up',
          acceptedAt: "2026-10-15T14:00:00.000Z",
          acceptanceSource: "MANUAL",
          lifecycleStatus: "ACCEPTED",
        }),
      ],
      "America/New_York",
      NOW,
    );
    expect(csv.startsWith(UTF8_BOM)).toBe(true);
    const [header] = csv.slice(1).split("\r\n");
    expect(header).toContain("Full name");
    expect(header).toContain("Accepted at (America/New_York)");
    expect(csv).toContain(`"'=Jane, Doe"`);
    expect(csv).toContain(`"Met ""online""\nfollow up"`);
    expect(csv).toContain("2026-10-15 10:00");
    expect(csv).toContain("Manual confirmation");
    expect(csv).toContain(",Accepted,");
  });
});
