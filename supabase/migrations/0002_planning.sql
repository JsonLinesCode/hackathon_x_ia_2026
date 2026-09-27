-- Phase 2. Run after 0001_foundation.sql. No credentials or provider calls.
begin;
alter table public.trips add column workflow jsonb not null default '{}';
alter table public.trips add column creation_key uuid;
create unique index trips_creation_key on public.trips(owner_id, creation_key);
alter table public.trip_travelers add column booking_details jsonb;

-- A database lease serializes both the runner and manager mutations across
-- browser tabs / server instances. It outlives the 300-second route limit.
create table public.trip_leases (
  trip_id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  token uuid not null,
  expires_at timestamptz not null,
  foreign key (trip_id, owner_id) references public.trips(id, owner_id) on delete cascade
);
alter table public.trip_leases enable row level security;
revoke all on public.trip_leases from public, anon, authenticated;
grant all on public.trip_leases to service_role;

create function public.phase2_claim(p_trip uuid, p_owner uuid, p_token uuid) returns boolean
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.trips where id = p_trip and owner_id = p_owner) then return false; end if;
  insert into public.trip_leases(trip_id, owner_id, token, expires_at)
  values (p_trip, p_owner, p_token, now() + interval '350 seconds')
  on conflict (trip_id) do update set token = excluded.token, expires_at = excluded.expires_at
    where public.trip_leases.owner_id = p_owner and public.trip_leases.expires_at < now();
  return found;
end;
$$;

create function public.phase2_release(p_trip uuid, p_owner uuid, p_token uuid) returns void
language sql set search_path = '' as $$
  delete from public.trip_leases where trip_id = p_trip and owner_id = p_owner and token = p_token;
$$;

-- Every checkpoint atomically persists state, options, decisions, quotes and
-- their timeline entries. Only the authenticated server can invoke this RPC.
create function public.phase2_commit(p_trip uuid, p_owner uuid, p_token uuid, p_changes jsonb) returns void
language plpgsql set search_path = '' as $$
declare
  v_trip public.trips;
  v_item jsonb;
  v_option public.trip_options;
  v_action public.actions;
  v_booking public.bookings;
