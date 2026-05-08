create table if not exists public.payment_events (
  id uuid primary key default gen_random_uuid(),
  name text,
  evento text not null,
  data timestamptz not null default now(),
  stripe_session_id text,
  customer_id text,
  email text,
  metadata jsonb
);

create index if not exists payment_events_data_idx on public.payment_events(data desc);
