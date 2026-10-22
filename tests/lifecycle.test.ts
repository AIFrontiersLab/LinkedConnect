import { describe, expect, it } from "vitest";
import {
  archive,
  clearFollowUp,
  correctStatus,
  countActionable,
  deriveStatus,
  isFollowUpDue,
  isNewSinceReview,
  isReadyForInitialMessage,
  markAccepted,
  markMessageSent,
  markReplied,
  restore,
  scheduleFollowUp,
  TransitionError,
  validateTimeline,
} from "../src/shared/lifecycle";
import { makeContact, NOW, TZ } from "./helpers";

const nowIso = NOW.toISOString();
const accepted = () => markAccepted(makeContact(), "2026-10-15T14:00:00.000Z", nowIso, TZ).contact;

describe("status transitions", () => {
  it("mark accepted sets manual source, ACCEPTED status and an activity", () => {
    const r = markAccepted(makeContact(), "2026-10-15T14:00:00.000Z", nowIso, TZ);
    expect(r.contact.lifecycleStatus).toBe("ACCEPTED");
    expect(r.contact.acceptanceSource).toBe("MANUAL");
    expect(r.contact.acceptedAt).toBe("2026-10-15T14:00:00.000Z");
    expect(r.activity.activityType).toBe("ACCEPTED");
    expect(isReadyForInitialMessage(r.contact)).toBe(true);
    expect(isNewSinceReview(r.contact)).toBe(true);
  });

  it("rejects acceptance before the request date or in the future", () => {
    expect(() => markAccepted(makeContact(), "2026-10-01T14:00:00.000Z", nowIso, TZ)).toThrow(TransitionError);
    expect(() => markAccepted(makeContact(), "2026-10-30T14:00:00.000Z", nowIso, TZ)).toThrow(/future/);
    expect(() => markAccepted(accepted(), nowIso, nowIso, TZ)).toThrow(/already/);
  });

  it("message sent requires acceptance; first message is recorded once", () => {
    expect(() => markMessageSent(makeContact(), { sentAt: nowIso }, nowIso, TZ)).toThrow(/acceptance/);
    const first = markMessageSent(accepted(), { sentAt: "2026-10-16T10:00:00.000Z", templateId: "t1", messageText: "Hi" }, nowIso, TZ);
    expect(first.contact.lifecycleStatus).toBe("MESSAGE_SENT");
    expect(first.contact.initialMessageSentAt).toBe("2026-10-16T10:00:00.000Z");
    expect(first.activity.templateId).toBe("t1");
    expect(isReadyForInitialMessage(first.contact)).toBe(false);

    const second = markMessageSent(first.contact, { sentAt: "2026-10-20T10:00:00.000Z", followUpAt: "2026-10-27T13:00:00.000Z" }, nowIso, TZ);
    expect(second.contact.initialMessageSentAt).toBe("2026-10-16T10:00:00.000Z");
    expect(second.contact.lastMessageSentAt).toBe("2026-10-20T10:00:00.000Z");
    expect(second.contact.nextFollowUpAt).toBe("2026-10-27T13:00:00.000Z");
  });

  it("marking a message sent clears a due reminder unless a new one is given", () => {
    const due = scheduleFollowUp(accepted(), "2026-10-20T10:00:00.000Z", nowIso).contact;
    expect(isFollowUpDue(due, NOW)).toBe(true);
    const sent = markMessageSent(due, { sentAt: nowIso }, nowIso, TZ).contact;
    expect(sent.nextFollowUpAt).toBeNull();
  });

  it("mark replied sets REPLIED and clears the reminder", () => {
    const withReminder = scheduleFollowUp(accepted(), "2026-10-25T10:00:00.000Z", nowIso).contact;
    const r = markReplied(withReminder, nowIso, nowIso, TZ);
    expect(r.contact.lifecycleStatus).toBe("REPLIED");
    expect(r.contact.nextFollowUpAt).toBeNull();
    // A new reminder is only created deliberately.
    expect(scheduleFollowUp(r.contact, "2026-11-01T10:00:00.000Z", nowIso).contact.nextFollowUpAt).toBe("2026-11-01T10:00:00.000Z");
  });

  it("archive clears reminders and restore returns to the stage implied by timestamps", () => {
    const sent = markMessageSent(accepted(), { sentAt: nowIso, followUpAt: "2026-10-28T10:00:00.000Z" }, nowIso, TZ).contact;
    const a = archive(sent, nowIso).contact;
    expect(a.lifecycleStatus).toBe("ARCHIVED");
    expect(a.nextFollowUpAt).toBeNull();
    expect(a.initialMessageSentAt).toBe(nowIso);
    expect(() => scheduleFollowUp(a, nowIso, nowIso)).toThrow(/Restore/);
    expect(restore(a, nowIso).contact.lifecycleStatus).toBe("MESSAGE_SENT");
  });

  it("status corrections clear later-stage timestamps", () => {
    const replied = markReplied(markMessageSent(accepted(), { sentAt: "2026-10-16T10:00:00.000Z" }, nowIso, TZ).contact, nowIso, nowIso, TZ).contact;
    const toAccepted = correctStatus(replied, "ACCEPTED", nowIso).contact;
    expect(toAccepted.lifecycleStatus).toBe("ACCEPTED");
    expect(toAccepted.initialMessageSentAt).toBeNull();
    expect(toAccepted.lastMessageSentAt).toBeNull();
    expect(toAccepted.repliedAt).toBeNull();
    expect(validateTimeline(toAccepted, TZ)).toEqual([]);

    const toRequest = correctStatus(replied, "REQUEST_SENT", nowIso).contact;
    expect(toRequest.acceptedAt).toBeNull();
    expect(toRequest.acceptanceSource).toBeNull();
    expect(deriveStatus(toRequest)).toBe("REQUEST_SENT");
    expect(() => correctStatus(toRequest, "ACCEPTED", nowIso)).toThrow(/earlier/);
  });

  it("validateTimeline flags contradictory timestamps", () => {
    expect(validateTimeline(makeContact({ initialMessageSentAt: nowIso, lastMessageSentAt: nowIso }), TZ)).toContain(
      "Messages and replies require a confirmed acceptance.",
    );
    expect(
      validateTimeline(makeContact({ acceptedAt: "2026-10-15T00:00:00Z", initialMessageSentAt: "2026-10-14T00:00:00Z", lastMessageSentAt: "2026-10-14T00:00:00Z" }), TZ),
    ).toContain("The first message can't be before acceptance.");
  });

  it("uses the configured timezone when comparing acceptance to the request date", () => {
    // 2026-10-10T02:00Z is still Oct 9 in New York, so it's before the Oct 10 request date there.
    expect(validateTimeline(makeContact({ acceptedAt: "2026-10-10T02:00:00.000Z", acceptanceSource: "MANUAL" }), TZ)).toHaveLength(1);
    expect(validateTimeline(makeContact({ acceptedAt: "2026-10-10T02:00:00.000Z", acceptanceSource: "MANUAL" }), "UTC")).toEqual([]);
  });
});

