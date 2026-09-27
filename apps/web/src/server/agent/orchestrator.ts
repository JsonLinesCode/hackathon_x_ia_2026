import "server-only";
import { PlanningError } from "@repo/core";
import { IntegrationError } from "../integrations/errors";
import { HttpError } from "../http";
import { EnvironmentError } from "../env";
import { withTrip, type TripStore } from "./store";
import { understand, searchNext, quoteNext } from "./flows/plan-trip";

import { executeCommunication } from "./notify";
import { checkAvailability, confirmationNext, postBookingNext } from "./flows/confirmations";
import { replanTraveler } from "./flows/counter-proposal";

export async function runStep(store: TripStore, retry = false) {
  if (store.state.workflow.error && !retry) return;
  if (retry) await store.save({ trip: { workflow: { ...store.state.workflow, error: null } }, events: [{ actor: "manager", title: "Retry requested" }] });
  try {
    if (await executeCommunication(store)) return;
    switch (store.state.trip.status) {
      case "understanding": await understand(store); break;
      case "checking_availability": await checkAvailability(store); break;
      case "booked": await postBookingNext(store); break;
      case "searching": await searchNext(store); break;
      case "awaiting_travelers":
        { const counter = store.state.travelers.find((t) => t.confirmation_status === "counter_proposal");
          if (counter) await replanTraveler(store, counter.traveler_id); else await confirmationNext(store); }
        break;
      case "ready_to_book":
        if (store.state.actions.some((a) => a.status === "approved" && a.payload.option_id === store.state.options.find((o) => o.selected)?.id)) {
          await store.save({ trip: { status: store.next("booking") }, events: [{ title: "Preparing approved quotes" }] });
        }
        break;
      case "booking": await quoteNext(store); break;
    }
  } catch (error) {
    const message = error instanceof IntegrationError || error instanceof HttpError || error instanceof EnvironmentError || error instanceof PlanningError
      ? error.message
      : "This step could not be completed. Check traveler details and the provider response, then retry. If a quote call was started, reconcile it before trying again.";
    await store.save({ trip: { workflow: { ...store.state.workflow, error: message } },
      events: [{ actor: "system", title: "Workflow paused", detail: message }] });
  }
}
export async function runTrip(owner: string, id: string, retry = false) {
  return withTrip(owner, id, async (store) => { await runStep(store, retry); });
}
