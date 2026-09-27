-- Part A: reviewable trip requests. Existing auth and owner policies are unchanged.
begin;
alter table public.trips add column card jsonb check(card is null or jsonb_typeof(card)='object');
alter table public.trips drop constraint trips_status_check;
alter table public.trips add constraint trips_status_check check(status in (
  'draft','awaiting_request_confirmation','understanding','needs_info','checking_availability','searching','options_ready',
  'awaiting_exception','awaiting_travelers','ready_to_book','booking','booked','disrupted','cancelled','completed','reported'
));
create table public.trip_messages (
  id uuid primary key default gen_random_uuid(), trip_id uuid not null, owner_id uuid not null references auth.users(id) on delete cascade,
  role text not null check(role in ('user','agent','system')), content text not null,
  quick_replies jsonb not null default '[]' check(jsonb_typeof(quick_replies)='array'), created_at timestamptz not null default now(),
  foreign key(trip_id,owner_id) references public.trips(id,owner_id) on delete cascade
);
alter table public.trip_messages enable row level security;
create policy message_owner on public.trip_messages for select to authenticated using(owner_id=(select auth.uid()));
revoke all on public.trip_messages from public,anon,authenticated;
grant select on public.trip_messages to authenticated;
grant all on public.trip_messages to service_role;
create index trip_messages_order on public.trip_messages(owner_id,trip_id,created_at,id);

-- Save the card, conversation, and validation checkpoint in a single transaction
-- under the same lease as the existing workflow. Revisions reject stale browser tabs.
create function public.trip_draft_commit(p_trip uuid,p_owner uuid,p_token uuid,p_revision integer,p_card jsonb,p_messages jsonb,p_changes jsonb default '{}') returns void
language plpgsql set search_path='' as $$
declare v_trip public.trips; v_item jsonb;
begin
  perform 1 from public.trip_leases where trip_id=p_trip and owner_id=p_owner and token=p_token and expires_at>now() for update;
  if not found then raise exception 'Workflow lease unavailable' using errcode='P0001'; end if;
  select * into v_trip from public.trips where id=p_trip and owner_id=p_owner for update;
  if not found or v_trip.status <> 'awaiting_request_confirmation' or coalesce((v_trip.card->>'revision')::integer,0) <> p_revision then
    raise exception 'Draft changed or already validated' using errcode='P0001';
  end if;
  if p_changes <> '{}'::jsonb then
    if p_changes->'trip'->>'status' <> 'checking_availability' then raise exception 'Invalid validation' using errcode='P0001'; end if;
    perform public.phase5_commit(p_trip,p_owner,p_token,p_changes);
  end if;
  update public.trips set card=p_card || jsonb_build_object('revision',p_revision+1),
    title=coalesce(nullif(p_card->'destination'->>'value',''),'New trip') || ' · team trip',
    destination=p_card->'destination'->>'value', budget_per_traveler=(p_card->'budget'->>'value')::numeric
    where id=p_trip and owner_id=p_owner;
  for v_item in select value from jsonb_array_elements(p_messages) loop
    insert into public.trip_messages(id,trip_id,owner_id,role,content,quick_replies,created_at)
      values((v_item->>'id')::uuid,p_trip,p_owner,v_item->>'role',v_item->>'content',coalesce(v_item->'quick_replies','[]'),(v_item->>'created_at')::timestamptz);
  end loop;
end;
$$;
revoke all on function public.trip_draft_commit(uuid,uuid,uuid,integer,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.trip_draft_commit(uuid,uuid,uuid,integer,jsonb,jsonb,jsonb) to service_role;
commit;
