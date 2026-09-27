import { z } from "zod";
import { IdSchema, JourneySchema, MeetingSchema } from "@repo/types";
import { requireUser } from "@/server/auth";
import { checkOrigin, handleApi, HttpError, json, readJson } from "@/server/http";
import { withTrip, publicTrip, loadTrip } from "@/server/agent/store";
import { chooseReplacement } from "@/server/agent/flows/disruptions";
const Input = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("replace"), option_id: IdSchema }).strict(),
  z.object({ operation: z.literal("dates"), action_id: IdSchema, journey: JourneySchema, meeting: MeetingSchema }).strict(),
  z.object({ operation: z.literal("manual_cancelled"), booking_id: IdSchema, note: z.string().trim().min(10).max(2000) }).strict(),
]);
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleApi(async () => {
    const { user } = await requireUser(); checkOrigin(request);
    const id = IdSchema.parse((await context.params).id), input = Input.parse(await readJson(request));
    await withTrip(user.id, id, async (store) => {
      const d = store.state.workflow.disruption;
      if (!d) throw new HttpError(409, "No disruption is recorded.");
      if (input.operation === "replace") { await chooseReplacement(store, input.option_id); return; }
      if (input.operation === "dates") {
        const action = store.state.actions.find((a) => a.id === input.action_id && d.action_ids.includes(a.id) && a.payload.operation === "move_dates");
        if (!action || action.status !== "proposed" || d.stage !== "waiting") throw new HttpError(409, "This move no longer accepts changes.");
        const j = input.journey;
        if (Date.parse(input.meeting.start) <= Date.now() || (j.transport === "flight" && (!j.departure_date || !j.destination_iata || (!j.one_way && (!j.return_date || j.return_date < j.departure_date)))) ||
          (j.hotel_needed && (!j.hotel_checkin || !j.hotel_checkout || j.hotel_checkout <= j.hotel_checkin))) throw new HttpError(400, "Enter future meeting times and consistent travel dates.");
        await store.save({ actions: [{ ...action, payload: { ...action.payload, journey: j, meeting: input.meeting } }],
          events: [{ actor: "manager", title: "Alternative dates prepared", detail: "Approve the move to start a fresh search." }] }); return;
      }
      const booking = store.state.bookings.find((b) => b.id === input.booking_id);
      if (!booking || booking.status !== "cancel_requested") throw new HttpError(409, "This booking is not awaiting manual cancellation.");
      await store.save({ bookings: [{ ...booking, status: "cancelled" }],
        trip: { workflow: { ...store.state.workflow, error: null } },
        events: [{ actor: "manager", title: "External cancellation confirmed", detail: input.note, data: { booking_id: booking.id, provider_ref: booking.provider_ref } }] });
    });
    return json(publicTrip(await loadTrip(user.id, id)));
  });
}
