create table if not exists public.app_logs (
  id uuid primary key default gen_random_uuid(),
  event text not null,
  data jsonb,
  ts timestamptz not null default now()
);

create index if not exists app_logs_ts_idx on public.app_logs(ts desc);
