-- The raw per-sheet P&ID readings behind the lineup (35 Smart P&ID sheets: equipment, streams, off-page connectors,
-- notes, open questions), kept to check details or quote a sheet. The lineup guide, the reading guide, the sheet index and
-- the drawing template (charge path) go in lu_meta. lu_load takes them too.
create table if not exists public.lu_sheets (
  sheet text primary key, braun text, title text, train text, data jsonb not null, loaded_at timestamptz not null default now());
alter table public.lu_sheets enable row level security;
create policy lu_sheets_read on public.lu_sheets for select using (public.app_current_role() is not null);

create or replace function public.lu_load(p_token text, p_kind text, p_rows jsonb) returns integer language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_token is null or p_token is distinct from (select value->>'token' from public.lu_meta where key = 'load_token') then raise exception 'Not allowed.'; end if;
  if p_kind = 'equipment' then
    insert into public.lu_equipment (tag, plant_tag, name, service, type, subtype, section, train, primary_sheet, sheets, conf, status, data, note, pid_notes)
    select r->>'tag', r->>'plant_tag', r->>'name', r->>'service', r->>'type', r->>'subtype', r->>'section', r->>'train', r->>'primarySheet',
           coalesce(array(select jsonb_array_elements_text(r->'sheets')), '{}'), r->>'conf', r->>'status', r->>'data', r->>'note', r->>'pidNotes'
      from jsonb_array_elements(p_rows) r
    on conflict (tag) do update set plant_tag = excluded.plant_tag, name = excluded.name, service = excluded.service, type = excluded.type, subtype = excluded.subtype,
      section = excluded.section, train = excluded.train, primary_sheet = excluded.primary_sheet, sheets = excluded.sheets, conf = excluded.conf, status = excluded.status,
      data = excluded.data, note = excluded.note, pid_notes = excluded.pid_notes, loaded_at = now();
  elsif p_kind = 'streams' then
    insert into public.lu_streams (id, frm, to_tag, fport, tport, fluid, line, line_nos, size, conf, src, note, via, sheets, valves)
    select r->>'id', r->>'frm', r->>'to', r->>'fport', r->>'tport', r->>'fluid', r->>'line', coalesce(array(select jsonb_array_elements_text(r->'line_nos')), '{}'),
           r->>'size', r->>'conf', r->>'src', r->>'note', r->>'via', coalesce(array(select jsonb_array_elements_text(r->'sheets')), '{}'), coalesce(r->'valves', '[]')
      from jsonb_array_elements(p_rows) r
    on conflict (id) do update set frm = excluded.frm, to_tag = excluded.to_tag, fport = excluded.fport, tport = excluded.tport, fluid = excluded.fluid, line = excluded.line,
      line_nos = excluded.line_nos, size = excluded.size, conf = excluded.conf, src = excluded.src, note = excluded.note, via = excluded.via, sheets = excluded.sheets,
      valves = excluded.valves, loaded_at = now();
  elsif p_kind = 'sheets' then
    insert into public.lu_sheets (sheet, braun, title, train, data)
    select r->>'sheet', r->>'braun', r->>'title', r->>'train', r from jsonb_array_elements(p_rows) r
    on conflict (sheet) do update set braun = excluded.braun, title = excluded.title, train = excluded.train, data = excluded.data, loaded_at = now();
  elsif p_kind = 'meta' then
    insert into public.lu_meta (key, value) select k, v from jsonb_each(p_rows) e(k, v)
    on conflict (key) do update set value = excluded.value, updated_at = now();
  else raise exception 'Unknown kind %', p_kind;
  end if;
  get diagnostics n = row_count;
  return n;
end $$;
-- closed after the load (35 sheets, guide, reading guide, index, drawing template on 20 Oct 2026)
revoke execute on function public.lu_load(text, text, jsonb) from anon, authenticated, public;
