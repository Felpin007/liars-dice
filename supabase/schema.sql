-- Liar's Dice Arena persistence schema for Supabase.
-- Run this in Supabase SQL Editor after creating the project.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  display_name text not null default '',
  avatar_url text not null default '',
  bio text not null default '',
  rating integer not null default 1500,
  rating_deviation numeric not null default 350,
  rating_volatility numeric not null default 0.06,
  rating_updated_at timestamptz,
  xp integer not null default 0,
  level integer not null default 1,
  games_played integer not null default 0,
  wins integer not null default 0,
  losses integer not null default 0,
  current_streak integer not null default 0,
  best_streak integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_len check (char_length(username) between 3 and 32),
  constraint profiles_rating_floor check (rating >= 100)
);

alter table public.profiles
  add column if not exists rating_deviation numeric not null default 350,
  add column if not exists rating_volatility numeric not null default 0.06,
  add column if not exists rating_updated_at timestamptz,
  add column if not exists xp integer not null default 0,
  add column if not exists level integer not null default 1;

alter table public.profiles alter column rating set default 1500;

create table if not exists public.matches (
  id text primary key,
  label text not null,
  mode_key text not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  winner_seat integer,
  winner_profile_id uuid references public.profiles(id) on delete set null,
  player_count integer not null,
  bot_count integer not null default 0,
  round_count integer not null default 0,
  config jsonb not null default '{}'::jsonb,
  final_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.match_players (
  id bigserial primary key,
  match_id text not null references public.matches(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  player_name text not null,
  seat integer not null,
  is_bot boolean not null default false,
  result text not null check (result in ('win', 'loss', 'draw', 'bot')),
  rating_before integer,
  rating_after integer,
  dice_left integer not null default 0,
  created_at timestamptz not null default now(),
  unique (match_id, seat)
);

create table if not exists public.match_actions (
  id bigserial primary key,
  match_id text not null references public.matches(id) on delete cascade,
  round_number integer not null,
  seat integer not null,
  action_type text not null,
  quantity integer,
  face integer,
  time_left_ms integer,
  created_at timestamptz not null default now()
);

create table if not exists public.sessions (
  id text primary key,
  client_id text not null,
  csrf_token text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists public.presence (
  client_id text primary key,
  username text not null,
  display_name text not null default '',
  avatar_url text not null default '',
  supabase_user_id uuid references public.profiles(id) on delete set null,
  current_room_code text,
  queue_entry_id text,
  active_match_id text,
  last_seen_at timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb
);

create table if not exists public.rooms (
  code text primary key,
  visibility text not null default 'public',
  status text not null default 'waiting',
  data jsonb not null,
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists public.queue_entries (
  id text primary key,
  client_id text not null,
  mode_key text not null,
  data jsonb not null,
  joined_at timestamptz not null default now()
);

create table if not exists public.active_matches (
  id text primary key,
  phase text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  persisted_at timestamptz
);

create table if not exists public.reports (
  id bigserial primary key,
  reporter_client_id text not null,
  reporter_profile_id uuid references public.profiles(id) on delete set null,
  target_username text not null default '',
  target_client_id text,
  match_id text,
  reason text not null,
  details text not null default '',
  status text not null default 'open' check (status in ('open', 'reviewed', 'dismissed', 'actioned')),
  created_at timestamptz not null default now()
);

create table if not exists public.friend_requests (
  id text primary key default ('fr_' || encode(gen_random_bytes(12), 'base64')),
  pair_key text not null,
  requester_profile_id uuid not null references public.profiles(id) on delete cascade,
  target_profile_id uuid not null references public.profiles(id) on delete cascade,
  requester_username text not null,
  target_username text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  cooldown_until timestamptz,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists friend_requests_pair_status_idx
on public.friend_requests (pair_key, status, created_at desc);

create table if not exists public.friendships (
  pair_key text primary key,
  user_a_profile_id uuid not null references public.profiles(id) on delete cascade,
  user_b_profile_id uuid not null references public.profiles(id) on delete cascade,
  user_a_username text not null,
  user_b_username text not null,
  created_at timestamptz not null default now(),
  constraint friendships_ordered_pair check (user_a_profile_id < user_b_profile_id)
);

create table if not exists public.notifications (
  id text primary key default ('n_' || encode(gen_random_bytes(12), 'base64')),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null default '',
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_profile_created_idx
on public.notifications (profile_id, created_at desc);

grant usage on schema public to anon, authenticated, service_role;
grant select on public.profiles, public.matches, public.match_players, public.match_actions to anon, authenticated;
grant select, insert, update, delete on public.profiles, public.matches, public.match_players, public.match_actions,
  public.sessions, public.presence, public.rooms, public.queue_entries, public.active_matches, public.reports,
  public.friend_requests, public.friendships, public.notifications to service_role;
grant usage, select on all sequences in schema public to service_role;

alter table public.profiles enable row level security;
alter table public.matches enable row level security;
alter table public.match_players enable row level security;
alter table public.match_actions enable row level security;
alter table public.sessions enable row level security;
alter table public.presence enable row level security;
alter table public.rooms enable row level security;
alter table public.queue_entries enable row level security;
alter table public.active_matches enable row level security;
alter table public.reports enable row level security;
alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;
alter table public.notifications enable row level security;

drop policy if exists "profiles are public readable" on public.profiles;
create policy "profiles are public readable"
on public.profiles for select
using (true);

drop policy if exists "users can update own profile" on public.profiles;
create policy "users can update own profile"
on public.profiles for update
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "matches are public readable" on public.matches;
create policy "matches are public readable"
on public.matches for select
using (true);

drop policy if exists "match players are public readable" on public.match_players;
create policy "match players are public readable"
on public.match_players for select
using (true);

drop policy if exists "match actions are public readable" on public.match_actions;
create policy "match actions are public readable"
on public.match_actions for select
using (true);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatar images are public readable" on storage.objects;
create policy "avatar images are public readable"
on storage.objects for select
using (bucket_id = 'avatars');

drop policy if exists "users can upload own avatar" on storage.objects;
create policy "users can upload own avatar"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "users can update own avatar" on storage.objects;
create policy "users can update own avatar"
on storage.objects for update
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);
