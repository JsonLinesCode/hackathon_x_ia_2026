import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const auth = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock("./auth", async (original) => ({ ...await original<typeof import("./auth")>(), requireUser: auth.requireUser }));
import { UnauthorizedError } from "./auth";
import { GET as list, POST as create } from "@/app/api/trips/route";
import { GET as detail, PATCH as clarify } from "@/app/api/trips/[id]/route";
import { POST as run } from "@/app/api/trips/[id]/run/route";
import { POST as select } from "@/app/api/trips/[id]/select/route";
import { POST as exception } from "@/app/api/trips/[id]/exception/route";
import { POST as confirm } from "@/app/api/trips/[id]/confirm/route";
import { POST as decide } from "@/app/api/actions/[id]/decide/route";
const id = "11111111-1111-4111-8111-111111111111";
const ctx = { params: Promise.resolve({ id }) };
const request = () => new Request("http://localhost:3000/api/trips", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
beforeEach(() => vi.clearAllMocks());
describe("phase 2 authentication boundaries", () => {
  it("returns 401 JSON on all unauthenticated workflow routes before using provider keys or a service client", async () => {
    auth.requireUser.mockRejectedValue(new UnauthorizedError());
    const responses = await Promise.all([list(), create(request()), detail(request(), ctx), clarify(request(), ctx), run(request(), ctx),
      select(request(), ctx), exception(request(), ctx), confirm(request(), ctx), decide(request(), ctx)]);
    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(response.headers.get("location")).toBeNull();
      expect(await response.json()).toHaveProperty("error");
    }
  });
  it("rejects owner injection and forged action IDs at the boundary", async () => {
    const chain = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
    auth.requireUser.mockResolvedValue({ user: { id }, db: { from: vi.fn().mockReturnValue(chain) } });
    const injected = new Request("http://localhost:3000/api/trips", { method: "POST", body: JSON.stringify({ request_text: "Plan a business trip", traveler_ids: [], idempotency_key: id, owner_id: id }) });
    expect((await create(injected)).status).toBe(400);
    const decision = new Request("http://localhost:3000/api/actions/" + id + "/decide", { method: "POST", body: JSON.stringify({ decision: "approve" }) });
    expect((await decide(decision, ctx)).status).toBe(404);
    expect(chain.eq).toHaveBeenCalledWith("owner_id", id);
  });
});
