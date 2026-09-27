import { EXPENSE_REPORT_SUMMARY } from "../prompts";
import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { ExpenseSchema, ExpenseInputSchema, type Action, type Expense, type ExpenseInput } from "@repo/types";
import { assessExpense, assertActionExecutable, expenseTotals } from "@repo/core";
import { getEnv } from "../../env";
import { HttpError } from "../../http";
import { assertExpensesEditable, receiptHash, MAX_RECEIPT_BYTES } from "../../receipts";
import { extractReceipt, structured } from "../../integrations/openai";
import { GoogleError } from "../../integrations/google-auth";
import { MailSchema, sendMail, findSent } from "../../integrations/gmail";
import { proposal } from "../notify";
import { planningDatabase, type TripStore } from "../store";

export async function assessedExpenses(store: TripStore, expenses = store.state.expenses) {
  const policy = await store.policy();
  return expenses.map((e) => { const result = assessExpense(e, policy, store.state.trip, expenses);
    return { ...e, compliant: result.compliant, policy_reasons: result.reasons }; });
}
export async function extractNextReceipt(store: TripStore) {
  const receipt = store.state.receipts.find((r) => ["uploaded", "extracting"].includes(r.status));
  if (!receipt) return false;
  assertExpensesEditable(store);
  await store.save({ receipts: [{ ...receipt, status: "extracting", error: null }] });
  try {
    const { data, error } = await store.db.storage.from("receipts").download(receipt.path);
    if (error || !data) throw new HttpError(502, "The private receipt could not be downloaded.");
    if (data.size > MAX_RECEIPT_BYTES) throw new HttpError(400, "Receipt exceeds 4 MiB.");
    const bytes = Buffer.from(await data.arrayBuffer());
    if (receiptHash(bytes) !== receipt.content_hash) throw new HttpError(409, "The receipt content changed. Upload the original file again.");
    const extraction = await extractReceipt(receipt.mime_type, bytes, store.audit);
    if (extraction.lines.length > 50) throw new HttpError(400, "More than 50 totals were extracted. Split the document into smaller receipts.");
    const expenses: Expense[] = [];
    if (extraction.is_receipt) extraction.lines.forEach((line, index) => {
      const parsed = ExpenseSchema.safeParse({
        id: randomUUID(), owner_id: store.owner, trip_id: store.id, traveler_id: receipt.traveler_id,
        date: line.date, merchant: line.merchant, category: line.category, amount: line.amount, currency: line.currency,
        amount_eur: line.currency === "EUR" ? line.amount : null, nights: line.nights,
        compliant: false, reviewed: false, policy_reasons: [], note: line.note, receipt_id: receipt.id, line_index: index, receipt_path: receipt.path,
      });
      if (parsed.success && parsed.data.merchant.trim()) expenses.push(parsed.data);
    });
    const all = [...store.state.expenses.filter((e) => e.receipt_id !== receipt.id), ...expenses];
    await store.save({ receipts: [{ ...receipt, status: "needs_review", extraction, error: null }],
      delete_receipt_expenses: receipt.id, expenses: await assessedExpenses(store, all),
      events: [{ title: "Receipt extracted", detail: "Verify the source, amounts and currency before adding it to the report.", data: { receipt_id: receipt.id, lines: extraction.lines.length } }] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Receipt extraction failed. Retry or enter its details manually.";
    await store.save({ receipts: [{ ...receipt, status: "failed", error: message.slice(0,500) }],
      events: [{ title: "Receipt needs attention", detail: message.slice(0,500), data: { receipt_id: receipt.id } }] });
  }
  return true;
}
export async function reviewExpense(store: TripStore, value: ExpenseInput) {
  assertExpensesEditable(store);
  const input = ExpenseInputSchema.parse(value);
  const receipt = store.state.receipts.find((r) => r.id === input.receipt_id);
  if (!receipt || !["needs_review", "ready", "failed"].includes(receipt.status)) throw new HttpError(409, "Wait for extraction or retry the receipt.");
  const count = Math.max(1, receipt.extraction?.lines.length ?? 0);
  if (input.line_index >= count) throw new HttpError(400, "This receipt line does not exist.");
  const previous = store.state.expenses.find((e) => e.receipt_id === receipt.id && e.line_index === input.line_index);
  const expense = ExpenseSchema.parse({ ...input, id: previous?.id ?? randomUUID(), owner_id: store.owner, trip_id: store.id,
    traveler_id: receipt.traveler_id, receipt_path: receipt.path, compliant: false });
  const expenses = await assessedExpenses(store, [...store.state.expenses.filter((e) => e.id !== expense.id), expense]);
  const ready = Array.from({ length: count }, (_, i) => i).every((i) => expenses.some((e) => e.receipt_id === receipt.id && e.line_index === i && e.reviewed));
  await store.save({ expenses, receipts: [{ ...receipt, status: ready ? "ready" : "needs_review", error: null }],
    events: [{ actor: "manager", title: "Expense verified", detail: expense.merchant, data: { receipt_id: receipt.id, expense_id: expense.id } }] });
}
export async function changeReceipt(store: TripStore, id: string, operation: "retry" | "ignore", reason?: string) {
  assertExpensesEditable(store);
  const receipt = store.state.receipts.find((r) => r.id === id);
  if (!receipt) throw new HttpError(404, "Receipt not found.");
  if (["uploading", "uploaded", "extracting"].includes(receipt.status)) throw new HttpError(409, "Wait for the current upload or extraction.");
  if (operation === "retry" && store.state.expenses.some((e) => e.receipt_id === id && e.reviewed)) throw new HttpError(409, "Edit the verified lines instead of re-extracting them.");
  const expenses = store.state.expenses.filter((e) => e.receipt_id !== id);
  await store.save({ receipts: [{ ...receipt, status: operation === "retry" ? "uploaded" : "ignored", error: operation === "ignore" ? reason ?? "Excluded by manager." : null }],
    delete_receipt_expenses: id, expenses: await assessedExpenses(store, expenses),
    events: [{ actor: "manager", title: operation === "retry" ? "Receipt extraction requested" : "Receipt excluded from report", detail: reason ?? receipt.file_name }] });
}
export async function reportSnapshot(store: TripStore) {
  if (!["completed", "cancelled"].includes(store.state.trip.status)) throw new HttpError(409, "Mark the trip completed before preparing the report.");
  if (!store.state.expenses.length || store.state.expenses.some((e) => !e.reviewed || e.amount_eur === null))
    throw new HttpError(409, "Verify all expense lines and EUR conversions before preparing the report.");
  if (store.state.receipts.some((r) => !["ready", "ignored"].includes(r.status))) throw new HttpError(409, "Review or exclude every receipt first.");
  const policy = await store.policy();
  const expenses = store.state.expenses.map((e) => { const result = assessExpense(e, policy, store.state.trip, store.state.expenses);
    return { ...e, compliant: result.compliant, policy_reasons: result.reasons }; }).sort((a,b) => a.id.localeCompare(b.id));
  const snapshot = { trip: { id: store.id, title: store.state.trip.title, destination: store.state.trip.destination, meeting: store.state.trip.meeting },
    travelers: store.state.travelers.map((t) => ({ id: t.traveler_id, name: t.traveler.full_name })).sort((a,b) => a.id.localeCompare(b.id)),
    receipts: store.state.receipts.map((r) => ({ id: r.id, hash: r.content_hash, status: r.status })).sort((a,b) => a.id.localeCompare(b.id)),
    policy, expenses, totals: expenseTotals(expenses) };
  return { snapshot, fingerprint: createHash("sha256").update(JSON.stringify(snapshot)).digest("hex") };
}
export async function validateReport(store: TripStore, action: Action) {
  const { fingerprint } = await reportSnapshot(store);
  if (action.payload.fingerprint !== fingerprint) throw new HttpError(409, "Expenses or policy changed. Prepare a fresh report for approval.");
}
export async function prepareReport(store: TripStore, to: string) {
  assertExpensesEditable(store);
  const { snapshot, fingerprint } = await reportSnapshot(store);
  if (store.state.actions.some((a) => a.kind === "submit_expense_report" && ["proposed", "approved"].includes(a.status) && a.payload.fingerprint === fingerprint && a.payload.recipient === to)) return;
  const language = store.state.trip.extracted?.language ?? "en";
  const summary = await structured(z.object({ summary: z.string() }), "expense_report_summary", EXPENSE_REPORT_SUMMARY,
    { language, trip: snapshot.trip, categories: [...new Set(snapshot.expenses.map((e) => e.category))] }, store.audit);
  const french = language === "fr";
  const names = Object.fromEntries(snapshot.travelers.map((t) => [t.id, t.name]));
  const totals = Object.entries(snapshot.totals.per_traveler).map(([id, total]) => names[id] + ": EUR " + total.toFixed(2)).join("\n");
  const frenchReasons = (reason: string) => reason
    .replace("Verify the EUR conversion before reporting.", "Vérifier la conversion en EUR avant envoi.")
    .replace("Hotel nights must be verified.", "Vérifier le nombre de nuitées.")
    .replace("Hotel exceeds EUR ", "Le coût de l'hôtel dépasse ")
    .replace(" per person per night.", " EUR par personne et par nuit.")
    .replace("Check the business purpose of this expense.", "Vérifier le motif professionnel de cette dépense.")
    .replace("Check flight class against the travel policy using the ticket.", "Vérifier la classe du vol sur le billet selon la politique voyage.")
    .replace("Possible duplicate receipt: verify before submitting.", "Doublon possible : vérifier avant envoi.")
    .replace("Traveler expenses exceed the EUR ", "Les dépenses du voyageur dépassent le budget de ")
    .replace(" trip budget.", " EUR.");
  const categories: Record<string, string> = { hotel: "Hôtel", flight: "Vol", meals: "Repas", ground_transport: "Transport terrestre", other: "Autre" };
  const lines = snapshot.expenses.map((e) => [names[e.traveler_id], e.date, e.merchant, french ? categories[e.category] ?? e.category : e.category,
    e.amount.toFixed(2) + " " + e.currency, "EUR " + e.amount_eur!.toFixed(2),
    e.compliant ? (french ? "Conforme" : "Compliant") : (french ? "À vérifier : " : "Review: ") + e.policy_reasons.map((reason) => french ? frenchReasons(reason) : reason).join("; "), e.note ?? ""].join(" | ")).join("\n");
  const action = proposal(store, { kind: "submit_expense_report", reversible: false,
    summary: (french ? "Envoyer le rapport à " : "Send expense report to ") + to, payload: {},
    idempotency_key: "report:" + store.id + ":" + randomUUID(), rationale: "Verified receipts and current company policy; manager approval required." });
  const messageId = "<" + action.id + "@" + new URL(getEnv(["APP_URL"]).APP_URL).hostname + ">";
  action.payload = { fingerprint, recipient: to, snapshot, operation: "expense_report",
    mail: MailSchema.parse({ to, messageId, subject: (french ? "Rapport de frais — " : "Expense report — ") + store.state.trip.title.replace(/[\r\n]+/g, " "),
      body: summary.summary + "\n\n" + totals + "\n\nTotal: EUR " + snapshot.totals.total_eur.toFixed(2) + "\n\n" + lines, links: [] }) };
  const old = store.state.actions.filter((a) => a.kind === "submit_expense_report" && ["proposed", "approved"].includes(a.status))
    .map((a) => ({ ...a, status: "rejected" as const, decided_at: a.decided_at ?? new Date().toISOString() }));
  await store.save({ trip: { workflow: { ...store.state.workflow, error: null } }, actions: [...old, action], events: [{ title: "Expense report prepared", detail: "Review the recipient and exact email before approval.", data: { action_id: action.id } }] });
}
export async function sendReportNext(store: TripStore) {
  const action = store.state.actions.find((a) => a.kind === "submit_expense_report" && ["approved", "executing"].includes(a.status));
  if (!action) return false;
  const mail = MailSchema.parse(action.payload.mail);
  let sent: { id: string; threadId: string } | null = null;
  if (action.status === "approved") {
    assertActionExecutable(action);
    await validateReport(store, action);
    const profile = await store.db.from("profiles").select("email").eq("id", store.owner).single();
    planningDatabase(profile.error);
    await store.save({ actions: [{ ...action, status: "executing", result: { started_at: new Date().toISOString() } }],
      events: [{ title: "Submitting approved expense report", detail: mail.to }] });
    try { sent = await sendMail(store.owner, profile.data!.email, mail, store.audit); }
    catch (error) {
      // Explicit authorization refusals prove Gmail did not accept the message.
      // The same immutable approval can resume after the manager reconnects.
      if (error instanceof GoogleError && [401, 403].includes(error.googleStatus))
        await store.save({ actions: [{ ...action, status: "approved", result: { error: error.message } }] });
      throw error;
    }
  } else {
    if (!action.decided_at || action.gate !== "needs_manager") throw new HttpError(409, "The report has no recorded approval.");
    sent = await findSent(store.owner, mail.messageId, store.audit);
    if (!sent) {
      const error = "Report delivery is uncertain. Check Sent in Gmail using Message-ID " + mail.messageId + ". This report is frozen and will not be sent again automatically.";
      await store.save({ actions: [{ ...action, status: "failed", result: { error } }], events: [{ title: "Report delivery needs review", detail: error }] });
      throw new HttpError(409, error);
    }
  }
  await store.save({ actions: [{ ...action, status: "executed", result: { gmail_message_id: sent.id, gmail_thread_id: sent.threadId } }],
    trip: { status: store.next("reported") }, events: [{ title: "Expense report sent", detail: mail.to, data: { action_id: action.id } }] });
  return true;
}
export async function completeTrip(store: TripStore) {
  if (store.state.trip.status === "completed") return;
  if (store.state.trip.status !== "booked") throw new HttpError(409, "Only a finished trip with prepared travel can be marked completed.");
  const dates = [store.state.trip.meeting?.end, store.state.workflow.journey?.return_date, store.state.workflow.journey?.hotel_checkout]
    .filter((v): v is string => !!v).map((v) => Date.parse(v.length === 10 ? v + "T23:59:59Z" : v));
  if (!dates.length || Math.max(...dates) > Date.now()) throw new HttpError(409, "The recorded trip dates have not ended yet.");
  await store.save({ trip: { status: store.next("completed") }, events: [{ actor: "manager", title: "Trip marked completed" }] });
}
