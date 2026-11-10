-- Run once in the Supabase SQL editor, after files 1 to 6.
-- Lines lock at noon Central on Tuesday of each game's week. Picks open then, and the
-- locked line is the one that scores. A game with no line at lock stays closed until one
-- is posted; then that line locks and picks open.

alter table nfl_games add column if not exists picks_open_at timestamptz;   -- Tuesday noon CT of the week
alter table nfl_games add column if not exists line_locked boolean not null default false;
alter table nfl_games add column if not exists locked_spread_home numeric;   -- the line that scores

-- Picks need a locked line, in addition to the existing checks.
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
  if not isp then raise exception 'Your $100 entry isn''t marked paid yet'; end if;
  if p_side not in ('home', 'away') then raise exception 'Bad pick'; end if;
  select * into g from nfl_games where id = p_game_id;
  if g.id is null then raise exception 'Unknown game'; end if;
  if not g.line_locked then raise exception 'The line for this game isn''t locked yet'; end if;
  if now() >= g.start_at then raise exception 'That game has already started'; end if;
  insert into nfl_picks (player, game_id, side) values (me, p_game_id, p_side)
    on conflict (player, game_id) do update set side = excluded.side;
end $$;
