-- Phase 1. Run once in the Supabase SQL editor as the project administrator.
begin;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  created_at timestamptz not null default now()
);

create table public.google_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token text not null check (length(refresh_token) > 0),
  scopes text[] not null default '{}',
  updated_at timestamptz not null default now(),
  invalidated_at timestamptz
);

create table public.policies (
  owner_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  rules jsonb not null default '{"economy_under_hours":6,"hotel_cap_eur":180,"max_trip_budget_per_traveler":null,"arrival_margin_minutes":60}'::jsonb,
  constraint policy_rules_object check (jsonb_typeof(rules) = 'object')
);

create table public.travelers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  full_name text not null check (length(trim(full_name)) between 1 and 120),
  email text not null check (length(email) <= 254 and email = lower(trim(email))),
  home_city text not null check (length(trim(home_city)) between 1 and 120),
  home_airport text not null check (home_airport ~ '^[A-Z]{3}$'),
  preferences jsonb not null default '{"seat":"none","notes":""}'::jsonb,
  calendar_access text not null default 'unknown' check (calendar_access in ('unknown','direct','consented','denied')),
  created_at timestamptz not null default now(),
  unique (id, owner_id),
  unique (owner_id, email),
  check (jsonb_typeof(preferences) = 'object')
);

create table public.traveler_google_credentials (
  traveler_id uuid primary key references public.travelers(id) on delete cascade,
  refresh_token text not null check (length(refresh_token) > 0),
  scopes text[] not null default '{}',
  updated_at timestamptz not null default now(),
  invalidated_at timestamptz
);

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  request_text text not null,
  extracted jsonb,
  destination text,
  meeting jsonb,
  status text not null default 'draft' check (status in (
    'draft','understanding','needs_info','checking_availability','searching','options_ready',
    'awaiting_exception','awaiting_travelers','ready_to_book','booking','booked','disrupted','cancelled','completed','reported'
  )),
  budget_per_traveler numeric(12,2) check (budget_per_traveler >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  check (extracted is null or jsonb_typeof(extracted) = 'object'),
  check (meeting is null or jsonb_typeof(meeting) = 'object')
);

create table public.trip_travelers (
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  trip_id uuid not null,
  traveler_id uuid not null,
  availability jsonb,
  confirmation_status text not null default 'not_requested' check (
    confirmation_status in ('not_requested','pending','confirmed','counter_proposal','declined','needs_review')
  ),
  response_text text,
  primary key (trip_id, traveler_id),
  unique (trip_id, traveler_id, owner_id),
  foreign key (trip_id, owner_id) references public.trips(id, owner_id) on delete cascade,
  foreign key (traveler_id, owner_id) references public.travelers(id, owner_id) on delete restrict
);

create table public.trip_options (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  trip_id uuid not null,
  label text not null,
  rank integer not null check (rank > 0),
  total_eur numeric(12,2) not null check (total_eur >= 0),
  per_traveler jsonb not null default '[]',
  compliant boolean not null default false,
  violations jsonb not null default '[]',
  explanation text not null default '',
  selected boolean not null default false,
  exception_approved boolean not null default false,
  exception_note text,
  foreign key (trip_id, owner_id) references public.trips(id, owner_id) on delete cascade,
  check (jsonb_typeof(per_traveler) = 'array' and jsonb_typeof(violations) = 'array')
);
create unique index one_selected_option_per_trip on public.trip_options(trip_id) where selected;

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  trip_id uuid not null,
  traveler_id uuid not null,
  kind text not null check (kind in ('flight','hotel')),
  status text not null default 'quoted' check (status in ('quoted','booked','cancelled','cancel_requested','failed')),
  provider_ref text,
  price_eur numeric(12,2) not null check (price_eur >= 0),
  payment_link text,
  cancellation_terms jsonb,
  details jsonb not null default '{}',
  raw jsonb not null default '{}',
  foreign key (trip_id, traveler_id, owner_id) references public.trip_travelers(trip_id, traveler_id, owner_id) on delete cascade
);

create table public.actions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  trip_id uuid not null,
  kind text not null,
  summary text not null,
  cost_eur numeric(12,2) check (cost_eur >= 0),
  reversible boolean not null default false,
  gate text not null check (gate in ('auto','needs_manager')),
  status text not null default 'proposed' check (status in ('proposed','approved','rejected','executing','executed','failed')),
  payload jsonb not null default '{}',
  rationale text not null default '',
  decided_at timestamptz,
  result jsonb,
  idempotency_key text not null unique,
  foreign key (trip_id, owner_id) references public.trips(id, owner_id) on delete cascade,
  check (gate <> 'auto' or (
    cost_eur is not null and cost_eur = 0 and reversible and kind in
    ('send_information','request_confirmation','send_reminder','calendar_invite','calendar_update','send_recap')
  )),
  check (status not in ('approved','rejected') or decided_at is not null),
  check (gate <> 'needs_manager' or status not in ('executing','executed') or decided_at is not null)
);

