-- Run once in the Supabase SQL editor, after files 1 to 9.
-- Invite links: the commissioner makes one from the app. It lasts 7 days and works for up to
-- 10 sign-ups. The group password keeps working too.

create table if not exists nfl_invites (
  code       text primary key,
  created_by text not null,
  expires_at timestamptz not null,
  uses       int not null default 0,
  max_uses   int not null default 10
);
alter table nfl_invites enable row level security;   -- no policies: only the functions below

-- Sign-up accepts the group password or a live invite code.
create or replace function nfl_signup(p_name text, p_invite text, p_pass text, p_venmo text)
returns text language plpgsql security definer set search_path = public, extensions
as $$
declare
  inv text;
  nm  text := trim(coalesce(p_name, ''));
  vm  text := trim(coalesce(p_venmo, ''));
  tok text;
begin
  select value into inv from nfl_config where key = 'invite';
  if p_invite is distinct from inv then
    update nfl_invites set uses = uses + 1
      where code = lower(trim(coalesce(p_invite, '')))
        and expires_at > now() and uses < max_uses;
    if not found then raise exception 'Wrong group password, or that invite link has expired'; end if;
  end if;
  if length(nm) < 2 then raise exception 'Enter a name (at least 2 letters)'; end if;
  if length(coalesce(p_pass, '')) < 6 then raise exception 'Password must be at least 6 characters'; end if;
  if length(vm) < 2 then raise exception 'Add your Venmo handle to finish setup'; end if;
  if exists (select 1 from nfl_players where lower(name) = lower(nm)) then
    raise exception 'That name is taken';
  end if;
  insert into nfl_players (name, pass_hash, venmo)
    values (nm, crypt(p_pass, gen_salt('bf')), vm);
  tok := encode(gen_random_bytes(24), 'hex');
  insert into nfl_sessions (token, player) values (tok, nm);
  return tok;
end $$;

create or replace function nfl_create_invite(p_token text)
returns text language plpgsql security definer set search_path = public, extensions
as $$
declare
  me text := nfl_session_player(p_token);
  c  text := encode(gen_random_bytes(5), 'hex');
begin
  if not nfl_is_admin(p_token) then raise exception 'Commissioner only'; end if;
  insert into nfl_invites (code, created_by, expires_at, max_uses)
    values (c, me, now() + interval '7 days', 10);
  perform nfl_audit_add(me, 'created invite link', null);
  return c;
end $$;

create or replace function nfl_list_invites(p_token text)
returns table (code text, expires_at timestamptz, uses int, max_uses int)
language plpgsql security definer set search_path = public
as $$
begin
  if not nfl_is_admin(p_token) then raise exception 'Commissioner only'; end if;
  return query
    select i.code, i.expires_at, i.uses, i.max_uses
    from nfl_invites i
    where i.expires_at > now() and i.uses < i.max_uses
    order by i.expires_at desc;
end $$;

create or replace function nfl_revoke_invite(p_token text, p_code text)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not nfl_is_admin(p_token) then raise exception 'Commissioner only'; end if;
  update nfl_invites set expires_at = now() where code = lower(trim(p_code));
  perform nfl_audit_add(nfl_session_player(p_token), 'revoked invite link', null);
end $$;
