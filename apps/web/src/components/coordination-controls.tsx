"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@repo/ui/button";
import type { PlanTraveler } from "@repo/types";
import { api } from "@/lib/trip-client";
export function SyncControl() {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [status, setStatus] = useState("");
  const running = useRef(false);
  async function sync() {
    if (running.current) return;
    running.current = true; setBusy(true); setError("");
    try {
      const value = await api<{ processed: number; running: boolean; more?: boolean }>("/api/sync", {});
      setStatus(value.running ? "Sync already running" : value.processed + " updates processed" + (value.more ? " · More on next sync" : ""));
    } catch (e) { setError(e instanceof Error ? e.message : "Sync failed."); }
    finally { running.current = false; setBusy(false); }
  }
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === "visible") void sync(); }, 60000);
    return () => clearInterval(timer);
  }, []);
  return <div className="sync-controls"><span className="muted small" role="status">{status}</span>
    <Button size="sm" variant="outline" disabled={busy} onClick={() => void sync()}><RefreshCw size={14} />{busy ? "Syncing…" : "Sync now"}</Button>
    {error && <p role="alert" className="warning-text">{error} <Link href="/profile">Google settings</Link></p>}</div>;
}
export function ResponseReview({ person, busy, submit }: { person: PlanTraveler; busy: boolean; submit: (decision: string, message: string) => void }) {
  const [message, setMessage] = useState(person.response_text ?? "");
  return <div className="response-review"><strong>{person.traveler.full_name} · Response needs review</strong>
    <label>Reply and alternative constraints<textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={4000} rows={3} /></label>
    <div className="button-row"><Button variant="outline" disabled={busy} onClick={() => submit("confirmed", message)}>Mark confirmed</Button>
      <Button variant="outline" disabled={busy} onClick={() => submit("declined", message)}>Mark declined</Button>
      <Button disabled={busy || message.trim().length < 5} onClick={() => submit("replan", message)}>Search alternatives</Button></div></div>;
}
