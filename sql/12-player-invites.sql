-- Run once in the Supabase SQL editor, after files 1 to 11.
-- Any player can now make an invite link. Players see and turn off only their own links;
-- the commissioner sees and turns off all of them.

create or replace function nfl_create_invite(p_token text)
returns text language plpgsql security definer set search_path = public, extensions
as $$
declare
  me text := nfl_session_player(p_token);
  c  text := encode(gen_random_bytes(5), 'hex');
begin
  if me is null then raise exception 'Please log in again'; end if;
  insert into nfl_invites (code, created_by, expires_at, max_uses)
    values (c, me, now() + interval '7 days', 10);
  perform nfl_audit_add(me, 'created invite link', null);
  return c;
end $$;

create or replace function nfl_list_invites(p_token text)
returns table (code text, expires_at timestamptz, uses int, max_uses int)
language plpgsql security definer set search_path = public
as $$
declare
  me text := nfl_session_player(p_token);
begin
  if me is null then raise exception 'Please log in again'; end if;
  return query
    select i.code, i.expires_at, i.uses, i.max_uses
    from nfl_invites i
    where i.expires_at > now() and i.uses < i.max_uses
      and (i.created_by = me or nfl_is_admin(p_token))
    order by i.expires_at desc;
end $$;

create or replace function nfl_revoke_invite(p_token text, p_code text)
returns void language plpgsql security definer set search_path = public
as $$
declare
  me text := nfl_session_player(p_token);
begin
  if me is null then raise exception 'Please log in again'; end if;
  update nfl_invites set expires_at = now()
    where code = lower(trim(p_code)) and (created_by = me or nfl_is_admin(p_token));
  if not found then raise exception 'You can only turn off invite links you made'; end if;
  perform nfl_audit_add(me, 'revoked invite link', null);
end $$;
