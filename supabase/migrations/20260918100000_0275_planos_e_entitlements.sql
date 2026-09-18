-- 0275 — Planos comerciais e entitlements por organização.
--
-- O que uma organização PODE USAR passa a ser decidido num lugar só, no banco,
-- e lido pela API, pelas páginas, pelos crons (Supabase client) e pelo worker
-- do agent-engine (pool `pg`) — os dois caminhos de banco que este produto tem.
--
-- ─── Três palavras, três lugares ─────────────────────────────────────────────
--
--   plano        `platform_plans` — DADO: nasce pela tela do admin, sem deploy.
--   recurso      vocabulário de CÓDIGO (`lib/entitlements/recursos.ts`); o banco
--                só o espelha em CHECK (`platform_plan_features.feature`,
--                `organization_feature_overrides.feature`). Foi avaliado um
--                catálogo `platform_features` com FK e recusado: um recurso sem
--                código que o gateie é um checkbox que não faz nada, e a tabela
--                trocaria o CHECK por uma migration de seed sem poupar nenhum
--                outro passo (o porquê inteiro está no cabeçalho de recursos.ts).
--   entitlement  `fn_org_entitlements(org)` — a RESPOSTA, já resolvida:
--                plano atribuído (ou o padrão) ∪ overrides `enable` ativos
--                − overrides `disable` ativos ∪ {channels}.
--
-- ─── `channels` não é dado, é lei ────────────────────────────────────────────
--
-- Canais é por onde o cliente conecta o WhatsApp; um erro de configuração não
-- pode desligá-lo. Ele NÃO é linha em `platform_plan_features` (o CHECK nem o
-- aceita), `fn_org_entitlements` o inclui incondicionalmente, `fn_org_has_feature`
-- devolve `true` sem consultar, e o CHECK `ofo_canais_nunca_desligam` recusa um
-- override que o desligue. `tests/invariants/entitlements-canais-sempre.test.ts`
-- tenta derrubar cada camada.
--
-- ─── `organizations.plan_id` é a fonte da atribuição — e só a função a escreve ─
--
-- Existia `organizations.settings.plan` ('standard'|'pro'|'enterprise'), gravado
-- por `fn_create_tenant_with_owner` e lido por NINGUÉM — e morando no mesmo jsonb
-- que o admin do tenant reescreve por `updateTenant` com o admin client. Um plano
-- ali seria auto-upgrade. A chave fica (comentário a declara morta); a fonte é a
-- coluna. E como `organizations` é escrita por muitos caminhos de service role com
-- a linha inteira, o trigger `trg_organizations_plano_so_pela_funcao` recusa
-- qualquer UPDATE de `plan_id` que não venha de `fn_definir_plano_da_organizacao`
-- (marcado por `set_config('deskcomm.plano_via_funcao', 'on', true)`, local à
-- transação). É a mesma classe de proteção da 0262 sobre as colunas de cliente.
--
-- ─── Quem escreve, e como o banco sabe ───────────────────────────────────────
--
-- As três funções de escrita seguem `fn_create_tenant_with_owner` (0219/0231):
-- recebem `p_actor`, exigem que ele seja platform admin `scope = 'full'` não
-- revogado, e têm EXECUTE só para `service_role` — o tenant não tem caminho até
-- elas. Quem as chama é a rota de `/api/v1/admin/*` depois de `requirePlatformAdmin()`
-- (que já prova a MFA quando `platform_admins.mfa_required`).
--
-- ─── Clientes existentes: efeito no deploy = zero ────────────────────────────
--
-- Semeia o plano `legado` (todos os recursos, sem limites) como padrão — só se
-- ainda não houver um padrão — e faz o backfill de toda organização com
-- `plan_id` nulo. O trigger `BEFORE INSERT` põe o padrão em toda organização
-- nova, por qualquer dos quatro caminhos de criação (signup, bootstrap-owner,
-- fn_create_tenant_with_owner, recuperação). Sem plano e sem padrão — estado só
-- alcançável apagando o padrão à mão — a resposta é FECHADA (só channels) e
-- OBSERVÁVEL (`origem = 'nenhum'` no jsonb; a tela do admin pinta de vermelho).
--
-- ─── Expiração é passiva; `disable` vence; plano inativo não derruba ninguém ──
--
-- Um override conta enquanto `revoked_at is null and starts_at <= now() and
-- (ends_at is null or ends_at > now())`. Não há cron para "voltar ao plano": o
-- tempo passa e a condição deixa de valer. `disable` ativo sobrepõe `enable`
-- ativo. `is_active = false` só impede ATRIBUIR o plano; quem já está nele
-- continua — e o padrão não pode ser desativado (CHECK).
--
-- ─── Central de avisos ───────────────────────────────────────────────────────
--
-- `agent_inbox_items.kind` ganha `entitlement_changed` (troca de plano,
-- liberação com prazo, revogação — escrito pela rota admin; e o aviso único por
-- org/mês do worker quando pula execução por recurso). CHECK reconstruído em UM
-- bloco, como manda a lição do #159; `kind-check-migration-x-baseline` cobra a
-- paridade com o baseline.
--
-- Idempotente e portável em psql puro: `if not exists`, `create or replace`,
-- `drop … if exists` antes de `create trigger`/`policy`, seed com
-- `on conflict do nothing`, backfill só onde `plan_id is null`. Nenhuma
-- constraint nova sobre dado existente (as tabelas nascem vazias; a coluna nova
-- é nullable), então não há o que corrigir antes.

