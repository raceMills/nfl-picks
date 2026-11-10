-- Run once in the Supabase SQL editor, after the first two files.
-- Other players' picks stay hidden until their game kicks off. Your own picks are always visible.

-- Stop the public table reads that exposed everyone's picks before kickoff.
drop policy if exists nfl_picks_read on nfl_picks;
drop policy if exists nfl_survivor_read on nfl_survivor;

-- Pick'em picks: yours always, everyone else's once their game has started.
create or replace function nfl_picks_visible(p_token text)
returns table (player text, game_id text, side text)
language sql stable security definer set search_path = public
as $$
  select pk.player, pk.game_id, pk.side
  from nfl_picks pk
  join nfl_games g on g.id = pk.game_id
  where pk.player = nfl_session_player(p_token)
     or now() >= g.start_at
$$;

-- Survivor picks: yours always, everyone else's once that team's game has started.
create or replace function nfl_survivor_visible(p_token text)
returns table (player text, week int, team text)
language sql stable security definer set search_path = public
as $$
  select s.player, s.week, s.team
  from nfl_survivor s
  where s.player = nfl_session_player(p_token)
     or exists (
       select 1 from nfl_games g
       where g.week = s.week and (g.home = s.team or g.away = s.team) and now() >= g.start_at
     )
$$;
