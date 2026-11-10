-- Run once in the Supabase SQL editor, after files 1 to 8.
-- Adds avatars, favorite teams, and how each player's name shows (name, avatar, or both).

alter table nfl_players add column if not exists avatar text not null default '🏈';
alter table nfl_players add column if not exists favorite_team text;
alter table nfl_players add column if not exists display_mode text not null default 'both';

alter table nfl_players drop constraint if exists nfl_players_favorite_team_check;
alter table nfl_players add constraint nfl_players_favorite_team_check check (
  favorite_team is null or favorite_team in (
    'ARI','ATL','BAL','BUF','CAR','CHI','CIN','CLE','DAL','DEN','DET','GB','HOU','IND','JAX','KC',
    'LV','LAC','LAR','MIA','MIN','NE','NO','NYG','NYJ','PHI','PIT','SF','SEA','TB','TEN','WSH'));

alter table nfl_players drop constraint if exists nfl_players_display_mode_check;
alter table nfl_players add constraint nfl_players_display_mode_check check (display_mode in ('name', 'avatar', 'both'));

-- Public profile data: no password, venmo, or payment details.
create or replace function nfl_profiles()
returns table (name text, avatar text, favorite_team text, display_mode text)
language sql stable security definer set search_path = public
as $$
  select p.name, p.avatar, p.favorite_team, p.display_mode from nfl_players p
$$;

-- Save your own profile.
create or replace function nfl_set_profile(p_token text, p_avatar text, p_favorite_team text, p_display_mode text)
returns void language plpgsql security definer set search_path = public
as $$
declare
  me text := nfl_session_player(p_token);
  team text := nullif(trim(coalesce(p_favorite_team, '')), '');
begin
  if me is null then raise exception 'Please log in again'; end if;
  if p_display_mode not in ('name', 'avatar', 'both') then raise exception 'Pick how your name shows'; end if;
  if char_length(coalesce(p_avatar, '')) < 1 or char_length(p_avatar) > 8 then raise exception 'Pick an avatar'; end if;
  update nfl_players
    set avatar = p_avatar, favorite_team = team, display_mode = p_display_mode
    where name = me;
  if not found then raise exception 'Please log in again'; end if;
end $$;
