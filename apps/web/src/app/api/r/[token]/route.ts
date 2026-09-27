import { TravelerReplySchema } from "@repo/types";
import { checkOrigin, handleApi, json, readJson } from "@/server/http";
import { travelerView, verifyOutreach } from "@/server/traveler-links";
import { withTrip } from "@/server/agent/store";
import { applyReply } from "@/server/agent/flows/confirmations";
export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  return handleApi(async () => json(await travelerView((await context.params).token)));
}
export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  return handleApi(async () => {
    checkOrigin(request);
    const token = (await context.params).token;
    const input = TravelerReplySchema.parse(await readJson(request));
    const { outreach } = await verifyOutreach(token, "trip_confirmation");
    await withTrip(outreach.owner_id, outreach.trip_id, async (store) => {
      await applyReply(store, store.state.outreach.find((o) => o.id === outreach.id)!, input, "traveler");
    });
    return json(await travelerView(token));
  });
}
