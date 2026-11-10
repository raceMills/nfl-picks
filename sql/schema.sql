-- Hotdawgs NFL Pool schema. Run once in the Supabase SQL editor for the hotdawgs project.
-- All tables are prefixed nfl_ so the golf pool tables are not touched.
-- Passwords and sessions are never readable with the public (anon) key: clients only
-- reach them through the security-definer functions below.

create extension if not exists pgcrypto;

-- ---------- Tables ----------
create table if not exists nfl_players (
  name       text primary key,
  pass_hash  text not null,
  venmo      text not null,
  paid       boolean not null default false,   -- commissioner ticks this after Venmo
  is_admin   boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists nfl_players_name_ci on nfl_players (lower(name));

create table if not exists nfl_sessions (
  token      text primary key,
  player     text not null references nfl_players(name) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists nfl_config (
  key   text primary key,
  value text not null
);

create table if not exists nfl_games (
  id          text primary key,              -- ESPN event id
  week        int  not null,
  start_at    timestamptz not null,
  home        text not null,                 -- team abbreviation
  away        text not null,
  spread_home numeric,                       -- e.g. -3.5 means home favored by 3.5
  home_score  int,
  away_score  int,
  status      text not null default 'scheduled',  -- scheduled | in_progress | final
  updated_at  timestamptz not null default now()
);
create index if not exists nfl_games_week on nfl_games (week);

create table if not exists nfl_picks (
  player     text not null references nfl_players(name) on delete cascade,
  game_id    text not null references nfl_games(id) on delete cascade,
  side       text not null check (side in ('home', 'away')),  -- which team you take against the spread
  created_at timestamptz not null default now(),
  primary key (player, game_id)
);

create table if not exists nfl_survivor (
  player text not null references nfl_players(name) on delete cascade,
  week   int  not null,
  team   text not null,
  primary key (player, week),
  unique (player, team)                      -- a team can only be used once per player
);

-- ---------- Row level security ----------
alter table nfl_players  enable row level security;   -- no policies: hidden from anon
alter table nfl_sessions enable row level security;
alter table nfl_config   enable row level security;
alter table nfl_games    enable row level security;
alter table nfl_picks    enable row level security;
alter table nfl_survivor enable row level security;

create policy nfl_games_read    on nfl_games    for select using (true);
create policy nfl_picks_read    on nfl_picks    for select using (true);
create policy nfl_survivor_read on nfl_survivor for select using (true);

-- ---------- Helpers ----------
create or replace function nfl_session_player(p_token text)
returns text language sql stable security definer set search_path = public
as $$ select player from nfl_sessions where token = p_token $$;

-- ---------- Sign up (invite) ----------
-- Anyone with the group password can join. Name, password and Venmo handle are all required.
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
  if p_invite is distinct from inv then raise exception 'Wrong group password'; end if;
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

-- ---------- Log in ----------
create or replace function nfl_login(p_name text, p_pass text)
returns text language plpgsql security definer set search_path = public, extensions
as $$
declare
  nm  text;
  tok text;
begin
  select name into nm from nfl_players
    where lower(name) = lower(trim(p_name)) and pass_hash = crypt(p_pass, pass_hash);
  if nm is null then raise exception 'Wrong name or password'; end if;
  tok := encode(gen_random_bytes(24), 'hex');
  insert into nfl_sessions (token, player) values (tok, nm);
  return tok;
end $$;

-- ---------- Who am I ----------
create or replace function nfl_me(p_token text)
returns table (name text, venmo text, paid boolean, is_admin boolean)
language sql stable security definer set search_path = public
as $$
  select p.name, p.venmo, p.paid, p.is_admin
  from nfl_sessions s join nfl_players p on p.name = s.player
  where s.token = p_token
$$;

-- ---------- Picks against the spread ----------
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
  if now() >= g.start_at then raise exception 'That game has already started'; end if;
  insert into nfl_picks (player, game_id, side) values (me, p_game_id, p_side)
    on conflict (player, game_id) do update set side = excluded.side;
end $$;

-- ---------- Survivor: one team per week, never reused ----------
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
  if not isp then raise exception 'Your $100 entry isn''t marked paid yet'; end if;
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

-- ---------- Admin (commissioner) ----------
create or replace function nfl_admin_players(p_token text)
returns table (name text, venmo text, paid boolean)
language plpgsql security definer set search_path = public
as $$
begin
  if not coalesce((select p.is_admin from nfl_sessions s join nfl_players p on p.name = s.player
                   where s.token = p_token), false) then
    raise exception 'Commissioner only';
  end if;
  return query select p.name, p.venmo, p.paid from nfl_players p order by p.name;
end $$;

create or replace function nfl_set_paid(p_token text, p_name text, p_paid boolean)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not coalesce((select p.is_admin from nfl_sessions s join nfl_players p on p.name = s.player
                   where s.token = p_token), false) then
    raise exception 'Commissioner only';
  end if;
  update nfl_players set paid = p_paid where name = p_name;
end $$;

-- ---------- Settings (public: the Venmo handle and fee are shown to everyone) ----------
create or replace function nfl_settings()
returns table (venmo_handle text, entry_fee text)
language sql stable security definer set search_path = public
as $$
  select
    coalesce((select value from nfl_config where key = 'venmo_handle'), ''),
    coalesce((select value from nfl_config where key = 'entry_fee'), '')
$$;

-- ---------- Settings ----------
-- Group password for joining. Change 'Hotdawgs' here if you want a different one.
insert into nfl_config (key, value) values ('invite', 'Hotdawgs')
  on conflict (key) do nothing;
insert into nfl_config (key, value) values ('venmo_handle', '@CHANGE_ME')
  on conflict (key) do nothing;
insert into nfl_config (key, value) values ('entry_fee', '100')
  on conflict (key) do nothing;

-- After a player signs up, make yourself the commissioner (replace the name):
--   update nfl_players set is_admin = true where lower(name) = 'your name';
