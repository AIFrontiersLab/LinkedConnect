import { describe, expect, it } from "vitest";
import { badgeText, nextReminderTime, planNotifications, reminderKey } from "../src/shared/reminders";
import { makeContact, NOW } from "./helpers";

const due = (id: string, name: string, at = "2026-10-21T10:00:00.000Z") =>
  makeContact({ id, fullName: name, normalizedProfileUrl: `https://www.linkedin.com/in/${id}`, nextFollowUpAt: at });

describe("notification planning", () => {
  it("notifies a single due reminder once", () => {
    const contacts = [due("a", "Ann")];
    const first = planNotifications(contacts, [], NOW);
    expect(first.notification?.id).toBe("lmc-contact:a");
    expect(first.notification?.target).toBe("#/contact/a");
    const second = planNotifications(contacts, first.notifiedKeys, NOW);
    expect(second.notification).toBeNull();
    expect(second.notifiedKeys).toEqual(first.notifiedKeys);
  });

  it("summarizes several new reminders into one notification", () => {
    const contacts = [due("a", "Ann"), due("b", "Ben"), due("c", "Cy"), due("d", "Di")];
    const plan = planNotifications(contacts, [reminderKey(contacts[0]!)], NOW);
    expect(plan.notification?.id).toBe("lmc-summary");
    expect(plan.notification?.title).toBe("3 follow-ups due");
    expect(plan.notification?.message).toBe("Ben, Cy, Di.");
    expect(plan.notifiedKeys).toHaveLength(4);
  });

  it("re-notifies after rescheduling, and prunes keys that are no longer due", () => {
    const c = due("a", "Ann");
    const first = planNotifications([c], [], NOW);
    const rescheduled = { ...c, nextFollowUpAt: "2026-10-21T14:00:00.000Z" };
    const again = planNotifications([rescheduled], first.notifiedKeys, NOW);
    expect(again.notification).not.toBeNull();
    expect(again.notifiedKeys).toEqual([reminderKey(rescheduled)]);

    const cleared = planNotifications([{ ...c, nextFollowUpAt: null }], first.notifiedKeys, NOW);
    expect(cleared.notification).toBeNull();
    expect(cleared.notifiedKeys).toEqual([]);
  });

  it("ignores future and archived reminders", () => {
    const plan = planNotifications(
      [due("a", "Ann", "2026-10-22T10:00:00.000Z"), { ...due("b", "Ben"), archivedAt: NOW.toISOString() }],
      [],
      NOW,
    );
    expect(plan.notification).toBeNull();
  });
});

describe("alarm and badge helpers", () => {
  it("finds the earliest future reminder", () => {
    const t = nextReminderTime(
      [due("a", "A", "2026-10-25T10:00:00.000Z"), due("b", "B", "2026-10-22T10:00:00.000Z"), due("c", "C", "2026-10-01T10:00:00.000Z")],
      NOW,
    );
    expect(t).toBe(Date.parse("2026-10-22T10:00:00.000Z"));
    expect(nextReminderTime([], NOW)).toBeNull();
  });
  it("formats the badge", () => {
    expect(badgeText(0)).toBe("");
    expect(badgeText(7)).toBe("7");
    expect(badgeText(150)).toBe("99+");
  });
});
