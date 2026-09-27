"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { TripDetailSchema, type TripDetail } from "@repo/types";

export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
export async function api<T>(path: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<T> {
  const response = await fetch(path, { method, cache: "no-store", headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new ApiError(value.fields?.length ? value.error + " " + value.fields.map((f: { path: string; message: string }) => f.path + ": " + f.message).join(" ") : value.error || "Request failed.", response.status);
  return value as T;
}
export function automatic(detail: TripDetail) {
  if (detail.workflow_error) return false;
  if (["understanding", "checking_availability", "searching"].includes(detail.trip.status)) return true;
  if (detail.actions.some((a) => a.gate === "auto" && ["proposed", "executing"].includes(a.status))) return true;
  if (detail.trip.status === "booked" && !detail.coordination_done) return true;
  if (detail.trip.status === "awaiting_travelers") return detail.travelers.some((t) => ["not_requested", "counter_proposal"].includes(t.confirmation_status)) || detail.travelers.every((t) => t.confirmation_status === "confirmed" && t.booking_details);
  const selectedId = detail.options.find((o) => o.selected)?.id;
  const actions = detail.actions.filter((a) => a.payload.option_id === selectedId);
  if (["ready_to_book", "booking"].includes(detail.trip.status)) return actions.some((a) => ["approved", "executing"].includes(a.status)) ||
    (detail.trip.status === "booking" && actions.length > 0 && actions.every((a) => a.status === "executed"));
  return false;
}
export function useTrip(id: string) {
  const [data, setData] = useState<TripDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const mounted = useRef(false);
  const load = useCallback(async () => {
    const value = TripDetailSchema.parse(await api("/api/trips/" + id));
    if (mounted.current) setData(value);
    return value;
  }, [id]);
  useEffect(() => {
    mounted.current = true;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      let next = 5000;
      try {
        const value = await load();
        if (automatic(value) || value.running) next = 1500;
        if (!stopped && automatic(value) && !value.running && !running.current) {
          running.current = true;
          // Server steps persist independently of page lifetime.
          void api("/api/trips/" + id + "/run", {}).catch((err: unknown) => {
            if (!stopped && !(err instanceof ApiError && err.status === 409)) setError(err instanceof Error ? err.message : "The step failed.");
          }).finally(() => { running.current = false; });
        }
      } catch (err) { if (!stopped) setError(err instanceof Error ? err.message : "Could not load this trip."); }
      if (!stopped) timer = setTimeout(() => { void poll(); }, next);
    }
    void poll();
    return () => { stopped = true; mounted.current = false; clearTimeout(timer); };
  }, [id, load]);
  const mutate = useCallback(async (path: string, body: unknown, method = "POST") => {
    setBusy(true); setError("");
    try { await api(path, body, method); await load(); return true; }
    catch (err) { setError(err instanceof Error ? err.message : "Could not save the change."); await load().catch(() => undefined); return false; }
    finally { if (mounted.current) setBusy(false); }
  }, [load]);
  return { data, error, busy, mutate, reload: load };
}
export const euro = (value: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR" }).format(value);
export const dateTime = (value: string, timeZone = "Europe/Paris") => new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium", timeStyle: "short", timeZone,
}).format(new Date(value));
export const statusLabel = (status: string) => status === "booked" ? "Payment links ready" : status.replaceAll("_", " ");