-- ---------------------------------------------------------------------------
-- 1. Catálogo de planos (tabela de PLATAFORMA — sem organization_id)
-- ---------------------------------------------------------------------------

create table if not exists public.platform_plans (
  id          uuid primary key default gen_random_uuid(),
  slug        citext not null unique,
  name        text not null,
  description text,
  is_active   boolean not null default true,
  is_default  boolean not null default false,
  -- Namespace plano de limites; chaves e schema em lib/entitlements/limites.ts.
  -- `null` numa chave = "sem limite, dito de propósito".
  limits      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  constraint platform_plans_slug_check   check (slug ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  constraint platform_plans_name_check   check (length(btrim(name)) between 1 and 80),
  constraint platform_plans_limits_check check (jsonb_typeof(limits) = 'object'),
  -- O padrão é o que toda organização nova recebe: não pode estar desligado.
  constraint platform_plans_padrao_ativo check (not is_default or is_active)
);

-- Um padrão só. Índice parcial único em vez de coluna em outra tabela: a
-- resposta "qual é o padrão?" é uma linha desta.
create unique index if not exists platform_plans_um_padrao
  on public.platform_plans (is_default) where is_default;

comment on table public.platform_plans is
  'Catálogo comercial da INSTALAÇÃO (planos que o platform admin vende). Plano é dado; recurso é código (lib/entitlements/recursos.ts). is_default = o que toda organização nova recebe (um só, e ativo). Deletar é recusado quando há organização no plano (FK restrict): plano sai de circulação por is_active=false. Lida só por platform admin (RLS); escrita só por service_role (rotas /api/v1/admin/plans).';

comment on column public.platform_plans.limits is
  'Limites do plano, namespace plano: {max_channels, max_users, max_ai_agents, broadcast_monthly_sends, max_contacts} → inteiro ≥ 0 ou null (sem limite). Chaves e schema: lib/entitlements/limites.ts. Nenhuma chave é ENFORCED até a etapa 8 do plano de entitlements — até lá é informativo.';

drop trigger if exists trg_platform_plans_touch on public.platform_plans;
create trigger trg_platform_plans_touch
  before update on public.platform_plans
  for each row execute function public.fn_touch_updated_at();

create table if not exists public.platform_plan_features (
  plan_id uuid not null references public.platform_plans(id) on delete cascade,
  feature text not null,
  primary key (plan_id, feature),
  -- Espelho de RECURSOS_VENDAVEIS (lib/entitlements/recursos.ts). 'channels'
  -- fica FORA de propósito: não é dado, é lei — ver o cabeçalho.
  constraint platform_plan_features_feature_check
    check (feature in ('inbox', 'broadcast', 'crm', 'ai_agents', 'analytics'))
);

comment on table public.platform_plan_features is
  'Recursos incluídos em cada plano — uma linha por (plano, recurso). channels nunca é linha: fn_org_entitlements o inclui sempre. Vocabulário: RECURSOS_VENDAVEIS em lib/entitlements/recursos.ts; paridade vigiada por tests/invariants/vocabulario-banco-x-typescript.test.ts.';

-- ---------------------------------------------------------------------------
-- 2. A atribuição: organizations.plan_id
-- ---------------------------------------------------------------------------

alter table public.organizations
  add column if not exists plan_id uuid references public.platform_plans(id) on delete restrict;
alter table public.organizations
  add column if not exists plan_assigned_at timestamptz;

create index if not exists idx_organizations_plan on public.organizations (plan_id);

comment on column public.organizations.plan_id is
  'O plano contratado — FONTE DA VERDADE da atribuição (settings.plan é chave morta). Só muda por fn_definir_plano_da_organizacao (trigger trg_organizations_plano_so_pela_funcao recusa o resto). Nulo só em organização anterior ao catálogo antes do backfill; o trigger BEFORE INSERT põe o padrão em toda organização nova.';

-- ---------------------------------------------------------------------------
-- 3. Overrides por organização
-- ---------------------------------------------------------------------------

create table if not exists public.organization_feature_overrides (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  feature         text not null,
  mode            text not null,
  limits          jsonb not null default '{}'::jsonb,
  starts_at       timestamptz not null default now(),
  ends_at         timestamptz,
  reason          text not null,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  revoked_at      timestamptz,
  revoked_by      uuid,
  revoke_reason   text,
  -- Espelho de RECURSOS (os seis): aqui 'channels' ENTRA, para override de
  -- LIMITE (max_channels, max_users) — nunca para desligá-lo.
  constraint ofo_feature_check check (feature in ('channels', 'inbox', 'broadcast', 'crm', 'ai_agents', 'analytics')),
  constraint ofo_mode_check    check (mode in ('enable', 'disable')),
  constraint ofo_limits_check  check (jsonb_typeof(limits) = 'object'),
  constraint ofo_reason_check  check (length(btrim(reason)) between 1 and 500),
  constraint ofo_janela_check  check (ends_at is null or ends_at > starts_at),
  -- A camada 3 das três que guardam Canais (ver cabeçalho).
  constraint ofo_canais_nunca_desligam check (feature <> 'channels' or mode <> 'disable')
);

create index if not exists ofo_org_ativos_idx
  on public.organization_feature_overrides (organization_id, feature)
  where revoked_at is null;

comment on table public.organization_feature_overrides is
  'Liberação ou bloqueio de UM recurso para UMA organização, fora do plano — com janela (starts_at/ends_at), motivo e revogação. Conta enquanto revoked_at is null e starts_at <= now() < coalesce(ends_at, infinity); expiração é passiva (sem cron). disable ativo vence enable ativo. channels nunca pode ser disable (CHECK). O tenant LÊ os próprios (RLS) para a tela dizer "liberado até dd/mm"; escreve só service_role via fn_criar/fn_revogar_override_de_recurso.';

-- ---------------------------------------------------------------------------
-- 4. RLS e privilégios
-- ---------------------------------------------------------------------------

alter table public.platform_plans                enable row level security;
alter table public.platform_plan_features        enable row level security;
alter table public.organization_feature_overrides enable row level security;

-- Catálogo: só platform admin lê pela REST. O tenant enxerga o PRÓPRIO plano
-- pela função (nome e slug), nunca o catálogo inteiro com os limites dos outros.
drop policy if exists platform_plans_select_platform_admin on public.platform_plans;
create policy platform_plans_select_platform_admin on public.platform_plans
  for select using (public.fn_is_platform_admin());

drop policy if exists platform_plan_features_select_platform_admin on public.platform_plan_features;
create policy platform_plan_features_select_platform_admin on public.platform_plan_features
  for select using (public.fn_is_platform_admin());

-- Overrides: membro lê os da própria organização; platform admin lê todos.
-- Nenhuma policy de escrita para authenticated — deny por RLS E por privilégio.
drop policy if exists ofo_select_membro_ou_platform_admin on public.organization_feature_overrides;
create policy ofo_select_membro_ou_platform_admin on public.organization_feature_overrides
  for select using (
    organization_id in (select public.fn_user_org_ids())
    or public.fn_is_platform_admin()
  );

revoke all on public.platform_plans                 from anon, public;
revoke all on public.platform_plan_features         from anon, public;
revoke all on public.organization_feature_overrides from anon, public;
revoke insert, update, delete, truncate on public.platform_plans                 from authenticated;
revoke insert, update, delete, truncate on public.platform_plan_features         from authenticated;
revoke insert, update, delete, truncate on public.organization_feature_overrides from authenticated;
grant select on public.platform_plans                 to authenticated;
grant select on public.platform_plan_features         to authenticated;
grant select on public.organization_feature_overrides to authenticated;
grant select, insert, update, delete on public.platform_plans                 to service_role;
grant select, insert, update, delete on public.platform_plan_features         to service_role;
grant select, insert, update, delete on public.organization_feature_overrides to service_role;

-- ---------------------------------------------------------------------------
-- 5. Quem pode chamar as funções de escrita — a mesma régua de
--    fn_create_tenant_with_owner: platform admin `full`, não revogado.
-- ---------------------------------------------------------------------------

create or replace function public.fn_exigir_platform_admin_full(p_actor uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_actor is null or not exists (
    select 1 from public.platform_admins
     where user_id = p_actor and revoked_at is null and scope = 'full'
  ) then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;
end;
$$;

revoke execute on function public.fn_exigir_platform_admin_full(uuid) from public, anon, authenticated;
grant  execute on function public.fn_exigir_platform_admin_full(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6. O resolvedor — a ÚNICA implementação da regra
-- ---------------------------------------------------------------------------

-- Quem pode PERGUNTAR: membro da organização (inclui suporte ativo, via
-- fn_user_org_ids), platform admin, ou chamada sem sessão (service_role /
-- worker pg / psql — anon não tem EXECUTE). Fora disso, 42501: perguntar pelo
-- plano de outra organização já é vazamento.
create or replace function public.fn_org_entitlements(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan_id   uuid;
  v_origem    text;
  v_plan      jsonb;
  v_features  jsonb;
  v_limits    jsonb;
  v_overrides jsonb;
begin
  if p_org is null then
    raise exception 'organization_required' using errcode = '22023';
  end if;
  if auth.uid() is not null
     and not public.fn_is_platform_admin()
     and p_org not in (select public.fn_user_org_ids()) then
    raise exception 'entitlements_forbidden' using errcode = '42501';
  end if;

  select o.plan_id into v_plan_id from public.organizations o where o.id = p_org;
  if not found then
    raise exception 'organization_not_found' using errcode = 'P0002';
  end if;

  if v_plan_id is not null then
    v_origem := 'atribuido';
  else
    select p.id into v_plan_id from public.platform_plans p where p.is_default limit 1;
    v_origem := case when v_plan_id is null then 'nenhum' else 'padrao' end;
  end if;

  select jsonb_build_object('id', p.id, 'slug', p.slug::text, 'name', p.name, 'is_active', p.is_active),
         coalesce(p.limits, '{}'::jsonb)
    into v_plan, v_limits
    from public.platform_plans p
   where p.id = v_plan_id;
  v_plan   := coalesce(v_plan, 'null'::jsonb);
  v_limits := coalesce(v_limits, '{}'::jsonb);

  -- Overrides ATIVOS agora, do mais antigo ao mais novo — a ordem é a de
  -- mesclagem dos limites (o mais recente vence por chave).
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', o.id, 'feature', o.feature, 'mode', o.mode,
           'starts_at', o.starts_at, 'ends_at', o.ends_at,
           'limits', o.limits, 'reason', o.reason
         ) order by o.created_at, o.id), '[]'::jsonb)
    into v_overrides
    from public.organization_feature_overrides o
   where o.organization_id = p_org
     and o.revoked_at is null
     and o.starts_at <= now()
     and (o.ends_at is null or o.ends_at > now());

  -- (plano ∪ enable) − disable ∪ {channels}
  with base as (
    select f.feature from public.platform_plan_features f where f.plan_id = v_plan_id
    union
    select (o ->> 'feature') from jsonb_array_elements(v_overrides) o where o ->> 'mode' = 'enable'
  ),
  efetivo as (
    select b.feature from base b
    where b.feature not in (
      select (o ->> 'feature') from jsonb_array_elements(v_overrides) o where o ->> 'mode' = 'disable'
    )
    union
    select 'channels'
  )
  select coalesce(jsonb_agg(e.feature order by e.feature), '["channels"]'::jsonb)
    into v_features
    from efetivo e;

  -- Limites: plano embaixo, overrides por cima na ordem de criação.
  -- `jsonb_object_agg` fica com o ÚLTIMO valor de cada chave na ordem do
  -- `order by` — o override mais novo vence, como o comentário acima promete.
  select v_limits || coalesce(
           (select jsonb_object_agg(kv.k, kv.v order by ov.n)
              from jsonb_array_elements(v_overrides) with ordinality as ov(o, n),
                   jsonb_each(coalesce(ov.o -> 'limits', '{}'::jsonb)) as kv(k, v)),
           '{}'::jsonb)
    into v_limits;

  return jsonb_build_object(
    'plan', v_plan,
    'origem', v_origem,
    'features', v_features,
    'limits', coalesce(v_limits, '{}'::jsonb),
    'overrides', v_overrides
  );
end;
$$;

revoke execute on function public.fn_org_entitlements(uuid) from public, anon;
grant  execute on function public.fn_org_entitlements(uuid) to authenticated, service_role;

comment on function public.fn_org_entitlements(uuid) is
  'A RESPOSTA: o que a organização pode usar agora. {plan, origem (atribuido|padrao|nenhum), features[], limits{}, overrides[] ativos}. Regra: (plano ∪ enable ativos) − disable ativos ∪ {channels}; limites = plano ⊕ overrides (o mais novo vence por chave). Única implementação — lib/entitlements/resolver.ts (Supabase) e resolver-pg.ts (pool) só dão forma ao jsonb. Membro, platform admin ou chamada sem sessão; anon sem EXECUTE.';

-- A pergunta curta, para quem executa em background e só precisa de um booleano.
-- `channels` responde true SEM consultar — camada 2 das três (ver cabeçalho).
create or replace function public.fn_org_has_feature(p_org uuid, p_feature text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_feature = 'channels' then
    return true;
  end if;
  return public.fn_org_entitlements(p_org) -> 'features' ? p_feature;
end;
$$;

revoke execute on function public.fn_org_has_feature(uuid, text) from public, anon;
grant  execute on function public.fn_org_has_feature(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Escrita: atribuir plano, criar e revogar override
-- ---------------------------------------------------------------------------

create or replace function public.fn_definir_plano_da_organizacao(
  p_actor uuid, p_org uuid, p_plan uuid, p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_antes  uuid;
  v_ativo  boolean;
  v_agora  timestamptz := now();
begin
  perform public.fn_exigir_platform_admin_full(p_actor);
  if p_org is null or p_plan is null then
    raise exception 'plan_and_org_required' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason, ''))) not between 1 and 500 then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  select p.is_active into v_ativo from public.platform_plans p where p.id = p_plan;
  if not found then
    raise exception 'plan_not_found' using errcode = 'P0002';
  end if;
  if not v_ativo then
    -- Plano inativo não recebe organização nova. Quem já está nele continua.
    raise exception 'plan_inactive' using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_org::text, 275));
  select o.plan_id into v_antes from public.organizations o where o.id = p_org for update;
  if not found then
    raise exception 'organization_not_found' using errcode = 'P0002';
  end if;

  if v_antes is distinct from p_plan then
    -- A marca que o trigger de guarda procura — local à transação.
    perform set_config('deskcomm.plano_via_funcao', 'on', true);
    update public.organizations
       set plan_id = p_plan, plan_assigned_at = v_agora
     where id = p_org;
  end if;

  return jsonb_build_object(
    'organization_id', p_org,
    'from_plan_id', v_antes,
    'to_plan_id', p_plan,
    'changed', v_antes is distinct from p_plan,
    'assigned_at', v_agora
  );
