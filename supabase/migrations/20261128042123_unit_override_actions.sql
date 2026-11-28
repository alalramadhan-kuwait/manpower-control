-- Override actions from the app (owner, 28 Nov 2026: "allow me to click and take action for the override"). The Section
-- Head can add an override (also from a remark that names one), set its MOC, expiry and reason, and close it with a note.
-- Nothing is deleted: a closed override keeps who closed it, when and why; every change is in the audit log.
alter table public.unit_overrides
  add column updated_at timestamptz not null default now(),
  add column closed_at timestamptz,
  add column closed_by uuid,
  add column close_note text;
create trigger unit_overrides_audit after insert or update or delete on public.unit_overrides for each row execute function public.audit_row_change();

create or replace function public.unit_override_add(p_train text, p_item text, p_tags text, p_reason text, p_moc text, p_started date, p_expires date, p_source text)
returns uuid language plpgsql security definer set search_path = public as $$
declare nid uuid;
begin
  if not public.app_is_section_head() then raise exception 'Only the Section Head can change overrides.' using errcode = 'insufficient_privilege'; end if;
  if p_train not in ('TR-1', 'TR-2', 'Common') then raise exception 'Train must be TR-1, TR-2 or Common.'; end if;
  if length(btrim(coalesce(p_item, ''))) < 3 then raise exception 'Say what is overridden.'; end if;
  if p_expires is not null and p_started is not null and p_expires < p_started then raise exception 'Expiry is before the start.'; end if;
  insert into public.unit_overrides (train, item, tags, reason, moc, started_on, expires_on, source)
    values (p_train, btrim(p_item), nullif(btrim(p_tags), ''), nullif(btrim(p_reason), ''), nullif(btrim(p_moc), ''), coalesce(p_started, current_date), p_expires, coalesce(nullif(btrim(p_source), ''), 'Added in the app'))
    returning id into nid;
  return nid;
end $$;

create or replace function public.unit_override_update(p_id uuid, p_reason text, p_moc text, p_expires date)
returns void language plpgsql security definer set search_path = public as $$
declare o public.unit_overrides;
begin
  if not public.app_is_section_head() then raise exception 'Only the Section Head can change overrides.' using errcode = 'insufficient_privilege'; end if;
  select * into o from public.unit_overrides where id = p_id for update;
  if not found or o.status <> 'open' then raise exception 'No open override with that id.'; end if;
  if p_expires is not null and o.started_on is not null and p_expires < o.started_on then raise exception 'Expiry is before the start.'; end if;
  update public.unit_overrides set reason = nullif(btrim(p_reason), ''), moc = nullif(btrim(p_moc), ''), expires_on = p_expires, updated_at = now() where id = p_id;
end $$;

create or replace function public.unit_override_close(p_id uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare o public.unit_overrides;
begin
  if not public.app_is_section_head() then raise exception 'Only the Section Head can change overrides.' using errcode = 'insufficient_privilege'; end if;
  if length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Say how it was closed (e.g. module replaced, voting restored).'; end if;
  select * into o from public.unit_overrides where id = p_id for update;
  if not found or o.status <> 'open' then raise exception 'No open override with that id.'; end if;
  update public.unit_overrides set status = 'closed', closed_at = now(), closed_by = auth.uid(), close_note = btrim(p_note), updated_at = now() where id = p_id;
end $$;

revoke all on function public.unit_override_add(text, text, text, text, text, date, date, text) from public, anon;
revoke all on function public.unit_override_update(uuid, text, text, date) from public, anon;
revoke all on function public.unit_override_close(uuid, text) from public, anon;
grant execute on function public.unit_override_add(text, text, text, text, text, date, date, text) to authenticated;
grant execute on function public.unit_override_update(uuid, text, text, date) to authenticated;
grant execute on function public.unit_override_close(uuid, text) to authenticated;
