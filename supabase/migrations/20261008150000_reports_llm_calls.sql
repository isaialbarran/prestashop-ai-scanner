-- Informes completos (fase 2) y cada llamada a un LLM, para los evals de coste, latencia y citas.
-- RLS activado y sin políticas: solo se accede con la clave secreta desde el servidor.
create table public.reports (
  id uuid primary key,
  scan_id uuid not null references public.scans (id) on delete cascade,
  domain text not null,
  created_at timestamptz not null,
  score smallint check (score between 0 and 100),
  cited_in smallint not null,
  answers smallint not null,
  cost_usd numeric(10, 5) not null,
  latency_ms integer not null,
  result jsonb not null
);

create index reports_domain_created_at_idx on public.reports (domain, created_at desc);
alter table public.reports enable row level security;

create table public.llm_calls (
  id uuid primary key,
  report_id uuid references public.reports (id) on delete cascade,
  domain text not null,
  purpose text not null check (purpose in ('queries', 'visibility', 'detection', 'extraction', 'report')),
  provider text not null,
  model text not null,
  input_hash text not null,
  started_at timestamptz not null,
  latency_ms integer not null,
  input_tokens integer not null,
  cached_input_tokens integer not null,
  output_tokens integer not null,
  reasoning_tokens integer not null,
  search_calls integer not null,
  cost_usd numeric(12, 6) not null,
  from_cache boolean not null,
  error text,
  response jsonb
);

create index llm_calls_report_idx on public.llm_calls (report_id);
create index llm_calls_purpose_idx on public.llm_calls (purpose, provider, model);
alter table public.llm_calls enable row level security;

comment on table public.llm_calls is 'Una fila por llamada a un LLM; response guarda la respuesta completa del proveedor.';
