-- Proof of Duty: run this once in Supabase → SQL Editor → New query → Run.
-- The game server keeps accounts, profiles, adverts and bookings in this table.
-- Advert images go in the "pod-ads" storage bucket, which the server creates by itself.
create table if not exists public.pod_store (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- Only the server (with the secret key) may read or write it.
alter table public.pod_store enable row level security;
