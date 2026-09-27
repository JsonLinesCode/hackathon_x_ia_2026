import { z } from "zod";
import { IdSchema, BookingDetailsSchema } from "@repo/types";
import { assertBookingReady } from "@repo/core";
import { requireUser } from "@/server/auth";
import { checkOrigin, handleApi, HttpError, json, readJson } from "@/server/http";
import { loadTrip, publicTrip, withTrip } from "@/server/agent/store";
import { prepareDecisions } from "@/server/agent/flows/plan-trip";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleApi(async () => {
    const { user } = await requireUser(); checkOrigin(request);
    const id = IdSchema.parse((await context.params).id);
    const input = z.object({ traveler_id: IdSchema, booking_details: BookingDetailsSchema }).strict().parse(await readJson(request));
    await withTrip(user.id, id, async (store) => {
      if (store.state.trip.status !== "awaiting_travelers") throw new HttpError(409, "Select an option and resolve policy exceptions before confirming travelers.");
      const person = store.state.travelers.find((t) => t.traveler_id === input.traveler_id);
      if (!person) throw new HttpError(404, "Traveler not found for this trip.");
      const hasFlight = !!store.state.options.find((o) => o.selected)?.per_traveler.find((p) => p.traveler_id === input.traveler_id)?.flight;
      if (hasFlight && (!input.booking_details.date_of_birth || !input.booking_details.gender)) throw new HttpError(400, "Flight quotes require date of birth and gender as on the travel document.");
      const selected = store.state.options.find((o) => o.selected)!;
      const item = selected.per_traveler.find((p) => p.traveler_id === person.traveler_id);
      if (!item) throw new HttpError(409, "This traveler has no selected itinerary.");
      assertBookingReady({ ...selected, per_traveler: [item] }, [{ ...person, confirmation_status: "confirmed", booking_details: input.booking_details }], new Date());
      await store.save({ travelers: [{ traveler_id: person.traveler_id, booking_details: input.booking_details,
        confirmation_status: "confirmed", response_text: "Confirmed manually by the manager." }],
        trip: { workflow: { ...store.state.workflow, error: null } },
        events: [{ actor: "manager", title: "Traveler confirmed manually", detail: person.traveler.full_name, data: { traveler_id: person.traveler_id } }] });
      if (store.state.travelers.every((t) => t.confirmation_status === "confirmed" && t.booking_details)) await prepareDecisions(store);
    });
    return json(publicTrip(await loadTrip(user.id, id)));
  });
}
