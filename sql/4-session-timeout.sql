-- Run once in the Supabase SQL editor, after the first three files.
-- Logins last one hour from when you logged in. After that the app asks you to log in again.

create or replace function nfl_session_player(p_token text)
returns text language sql stable security definer set search_path = public
as $$
  select player from nfl_sessions
  where token = p_token and created_at > now() - interval '1 hour'
$$;

create or replace function nfl_me(p_token text)
returns table (name text, venmo text, paid boolean, is_admin boolean)
language sql stable security definer set search_path = public
as $$
  select p.name, p.venmo, p.paid, p.is_admin
  from nfl_sessions s join nfl_players p on p.name = s.player
  where s.token = p_token and s.created_at > now() - interval '1 hour'
$$;

-- Tidy up expired sessions each time someone logs in.
create or replace function nfl_login(p_name text, p_pass text)
returns text language plpgsql security definer set search_path = public, extensions
as $$
declare
  nm  text;
  tok text;
begin
  delete from nfl_sessions where created_at < now() - interval '1 hour';
  select name into nm from nfl_players
    where lower(name) = lower(trim(p_name)) and pass_hash = crypt(p_pass, pass_hash);
  if nm is null then raise exception 'Wrong name or password'; end if;
  tok := encode(gen_random_bytes(24), 'hex');
  insert into nfl_sessions (token, player) values (tok, nm);
  return tok;
end $$;