begin
  perform 1 from public.trip_leases where trip_id = p_trip and owner_id = p_owner
    and token = p_token and expires_at > now() for update;
  if not found then raise exception 'Workflow lease unavailable' using errcode = 'P0001'; end if;
  select * into strict v_trip from public.trips where id = p_trip and owner_id = p_owner for update;
  if p_changes ? 'trip' then
    v_trip := jsonb_populate_record(v_trip, p_changes->'trip');
    update public.trips set title=v_trip.title, request_text=v_trip.request_text, extracted=v_trip.extracted,
      destination=v_trip.destination, meeting=v_trip.meeting, status=v_trip.status,
      budget_per_traveler=v_trip.budget_per_traveler, workflow=v_trip.workflow
      where id=p_trip and owner_id=p_owner;
  end if;
  if coalesce((p_changes->>'reset_plan')::boolean, false) then
    if exists (select 1 from public.actions where trip_id=p_trip and owner_id=p_owner and status in ('executing','executed'))
      or exists (select 1 from public.bookings where trip_id=p_trip and owner_id=p_owner)
      then raise exception 'A quote has already started' using errcode='P0001'; end if;
    update public.actions set status='rejected', decided_at=coalesce(decided_at, now())
      where trip_id=p_trip and owner_id=p_owner and status in ('proposed','approved');
    delete from public.trip_options where trip_id=p_trip and owner_id=p_owner;
    update public.trip_travelers set confirmation_status='not_requested', response_text=null
      where trip_id=p_trip and owner_id=p_owner;
  end if;
  if coalesce((p_changes->>'replace_travelers')::boolean, false) then
    if exists (select 1 from public.bookings where trip_id=p_trip) then raise exception 'Travel quotes already exist'; end if;
    delete from public.trip_travelers where trip_id=p_trip and owner_id=p_owner;
  end if;
  for v_item in select value from jsonb_array_elements(coalesce(p_changes->'travelers','[]')) loop
    insert into public.trip_travelers(owner_id, trip_id, traveler_id, confirmation_status, response_text, booking_details)
      values(p_owner,p_trip,(v_item->>'traveler_id')::uuid,coalesce(v_item->>'confirmation_status','not_requested'),
        v_item->>'response_text',nullif(v_item->'booking_details','null'))
      on conflict (trip_id,traveler_id) do update set
        confirmation_status=excluded.confirmation_status, response_text=excluded.response_text, booking_details=excluded.booking_details
      where public.trip_travelers.owner_id=p_owner;
  end loop;
  -- Clear the old selection first to satisfy the one-selected-option index.
  if p_changes ? 'options' then
    update public.trip_options set selected=false where trip_id=p_trip and owner_id=p_owner;
  end if;
  for v_item in select value from jsonb_array_elements(coalesce(p_changes->'options','[]')) loop
    v_option := jsonb_populate_record(null::public.trip_options, v_item || jsonb_build_object('owner_id',p_owner,'trip_id',p_trip));
    insert into public.trip_options select v_option.*
      on conflict(id) do update set selected=excluded.selected, exception_approved=excluded.exception_approved,
        exception_note=excluded.exception_note, compliant=excluded.compliant, violations=excluded.violations
      where public.trip_options.trip_id=p_trip and public.trip_options.owner_id=p_owner;
  end loop;
  for v_item in select value from jsonb_array_elements(coalesce(p_changes->'actions','[]')) loop
    v_action := jsonb_populate_record(null::public.actions, v_item || jsonb_build_object('owner_id',p_owner,'trip_id',p_trip));
    update public.actions set status=v_action.status, decided_at=v_action.decided_at,
      result=v_action.result, payload=v_action.payload
      where id=v_action.id and trip_id=p_trip and owner_id=p_owner;
    if not found then insert into public.actions select v_action.*; end if;
  end loop;
  for v_item in select value from jsonb_array_elements(coalesce(p_changes->'bookings','[]')) loop
    v_booking := jsonb_populate_record(null::public.bookings, v_item || jsonb_build_object('owner_id',p_owner,'trip_id',p_trip));
    insert into public.bookings select v_booking.*
      on conflict(id) do update set status=excluded.status, provider_ref=excluded.provider_ref,
        price_eur=excluded.price_eur, payment_link=excluded.payment_link,
        cancellation_terms=excluded.cancellation_terms, details=excluded.details, raw=excluded.raw
      where public.bookings.trip_id=p_trip and public.bookings.owner_id=p_owner;
  end loop;
  for v_item in select value from jsonb_array_elements(coalesce(p_changes->'events','[]')) loop
    insert into public.timeline_events(owner_id,trip_id,actor,source,title,detail,data)
      values(p_owner,p_trip,coalesce(v_item->>'actor','agent'),coalesce(v_item->>'source','planner'),
        v_item->>'title',coalesce(v_item->>'detail',''),coalesce(v_item->'data','{}'));
  end loop;
end;
$$;

-- Defense in depth: workflow inserts are proposals; execution must follow a
-- persisted approval, and completed/failed decisions cannot be re-executed.
create function public.phase2_action_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.kind = 'book' then
    if new.gate <> 'needs_manager' then raise exception 'Booking requires manager gate'; end if;
    if tg_op = 'INSERT' and new.status <> 'proposed' then raise exception 'New booking actions must be proposals'; end if;
    if tg_op = 'UPDATE' then
      if new.status = 'executing' and old.status not in ('approved','executing') then raise exception 'Booking needs a recorded approval'; end if;
      if new.status = 'executed' and old.status not in ('executing','executed') then raise exception 'Booking was not executing'; end if;
      if old.status in ('executed','failed','rejected') and new.status <> old.status then raise exception 'Booking decision is final'; end if;
      if old.status <> 'proposed' and new.decided_at is distinct from old.decided_at then raise exception 'Decision timestamp is immutable'; end if;
    end if;
  end if;
  return new;
end;
$$;
create trigger phase2_action_guard before insert or update on public.actions
for each row execute function public.phase2_action_guard();

revoke all on function public.phase2_claim(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.phase2_release(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.phase2_commit(uuid,uuid,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.phase2_action_guard() from public, anon, authenticated;
grant execute on function public.phase2_claim(uuid,uuid,uuid) to service_role;
grant execute on function public.phase2_release(uuid,uuid,uuid) to service_role;
grant execute on function public.phase2_commit(uuid,uuid,uuid,jsonb) to service_role;
commit;
