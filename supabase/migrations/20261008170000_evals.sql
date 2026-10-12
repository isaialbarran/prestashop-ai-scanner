-- Fase 3: lote y repetición de cada informe (eval de estabilidad) y copia de las etiquetas manuales.
alter table public.reports add column run_tag text, add column run_index smallint;
create index reports_run_tag_idx on public.reports (run_tag, domain, run_index);

-- Etiquetas de Isai: copia de seguridad de evals/datasets/ (fuera de git porque el repo es público).
create table public.eval_labels (
  kind text not null check (kind in ('checks', 'extraction', 'detection', 'fidelity')),
  item_id text not null,
  label jsonb not null,
  labeled_at timestamptz not null default now(),
  primary key (kind, item_id)
);
alter table public.eval_labels enable row level security;
