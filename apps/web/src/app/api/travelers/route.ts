import { TravelerInputSchema, TravelerRecordSchema, type TravelerInput } from "@repo/types";
import { requireUser } from "@/server/auth";
import { checkDatabase, checkOrigin, handleApi, json, readJson } from "@/server/http";

const demoTravelers: TravelerInput[] = TravelerInputSchema.array().parse([
  {
    full_name: "Alice Martin",
    email: "alice.martin@example.com",
    home_city: "Paris",
    home_airport: "CDG",
    preferences: { seat: "aisle", notes: "No flights before 08:00." },
  },
  {
    full_name: "Marc Bennett",
    email: "marc.bennett@example.com",
    home_city: "London",
    home_airport: "LHR",
    preferences: { seat: "none", notes: "Heathrow preferred." },
  },
  {
    full_name: "Sarah Ruiz",
    email: "sarah.ruiz@example.com",
    home_city: "Madrid",
    home_airport: "MAD",
    preferences: { seat: "window", notes: "Vegetarian meal." },
  },
]);

export async function GET() {
  return handleApi(async () => {
    const { db, user } = await requireUser();
    const { data: existing, error } = await db.from("travelers").select("*").eq("owner_id", user.id).order("created_at");
    checkDatabase(error);
    let data = existing;
    if (data?.length === 0) {
      const seeded = await db.from("travelers").insert(demoTravelers.map((person) => ({ ...person, owner_id: user.id }))).select("*").order("created_at");
      if (seeded.error?.code === "23505") {
        const refreshed = await db.from("travelers").select("*").eq("owner_id", user.id).order("created_at");
        checkDatabase(refreshed.error);
        data = refreshed.data;
      } else {
        checkDatabase(seeded.error);
        data = seeded.data;
      }
    }
    return json(TravelerRecordSchema.array().parse(data));
  });
}
export async function POST(request: Request) {
  return handleApi(async () => {
    const { db, user } = await requireUser();
    checkOrigin(request);
    const input = TravelerInputSchema.parse(await readJson(request));
    const { data, error } = await db.from("travelers").insert({ ...input, owner_id: user.id }).select().single();
    checkDatabase(error);
    return json(TravelerRecordSchema.parse(data), 201);
  });
}
