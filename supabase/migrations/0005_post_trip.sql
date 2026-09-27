-- Phase 5: private receipt metadata, reviewed expenses and atomic report checkpoints.
begin;
create table public.receipts (
  id uuid primary key, owner_id uuid not null references auth.users(id) on delete cascade,
  trip_id uuid not null, traveler_id uuid not null,
  path text not null unique, file_name text not null,
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp','application/pdf')),
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  status text not null check (status in ('uploading','uploaded','extracting','needs_review','ready','failed','ignored')),
  extraction jsonb, error text, created_at timestamptz not null default now(),
  foreign key (trip_id,traveler_id,owner_id) references public.trip_travelers(trip_id,traveler_id,owner_id) on delete cascade,
  unique(id,trip_id,traveler_id,owner_id),
  unique(owner_id,trip_id,content_hash),
  check (path like owner_id::text || '/' || trip_id::text || '/%')
);
alter table public.receipts enable row level security;
create policy receipt_owner on public.receipts for select to authenticated using (owner_id = (select auth.uid()));
revoke all on public.receipts from public,anon,authenticated;
grant select on public.receipts to authenticated;
grant all on public.receipts to service_role;
create index receipts_owner_idx on public.receipts(owner_id);
alter table public.expenses alter column amount_eur drop not null;
alter table public.expenses add column receipt_id uuid,
  add column line_index integer check (line_index between 0 and 49),
  add column reviewed boolean not null default false,
  add column nights integer check (nights between 1 and 365),
  add column policy_reasons jsonb not null default '[]',
  add constraint expense_receipt_fk foreign key (receipt_id,trip_id,traveler_id,owner_id)
    references public.receipts(id,trip_id,traveler_id,owner_id),
  add constraint expense_line_unique unique(receipt_id,line_index),
  add constraint expense_line_pair check ((receipt_id is null) = (line_index is null));
-- Receipt uploads/deletions go through authenticated, leased server routes.
drop policy receipt_insert on storage.objects;
drop policy receipt_delete on storage.objects;

create function public.phase5_commit(p_trip uuid,p_owner uuid,p_token uuid,p_changes jsonb) returns void
language plpgsql set search_path='' as $$
declare v_item jsonb; v_receipt public.receipts; v_expense public.expenses;
begin
  perform 1 from public.trip_leases where trip_id=p_trip and owner_id=p_owner
    and token=p_token and expires_at>now() for update;
  if not found then raise exception 'Workflow lease unavailable' using errcode='P0001'; end if;
  perform 1 from public.trips where id=p_trip and owner_id=p_owner for update;
  if not found then raise exception 'Trip unavailable' using errcode='P0001'; end if;
  if p_changes ? 'receipts' or p_changes ? 'expenses' or p_changes ? 'delete_receipt_expenses' then
    if exists(select 1 from public.actions where trip_id=p_trip and owner_id=p_owner
      and kind='submit_expense_report' and status in ('executing','executed','failed'))
      or exists(select 1 from public.trips where id=p_trip and status='reported') then
      raise exception 'Report submission has started; expenses are frozen' using errcode='P0001';
    end if;
    update public.actions set status='rejected',decided_at=coalesce(decided_at,now())
      where trip_id=p_trip and owner_id=p_owner and kind='submit_expense_report' and status in ('proposed','approved');
  end if;
  perform public.phase4_commit(p_trip,p_owner,p_token,p_changes);
  for v_item in select value from jsonb_array_elements(coalesce(p_changes->'receipts','[]')) loop
    v_receipt := jsonb_populate_record(null::public.receipts,v_item || jsonb_build_object('owner_id',p_owner,'trip_id',p_trip));
    insert into public.receipts select v_receipt.*
      on conflict(id) do update set status=excluded.status,extraction=excluded.extraction,error=excluded.error
      where public.receipts.owner_id=p_owner and public.receipts.trip_id=p_trip;
  end loop;
  if p_changes ? 'delete_receipt_expenses' then
    delete from public.expenses where owner_id=p_owner and trip_id=p_trip
      and receipt_id=(p_changes->>'delete_receipt_expenses')::uuid;
  end if;
  for v_item in select value from jsonb_array_elements(coalesce(p_changes->'expenses','[]')) loop
    v_expense := jsonb_populate_record(null::public.expenses,v_item || jsonb_build_object('owner_id',p_owner,'trip_id',p_trip));
    insert into public.expenses select v_expense.*
      on conflict(id) do update set date=excluded.date,merchant=excluded.merchant,category=excluded.category,
        amount=excluded.amount,currency=excluded.currency,amount_eur=excluded.amount_eur,compliant=excluded.compliant,
        note=excluded.note,reviewed=excluded.reviewed,nights=excluded.nights,policy_reasons=excluded.policy_reasons
      where public.expenses.owner_id=p_owner and public.expenses.trip_id=p_trip
        and public.expenses.receipt_id=excluded.receipt_id and public.expenses.line_index=excluded.line_index;
  end loop;
end;
$$;
revoke all on function public.phase5_commit(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.phase5_commit(uuid,uuid,uuid,jsonb) to service_role;
commit;
