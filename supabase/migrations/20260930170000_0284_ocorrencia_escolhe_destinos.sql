-- 0284 — Cada data de uma publicação escolhe para quais destinos vai
--
-- Na 0283 toda ocorrência saía em TODOS os destinos da publicação. O uso real
-- pede o contrário com frequência: "o Feed do Instagram e o Facebook às 19:30;
-- os Stories só às 12:00 de amanhã; o WhatsApp nos dois". A tabela abaixo é o
-- subconjunto de destinos de UMA ocorrência. Sem linha nenhuma para a
-- ocorrência = todos os destinos (é o que a recorrência gera e o que o legado
-- copiado da 0283 tem), então nada muda para quem já agendou.
--
-- Join table e não `uuid[]` na ocorrência: FK composta (org, target) garante que
-- o destino é desta organização e cascateia quando o destino some; o worker
-- (`lib/publicacoes/worker/expandir.ts`) faz um `in (...)` simples.

create table if not exists public.publication_occurrence_targets (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  occurrence_id uuid not null references public.publication_occurrences(id) on delete cascade,
  target_id uuid not null references public.publication_targets(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint publication_occurrence_targets_pkey primary key (occurrence_id, target_id),
  constraint publication_occurrence_targets_occurrence_org_fkey foreign key (organization_id, occurrence_id)
    references public.publication_occurrences(organization_id, id) on delete cascade,
  constraint publication_occurrence_targets_target_org_fkey foreign key (organization_id, target_id)
    references public.publication_targets(organization_id, id) on delete cascade
);

create index if not exists publication_occurrence_targets_target_idx
  on public.publication_occurrence_targets (organization_id, target_id);

alter table public.publication_occurrence_targets enable row level security;

drop policy if exists tenant_isolation_publication_occurrence_targets_select on public.publication_occurrence_targets;
create policy tenant_isolation_publication_occurrence_targets_select on public.publication_occurrence_targets
  for select using (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin());

drop policy if exists tenant_isolation_publication_occurrence_targets_all on public.publication_occurrence_targets;
create policy tenant_isolation_publication_occurrence_targets_all on public.publication_occurrence_targets
  for all using (
    public.fn_is_platform_admin()
    or (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'manager'))
  )
  with check (
    public.fn_is_platform_admin()
    or (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'manager'))
  );

revoke all on public.publication_occurrence_targets from public, anon;
grant select, insert, update, delete on public.publication_occurrence_targets to authenticated;
grant all on public.publication_occurrence_targets to service_role;

comment on table public.publication_occurrence_targets is
  'Subconjunto de destinos de UMA ocorrência (data/hora) de Publicações. Sem linhas para a ocorrência = todos os destinos da publicação.';

do $f$ begin perform public.fn_aplicar_travas_de_suporte(); end $f$;

notify pgrst, 'reload schema';