describe("follow-ups and actionable counts", () => {
  it("follow-up due only when in the past and not archived or cleared", () => {
    const c = makeContact({ nextFollowUpAt: "2026-10-21T14:59:00.000Z" });
    expect(isFollowUpDue(c, NOW)).toBe(true);
    expect(isFollowUpDue({ ...c, nextFollowUpAt: "2026-10-21T15:01:00.000Z" }, NOW)).toBe(false);
    expect(isFollowUpDue({ ...c, archivedAt: nowIso }, NOW)).toBe(false);
    expect(isFollowUpDue(clearFollowUp(c, nowIso).contact, NOW)).toBe(false);
    expect(isFollowUpDue(scheduleFollowUp(c, "2026-10-24T10:00:00.000Z", nowIso).contact, NOW)).toBe(false);
  });

  it("counts a contact that is both ready and due only once", () => {
    const readyAndDue = { ...accepted(), id: "a", nextFollowUpAt: "2026-10-20T00:00:00.000Z" };
    const readyOnly = { ...accepted(), id: "b" };
    const dueOnly = makeContact({ id: "c", nextFollowUpAt: "2026-10-20T00:00:00.000Z" });
    const neither = makeContact({ id: "d" });
    const archivedReady = { ...accepted(), id: "e", archivedAt: nowIso, lifecycleStatus: "ARCHIVED" as const };
    expect(countActionable([readyAndDue, readyOnly, dueOnly, neither, archivedReady], NOW)).toBe(3);
  });
});
