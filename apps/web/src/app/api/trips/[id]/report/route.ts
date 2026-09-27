import { z } from "zod";
import { ExpenseReportSnapshotSchema, IdSchema } from "@repo/types";
import { requireUser } from "@/server/auth";
import { checkOrigin, handleApi, json, readJson } from "@/server/http";
import { withTrip, publicTrip } from "@/server/agent/store";
import { expenseCsv } from "@repo/core";
import { loadTrip, TripStore } from "@/server/agent/store";
import { assessedExpenses, prepareReport, completeTrip } from "@/server/agent/flows/post-trip";
export const maxDuration = 300;
const Input = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("complete"), finished: z.literal(true) }).strict(),
  z.object({ operation: z.literal("prepare"), recipient: z.string().trim().email().max(254) }).strict(),
]);
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleApi(async () => {
    const { user } = await requireUser(); checkOrigin(request);
    const id = IdSchema.parse((await context.params).id); const input = Input.parse(await readJson(request));
    return json(await withTrip(user.id, id, async (store) => {
      if (input.operation === "complete") await completeTrip(store);
      else await prepareReport(store, input.recipient);
      return publicTrip(store.state);
    }));
  });
}
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return handleApi(async () => {
    const { user } = await requireUser(); const id = IdSchema.parse((await context.params).id);
    const state = await loadTrip(user.id, id);
    const sent = ExpenseReportSnapshotSchema.safeParse(state.actions.find((a) => a.kind === "submit_expense_report" && a.status === "executed")?.payload.snapshot);
    const expenses = sent.success ? sent.data.expenses : await assessedExpenses(new TripStore(user.id, id, "", state));
    const names = Object.fromEntries(sent.success ? sent.data.travelers.map((t) => [t.id, t.name]) : state.travelers.map((t) => [t.traveler_id, t.traveler.full_name]));
    return new Response(expenseCsv(expenses, names), { headers: {
      "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="expense-report.csv"', "Cache-Control": "private, no-store",
    } });
  });
}
