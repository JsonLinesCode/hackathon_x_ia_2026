import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const gmail = vi.hoisted(() => ({ sendMail: vi.fn(), findSent: vi.fn() }));
vi.mock("../integrations/gmail", async (original) => ({ ...await original<typeof import("../integrations/gmail")>(), ...gmail }));
import { executeCommunication } from "./notify";
import type { TripStore, Changes } from "./store";
import { ActionSchema } from "@repo/types";
const id = "11111111-1111-4111-8111-111111111111";
function fixture(status = "proposed") {
  const action = ActionSchema.parse({ id, owner_id: id, trip_id: id, kind: "request_confirmation", cost_eur: 0, reversible: true, summary: "Confirm trip", rationale: "", gate: "auto",
    status, decided_at: null, result: null, idempotency_key: "confirmation", payload: { operation: "email", mail: {
      to: "alice@example.com", subject: "Trip", body: "Confirm please", links: [], messageId: "<" + id + "@example.com>",
    } } });
  const store = { owner: id, id, state: { actions: [action], outreach: [] }, audit: vi.fn(),
    db: { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { email: "manager@example.com" }, error: null }) }) }) }) },
    save: async (change: Changes) => { if (change.actions) store.state.actions = change.actions; },
  } as unknown as TripStore;
  return store;
}
beforeEach(() => vi.clearAllMocks());
describe("email execution checkpoints", () => {
  it("saves intent before sending and skips a completed action", async () => {
    const store = fixture();
    gmail.sendMail.mockImplementation(async () => {
      expect(store.state.actions[0].status).toBe("executing");
      return { id: "gmail1", threadId: "thread1" };
    });
    await executeCommunication(store); await executeCommunication(store);
    expect(gmail.sendMail).toHaveBeenCalledTimes(1);
    expect(store.state.actions[0].status).toBe("executed");
  });
  it("reconciles a sent message after interruption without resending", async () => {
    const store = fixture("executing");
    gmail.findSent.mockResolvedValue({ id: "gmail1", threadId: "thread1" });
    await executeCommunication(store);
    expect(gmail.sendMail).not.toHaveBeenCalled();
    expect(store.state.actions[0].status).toBe("executed");
  });
  it("blocks replay when delivery cannot be proven", async () => {
    const store = fixture("executing"); gmail.findSent.mockResolvedValue(null);
    await expect(executeCommunication(store)).rejects.toThrow(/uncertain/);
    expect(gmail.sendMail).not.toHaveBeenCalled();
    expect(store.state.actions[0].status).toBe("failed");
  });
});
