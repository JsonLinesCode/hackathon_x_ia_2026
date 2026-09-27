"use client";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { Badge } from "@repo/ui";
import { Button } from "@repo/ui/button";
import { assessExpense, expenseTotals } from "@repo/core";
import { ExpenseReportSnapshotSchema, ExpenseInputSchema, type Expense, type Policy, type Receipt, type TripDetail } from "@repo/types";
import { api, euro, statusLabel, useTrip } from "@/lib/trip-client";
import { Heading } from "./travel-primitives";

function ExpenseLine({ receipt, index, expense, busy, save }: {
  receipt: Receipt; index: number; expense?: Expense; busy: boolean; save: (body: unknown) => Promise<boolean>;
}) {
  const line = receipt.extraction?.lines[index];
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const form = new FormData(event.currentTarget);
    const text = (key: string) => String(form.get(key) ?? "").trim();
    const parsed = ExpenseInputSchema.safeParse({ receipt_id: receipt.id, line_index: index,
      date: text("date"), merchant: text("merchant"), category: text("category"), amount: Number(text("amount")),
      currency: text("currency").toUpperCase(), amount_eur: Number(text("amount_eur")),
      nights: text("nights") ? Number(text("nights")) : null, note: text("note") || null, reviewed: true });
    if (!parsed.success) { setError(parsed.error.issues.map((i) => i.message).join(" ")); return; }
    await save({ operation: "review", expense: parsed.data });
  }
  return <form className="form-stack expense-line" onSubmit={submit}>
    <div className="section-heading"><h3>Expense {index + 1}</h3><Badge tone={expense?.reviewed ? "success" : "warning"}>{expense?.reviewed ? "Verified" : "Check original receipt"}</Badge></div>
    {line && <p className="muted small">Extraction confidence: {Math.round(line.confidence * 100)}%. Verify every field against the original.</p>}
    <div className="managed-form-grid">
      <label>Date<input name="date" type="date" required defaultValue={expense?.date ?? (line?.date?.match(/^\d{4}-\d{2}-\d{2}$/) ? line.date : "")} /></label>
      <label>Merchant<input name="merchant" required maxLength={200} defaultValue={expense?.merchant ?? line?.merchant ?? ""} /></label>
      <label>Category<select name="category" defaultValue={expense?.category ?? line?.category ?? "other"}>{["hotel","flight","meals","ground_transport","other"].map((v) => <option value={v} key={v}>{statusLabel(v)}</option>)}</select></label>
      <label>Original amount<input name="amount" required type="number" step="0.01" min="0" max="1000000" defaultValue={expense?.amount ?? line?.amount ?? ""} /></label>
      <label>Original currency<input name="currency" required pattern="[A-Za-z]{3}" maxLength={3} defaultValue={expense?.currency ?? line?.currency ?? ""} placeholder="EUR" /></label>
      <label>Verified EUR amount<input name="amount_eur" required type="number" step="0.01" min="0" max="1000000" defaultValue={expense?.amount_eur ?? (line?.currency === "EUR" ? line.amount ?? "" : "")} /></label>
      <label>Hotel nights<input name="nights" type="number" min="1" max="365" defaultValue={expense?.nights ?? line?.nights ?? ""} /></label>
    </div>
    <label>Business purpose / conversion source<textarea name="note" maxLength={2000} rows={2} defaultValue={expense?.note ?? line?.note ?? ""} placeholder="For foreign currency, enter the EUR amount from your card statement and record its source here." /></label>
    {expense?.policy_reasons.length ? <ul className="missing-fields">{expense.policy_reasons.map((r) => <li key={r}>{r}</li>)}</ul> : null}
    <label className="checkbox-label"><input type="checkbox" required disabled={busy} />I checked this line against the original receipt.</label>
    {error && <p role="alert" className="warning-text">{error}</p>}<Button variant="outline" disabled={busy}>Save verified expense</Button>
  </form>;
}
function ReceiptCard({ receipt, data, busy, save }: { receipt: Receipt; data: TripDetail; busy: boolean; save: (body: unknown) => Promise<boolean> }) {
  const [reason, setReason] = useState("");
  const expenses = data.expenses.filter((e) => e.receipt_id === receipt.id);
  return <section className="surface stack">
    <div className="section-heading"><div><h2>{receipt.file_name}</h2><p className="muted">{data.travelers.find((t) => t.traveler_id === receipt.traveler_id)?.traveler.full_name}</p></div><Badge tone={receipt.status === "ready" ? "success" : "neutral"}>{statusLabel(receipt.status)}</Badge></div>
    {receipt.status !== "uploading" && <a className="text-link" href={"/api/receipts/" + receipt.id}>Download original receipt</a>}
    {receipt.error && <p role="alert" className="warning-text">{receipt.error}</p>}
    {receipt.extraction?.issues.map((issue, i) => <p className="muted small" key={i}>{issue}</p>)}
    {["uploading", "uploaded", "extracting"].includes(receipt.status) && <p role="status">{receipt.status === "uploading" ? "Upload not completed. Upload the same file again to resume." : "Extracting expenses… Keep this page open to advance the saved steps."}</p>}
    {["needs_review", "ready", "failed"].includes(receipt.status) && <>
      {Array.from({ length: Math.max(1, receipt.extraction?.lines.length ?? 0) }, (_, i) => <ExpenseLine key={receipt.id + ":" + i + ":" + JSON.stringify(expenses.find((e) => e.line_index === i))} receipt={receipt} index={i} expense={expenses.find((e) => e.line_index === i)} busy={busy} save={save} />)}
      {!expenses.some((e) => e.reviewed) && <Button variant="outline" disabled={busy} onClick={() => void save({ operation: "retry", receipt_id: receipt.id })}>Retry extraction</Button>}
      <form className="form-stack" onSubmit={(e) => { e.preventDefault(); void save({ operation: "ignore", receipt_id: receipt.id, reason }); }}>
        <label>Reason to exclude this receipt<input minLength={5} maxLength={500} required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Duplicate, personal expense, wrong document…" /></label>
        <Button variant="ghost" disabled={busy}>Exclude receipt from report</Button>
      </form>
    </>}
  </section>;
}
export function PostTrip({ tripId }: { tripId: string }) {
  const { data, error, busy, mutate, reload } = useTrip(tripId);
  const [uploading, setUploading] = useState(false), [uploadError, setUploadError] = useState(""), [recipient, setRecipient] = useState("");
  const [policy, setPolicy] = useState<Policy | null>(null), [policyError, setPolicyError] = useState("");
  useEffect(() => {
    let active = true;
    const load = () => void api<Policy>("/api/policies").then((p) => { if (active) { setPolicy(p); setPolicyError(""); } }).catch((e: Error) => { if (active) setPolicyError(e.message); });
    load(); const timer = setInterval(load, 30000); return () => { active = false; clearInterval(timer); };
  }, []);
  if (!data) return <section className="surface"><p role={error ? "alert" : "status"}>{error || "Loading expenses…"}</p></section>;
  const path = "/api/trips/" + tripId;
  const frozen = data.trip.status === "reported" || data.actions.some((a) => a.kind === "submit_expense_report" && ["executing","executed","failed"].includes(a.status));
  const locked = busy || data.running || uploading;
  const sent = ExpenseReportSnapshotSchema.safeParse(data.actions.find((a) => a.kind === "submit_expense_report" && a.status === "executed")?.payload.snapshot);
  const expenses = sent.success ? sent.data.expenses : data.expenses.map((e) => { if (!policy) return e; const result = assessExpense(e, policy.rules, data.trip, data.expenses); return { ...e, compliant: result.compliant, policy_reasons: result.reasons }; });
  const totals = expenseTotals(expenses);
  const reports = data.actions.filter((a) => a.kind === "submit_expense_report");
  const ready = ["completed", "cancelled"].includes(data.trip.status) && expenses.length > 0 && expenses.every((e) => e.reviewed && e.amount_eur !== null) && data.receipts.every((r) => ["ready","ignored"].includes(r.status));
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; setUploading(true); setUploadError("");
    try {
      const response = await fetch(path + "/receipts", { method: "POST", body: new FormData(formElement) });
      const value = await response.json(); if (!response.ok) throw new Error(value.error ?? "Upload failed.");
      formElement.reset(); await reload();
    } catch (e) { setUploadError(e instanceof Error ? e.message : "Upload failed."); }
    finally { setUploading(false); }
  }
  return <div className="stack post-trip">
    <Heading title="Expenses & report" subtitle={data.trip.title} eyebrow={<Badge>{statusLabel(data.trip.status)}</Badge>}><Button asChild variant="outline"><Link href={"/trips/" + tripId}>Back to travel plan</Link></Button></Heading>
    {(error || uploadError || policyError) && <p role="alert" className="inline-alert tone-danger">{error || uploadError || policyError}</p>}
    {data.workflow_error && <div className="surface stack"><p role="alert">{data.workflow_error}</p><Button variant="outline" disabled={locked} onClick={() => void mutate(path + "/run", { retry: true })}>Retry saved step</Button></div>}
    <section className="surface stack"><div className="section-heading"><h2>Expense summary</h2><strong>{euro(totals.total_eur)}</strong></div>
      {!expenses.length ? <p className="muted">Upload a receipt to start the expense report.</p> : <>
        {Object.entries(totals.per_traveler).map(([id, amount]) => <div className="between" key={id}><span>{sent.success ? sent.data.travelers.find((t) => t.id === id)?.name : data.travelers.find((t) => t.traveler_id === id)?.traveler.full_name}</span><strong>{euro(amount)}</strong></div>)}
        <p className="muted small">{expenses.filter((e) => !e.reviewed).length} lines to verify · {expenses.filter((e) => !e.compliant).length} lines need policy review{totals.unconverted > 0 ? " · " + totals.unconverted + " missing EUR conversions (excluded from totals)" : ""}</p>
        <Button asChild variant="outline"><a href={path + "/report"}>Download expense CSV</a></Button>
      </>}
      <p className="muted small">Policy exceptions remain visible in the report. Receipt amounts do not establish that a booking was paid or ticketed.</p>
    </section>
    {!frozen && <section className="surface stack"><h2>Add a receipt</h2><p className="muted small">JPEG, PNG, WebP or PDF · up to 4 MiB · private to your workspace.</p>
      <form className="form-stack" onSubmit={upload}><label>Traveler<select name="traveler_id" required>{data.travelers.map((t) => <option key={t.traveler_id} value={t.traveler_id}>{t.traveler.full_name}</option>)}</select></label>
        <label>Receipt<input name="receipt" type="file" required accept="image/jpeg,image/png,image/webp,application/pdf" /></label><Button disabled={locked || !data.travelers.length}>{uploading ? "Uploading…" : "Upload & extract"}</Button></form>
    </section>}
    {data.receipts.map((receipt) => <ReceiptCard key={receipt.id} receipt={receipt} data={{ ...data, expenses }} busy={locked || frozen} save={(body) => mutate(path + "/expenses", body)} />)}
    {!frozen && <section className="surface stack"><h2>Prepare the final report</h2>
      {data.trip.status === "booked" && <form className="form-stack" onSubmit={(e) => { e.preventDefault(); void mutate(path + "/report", { operation: "complete", finished: true }); }}>
        <p>The recorded travel dates must have ended before completing the trip.</p><label className="checkbox-label"><input type="checkbox" required />The trip has finished and I have checked its actual outcome.</label><Button variant="outline" disabled={locked}>Mark trip completed</Button></form>}
      <p className="muted">Verify every receipt, then prepare the email. Sending requires a separate approval below.</p>
      <form className="form-stack" onSubmit={(e) => { e.preventDefault(); void mutate(path + "/report", { operation: "prepare", recipient }); }}><label>Report recipient<input type="email" required maxLength={254} value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="expenses@company.com" /></label>
        <Button disabled={locked || !ready}>Prepare report for approval</Button></form>
    </section>}
    {reports.map((a) => { const mail = a.payload.mail as { to: string; subject: string; body: string } | undefined; return <section key={a.id} className="surface stack"><div className="section-heading"><h2>{a.summary}</h2><Badge tone={a.status === "executed" ? "success" : "neutral"}>{statusLabel(a.status)}</Badge></div>
      {mail && <><p><strong>To:</strong> {mail.to}</p><p><strong>Subject:</strong> {mail.subject}</p><pre className="report-preview">{mail.body}</pre></>}
      {typeof a.result?.error === "string" && <p role="alert">{a.result.error}</p>}
      {a.status === "proposed" && <div className="button-row"><Button variant="outline" disabled={locked} onClick={() => void mutate("/api/actions/" + a.id + "/decide", { decision: "reject" })}>Reject</Button><Button disabled={locked} onClick={() => void mutate("/api/actions/" + a.id + "/decide", { decision: "approve" })}>Approve & send report</Button></div>}
    </section>; })}
  </div>;
}
