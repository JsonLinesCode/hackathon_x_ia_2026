import "server-only";
import { PlanningError } from "@repo/core";
import { IntegrationError } from "../integrations/errors";
import { HttpError } from "../http";
import { EnvironmentError } from "../env";
import { withTrip, type TripStore } from "./store";
import { understand, searchNext, prepareDecisions, quoteNext } from "./flows/plan-trip";

export async function runStep(store: TripStore, retry = false) {
  if (store.state.workflow.error && !retry) return;
  if (retry) await store.save({ trip: { workflow: { ...store.state.workflow, error: null } }, events: [{ actor: "manager", title: "Retry requested" }] });
  try {
    switch (store.state.trip.status) {
      case "understanding": await understand(store); break;
      case "searching": await searchNext(store); break;
      case "awaiting_travelers":
        if (store.state.travelers.length && store.state.travelers.every((t) => t.confirmation_status === "confirmed" && t.booking_details)) await prepareDecisions(store);
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
