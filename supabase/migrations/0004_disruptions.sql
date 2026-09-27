-- Phase 4: replace travel options while retaining booking and decision history.
begin;
create function public.phase4_commit(p_trip uuid, p_owner uuid, p_token uuid, p_changes jsonb) returns void
language plpgsql set search_path = '' as $$
declare
  v_trip public.trips;
  v_item jsonb;
  v_option public.trip_options;
  v_action public.actions;
  v_booking public.bookings;
  v_outreach public.outreach;
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
  if coalesce((p_changes->>'clear_options')::boolean,false) then
    if exists(select 1 from public.actions where trip_id=p_trip and owner_id=p_owner and kind='book' and status='executing') then
      raise exception 'A quote is still executing' using errcode='P0001';
    end if;
    update public.trip_options set selected=false where trip_id=p_trip and owner_id=p_owner;
    delete from public.trip_options where trip_id=p_trip and owner_id=p_owner;
    update public.outreach set status='expired' where trip_id=p_trip and owner_id=p_owner and purpose='trip_confirmation';
    update public.actions set status='rejected',decided_at=coalesce(decided_at,now())
      where trip_id=p_trip and owner_id=p_owner and kind='book' and status in ('proposed','approved');
  end if;
  if coalesce((p_changes->>'reset_plan')::boolean, false) then
    if exists (select 1 from public.actions where trip_id=p_trip and owner_id=p_owner and (status='executing' or (kind='book' and status in ('executed','failed'))))
      or exists (select 1 from public.bookings where trip_id=p_trip and owner_id=p_owner)
      then raise exception 'A quote has already started' using errcode='P0001'; end if;
    update public.outreach set status='expired' where trip_id=p_trip and owner_id=p_owner and purpose='trip_confirmation';
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
    insert into public.trip_travelers(owner_id, trip_id, traveler_id, confirmation_status, response_text, booking_details, availability)
      values(p_owner,p_trip,(v_item->>'traveler_id')::uuid,coalesce(v_item->>'confirmation_status','not_requested'),
        v_item->>'response_text',nullif(v_item->'booking_details','null'),nullif(v_item->'availability','null'))
      on conflict (trip_id,traveler_id) do update set
        confirmation_status=excluded.confirmation_status, response_text=excluded.response_text, booking_details=excluded.booking_details, availability=excluded.availability
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

  for v_item in select value from jsonb_array_elements(coalesce(p_changes->'outreach','[]')) loop
    v_outreach := jsonb_populate_record(null::public.outreach,v_item || jsonb_build_object('owner_id',p_owner,'trip_id',p_trip));
    insert into public.outreach select v_outreach.*
    on conflict(id) do update set status=excluded.status,gmail_thread_id=excluded.gmail_thread_id,
      gmail_message_id=excluded.gmail_message_id,sent_at=excluded.sent_at,reminder_count=excluded.reminder_count,
      last_reminder_at=excluded.last_reminder_at,metadata=excluded.metadata
    where public.outreach.trip_id=p_trip and public.outreach.owner_id=p_owner;
  end loop;
  for v_item in select value from jsonb_array_elements(coalesce(p_changes->'inbound_ids','[]')) loop
    update public.inbound_events set processed_at=now() where id=(v_item#>>'{}')::uuid and owner_id=p_owner;
  end loop;
end;
$$;



revoke all on function public.phase4_commit(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.phase4_commit(uuid,uuid,uuid,jsonb) to service_role;
commit;
