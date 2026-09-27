import { z } from "zod";
import { IdSchema } from "@repo/types";
import { requireUser } from "@/server/auth";
import { checkOrigin, handleApi, json, readJson } from "@/server/http";
import { withTrip, publicTrip } from "@/server/agent/store";
import { ExpenseInputSchema } from "@repo/types";
import { reviewExpense, changeReceipt } from "@/server/agent/flows/post-trip";
const Input = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("review"), expense: ExpenseInputSchema }).strict(),
  z.object({ operation: z.literal("retry"), receipt_id: IdSchema }).strict(),
  z.object({ operation: z.literal("ignore"), receipt_id: IdSchema, reason: z.string().trim().min(5).max(500) }).strict(),
]);
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleApi(async () => {
    const { user } = await requireUser(); checkOrigin(request);
    const id = IdSchema.parse((await context.params).id); const input = Input.parse(await readJson(request));
    return json(await withTrip(user.id, id, async (store) => {
      if (input.operation === "review") await reviewExpense(store, input.expense);
      else await changeReceipt(store, input.receipt_id, input.operation, input.operation === "ignore" ? input.reason : undefined);
      return publicTrip(store.state);
    }));
  });
}
