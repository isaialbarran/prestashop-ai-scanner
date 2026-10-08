-- Un ScanResult por escaneo de dominio (capa determinista).
-- RLS activado y sin políticas: solo se accede con la clave secreta desde el servidor.
create table public.scans (
  id uuid primary key,
  domain text not null,
  scanned_at timestamptz not null,
  scanner_version text not null,
  score smallint check (score between 0 and 100),
  band text check (band in ('ilegible', 'legible con errores', 'preparada')),
  coverage real not null check (coverage between 0 and 1),
  capped boolean not null default false,
  result jsonb not null,
  created_at timestamptz not null default now()
);

create index scans_domain_scanned_at_idx on public.scans (domain, scanned_at desc);

alter table public.scans enable row level security;

comment on table public.scans is 'ScanResult completo en result; columnas sueltas para filtrar y ordenar.';
