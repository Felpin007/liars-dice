-- Liar's Dice Arena persistence schema for Supabase.
-- Run this in Supabase SQL Editor after creating the project.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  display_name text not null default '',
  avatar_url text not null default '',
  bio text not null default '',
  rating integer not null default 1000,
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

grant usage on schema public to anon, authenticated, service_role;
grant select on public.profiles, public.matches, public.match_players, public.match_actions to anon, authenticated;
grant select, insert, update, delete on public.profiles, public.matches, public.match_players, public.match_actions to service_role;
grant usage, select on all sequences in schema public to service_role;

alter table public.profiles enable row level security;
alter table public.matches enable row level security;
alter table public.match_players enable row level security;
alter table public.match_actions enable row level security;

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
