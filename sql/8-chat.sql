-- Run once in the Supabase SQL editor, after files 1 to 7.
-- Pool group chat. Anyone logged in can post. You can delete any message; players can
-- delete their own. Messages are only reachable through the functions below.

create table if not exists nfl_chat (
  id         bigserial primary key,
  player     text not null references nfl_players(name) on delete cascade,
  body       text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists nfl_chat_created on nfl_chat (created_at desc);
alter table nfl_chat enable row level security;   -- no policies: only the functions below

-- The latest 100 messages, oldest first.
create or replace function nfl_chat_list(p_token text)
returns table (id bigint, player text, body text, created_at timestamptz, is_mine boolean, can_delete boolean)
language sql stable security definer set search_path = public
as $$
  select c.id, c.player, c.body, c.created_at,
         (c.player = nfl_session_player(p_token)),
         (c.player = nfl_session_player(p_token) or nfl_is_admin(p_token))
  from (select * from nfl_chat order by created_at desc limit 100) c
  where nfl_session_player(p_token) is not null
  order by c.created_at asc
$$;

-- Post a message. One message every two seconds per player, to stop floods.
create or replace function nfl_chat_post(p_token text, p_body text)
returns void language plpgsql security definer set search_path = public
as $$
declare
  me text := nfl_session_player(p_token);
  b  text := trim(coalesce(p_body, ''));
begin
  if me is null then raise exception 'Please log in again'; end if;
  if length(b) < 1 then raise exception 'Type a message first'; end if;
  if length(b) > 500 then raise exception 'Keep messages under 500 characters'; end if;
  if exists (select 1 from nfl_chat where player = me and created_at > now() - interval '2 seconds') then
    raise exception 'Slow down a little';
  end if;
  insert into nfl_chat (player, body) values (me, b);
end $$;

-- Delete your own message, or any message if you're the commissioner.
create or replace function nfl_chat_delete(p_token text, p_id bigint)
returns void language plpgsql security definer set search_path = public
as $$
declare
  me text := nfl_session_player(p_token);
begin
  if me is null then raise exception 'Please log in again'; end if;
  delete from nfl_chat
  where id = p_id and (player = me or nfl_is_admin(p_token));
  if not found then raise exception 'You can only delete your own messages'; end if;
end $$;
