import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { encodeMail, mailText, senderAddress } from "./gmail";
import { matchMeeting, calendarEventId } from "./calendar";
describe("Google contracts", () => {
  it("encodes UTF-8 alternatives and preserves the original thread headers", () => {
    const raw = Buffer.from(encodeMail({ to: "alice@example.com", subject: "Déplacement à Lyon", body: "Bonjour <Alice> & merci.",
      links: [{ label: "Confirmer", url: "https://example.com/r/test" }], messageId: "<123@example.com>",
      threadId: "thread", inReplyTo: "<original@example.com>" }, "manager@example.com"), "base64url").toString();
    expect(raw).toContain("Subject: =?UTF-8?B?");
    expect(raw).toContain("In-Reply-To: <original@example.com>\r\nReferences: <original@example.com>");
    expect(raw).toContain('text/plain; charset="UTF-8"');
    expect(raw).toContain('text/html; charset="UTF-8"');
    expect(raw).not.toContain("Bonjour <Alice>");
  });
  it("rejects injected headers and extracts only the textual message", () => {
    expect(() => encodeMail({ to: "alice@example.com", subject: "Hi\r\nBcc: other@example.com", body: "Hi", links: [], messageId: "<x@example.com>" }, "manager@example.com")).toThrow();
    const message = { id: "id", threadId: "thread", payload: { headers: [{ name: "From", value: "Alice <ALICE@example.com>" }],
      parts: [{ mimeType: "text/plain", body: { data: Buffer.from("Je confirme").toString("base64url") } }, { mimeType: "text/html", body: { data: "invalid" } }] } };
    expect(senderAddress(message)).toBe("alice@example.com");
    expect(mailText(message)).toBe("Je confirme");
  });
  it("requires an unambiguous meeting match and stable calendar event IDs", () => {
    const meeting = { title: "Review", start: "2026-11-10T09:00:00Z", end: "2026-11-10T10:00:00Z", timezone: "Europe/Paris", location: "Lyon", google_event_id: null };
    const event = { id: "e1", summary: "Review", start: { dateTime: meeting.start }, end: { dateTime: meeting.end } };
    expect(matchMeeting(meeting, [event])?.id).toBe("e1");
    expect(matchMeeting(meeting, [event, { ...event, id: "e2" }])).toBeNull();
    expect(calendarEventId("action")).toMatch(/^[a-v0-9]{5,1024}$/);
    expect(calendarEventId("action")).toBe(calendarEventId("action"));
  });
});
