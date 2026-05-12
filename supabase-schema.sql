-- À lancer dans Supabase > SQL Editor

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  full_name text,
  role text not null default 'user' check (role in ('user','admin')),
  created_at timestamptz default now()
);

create table if not exists public.weekly_notes (
  id text primary key,
  owner_id uuid references public.profiles(id) on delete cascade,
  user_email text,
  title text,
  date text,
  week int,
  year int,
  "missionStart" text,
  "missionEnd" text,
  debtors jsonb default '[]'::jsonb,
  profiles jsonb default '[]'::jsonb,
  placements jsonb default '[]'::jsonb,
  rdv jsonb default '[]'::jsonb,
  urgent jsonb default '[]'::jsonb,
  divers text,
  attachments jsonb default '[]'::jsonb,
  summary text,
  archived boolean default false,
  "modifiedBy" text,
  "modifiedAt" text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.profiles enable row level security;
alter table public.weekly_notes enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin" on public.profiles
for select using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
for insert with check (id = auth.uid());

drop policy if exists "profiles_update_own_or_admin" on public.profiles;
create policy "profiles_update_own_or_admin" on public.profiles
for update using (id = auth.uid() or public.is_admin())
with check (id = auth.uid() or public.is_admin());

drop policy if exists "notes_select_own_or_admin" on public.weekly_notes;
create policy "notes_select_own_or_admin" on public.weekly_notes
for select using (owner_id = auth.uid() or public.is_admin());

drop policy if exists "notes_insert_own_or_admin" on public.weekly_notes;
create policy "notes_insert_own_or_admin" on public.weekly_notes
for insert with check (owner_id = auth.uid() or public.is_admin());

drop policy if exists "notes_update_own_or_admin" on public.weekly_notes;
create policy "notes_update_own_or_admin" on public.weekly_notes
for update using (owner_id = auth.uid() or public.is_admin())
with check (owner_id = auth.uid() or public.is_admin());

drop policy if exists "notes_delete_own_or_admin" on public.weekly_notes;
create policy "notes_delete_own_or_admin" on public.weekly_notes
for delete using (owner_id = auth.uid() or public.is_admin());

insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', true)
on conflict (id) do nothing;

-- Colonnes supplémentaires pour la version publique complète
alter table public.weekly_notes add column if not exists "sessionDate" text;
alter table public.weekly_notes add column if not exists "reminderTime" text default '09:00';
alter table public.weekly_notes add column if not exists status text default 'planned';
