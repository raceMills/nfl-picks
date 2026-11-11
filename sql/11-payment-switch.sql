-- Run once in the Supabase SQL editor, after files 1 to 10.
-- Adds a switch for the payment check. It's off now, so anyone can pick during testing.
-- To turn payments back on later, run:
--   update nfl_config set value = 'true' where key = 'require_payment';

insert into nfl_config (key, value) values ('require_payment', 'false')
  on conflict (key) do nothing;

create or replace function nfl_payment_required()
returns boolean language sql stable security definer set search_path = public
as $$
  select coalesce((select value from nfl_config where key = 'require_payment'), 'false') = 'true'
$$;

-- Settings the app reads now include the switch.
drop function if exists nfl_settings();
create or replace function nfl_settings()
returns table (venmo_handle text, entry_fee text, weekly_prize text, survivor_prize text,
               season_start_week int, test_season boolean, paid_count int, announcement text,
               require_payment boolean)
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
    coalesce((select value from nfl_config where key = 'announcement'), ''),
    nfl_payment_required()
$$;

-- Pick'em picks: the paid check only applies when the switch is on.
create or replace function nfl_pick(p_token text, p_game_id text, p_side text)
returns void language plpgsql security definer set search_path = public
as $$
declare
  me   text := nfl_session_player(p_token);
  g    nfl_games;
  isp  boolean;
begin
  if me is null then raise exception 'Please log in again'; end if;
  select paid into isp from nfl_players where name = me;
  if nfl_payment_required() and not isp then raise exception 'Your $100 entry isn''t marked paid yet'; end if;
  if p_side not in ('home', 'away') then raise exception 'Bad pick'; end if;
  select * into g from nfl_games where id = p_game_id;
  if g.id is null then raise exception 'Unknown game'; end if;
  if not g.line_locked then raise exception 'The line for this game isn''t locked yet'; end if;
  if now() >= g.start_at then raise exception 'That game has already started'; end if;
  insert into nfl_picks (player, game_id, side) values (me, p_game_id, p_side)
    on conflict (player, game_id) do update set side = excluded.side;
end $$;

-- Survivor picks: the paid check only applies when the switch is on.
create or replace function nfl_survivor_pick(p_token text, p_week int, p_team text)
returns void language plpgsql security definer set search_path = public
as $$
declare
  me  text := nfl_session_player(p_token);
  g   nfl_games;
  isp boolean;
begin
  if me is null then raise exception 'Please log in again'; end if;
  select paid into isp from nfl_players where name = me;
  if nfl_payment_required() and not isp then raise exception 'Your $100 entry isn''t marked paid yet'; end if;
  if exists (select 1 from nfl_survivor where player = me and team = p_team
             and week <> p_week) then
    raise exception '% is already used. Pick a different team.', p_team;
  end if;
  select * into g from nfl_games
    where week = p_week and (home = p_team or away = p_team)
    order by start_at limit 1;
  if g.id is null then raise exception '% isn''t playing in week %', p_team, p_week; end if;
  if now() >= g.start_at then raise exception 'That team''s game has already started'; end if;
  insert into nfl_survivor (player, week, team) values (me, p_week, p_team)
    on conflict (player, week) do update set team = excluded.team;
end $$;

-- Monday tiebreaker: the paid check only applies when the switch is on.
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
  if nfl_payment_required() and not isp then raise exception 'Your entry fee isn''t marked paid yet'; end if;
  if p_points is null or p_points < 0 or p_points > 150 then raise exception 'Enter a total between 0 and 150'; end if;
  select * into g from nfl_last_game(p_week);
  if g.id is null then raise exception 'No games posted for that week'; end if;
  if now() >= g.start_at then raise exception 'The last game has already kicked off'; end if;
  insert into nfl_tiebreaks (player, week, points) values (me, p_week, p_points)
    on conflict (player, week) do update set points = excluded.points;
end $$;