end;
$$;

revoke execute on function public.fn_definir_plano_da_organizacao(uuid, uuid, uuid, text) from public, anon, authenticated;
grant  execute on function public.fn_definir_plano_da_organizacao(uuid, uuid, uuid, text) to service_role;

create or replace function public.fn_criar_override_de_recurso(
  p_actor uuid, p_org uuid, p_feature text, p_mode text,
  p_starts_at timestamptz, p_ends_at timestamptz, p_limits jsonb, p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  perform public.fn_exigir_platform_admin_full(p_actor);
  if not exists (select 1 from public.organizations o where o.id = p_org) then
    raise exception 'organization_not_found' using errcode = 'P0002';
  end if;
  -- Os CHECKs da tabela (feature, mode, janela, reason, canais nunca disable)
  -- são a validação; aqui só se traduz o valor ausente para o padrão.
  insert into public.organization_feature_overrides
    (organization_id, feature, mode, limits, starts_at, ends_at, reason, created_by)
  values
    (p_org, p_feature, p_mode, coalesce(p_limits, '{}'::jsonb),
     coalesce(p_starts_at, now()), p_ends_at, p_reason, p_actor)
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.fn_criar_override_de_recurso(uuid, uuid, text, text, timestamptz, timestamptz, jsonb, text) from public, anon, authenticated;
grant  execute on function public.fn_criar_override_de_recurso(uuid, uuid, text, text, timestamptz, timestamptz, jsonb, text) to service_role;

create or replace function public.fn_revogar_override_de_recurso(
  p_actor uuid, p_org uuid, p_override uuid, p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_linhas integer;
begin
  perform public.fn_exigir_platform_admin_full(p_actor);
  if length(btrim(coalesce(p_reason, ''))) not between 1 and 500 then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  -- Revogar é carimbar, nunca apagar: a linha é a única memória de que a
  -- liberação existiu. Já revogado → false (idempotente, sem segunda carimbada).
  update public.organization_feature_overrides
     set revoked_at = now(), revoked_by = p_actor, revoke_reason = p_reason
   where id = p_override and organization_id = p_org and revoked_at is null;
  get diagnostics v_linhas = row_count;
  return v_linhas = 1;
end;
$$;

revoke execute on function public.fn_revogar_override_de_recurso(uuid, uuid, uuid, text) from public, anon, authenticated;
grant  execute on function public.fn_revogar_override_de_recurso(uuid, uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 8. Seed do plano legado + backfill (ANTES dos triggers de guarda)
-- ---------------------------------------------------------------------------

-- `is_default` só se ainda não houver padrão: numa instalação em que o admin já
-- fez Starter o padrão, reaplicar o baseline (update.sh) não pode brigar com o
-- índice único nem trocar o padrão de volta.
insert into public.platform_plans (slug, name, description, is_active, is_default, limits)
select 'legado', 'Legado',
       'Todos os recursos, sem limites — o plano das organizações anteriores ao catálogo comercial.',
       true,
       not exists (select 1 from public.platform_plans where is_default),
       '{}'::jsonb
on conflict (slug) do nothing;

insert into public.platform_plan_features (plan_id, feature)
select p.id, f.feature
  from public.platform_plans p
  cross join (values ('inbox'), ('broadcast'), ('crm'), ('ai_agents'), ('analytics')) as f(feature)
 where p.slug = 'legado'
on conflict do nothing;

-- Toda organização sem plano cai no padrão. Dentro de um DO para o
-- `set_config(..., true)` valer só nesta transação — no update.sh o trigger de
-- guarda abaixo já existe, e sem a marca o backfill seria recusado.
do $$
declare
  v_padrao uuid;
begin
  select p.id into v_padrao from public.platform_plans p where p.is_default limit 1;
  if v_padrao is null then
    return;
  end if;
  perform set_config('deskcomm.plano_via_funcao', 'on', true);
  update public.organizations
     set plan_id = v_padrao, plan_assigned_at = coalesce(plan_assigned_at, now())
   where plan_id is null;
end $$;

-- ---------------------------------------------------------------------------
-- 9. Triggers de guarda em organizations
-- ---------------------------------------------------------------------------

-- Organização nova nasce no padrão, por QUALQUER caminho de criação.
create or replace function public.fn_organizations_plano_padrao()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.plan_id is null then
    select p.id into new.plan_id from public.platform_plans p where p.is_default limit 1;
    if new.plan_id is not null then
      new.plan_assigned_at := coalesce(new.plan_assigned_at, now());
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_organizations_plano_padrao on public.organizations;
create trigger trg_organizations_plano_padrao
  before insert on public.organizations
  for each row execute function public.fn_organizations_plano_padrao();

-- `plan_id` só muda pela função. Sem isto, qualquer UPDATE de service role que
-- carregue a linha inteira (updateTenant é um) poderia trocar o plano.
create or replace function public.fn_organizations_plano_so_pela_funcao()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.plan_id is distinct from old.plan_id
     and coalesce(current_setting('deskcomm.plano_via_funcao', true), '') <> 'on' then
    raise exception 'plan_id_only_via_fn_definir_plano_da_organizacao' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_organizations_plano_so_pela_funcao on public.organizations;
create trigger trg_organizations_plano_so_pela_funcao
  before update of plan_id on public.organizations
  for each row execute function public.fn_organizations_plano_so_pela_funcao();

revoke execute on function public.fn_organizations_plano_padrao() from public, anon, authenticated;
revoke execute on function public.fn_organizations_plano_so_pela_funcao() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 10. A chave morta, declarada morta
-- ---------------------------------------------------------------------------

comment on column public.organizations.settings is
  'Configurações da organização (jsonb). ⚠️ A chave `plan` é MORTA desde a 0275: era gravada na criação do tenant e lida por ninguém, e mora no jsonb que o admin do tenant reescreve — a fonte do plano é organizations.plan_id. Demais chaves: llm, routing, visibility_mode, atrito, ai_dispatch_mode, canonical_conversation_tags, lost_reasons_extra, branding, security, crm.';

-- ---------------------------------------------------------------------------
-- 11. Central de avisos: kind `entitlement_changed`
-- ---------------------------------------------------------------------------

alter table public.agent_inbox_items
  drop constraint if exists agent_inbox_items_kind_check;

alter table public.agent_inbox_items
  add constraint agent_inbox_items_kind_check check (kind in (
    'appointment_outcome_required',
    'appointment_recovery_review',
    'qr_rescan',
    'routing_unassigned',
    'job_dead',
    'event_dead',
    'budget_exceeded',
    'handoff',
    'promotion_review',
    'judge_unaligned',
    'followup_dead',
    'snooze_expired',
    'next_action_ambiguous',
    'risk_backlog_seeded',
    'reactivation_expired',
    'capabilities_missing',
    'message_send_stuck',
    'midia_nao_lida',
    'channel_template_review',
    'channel_number_alert',
    'promise_unfulfilled',
    'contact_proposal_expired',
    'budget_warning',
    'conhecimento_nao_indexado',
    'voice_call_missed',
    'case_stale',
    -- (migration 0275) O plano da organização mudou, um recurso foi liberado
    -- com prazo ou bloqueado, ou uma execução foi pulada por falta de recurso.
    -- Escrito pela rota admin e, uma vez por org/mês, pelo worker.
    'entitlement_changed',
    'other'
  ));

notify pgrst, 'reload schema';
