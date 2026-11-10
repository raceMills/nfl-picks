-- Run once in the Supabase SQL editor, after files 1 to 4.
-- Adds payout and season settings, a paid-player count for the pot, and a news/injuries table.

-- ---------- Settings the app reads ----------
drop function if exists nfl_settings();
create or replace function nfl_settings()
returns table (venmo_handle text, entry_fee text, weekly_prize text, survivor_prize text,
               season_start_week int, test_season boolean, paid_count int)
language sql stable security definer set search_path = public
as $$
  select
    coalesce((select value from nfl_config where key = 'venmo_handle'), ''),
    coalesce((select value from nfl_config where key = 'entry_fee'), ''),
    coalesce((select value from nfl_config where key = 'weekly_prize'), '0'),
    coalesce((select value from nfl_config where key = 'survivor_prize'), '0'),
    coalesce((select value from nfl_config where key = 'season_start_week'), '1')::int,
    coalesce((select value from nfl_config where key = 'test_season'), 'false') = 'true',
    (select count(*)::int from nfl_players where paid)
$$;

-- ---------- Commissioner can now edit payouts too ----------
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
  if p_key not in ('venmo_handle', 'entry_fee', 'invite', 'weekly_prize', 'survivor_prize') then
    raise exception 'Unknown setting';
  end if;
  if p_key = 'venmo_handle' and length(v) < 2 then raise exception 'Enter a Venmo handle'; end if;
  if p_key in ('entry_fee', 'weekly_prize', 'survivor_prize') and v !~ '^[0-9]+(\.[0-9]{1,2})?$' then
    raise exception 'Enter a dollar amount';
  end if;
  if p_key = 'invite' and length(v) < 4 then raise exception 'Group password must be at least 4 characters'; end if;
  insert into nfl_config (key, value) values (p_key, v)
    on conflict (key) do update set value = excluded.value;
end $$;

-- Best-guess defaults (6 paid players at $100 = $600 pot):
--   11 weeks (8 to 18) x $20 = $220 to weekly winners, $380 to the survivor winner.
insert into nfl_config (key, value) values ('weekly_prize', '20')
  on conflict (key) do nothing;
insert into nfl_config (key, value) values ('survivor_prize', '380')
  on conflict (key) do nothing;
insert into nfl_config (key, value) values ('season_start_week', '8')
  on conflict (key) do nothing;
insert into nfl_config (key, value) values ('test_season', 'true')
  on conflict (key) do nothing;

-- ---------- Injuries and news ----------
create table if not exists nfl_news (
  id           text primary key,            -- the feed's own id or url
  kind         text not null default 'news' check (kind in ('news', 'injury')),
  team         text,                        -- team abbreviation, if any
  headline     text not null,
  summary      text,
  url          text,
  published_at timestamptz,
  updated_at   timestamptz not null default now()
);
create index if not exists nfl_news_published on nfl_news (published_at desc);

alter table nfl_news enable row level security;
drop policy if exists nfl_news_read on nfl_news;
create policy nfl_news_read on nfl_news for select using (true);
