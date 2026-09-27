import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { IdSchema, ReceiptSchema } from "@repo/types";
import { HttpError } from "./http";
import type { TripStore } from "./agent/store";
export const MAX_RECEIPT_BYTES = 4 * 1024 * 1024;
export function receiptMime(bytes: Buffer) {
  if (!bytes.length || bytes.length > MAX_RECEIPT_BYTES) throw new HttpError(400, "Choose a receipt up to 4 MiB.");
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return "image/png" as const;
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg" as const;
  if (bytes.subarray(0,4).toString() === "RIFF" && bytes.subarray(8,12).toString() === "WEBP") return "image/webp" as const;
  if (bytes.subarray(0,5).toString() === "%PDF-") return "application/pdf" as const;
  throw new HttpError(400, "Use a JPEG, PNG, WebP photo or PDF receipt.");
}
export const receiptHash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
export function assertExpensesEditable(store: TripStore) {
  if (store.state.trip.status === "reported" || store.state.actions.some((a) => a.kind === "submit_expense_report" && ["executing", "executed", "failed"].includes(a.status)))
    throw new HttpError(409, "Report delivery has started. Review its Gmail delivery status before changing expenses.");
}
export async function receiptForm(request: Request) {
  const limit = MAX_RECEIPT_BYTES + 65536;
  if (Number(request.headers.get("content-length")) > limit) throw new HttpError(413, "Choose a receipt up to 4 MiB.");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "Select a receipt.");
  const chunks: Uint8Array[] = []; let length = 0;
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    length += value.byteLength;
    if (length > limit) { await reader.cancel(); throw new HttpError(413, "Choose a receipt up to 4 MiB."); }
    chunks.push(value);
  }
  let form: FormData;
  try { form = await new Response(Buffer.concat(chunks), { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData(); }
  catch { throw new HttpError(400, "Upload a multipart form with a receipt and traveler_id."); }
  const file = form.get("receipt");
  if (!(file instanceof File)) throw new HttpError(400, "Select a receipt file.");
  return { file, travelerId: IdSchema.parse(form.get("traveler_id")) };
}
export async function uploadReceipt(store: TripStore, file: File, travelerId: string) {
  assertExpensesEditable(store);
  if (!store.state.travelers.some((t) => t.traveler_id === travelerId)) throw new HttpError(404, "Traveler not found in this trip.");
  const bytes = Buffer.from(await file.arrayBuffer()); const mime = receiptMime(bytes); const hash = receiptHash(bytes);
  let receipt = store.state.receipts.find((r) => r.content_hash === hash);
  if (receipt && receipt.traveler_id !== travelerId) throw new HttpError(409, "This file already belongs to another traveler in this trip.");
  if (receipt && receipt.status !== "uploading") return receipt;
  receipt ??= ReceiptSchema.parse({ id: randomUUID(), owner_id: store.owner, trip_id: store.id, traveler_id: travelerId,
    path: store.owner + "/" + store.id + "/" + hash, file_name: file.name.slice(0,200), mime_type: mime, content_hash: hash,
    status: "uploading", extraction: null, error: null, created_at: new Date().toISOString() });
  await store.save({ receipts: [receipt] });
  const bucket = store.db.storage.from("receipts");
  const { error } = await bucket.upload(receipt.path, bytes, { contentType: mime, upsert: false });
  if (error) {
    // A previous upload may have succeeded before its checkpoint was persisted.
    const old = await bucket.download(receipt.path);
    if (!old.data || receiptHash(Buffer.from(await old.data.arrayBuffer())) !== hash)
      throw new HttpError(502, "Receipt upload failed. Upload the same file again to resume.");
  }
  receipt = { ...receipt, status: "uploaded" };
  await store.save({ receipts: [receipt], events: [{ actor: "manager", title: "Receipt uploaded", detail: receipt.file_name, data: { receipt_id: receipt.id, traveler_id: travelerId } }] });
  return receipt;
}
