import { ActionProposalSchema, type Action, type ActionProposal } from "@repo/types";

const automaticKinds = new Set<ActionProposal["kind"]>([
  "send_information", "request_confirmation", "send_reminder", "calendar_invite", "calendar_update", "send_recap",
]);

// Unknown kinds, costs, and invalid input fail closed. Booking/cancellation/reporting
// never become automatic even when a provider advertises a zero charge.
export function classifyAction(action: unknown): "auto" | "needs_manager" {
  const parsed = ActionProposalSchema.safeParse(action);
  return parsed.success && automaticKinds.has(parsed.data.kind)
    && parsed.data.cost_eur === 0 && parsed.data.reversible ? "auto" : "needs_manager";
}

export function assertActionExecutable(action: Pick<Action, "kind" | "cost_eur" | "reversible" | "status" | "decided_at">) {
  const gate = classifyAction(action);
  if (gate === "needs_manager" && (action.status !== "approved" || !action.decided_at)) {
    throw new Error("An explicit manager approval must be recorded before execution.");
  }
  if (gate === "auto" && !["proposed", "approved"].includes(action.status)) {
    throw new Error("This action cannot be executed in its current state.");
  }
}
