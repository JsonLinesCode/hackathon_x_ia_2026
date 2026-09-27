import { IdSchema } from "@repo/types";
import { requireUser } from "@/server/auth";
import { checkOrigin, handleApi, json } from "@/server/http";
import { withTrip } from "@/server/agent/store";
import { receiptForm, uploadReceipt } from "@/server/receipts";
export const maxDuration = 300;
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleApi(async () => {
    const { user } = await requireUser(); checkOrigin(request);
    const id = IdSchema.parse((await context.params).id);
    const { file, travelerId } = await receiptForm(request);
    return json(await withTrip(user.id, id, (store) => uploadReceipt(store, file, travelerId)));
  });
}
