"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { MapPin, Pencil, Plus, RefreshCw, Search, ShieldCheck, Trash2, Users } from "lucide-react";
import { Avatar, Badge } from "@repo/ui";
import { Button } from "@repo/ui/button";
import { PolicyRulesSchema, TravelerInputSchema, type Policy, type PolicyRules, type TravelerRecord } from "@repo/types";
import { Heading, IconBox, Modal } from "./travel-primitives";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store", headers: { "Content-Type": "application/json", ...init?.headers } });
  if (response.status === 204) return undefined as T;
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.fields?.map((field: { path: string; message: string }) => field.path + ": " + field.message).join(" · ") || body.error || "Request failed. Please try again.");
  }
  return body;
}
function useResource<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setError("");
    setLoading(true);
    try { setData(await api<T>(url)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load your data."); }
    finally { setLoading(false); }
  }, [url]);
  useEffect(() => { void reload(); }, [reload]);
  return { data, error, loading, reload };
}
function LoadState({ error, loading, retry }: { error: string; loading: boolean; retry: () => void }) {
  if (error) return <div className="surface form-stack" role="alert"><p>{error}</p><div className="button-row">
    <Button variant="outline" onClick={retry}><RefreshCw size={16} />Try again</Button>
    <Button asChild variant="ghost"><Link href="/login">Sign in</Link></Button>
  </div></div>;
  if (loading) return <p className="muted" role="status">Loading your workspace…</p>;
  return null;
}

