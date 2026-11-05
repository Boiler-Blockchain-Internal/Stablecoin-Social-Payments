-- A send intent is created before broadcasting. Retrying with the same client reference
-- returns the original intent, so application retries cannot create a second payment row.
alter table public.transactions
  add column client_reference uuid null;

create unique index transactions_client_reference_key
  on public.transactions (client_reference)
  where client_reference is not null;

-- A browser can disappear after the wallet broadcasts but before it saves the hash.
-- Keep a sender from creating a second active send intent until the first one is
-- confirmed, failed, or safely cancelled. Existing request transactions have a null
-- client_reference and do not participate in this lock.
create unique index transactions_one_open_send_per_sender_key
  on public.transactions (from_user)
  where client_reference is not null and status = 'pending';

-- A request is settled by at most one live payment, so a retry can never pay it twice.
create unique index transactions_one_payment_per_request_key
  on public.transactions (request_id)
  where request_id is not null and status <> 'failed';
