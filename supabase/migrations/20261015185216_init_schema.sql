-- Initial schema for the stablecoin payments app.
-- Tables are created in foreign-key order: users → groups → group_members → splits → requests → transactions.
--
-- Security model:
--   * RLS is enabled on every table.
--   * anon/authenticated may only SELECT (the browser reads with the anon key).
--   * There are NO insert/update/delete policies. All writes happen in Next.js API routes using the
--     service role key (which bypasses RLS) after verifying the caller's Privy access token.

-- users ---------------------------------------------------------------------
create table public.users (
  id             uuid primary key default gen_random_uuid(),
  privy_id       text unique not null,
  username       text unique,
  wallet_address text unique,          -- the user's Privy SMART WALLET address, lowercased
  created_at     timestamptz not null default now()
);

-- groups --------------------------------------------------------------------
create table public.groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_by uuid references public.users (id),
  created_at timestamptz not null default now()
);

-- group_members -------------------------------------------------------------
create table public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id  uuid not null references public.users (id),
  primary key (group_id, user_id)
);

-- splits --------------------------------------------------------------------
create table public.splits (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid references public.groups (id),
  created_by  uuid references public.users (id),
  description text,
  total       numeric,
  created_at  timestamptz not null default now()
);

-- requests ------------------------------------------------------------------
create table public.requests (
  id           uuid primary key default gen_random_uuid(),
  requester_id uuid references public.users (id),
  payer_id     uuid references public.users (id),
  amount       numeric not null check (amount > 0),
  note         text,
  status       text not null default 'pending' check (status in ('pending', 'paid', 'declined')),
  split_id     uuid null references public.splits (id),
  created_at   timestamptz not null default now()
);

-- transactions --------------------------------------------------------------
create table public.transactions (
  id         uuid primary key default gen_random_uuid(),
  from_user  uuid references public.users (id),
  to_user    uuid references public.users (id),
  amount     numeric not null check (amount > 0),
  note       text,
  tx_hash    text unique,
  status     text not null default 'pending' check (status in ('pending', 'confirmed', 'failed')),
  request_id uuid null references public.requests (id),
  created_at timestamptz not null default now()
);

-- Indexes for the common "my activity" lookups.
create index requests_requester_id_idx on public.requests (requester_id);
create index requests_payer_id_idx on public.requests (payer_id);
create index requests_split_id_idx on public.requests (split_id);
create index transactions_from_user_idx on public.transactions (from_user);
create index transactions_to_user_idx on public.transactions (to_user);
create index group_members_user_id_idx on public.group_members (user_id);

-- Row level security ---------------------------------------------------------
alter table public.users         enable row level security;
alter table public.groups        enable row level security;
alter table public.group_members enable row level security;
alter table public.splits        enable row level security;
alter table public.requests      enable row level security;
alter table public.transactions  enable row level security;

create policy "Public read" on public.users         for select to anon, authenticated using (true);
create policy "Public read" on public.groups        for select to anon, authenticated using (true);
create policy "Public read" on public.group_members for select to anon, authenticated using (true);
create policy "Public read" on public.splits        for select to anon, authenticated using (true);
create policy "Public read" on public.requests      for select to anon, authenticated using (true);
create policy "Public read" on public.transactions  for select to anon, authenticated using (true);

-- Explicit grants (don't rely on project-level default privileges).
grant usage on schema public to anon, authenticated, service_role;
grant select on
  public.users, public.groups, public.group_members, public.splits, public.requests, public.transactions
  to anon, authenticated;
grant all on
  public.users, public.groups, public.group_members, public.splits, public.requests, public.transactions
  to service_role;

-- Realtime ---------------------------------------------------------------------
alter publication supabase_realtime add table public.requests, public.transactions;