export function TravelersManager() {
  const { data, error, loading, reload } = useResource<TravelerRecord[]>("/api/travelers");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<TravelerRecord | "new" | null>(null);
  const [deleting, setDeleting] = useState<TravelerRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [mutationError, setMutationError] = useState("");
  const filtered = data?.filter((item) => [item.full_name, item.email, item.home_city, item.home_airport].join(" ").toLowerCase().includes(query.toLowerCase()));
  async function remove() {
    if (!deleting) return;
    setBusy(true); setMutationError("");
    try {
      await api("/api/travelers/" + deleting.id, { method: "DELETE" });
      setDeleting(null); await reload();
    } catch (cause) { setMutationError((cause as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="stack">
    <Heading title="Travelers" subtitle="The people you coordinate. Their details are saved to your workspace.">
      <Button onClick={() => setEditing("new")}><Plus size={16} />Add traveler</Button>
    </Heading>
    <label className="filter-input"><Search size={16} /><input aria-label="Search travelers" placeholder="Search name, email or city" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
    <LoadState error={error} loading={loading} retry={reload} />
    {!loading && !error && data?.length === 0 && <section className="surface empty-state">
      <IconBox icon={Users} /><h2>Your team starts here</h2><p className="muted">Add a traveler with their email and departure airport.</p>
      <Button variant="outline" onClick={() => setEditing("new")}>Add your first traveler</Button>
    </section>}
    {!loading && !error && data && data.length > 0 && filtered?.length === 0 && <p className="muted">No travelers match this search.</p>}
    {!error && <div className="traveler-directory">{filtered?.map((traveler) => <section className="surface managed-traveler" key={traveler.id}>
      <div className="person"><Avatar>{traveler.full_name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("")}</Avatar>
        <div><h2>{traveler.full_name}</h2><p className="muted break-anywhere">{traveler.email}</p></div>
      </div>
      <p className="inline-detail"><MapPin size={14} />{traveler.home_city} · {traveler.home_airport}</p>
      <Badge tone={["direct", "consented"].includes(traveler.calendar_access) ? "success" : "neutral"}>
        Calendar: {traveler.calendar_access === "unknown" ? "Not connected" : traveler.calendar_access}
      </Badge>
      {traveler.preferences.notes && <p className="muted break-anywhere">{traveler.preferences.notes}</p>}
      <div className="button-row"><Button variant="outline" size="sm" onClick={() => setEditing(traveler)}><Pencil size={14} />Edit</Button>
        <Button variant="ghost" size="sm" onClick={() => { setDeleting(traveler); setMutationError(""); }}><Trash2 size={14} />Delete</Button></div>
    </section>)}</div>}
    {editing && <Modal title={editing === "new" ? "Add traveler" : "Edit traveler"} onClose={() => setEditing(null)}>
      <TravelerForm traveler={editing === "new" ? undefined : editing} onSaved={async () => { setEditing(null); await reload(); }} />
    </Modal>}
    {deleting && <Modal title="Delete traveler" onClose={() => { if (!busy) setDeleting(null); }}>
      <div className="form-stack"><p>Remove {deleting.full_name} from your workspace? Travelers already attached to a trip cannot be deleted.</p>
        {mutationError && <p role="alert" className="danger-text">{mutationError}</p>}
        <div className="button-row"><Button variant="outline" disabled={busy} onClick={() => setDeleting(null)}>Keep traveler</Button>
          <Button variant="destructive" disabled={busy} onClick={remove}>{busy ? "Deleting…" : "Delete traveler"}</Button></div>
      </div>
    </Modal>}
  </div>;
}
function TravelerForm({ traveler, onSaved }: { traveler?: TravelerRecord; onSaved: () => Promise<void> }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const form = new FormData(event.currentTarget);
    const parsed = TravelerInputSchema.safeParse({
      full_name: form.get("full_name"), email: form.get("email"), home_city: form.get("home_city"), home_airport: form.get("home_airport"),
      preferences: { seat: form.get("seat"), notes: form.get("notes") },
    });
    if (!parsed.success) { setError(parsed.error.issues.map((issue) => issue.message).join(" · ")); return; }
    setBusy(true);
    try {
      await api(traveler ? "/api/travelers/" + traveler.id : "/api/travelers", { method: traveler ? "PATCH" : "POST", body: JSON.stringify(parsed.data) });
      await onSaved();
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }
  return <form className="form-stack" onSubmit={submit}>
    <label>Full name<input name="full_name" required maxLength={120} autoFocus defaultValue={traveler?.full_name} /></label>
    <label>Email<input name="email" type="email" required maxLength={254} defaultValue={traveler?.email} /></label>
    <div className="managed-form-grid"><label>Home city<input name="home_city" required maxLength={120} defaultValue={traveler?.home_city} /></label>
      <label>Home airport<input name="home_airport" required minLength={3} maxLength={3} placeholder="CDG" defaultValue={traveler?.home_airport} /></label></div>
    <label>Seat preference<select name="seat" defaultValue={traveler?.preferences.seat ?? "none"}><option value="none">No preference</option><option value="aisle">Aisle</option><option value="window">Window</option></select></label>
    <label>Preferences and constraints<textarea name="notes" rows={3} maxLength={2000} defaultValue={traveler?.preferences.notes} /></label>
    {error && <p role="alert" className="danger-text">{error}</p>}
    <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save traveler"}</Button>
  </form>;
}

export function PoliciesManager() {
  const { data, error, loading, reload } = useResource<Policy>("/api/policies");
  return <div className="stack">
    <Heading title="Company travel policy" subtitle="Rules applied consistently to every proposed trip."><Badge>Workspace policy</Badge></Heading>
    <LoadState error={error} loading={loading} retry={reload} />
    {data && !error && <PolicyEditor key={JSON.stringify(data.rules)} initial={data.rules} />}
  </div>;
}
function PolicyEditor({ initial }: { initial: PolicyRules }) {
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setSaved(false);
    const form = new FormData(event.currentTarget);
    const budget = String(form.get("max_trip_budget_per_traveler") ?? "").trim();
    const parsed = PolicyRulesSchema.safeParse({
      economy_under_hours: Number(form.get("economy_under_hours")), hotel_cap_eur: Number(form.get("hotel_cap_eur")),
      max_trip_budget_per_traveler: budget ? Number(budget) : null,
      arrival_margin_minutes: Number(form.get("arrival_margin_minutes")),
    });
    if (!parsed.success) { setError(parsed.error.issues.map((issue) => issue.path.join(".") + ": " + issue.message).join(" · ")); return; }
    setBusy(true);
    try { await api("/api/policies", { method: "PATCH", body: JSON.stringify(parsed.data) }); setSaved(true); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="surface managed-policy">
    <div className="section-heading"><div className="inline-detail"><IconBox icon={ShieldCheck} tone="success" /><h2>Travel rules</h2></div></div>
    <form className="form-stack" onSubmit={submit} onChange={() => setSaved(false)}>
      <label>Economy required for flights under (hours)<input name="economy_under_hours" type="number" min="0.1" max="24" step="0.1" required defaultValue={initial.economy_under_hours} /></label>
      <label>Hotel cap per person per night (EUR)<input name="hotel_cap_eur" type="number" min="0.01" max="10000" step="0.01" required defaultValue={initial.hotel_cap_eur} /></label>
      <label>Maximum trip budget per traveler (EUR)<input name="max_trip_budget_per_traveler" type="number" min="0.01" max="1000000" step="0.01" placeholder="No workspace cap" defaultValue={initial.max_trip_budget_per_traveler ?? ""} /><small className="muted">Leave empty to set a budget for each trip.</small></label>
      <label>Preferred arrival before the meeting (minutes)<input name="arrival_margin_minutes" type="number" min="0" max="1440" step="1" required defaultValue={initial.arrival_margin_minutes} /></label>
      <p className="muted">An exception requires your explicit approval before the related booking can proceed.</p>
      {error && <p role="alert" className="danger-text">{error}</p>}
      {saved && <p role="status" className="success-text">Policy saved to your workspace.</p>}
      <div><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save policy"}</Button></div>
    </form>
  </section>;
}

type ManagerProfile = { email: string; full_name: string; google_connected: boolean; connected_at: string | null };
export function ManagerSettings() {
  const { data, error, loading, reload } = useResource<ManagerProfile>("/api/profile");
  const [missingToken, setMissingToken] = useState(false);
  useEffect(() => { setMissingToken(new URLSearchParams(window.location.search).get("connection") === "missing_refresh_token"); }, []);
  return <div className="stack">
    <Heading title="Settings" subtitle="Your account and Google connection." />
    <LoadState error={error} loading={loading} retry={reload} />
    {data && !error && <>
      <section className="surface form-stack"><div className="person"><Avatar>{(data.full_name || data.email).slice(0, 2).toUpperCase()}</Avatar>
        <div><h2>{data.full_name || "Travel manager"}</h2><p className="muted break-anywhere">{data.email}</p></div></div>
        <div className="between"><h2>Google connection</h2><Badge tone={data.google_connected && !missingToken ? "success" : "warning"}>{data.google_connected && !missingToken ? "Connected" : "Reconnect required"}</Badge></div>
        <p className="muted">Calendar and Gmail access for travel coordination.</p>
        {missingToken && <div className="inline-alert tone-warning" role="alert"><p>Google did not return a refresh token. Remove this app’s access at <a className="primary-text" href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">Google account permissions</a>, then reconnect and grant the requested access.</p></div>}
        {!data.google_connected && !missingToken && <p className="muted">Connect Google to authorize calendar and email access.</p>}
        <form action="/auth/signin" method="post"><Button type="submit" variant="outline"><RefreshCw size={16} />Reconnect Google</Button></form>
      </section>
      <section className="surface form-stack"><h2>Workspace</h2><div className="profile-links">
        <Link href="/travelers">Manage travelers</Link><Link href="/policies">Edit travel policy</Link><Link href="/trips">Team trips</Link><Link href="/design-system">Shared UI</Link>
      </div><form action="/auth/signout" method="post"><Button type="submit" variant="outline">Sign out</Button></form></section>
    </>}
  </div>;
}
