-- Run this once in the Supabase SQL editor (hotdawgs project), after schema.sql.
-- Lets the commissioner change the Venmo handle, entry fee and group password from the app.

create or replace function nfl_admin_set_config(p_token text, p_key text, p_value text)
returns void language plpgsql security definer set search_path = public
as $$
declare
  v text := trim(coalesce(p_value, ''));
begin
  if not coalesce((select p.is_admin from nfl_sessions s join nfl_players p on p.name = s.player
                   where s.token = p_token), false) then
    raise exception 'Commissioner only';
  end if;
  if p_key not in ('venmo_handle', 'entry_fee', 'invite') then
    raise exception 'Unknown setting';
  end if;
  if p_key = 'venmo_handle' and length(v) < 2 then raise exception 'Enter a Venmo handle'; end if;
  if p_key = 'entry_fee' and v !~ '^[0-9]+(\.[0-9]{1,2})?$' then raise exception 'Entry fee must be a number'; end if;
  if p_key = 'invite' and length(v) < 4 then raise exception 'Group password must be at least 4 characters'; end if;
  insert into nfl_config (key, value) values (p_key, v)
    on conflict (key) do update set value = excluded.value;
end $$;
