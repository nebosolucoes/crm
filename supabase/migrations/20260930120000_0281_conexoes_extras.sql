-- 0281 — Conexões extras por empresa (somam ao limite do plano).
--
-- Spec 21 §10. O mesmo texto está no bloco `conexões extras por empresa` do
-- apêndice do baseline.

-- ---- conexões extras por empresa: somam ao limite do plano (migration 0281) ----
--
-- Spec: docs/specs/21-spec-direct-e-messenger.md, §10. Decisão do dono (30/09):
-- o plano diz quantos WhatsApp, Instagram e Messenger a empresa pode conectar
-- (`max_whatsapp`, `max_instagram`, `max_messenger`, ao lado do `max_channels`
-- que já existia), e o admin da instalação VENDE conexões avulsas por empresa.
--
-- Por que uma tabela e não o override que já existe
-- (`organization_feature_overrides.limits`): o override SUBSTITUI o número do
-- plano. Um extra SOMA — "+2 Instagram" continua valendo +2 quando a empresa
-- troca de plano. Guardar o total no override deixaria o número da empresa
-- congelado na troca de plano, e é justamente o caso em que se quer que ele
-- mude.
--
-- Semântica (aplicada em `lib/entitlements/consumo.ts`): teto efetivo = teto do
-- plano/override + soma dos extras ativos. Chave SEM teto (sem limite) segue
-- sem limite — extra não inventa um teto que não existia.
--
-- Escrita só pelo service role (rota do admin da instalação, com auditoria).
-- Leitura para membros da organização: a tela de plano mostra "3 + 2 extras".
--
-- Idempotente: `create ... if not exists`, `drop policy if exists`.

create table if not exists public.organization_limit_extras (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  limit_key       text not null,
  quantidade      integer not null,
  reason          text not null,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  revoked_at      timestamptz,
  revoked_by      uuid,
  constraint organization_limit_extras_key_check
    check (limit_key in ('max_channels', 'max_whatsapp', 'max_instagram', 'max_messenger')),
  constraint organization_limit_extras_quantidade_check check (quantidade between 1 and 1000),
  constraint organization_limit_extras_reason_check check (length(btrim(reason)) between 1 and 500)
);

create index if not exists idx_organization_limit_extras_ativos
  on public.organization_limit_extras (organization_id, limit_key)
  where revoked_at is null;

comment on table public.organization_limit_extras is
  'Conexões extras vendidas a UMA organização: somam ao teto do plano (não substituem, como o override). Ativo enquanto revoked_at is null. Escrita só service_role (admin da instalação). Vocabulário de limit_key em lib/entitlements/limites.ts (CHAVES_COM_EXTRA). Spec 21 §10.';

alter table public.organization_limit_extras enable row level security;
revoke all on public.organization_limit_extras from public, anon, authenticated;
grant select on public.organization_limit_extras to authenticated;
grant select, insert, update, delete on public.organization_limit_extras to service_role;

drop policy if exists tenant_isolation_organization_limit_extras_select on public.organization_limit_extras;
create policy tenant_isolation_organization_limit_extras_select on public.organization_limit_extras
  for select to authenticated
  using (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin());

-- ---- travas do modo somente leitura do suporte na tabela nova ----
-- Mesma razão da 0278/0280: na CADEIA ninguém replanta as travas depois da 0274.
do $f$
begin
  if to_regprocedure('public.fn_aplicar_travas_de_suporte()') is not null then
    perform public.fn_aplicar_travas_de_suporte();
  end if;
end $f$;
