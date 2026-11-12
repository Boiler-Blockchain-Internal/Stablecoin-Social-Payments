-- Cross-chain USDC deposits (CCTP V2) into a user's Base Sepolia smart wallet.
-- The server records a deposit only after verifying its burn on the source chain, and marks it
-- completed only once the Base Sepolia MessageTransmitter has used its nonce (the mint happened).
create table public.deposits (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users (id),
  source        text not null check (source in ('ethereum', 'arc')),
  burn_tx_hash  text not null unique,
  amount        numeric not null check (amount > 0),
  status        text not null default 'pending' check (status in ('pending', 'completed')),
  mint_tx_hash  text,
  created_at    timestamptz not null default now()
);

create index deposits_user_id_idx on public.deposits (user_id);

-- Same model as the other tables: public reads, writes only through API routes (service role).
alter table public.deposits enable row level security;
create policy "Public read" on public.deposits for select to anon, authenticated using (true);
grant select on public.deposits to anon, authenticated;
grant all on public.deposits to service_role;
