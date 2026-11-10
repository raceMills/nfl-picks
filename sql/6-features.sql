-- Run once in the Supabase SQL editor, after files 1 to 5.
-- Adds: weather on games, the Monday night tiebreaker, a commissioner audit log,
-- and a pool announcement shown on the home page.

-- ---------- Weather ----------
alter table nfl_games add column if not exists weather text;

-- ---------- Helpers ----------
create or replace function nfl_is_admin(p_token text)
returns boolean language sql stable security definer set search_path = public
as $$
  select coalesce((select p.is_admin from nfl_players p where p.name = nfl_session_player(p_token)), false)
$$;

-- The week's last game by kickoff. The tiebreaker locks when it starts.
create or replace function nfl_last_game(p_week int)
returns nfl_games language sql stable security definer set search_path = public
as $$
  select * from nfl_games where week = p_week order by start_at desc limit 1
$$;

-- ---------- Audit log ----------
create table if not exists nfl_audit (
  id        bigserial primary key,
  logged_at timestamptz not null default now(),
  actor     text not null,
  action    text not null,
  detail    text
);
alter table nfl_audit enable row level security;

create or replace function nfl_audit_add(p_actor text, p_action text, p_detail text)
returns void language sql security definer set search_path = public
as $$
  insert into nfl_audit (actor, action, detail) values (p_actor, p_action, p_detail)
$$;

create or replace function nfl_admin_audit(p_token text)
returns table (logged_at timestamptz, actor text, action text, detail text)
language plpgsql security definer set search_path = public
as $$
begin
  if not nfl_is_admin(p_token) then raise exception 'Commissioner only'; end if;
  return query select a.logged_at, a.actor, a.action, a.detail
    from nfl_audit a order by a.logged_at desc limit 25;
end $$;

-- Paid changes are now logged.
create or replace function nfl_set_paid(p_token text, p_name text, p_paid boolean)
returns void language plpgsql security definer set search_path = public
as $$
declare
  me text := nfl_session_player(p_token);
begin
  if not nfl_is_admin(p_token) then raise exception 'Commissioner only'; end if;
  update nfl_players set paid = p_paid where name = p_name;
  perform nfl_audit_add(me, case when p_paid then 'marked paid' else 'marked unpaid' end, p_name);
end $$;

-- ---------- Announcement and settings ----------
insert into nfl_config (key, value) values ('announcement', '')
  on conflict (key) do nothing;

drop function if exists nfl_settings();
create or replace function nfl_settings()
returns table (venmo_handle text, entry_fee text, weekly_prize text, survivor_prize text,
               season_start_week int, test_season boolean, paid_count int, announcement text)
language sql stable security definer set search_path = public
as $$
  select
    coalesce((select value from nfl_config where key = 'venmo_handle'), ''),
    coalesce((select value from nfl_config where key = 'entry_fee'), ''),
    coalesce((select value from nfl_config where key = 'weekly_prize'), '0'),
    coalesce((select value from nfl_config where key = 'survivor_prize'), '0'),
    coalesce((select value from nfl_config where key = 'season_start_week'), '1')::int,
    coalesce((select value from nfl_config where key = 'test_season'), 'false') = 'true',
    (select count(*)::int from nfl_players where paid),
    coalesce((select value from nfl_config where key = 'announcement'), '')
$$;

create or replace function nfl_admin_set_config(p_token text, p_key text, p_value text)
returns void language plpgsql security definer set search_path = public
as $$
declare
  me text := nfl_session_player(p_token);
  v  text := trim(coalesce(p_value, ''));
begin
  if not nfl_is_admin(p_token) then raise exception 'Commissioner only'; end if;
  if p_key not in ('venmo_handle', 'entry_fee', 'invite', 'weekly_prize', 'survivor_prize', 'announcement') then
    raise exception 'Unknown setting';
  end if;
  if p_key = 'venmo_handle' and length(v) < 2 then raise exception 'Enter a Venmo handle'; end if;
  if p_key in ('entry_fee', 'weekly_prize', 'survivor_prize') and v !~ '^[0-9]+(\.[0-9]{1,2})?$' then
    raise exception 'Enter a dollar amount';
  end if;
  if p_key = 'invite' and length(v) < 4 then raise exception 'Group password must be at least 4 characters'; end if;
  if p_key = 'announcement' and length(v) > 280 then raise exception 'Keep the announcement under 280 characters'; end if;
  insert into nfl_config (key, value) values (p_key, v)
    on conflict (key) do update set value = excluded.value;
  -- Log the change, but never the group password itself
  perform nfl_audit_add(me, 'changed setting', p_key);
end $$;

-- ---------- Monday night tiebreaker ----------
create table if not exists nfl_tiebreaks (
  player text not null references nfl_players(name) on delete cascade,
  week   int  not null,
  points int  not null check (points between 0 and 150),
  primary key (player, week)
);
alter table nfl_tiebreaks enable row level security;

create or replace function nfl_set_tiebreak(p_token text, p_week int, p_points int)
returns void language plpgsql security definer set search_path = public
as $$
declare
  me  text := nfl_session_player(p_token);
  g   nfl_games;
  isp boolean;
begin
  if me is null then raise exception 'Please log in again'; end if;
  select paid into isp from nfl_players where name = me;
  if not isp then raise exception 'Your entry fee isn''t marked paid yet'; end if;
  if p_points is null or p_points < 0 or p_points > 150 then raise exception 'Enter a total between 0 and 150'; end if;
  select * into g from nfl_last_game(p_week);
  if g.id is null then raise exception 'No games posted for that week'; end if;
  if now() >= g.start_at then raise exception 'The last game has already kicked off'; end if;
  insert into nfl_tiebreaks (player, week, points) values (me, p_week, p_points)
    on conflict (player, week) do update set points = excluded.points;
end $$;

-- Your own guess always; everyone else's once the week's last game kicks off.
create or replace function nfl_tiebreak_visible(p_token text)
returns table (player text, week int, points int)
language sql stable security definer set search_path = public
as $$
  select t.player, t.week, t.points
  from nfl_tiebreaks t
  where t.player = nfl_session_player(p_token)
     or exists (select 1 from nfl_last_game(t.week) g where now() >= g.start_at)
$$;