create table public.outreach (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  trip_id uuid not null,
  traveler_id uuid not null,
  purpose text not null check (purpose in ('calendar_access','trip_confirmation','info_request','notification')),
  channel text not null default 'email' check (channel = 'email'),
  status text not null default 'sent' check (status in ('sent','responded','expired')),
  gmail_thread_id text not null,
  gmail_message_id text not null,
  sent_at timestamptz not null default now(),
  reminder_count integer not null default 0 check (reminder_count >= 0),
  last_reminder_at timestamptz,
  foreign key (trip_id, traveler_id, owner_id) references public.trip_travelers(trip_id, traveler_id, owner_id) on delete cascade
);

create table public.timeline_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  trip_id uuid not null,
  at timestamptz not null default now(),
  actor text not null check (actor in ('agent','manager','traveler','provider','system')),
  source text not null,
  title text not null,
  detail text not null default '',
  data jsonb not null default '{}',
  foreign key (trip_id, owner_id) references public.trips(id, owner_id) on delete cascade
);

create table public.inbound_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null,
  dedupe_key text not null unique,
  payload jsonb not null default '{}',
  processed_at timestamptz
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  trip_id uuid not null,
  traveler_id uuid not null,
  date date not null,
  merchant text not null,
  category text not null,
  amount numeric(12,2) not null check (amount >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  amount_eur numeric(12,2) not null check (amount_eur >= 0),
  compliant boolean not null default false,
  note text,
  receipt_path text,
  foreign key (trip_id, traveler_id, owner_id) references public.trip_travelers(trip_id, traveler_id, owner_id) on delete cascade
);

-- Deny anon access and enable RLS everywhere, including both credential tables.
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','google_credentials','traveler_google_credentials','policies','travelers',
    'trips','trip_travelers','trip_options','bookings','actions','outreach','timeline_events','inbound_events','expenses'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
  foreach t in array array[
    'policies','travelers','trips','trip_travelers','trip_options','bookings','actions','outreach','timeline_events','inbound_events','expenses'
  ] loop
    execute format(
      'create policy owner_access on public.%I for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))', t
    );
    execute format('grant select on public.%I to authenticated', t);
    if t not in ('policies','travelers') then
      execute format('create index %I on public.%I (owner_id)', t || '_owner_idx', t);
    end if;
  end loop;
end $$;

create policy profile_access on public.profiles for select to authenticated using (id = (select auth.uid()));
grant select on public.profiles to authenticated;
-- Only Phase 1 CRUD tables accept user-scoped mutations. Future workflow tables
-- are written by authenticated server workflows, never directly by the browser.
grant insert, update, delete on public.travelers to authenticated;
grant update on public.policies to authenticated;
-- No policies and no authenticated/anon grants on either credential table.

create index trips_owner_status_idx on public.trips(owner_id, status);
create index timeline_trip_at_idx on public.timeline_events(trip_id, at);
create index outreach_thread_idx on public.outreach(owner_id, gmail_thread_id);

create function public.touch_trip_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
create trigger trip_updated_at before update on public.trips
for each row execute function public.touch_trip_updated_at();

create function public.handle_new_manager() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''))
  on conflict (id) do nothing;
  insert into public.policies (owner_id) values (new.id) on conflict (owner_id) do nothing;
  return new;
end;
$$;
revoke all on function public.handle_new_manager() from public, anon, authenticated;
revoke all on function public.touch_trip_updated_at() from public, anon, authenticated;
create trigger manager_created after insert on auth.users for each row execute function public.handle_new_manager();

-- Backfill accounts created before this migration, preserving existing policies.
insert into public.profiles (id, email, full_name)
select id, coalesce(email, ''), coalesce(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name', '')
from auth.users on conflict (id) do nothing;
insert into public.policies (owner_id) select id from auth.users on conflict (owner_id) do nothing;

insert into storage.buckets (id, name, public) values ('receipts', 'receipts', false)
on conflict (id) do update set public = false;
-- Object paths: <owner UUID>/<trip UUID>/<filename>. Also check trip ownership.
create policy receipt_read on storage.objects for select to authenticated using (
  bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (select 1 from public.trips where id::text = (storage.foldername(name))[2] and owner_id = (select auth.uid()))
);
create policy receipt_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (select 1 from public.trips where id::text = (storage.foldername(name))[2] and owner_id = (select auth.uid()))
);
create policy receipt_delete on storage.objects for delete to authenticated using (
  bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (select 1 from public.trips where id::text = (storage.foldername(name))[2] and owner_id = (select auth.uid()))
);
commit;
