import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const integrations = vi.hoisted(() => ({ sendMail: vi.fn(), findSent: vi.fn(), extractReceipt: vi.fn(), structured: vi.fn() }));
vi.mock("../integrations/gmail", async (original) => ({ ...await original<typeof import("../integrations/gmail")>(), sendMail: integrations.sendMail, findSent: integrations.findSent }));
vi.mock("../integrations/openai", () => ({ extractReceipt: integrations.extractReceipt, structured: integrations.structured }));
import { DEFAULT_POLICY, ExpenseSchema, ReceiptSchema, PlanningStateSchema, type Trip } from "@repo/types";
import { GoogleError } from "../integrations/google-auth";
import { transitionTrip } from "@repo/core";
import { prepareReport, sendReportNext, reportSnapshot, extractNextReceipt, reviewExpense, completeTrip } from "./flows/post-trip";
import { receiptHash, receiptMime, receiptForm, uploadReceipt, MAX_RECEIPT_BYTES } from "../receipts";
import type { TripStore, Changes } from "./store";
const id = "11111111-1111-4111-8111-111111111111";
const rid = "22222222-2222-4222-8222-222222222222";
const bytes = Buffer.from("%PDF-1.4 receipt test");
function fixture() {
  const receipt = ReceiptSchema.parse({ id: rid, owner_id: id, trip_id: id, traveler_id: id, path: id + "/" + id + "/receipt",
    file_name: "receipt.pdf", mime_type: "application/pdf", content_hash: receiptHash(bytes), status: "ready", extraction: null, error: null, created_at: new Date().toISOString() });
  const expense = ExpenseSchema.parse({ id, owner_id: id, trip_id: id, traveler_id: id, receipt_id: rid, line_index: 0, date: "2026-09-20",
    merchant: "Cafe", category: "meals", amount: 12, currency: "EUR", amount_eur: 12, reviewed: true, compliant: true, note: null, receipt_path: receipt.path });
  const store = { id, owner: id, state: { trip: { id, title: "Paris meeting", destination: "Paris", meeting: null, status: "completed", budget_per_traveler: null, extracted: { language: "en" } },
    travelers: [{ traveler_id: id, traveler: { full_name: "Alice" } }], receipts: [receipt], expenses: [expense], actions: [], workflow: PlanningStateSchema.parse({}) },
    audit: vi.fn(), policy: async () => DEFAULT_POLICY,
    next(status: Trip["status"]) { return transitionTrip(store.state.trip.status, status); },
    db: { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { email: "manager@example.com" }, error: null }) }) }) }),
      storage: { from: () => ({ download: async () => ({ data: new Blob([bytes]), error: null }), upload: vi.fn() }) } },
    async save(changes: Changes) {
      if (changes.trip) store.state.trip = { ...store.state.trip, ...changes.trip };
      if (changes.actions) for (const a of changes.actions) { const i = store.state.actions.findIndex((old) => old.id === a.id); if (i < 0) store.state.actions.push(a); else store.state.actions[i] = a; }
      if (changes.receipts) for (const r of changes.receipts) { const i = store.state.receipts.findIndex((old) => old.id === r.id); if (i < 0) store.state.receipts.push(r); else store.state.receipts[i] = r; }
      if (changes.delete_receipt_expenses) store.state.expenses = store.state.expenses.filter((e) => e.receipt_id !== changes.delete_receipt_expenses);
      if (changes.expenses) store.state.expenses = changes.expenses;
    },
  } as unknown as TripStore;
  return store;
}
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("APP_URL", "http://localhost:3000"); integrations.structured.mockResolvedValue({ summary: "Business trip expense report." }); });
describe("post-trip approval and recovery", () => {
  it("creates only a proposal and never sends an unapproved or rejected report", async () => {
    const store = fixture(); await prepareReport(store, "finance@example.com");
    await prepareReport(store, "finance@example.com"); expect(store.state.actions).toHaveLength(1);
    expect(store.state.actions[0]).toMatchObject({ kind: "submit_expense_report", status: "proposed", gate: "needs_manager", decided_at: null });
    expect(await sendReportNext(store)).toBe(false);
    store.state.actions[0].status = "rejected"; expect(await sendReportNext(store)).toBe(false);
    expect(integrations.sendMail).not.toHaveBeenCalled();
  });
  it("records execution before sending, then moves to reported without replay", async () => {
    const store = fixture(); await prepareReport(store, "finance@example.com");
    Object.assign(store.state.actions[0], { status: "approved", decided_at: new Date().toISOString() });
    integrations.sendMail.mockImplementation(async () => {
      expect(store.state.actions[0].status).toBe("executing"); return { id: "sent", threadId: "thread" };
    });
    await sendReportNext(store); await sendReportNext(store);
    expect(integrations.sendMail).toHaveBeenCalledTimes(1);
    expect(store.state.trip.status).toBe("reported");
  });
  it("keeps an explicit Gmail authorization refusal resumable after reconnect", async () => {
    const store = fixture(); await prepareReport(store, "finance@example.com");
    Object.assign(store.state.actions[0], { status: "approved", decided_at: new Date().toISOString() });
    integrations.sendMail.mockRejectedValueOnce(new GoogleError(401, "Reconnect Google"));
    await expect(sendReportNext(store)).rejects.toThrow(/Reconnect/);
    expect(store.state.actions[0].status).toBe("approved");
    integrations.sendMail.mockResolvedValue({ id: "sent", threadId: "thread" });
    await sendReportNext(store); expect(store.state.trip.status).toBe("reported");
  });
  it("blocks stale approval if expenses or policy changed", async () => {
    const store = fixture(); await prepareReport(store, "finance@example.com");
    Object.assign(store.state.actions[0], { status: "approved", decided_at: new Date().toISOString() });
    store.state.expenses[0].amount_eur = 13;
    await expect(sendReportNext(store)).rejects.toThrow(/changed/);
    store.state.expenses[0].amount_eur = 12;
    store.policy = async () => ({ ...DEFAULT_POLICY, hotel_cap_eur: 50 });
    await expect(sendReportNext(store)).rejects.toThrow(/changed/);
    expect(integrations.sendMail).not.toHaveBeenCalled();
  });
  it("reconciles interrupted delivery and refuses an uncertain resend", async () => {
    const store = fixture(); await prepareReport(store, "finance@example.com");
    Object.assign(store.state.actions[0], { status: "executing", decided_at: new Date().toISOString() });
    integrations.findSent.mockResolvedValue({ id: "sent", threadId: "thread" });
    await sendReportNext(store); expect(store.state.trip.status).toBe("reported");
    const uncertain = fixture(); await prepareReport(uncertain, "finance@example.com");
    Object.assign(uncertain.state.actions[0], { status: "executing", decided_at: new Date().toISOString() });
    integrations.findSent.mockResolvedValue(null);
    await expect(sendReportNext(uncertain)).rejects.toThrow(/uncertain/);
    expect(uncertain.state.actions[0].status).toBe("failed");
    await expect(prepareReport(uncertain, "finance@example.com")).rejects.toThrow(/delivery/);
    expect(integrations.sendMail).not.toHaveBeenCalled();
  });
  it("requires reviewed expenses and rejects premature trip completion", async () => {
    const store = fixture(); store.state.expenses[0].reviewed = false;
    await expect(reportSnapshot(store)).rejects.toThrow(/Verify/);
    store.state.trip.status = "booked"; store.state.trip.meeting = { title: "Future", start: "2099-01-01T09:00:00Z", end: "2099-01-01T10:00:00Z", timezone: "Europe/Paris", location: "", google_event_id: null };
    await expect(completeTrip(store)).rejects.toThrow(/not ended/);
  });
  it("keeps unreadable receipt fields empty until a manager verifies them", async () => {
    const store = fixture(); store.state.receipts[0].status = "uploaded"; store.state.expenses = [];
    integrations.extractReceipt.mockResolvedValue({ is_receipt: true, issues: ["Date unreadable"], lines: [{ date: null, merchant: "Cafe", category: "meals", amount: 12, currency: "EUR", nights: null, note: null, confidence: 0.7 }] });
    await extractNextReceipt(store);
    expect(store.state.expenses).toEqual([]);
    expect(store.state.receipts[0].status).toBe("needs_review");
    await reviewExpense(store, { receipt_id: rid, line_index: 0, date: "2026-09-20", merchant: "Cafe", category: "meals", amount: 12, currency: "EUR", amount_eur: 12, nights: null, note: null, reviewed: true });
    expect(store.state.receipts[0].status).toBe("ready");
    expect(store.state.expenses[0]).toMatchObject({ reviewed: true, amount_eur: 12, compliant: true });
  });
  it("does not re-extract a completed file or assign it to another traveler", async () => {
    const store = fixture(); const file = new File([bytes], "receipt.pdf", { type: "application/pdf" });
    expect((await uploadReceipt(store, file, id)).id).toBe(rid);
    expect(await extractNextReceipt(store)).toBe(false);
    await expect(uploadReceipt(store, file, rid)).rejects.toThrow(/Traveler not found/);
    expect(integrations.extractReceipt).not.toHaveBeenCalled();
  });
});
describe("private receipt boundaries", () => {
  it("sniffs content rather than trusting extension and bounds size", () => {
    expect(receiptMime(bytes)).toBe("application/pdf");
    expect(() => receiptMime(Buffer.from("<script>not a receipt</script>"))).toThrow(/JPEG/);
    expect(() => receiptMime(Buffer.alloc(MAX_RECEIPT_BYTES + 1))).toThrow(/4 MiB/);
    expect(receiptHash(bytes)).toHaveLength(64);
  });
  it("rejects oversized request bodies before multipart parsing", async () => {
    const request = new Request("http://localhost/api/receipts", { method: "POST", body: "x", headers: { "content-length": String(MAX_RECEIPT_BYTES + 100000) } });
    await expect(receiptForm(request)).rejects.toThrow(/4 MiB/);
  });
});
