import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const auth = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock("./auth", async (original) => ({ ...await original<typeof import("./auth")>(), requireUser: auth.requireUser }));
import { UnauthorizedError } from "./auth";
import { GET, POST } from "@/app/api/travelers/route";
import { PATCH, DELETE } from "@/app/api/travelers/[id]/route";
import { GET as getPolicy, PATCH as savePolicy } from "@/app/api/policies/route";

const owner = "cc02a830-3634-4c56-99f5-6614b20246c7";
const id = "acf5c6f0-96d6-4003-b5f6-31fd4b3f9455";
const traveler = {
  id, owner_id: owner, full_name: "Alice", email: "alice@example.com", home_city: "Paris", home_airport: "CDG",
  preferences: { seat: "aisle", notes: "" }, calendar_access: "unknown", created_at: "2026-09-27T10:00:00Z",
};
const input = { full_name: "Alice", email: "alice@example.com", home_city: "Paris", home_airport: "CDG", preferences: traveler.preferences };
function request(body: unknown, method = "POST") {
  return new Request("http://localhost:3000/api/travelers", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
function database(data: unknown, error: unknown = null) {
  const result = { data, error };
  const chain = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(), delete: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue(result), single: vi.fn().mockResolvedValue(result), maybeSingle: vi.fn().mockResolvedValue(result),
  };
  const db = { from: vi.fn().mockReturnValue(chain) };
  auth.requireUser.mockResolvedValue({ user: { id: owner }, db });
  return { db, chain };
}
beforeEach(() => { vi.clearAllMocks(); });

describe("authenticated CRUD boundaries", () => {
  it("returns 401 JSON from every unauthenticated API, including mutations", async () => {
    auth.requireUser.mockRejectedValue(new UnauthorizedError());
    const context = { params: Promise.resolve({ id }) };
    for (const response of await Promise.all([GET(), POST(request(input)), PATCH(request(input, "PATCH"), context), DELETE(new Request("http://localhost/api/travelers/" + id, { method: "DELETE" }), context), getPolicy(), savePolicy(request({}, "PATCH"))])) {
      expect(response.status).toBe(401);
      expect(response.headers.get("location")).toBeNull();
      expect(await response.json()).toHaveProperty("error");
    }
  });
  it("scopes lists to the authenticated manager", async () => {
    const { chain } = database([traveler]);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(chain.eq).toHaveBeenCalledWith("owner_id", owner);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("creates normalized records for the manager and rejects owner injection", async () => {
    const { chain } = database(traveler);
    expect((await POST(request({ ...input, email: "ALICE@example.com" }))).status).toBe(201);
    expect(chain.insert).toHaveBeenCalledWith({ ...input, owner_id: owner });
    chain.insert.mockClear();
    expect((await POST(request({ ...input, owner_id: id }))).status).toBe(400);
    expect(chain.insert).not.toHaveBeenCalled();
  });
  it("scopes updates and deletion by both owner and id, without leaking missing rows", async () => {
    const { chain } = database(null);
    const context = { params: Promise.resolve({ id }) };
    expect((await PATCH(request(input, "PATCH"), context)).status).toBe(404);
    expect(chain.eq).toHaveBeenCalledWith("owner_id", owner);
    expect(chain.eq).toHaveBeenCalledWith("id", id);
    expect((await DELETE(new Request("http://localhost/api/travelers/" + id, { method: "DELETE" }), context)).status).toBe(404);
  });
  it("reports unique-email conflicts and missing migrations clearly", async () => {
    database(null, { code: "23505" });
    expect((await POST(request(input))).status).toBe(409);
    database(null, { code: "42P01" });
    const response = await GET();
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("0001_foundation.sql");
  });
  it("rejects invalid policies and preserves valid per-owner updates", async () => {
    const { chain } = database({ owner_id: owner, rules: { economy_under_hours: 6, hotel_cap_eur: 170, max_trip_budget_per_traveler: null, arrival_margin_minutes: 60 } });
    expect((await savePolicy(request({ hotel_cap_eur: -1 }, "PATCH"))).status).toBe(400);
    expect(chain.update).not.toHaveBeenCalled();
    expect((await savePolicy(request({ hotel_cap_eur: 170 }, "PATCH"))).status).toBe(200);
    expect(chain.eq).toHaveBeenCalledWith("owner_id", owner);
  });
});
