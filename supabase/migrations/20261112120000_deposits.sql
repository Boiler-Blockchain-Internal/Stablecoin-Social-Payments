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

create index deposits_user_id_created_at_idx on public.deposits (user_id, created_at desc);

-- Only API routes (service role) read or write deposits: a burn hash links a user to their outside wallet,
-- so unlike the other tables there is no public read policy.
alter table public.deposits enable row level security;
grant all on public.deposits to service_role;
