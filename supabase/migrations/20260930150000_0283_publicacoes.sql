-- 0283 — Publicações: o Disparo vira um planejador de conteúdo multi-rede
--
-- ─── O que muda e por quê ─────────────────────────────────────────────────────
--
-- O Disparo (0265) guardava conteúdo, UM grupo, agenda e recorrência na mesma
-- linha: N grupos eram N cópias ligadas por `metadata.batch`, e não havia como
-- representar "este conteúdo sai no Instagram, no Facebook e em 3 grupos". Esta
-- migration separa as cinco coisas que o produto precisa distinguir:
--
--   publications            — o CONTEÚDO (título, legenda, fuso, regra de recorrência)
--   publication_media       — os arquivos, em ORDEM, com metadados para validar por formato
--   publication_targets     — o DESTINO: (rede, formato, conta). WhatsApp liga grupos
--                             por publication_target_groups (FK tripla org+sessão+grupo)
--   publication_occurrences — QUANDO: cada data/hora é uma linha; a recorrência
--                             materializa ocorrências num horizonte (90 d / 100 pendentes)
--   publication_executions  — o RESULTADO: uma linha por ocorrência × destino
--                             (× grupo no WhatsApp; × arquivo em Stories), com `position`
--                             para preservar a ordem. É a única linha que fala com
--                             provedor e a única com id externo.
--
-- Máquina de estados (a verdade está embaixo):
--   publications.status:  draft → scheduled → completed | cancelled (+ deleted_at)
--   occurrences.status:   pending → processing → done | partial | failed | skipped | cancelled
--   executions.status:    pending → sending → sent | failed | skipped | cancelled
--                         (retry = nova linha attempt+1 quando retry_at vence)
--
-- ─── Concorrência ─────────────────────────────────────────────────────────────
--
-- `fn_claim_publication_executions` arrenda execuções por (ocorrência, destino)
-- com `for update skip locked` + `lease_until`: todos os Stories de um destino (e
-- todos os grupos de um destino de WhatsApp) vão ao MESMO worker, que os publica
-- em ordem de `position`. Dois ticks sobrepostos nunca repartem um destino.
--
-- ─── Cópia do legado ──────────────────────────────────────────────────────────
--
-- Cada lote de `scheduled_group_messages` (ou linha solta) vira UMA publicação
-- (`legacy_scheduled_message_id` = id da primeira linha do lote), com um destino
-- WhatsApp por conexão, os grupos do lote, uma ocorrência por horário conhecido
-- e uma execução por `scheduled_group_message_runs` (`legacy_run_id`). Tudo
-- `where not exists`: o `update.sh` reaplica o baseline sem duplicar. As tabelas
-- antigas ficam UMA release sem escrita (a 0284 as retira); nenhum código as lê.
-- `paused` do legado vira `draft` (o modelo novo não tem pausa: cancela-se a
-- ocorrência), com `metadata.legacy_status` guardando o original.
--
-- ─── Doutrina cumprida ────────────────────────────────────────────────────────
--
-- organization_id em toda tabela; FKs compostas (organization_id, id) como na
-- 0265; RLS leitura-membro / escrita-manager; funções com revoke das DUAS
-- origens (public e anon) e grant só a service_role; nenhuma trigger faz HTTP;
-- `fn_aplicar_travas_de_suporte()` no fim (0274). Vocabulário em CHECK
-- espelhado em `lib/publicacoes/schema.ts` (invariante vocabulario-banco-x-typescript).

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. publications — o conteúdo
-- ══════════════════════════════════════════════════════════════════════════════

create table if not exists public.publications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text,
  body text,
  status text not null default 'draft',
  timezone text not null default 'America/Sao_Paulo',
  recurrence_kind text not null default 'none',
  recurrence_config jsonb not null default '{}',
  repeat_until timestamptz,
  max_occurrences integer,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id) on delete set null,
  cancel_reason text,
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id) on delete set null,
  legacy_scheduled_message_id uuid,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint publications_status_check check (status in ('draft', 'scheduled', 'completed', 'cancelled')),
  constraint publications_recurrence_kind_check check (recurrence_kind in ('none', 'daily', 'weekly', 'monthly', 'weekdays', 'custom')),
  constraint publications_body_check check (body is null or length(btrim(body)) between 1 and 4000),
  constraint publications_title_check check (title is null or length(btrim(title)) between 1 and 160),
  constraint publications_timezone_check check (length(btrim(timezone)) between 1 and 80),
  constraint publications_recurrence_config_object_check check (jsonb_typeof(recurrence_config) = 'object'),
  constraint publications_metadata_object_check check (jsonb_typeof(metadata) = 'object'),
  constraint publications_max_occurrences_check check (max_occurrences is null or max_occurrences > 0),
  constraint publications_cancel_check check (
    (status = 'cancelled' and cancelled_at is not null)
    or (status <> 'cancelled' and cancelled_at is null and cancel_reason is null)
  ),
  constraint publications_org_id_unique unique (organization_id, id),
  constraint publications_legacy_unique unique (legacy_scheduled_message_id)
);

create index if not exists publications_org_status_idx
  on public.publications (organization_id, status)
  where deleted_at is null;

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. publication_media — os arquivos, em ordem
-- ══════════════════════════════════════════════════════════════════════════════

create table if not exists public.publication_media (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  publication_id uuid not null references public.publications(id) on delete cascade,
  position numeric not null,
  kind text not null,
  storage_path text not null,
  mime text not null,
  size_bytes bigint not null default 0,
  filename text,
  width integer,
  height integer,
  duration_ms integer,
  cover_storage_path text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint publication_media_kind_check check (kind in ('image', 'video', 'audio', 'document')),
  constraint publication_media_storage_path_check check (length(btrim(storage_path)) between 1 and 500),
  constraint publication_media_mime_check check (length(btrim(mime)) between 1 and 160),
  constraint publication_media_size_check check (size_bytes >= 0),
  constraint publication_media_dims_check check (
    (width is null or width > 0) and (height is null or height > 0) and (duration_ms is null or duration_ms >= 0)
  ),
  constraint publication_media_metadata_object_check check (jsonb_typeof(metadata) = 'object'),
  constraint publication_media_org_id_unique unique (organization_id, id),
  constraint publication_media_position_unique unique (publication_id, position),
  constraint publication_media_publication_org_fkey foreign key (organization_id, publication_id)
    references public.publications(organization_id, id) on delete cascade
);

create index if not exists publication_media_publication_idx
  on public.publication_media (publication_id, position);

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. publication_targets — (rede, formato, conta)
-- ══════════════════════════════════════════════════════════════════════════════

create table if not exists public.publication_targets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  publication_id uuid not null references public.publications(id) on delete cascade,
  channel_session_id uuid not null references public.channel_sessions(id) on delete restrict,
  network text not null,
  format text not null,
  settings jsonb not null default '{}',
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Vocabulário simples por coluna (o invariante vocabulario-banco-x-typescript
  -- lê UM `in (...)` por coluna) e, em separado, o par válido rede × formato.
  constraint publication_targets_network_check check (network in ('instagram', 'facebook', 'whatsapp')),
  constraint publication_targets_format_check check (format in ('feed', 'story', 'reel', 'group_message')),
  constraint publication_targets_network_format_check check (
    (network = 'whatsapp' and format = 'group_message')
    or (network in ('instagram', 'facebook') and format in ('feed', 'story', 'reel'))
  ),
  constraint publication_targets_settings_object_check check (jsonb_typeof(settings) = 'object'),
  constraint publication_targets_metadata_object_check check (jsonb_typeof(metadata) = 'object'),
  constraint publication_targets_org_id_unique unique (organization_id, id),
  constraint publication_targets_org_channel_id_unique unique (organization_id, channel_session_id, id),
  constraint publication_targets_unique unique (publication_id, network, format, channel_session_id),
  constraint publication_targets_publication_org_fkey foreign key (organization_id, publication_id)
    references public.publications(organization_id, id) on delete cascade,
  constraint publication_targets_channel_org_fkey foreign key (organization_id, channel_session_id)
    references public.channel_sessions(organization_id, id) on delete restrict
);

create index if not exists publication_targets_publication_idx
  on public.publication_targets (publication_id);

-- Grupos de um destino WhatsApp. A FK tripla impede grupo da sessão A num
-- destino da sessão B; a coerência "network = whatsapp" fica na API (a
-- constraint não enxerga a outra tabela) e num invariante.
create table if not exists public.publication_target_groups (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  channel_session_id uuid not null references public.channel_sessions(id) on delete restrict,
  target_id uuid not null references public.publication_targets(id) on delete cascade,
  group_id uuid not null references public.scheduled_whatsapp_groups(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint publication_target_groups_pkey primary key (target_id, group_id),
  constraint publication_target_groups_target_org_channel_fkey foreign key (organization_id, channel_session_id, target_id)
    references public.publication_targets(organization_id, channel_session_id, id) on delete cascade,
  constraint publication_target_groups_group_org_channel_fkey foreign key (organization_id, channel_session_id, group_id)
    references public.scheduled_whatsapp_groups(organization_id, channel_session_id, id) on delete restrict
);

create index if not exists publication_target_groups_group_idx
  on public.publication_target_groups (organization_id, group_id);

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. publication_occurrences — quando
-- ══════════════════════════════════════════════════════════════════════════════

create table if not exists public.publication_occurrences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  publication_id uuid not null references public.publications(id) on delete cascade,
  scheduled_at timestamptz not null,
  source text not null default 'manual',
  status text not null default 'pending',
  skipped_reason text,
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id) on delete set null,
  processed_at timestamptz,
  finished_at timestamptz,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint publication_occurrences_source_check check (source in ('manual', 'recurrence')),
  constraint publication_occurrences_status_check check (
    status in ('pending', 'processing', 'done', 'partial', 'failed', 'skipped', 'cancelled')
  ),
  constraint publication_occurrences_skipped_check check (
    (status = 'skipped' and skipped_reason is not null) or status <> 'skipped'
  ),
  constraint publication_occurrences_metadata_object_check check (jsonb_typeof(metadata) = 'object'),
  constraint publication_occurrences_org_id_unique unique (organization_id, id),
  constraint publication_occurrences_slot_unique unique (publication_id, scheduled_at),
  constraint publication_occurrences_publication_org_fkey foreign key (organization_id, publication_id)
    references public.publications(organization_id, id) on delete cascade
);

-- A fila do worker: só pendentes, por horário.
create index if not exists publication_occurrences_due_idx
  on public.publication_occurrences (scheduled_at)
  where status = 'pending';

create index if not exists publication_occurrences_org_status_idx
  on public.publication_occurrences (organization_id, status, scheduled_at desc);

create index if not exists publication_occurrences_org_window_idx
  on public.publication_occurrences (organization_id, scheduled_at);

-- ══════════════════════════════════════════════════════════════════════════════
-- 5. publication_executions — o resultado, por unidade de efeito externo
-- ══════════════════════════════════════════════════════════════════════════════

create table if not exists public.publication_executions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Denormalizado de propósito (DIRC: Integrar): toda tela e todo índice deste
  -- módulo filtram por publicação, e a ocorrência já carrega o mesmo id. A FK
  -- composta abaixo garante que ele nunca diverge da ocorrência.
  publication_id uuid not null references public.publications(id) on delete cascade,
  occurrence_id uuid not null references public.publication_occurrences(id) on delete cascade,
  target_id uuid not null references public.publication_targets(id) on delete cascade,
  group_id uuid references public.scheduled_whatsapp_groups(id) on delete restrict,
  media_id uuid references public.publication_media(id) on delete set null,
  position numeric not null default 0,
  attempt integer not null default 1,
  status text not null default 'pending',
  idempotency_key uuid not null default gen_random_uuid(),
  external_post_id text,
  external_url text,
  provider_status text,
  error_code text,
  error_category text,
  error_message text,
  provider_response jsonb,
  retry_at timestamptz,
  lease_until timestamptz,
  worker_id text,
  request_id text,
  claimed_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  legacy_run_id uuid,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint publication_executions_status_check check (
    status in ('pending', 'sending', 'sent', 'failed', 'skipped', 'cancelled')
  ),
  constraint publication_executions_attempt_check check (attempt > 0),
  constraint publication_executions_error_category_check check (
    error_category is null or error_category in ('transitorio', 'permanente')
  ),
  constraint publication_executions_sent_check check (
    (status = 'sent' and finished_at is not null and external_post_id is not null) or status <> 'sent'
  ),
  constraint publication_executions_failed_check check (
    (status = 'failed' and error_code is not null) or status <> 'failed'
  ),
  constraint publication_executions_retry_check check (retry_at is null or status = 'failed'),
  constraint publication_executions_metadata_object_check check (jsonb_typeof(metadata) = 'object'),
  constraint publication_executions_org_id_unique unique (organization_id, id),
  constraint publication_executions_legacy_unique unique (legacy_run_id),
  constraint publication_executions_publication_org_fkey foreign key (organization_id, publication_id)
    references public.publications(organization_id, id) on delete cascade,
  constraint publication_executions_occurrence_org_fkey foreign key (organization_id, occurrence_id)
    references public.publication_occurrences(organization_id, id) on delete cascade,
  constraint publication_executions_target_org_fkey foreign key (organization_id, target_id)
    references public.publication_targets(organization_id, id) on delete cascade,
  constraint publication_executions_media_org_fkey foreign key (organization_id, media_id)
    references public.publication_media(organization_id, id) on delete set null
);

-- UNIQUE ignora NULL; o índice de expressão é o que impede a mesma unidade de
-- efeito nascer duas vezes na mesma tentativa (grupo e mídia são opcionais).
create unique index if not exists publication_executions_slot_uidx
  on public.publication_executions (
    occurrence_id,
    target_id,
    coalesce(group_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(media_id, '00000000-0000-0000-0000-000000000000'::uuid),
    attempt
  );

create index if not exists publication_executions_claim_idx
  on public.publication_executions (status, retry_at, lease_until)
  where status in ('pending', 'sending');

create index if not exists publication_executions_occurrence_idx
  on public.publication_executions (organization_id, occurrence_id);

create index if not exists publication_executions_target_position_idx
  on public.publication_executions (target_id, occurrence_id, position, attempt);

create index if not exists publication_executions_external_idx
  on public.publication_executions (external_post_id)
  where external_post_id is not null;

-- ══════════════════════════════════════════════════════════════════════════════
-- 6. updated_at
-- ══════════════════════════════════════════════════════════════════════════════

drop trigger if exists trg_publications_updated_at on public.publications;
create trigger trg_publications_updated_at
  before update on public.publications
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_publication_media_updated_at on public.publication_media;
create trigger trg_publication_media_updated_at
  before update on public.publication_media
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_publication_targets_updated_at on public.publication_targets;
create trigger trg_publication_targets_updated_at
  before update on public.publication_targets
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_publication_occurrences_updated_at on public.publication_occurrences;
create trigger trg_publication_occurrences_updated_at
  before update on public.publication_occurrences
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_publication_executions_updated_at on public.publication_executions;
create trigger trg_publication_executions_updated_at
  before update on public.publication_executions
  for each row execute function public.fn_set_updated_at();

-- ══════════════════════════════════════════════════════════════════════════════
-- 7. RLS e grants — leitura para membro, escrita para manager+ (como a 0265)
-- ══════════════════════════════════════════════════════════════════════════════

alter table public.publications enable row level security;
alter table public.publication_media enable row level security;
alter table public.publication_targets enable row level security;
alter table public.publication_target_groups enable row level security;
alter table public.publication_occurrences enable row level security;
alter table public.publication_executions enable row level security;

do $$
declare t text;
begin
  foreach t in array array['publications','publication_media','publication_targets','publication_target_groups','publication_occurrences','publication_executions'] loop
    execute format('drop policy if exists tenant_isolation_%s_select on public.%I', t, t);
    execute format(
      'create policy tenant_isolation_%s_select on public.%I for select using (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin())',
      t, t);
    execute format('drop policy if exists tenant_isolation_%s_all on public.%I', t, t);
    execute format(
      'create policy tenant_isolation_%s_all on public.%I for all using (public.fn_is_platform_admin() or (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, ''manager''))) with check (public.fn_is_platform_admin() or (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, ''manager'')))',
      t, t);
    execute format('revoke all on public.%I from public, anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- 8. Funções do worker
-- ══════════════════════════════════════════════════════════════════════════════

-- Arrenda execuções por (ocorrência, destino). Devolve TODAS as execuções
-- pendentes e vencidas dos destinos escolhidos, já com `lease_until`; o worker
-- as publica em ordem de `position` e move cada uma para `sending` na hora da
-- chamada externa. Uma execução cujo lease venceu sem sair de `pending` pode ser
-- arrendada de novo (nenhuma chamada externa aconteceu); uma em `sending` com
-- lease vencido NÃO volta por aqui — é da reconciliação.
create or replace function public.fn_claim_publication_executions(
  p_limit integer,
  p_worker_id text,
  p_lease_seconds integer
)
returns setof public.publication_executions
language sql
security definer
set search_path = public
as $$
  with alvos as (
    select occurrence_id, target_id
    from public.publication_executions
    where status = 'pending'
      and (lease_until is null or lease_until < now())
      and (retry_at is null or retry_at <= now())
    group by occurrence_id, target_id
    order by min(created_at)
    limit greatest(1, least(coalesce(p_limit, 20), 200))
  ),
  escolhidas as (
    select x.id
    from public.publication_executions x
    join alvos a on a.occurrence_id = x.occurrence_id and a.target_id = x.target_id
    where x.status = 'pending'
      and (x.lease_until is null or x.lease_until < now())
      and (x.retry_at is null or x.retry_at <= now())
    for update of x skip locked
  )
  update public.publication_executions e
  set lease_until = now() + make_interval(secs => greatest(30, coalesce(p_lease_seconds, 300))),
      claimed_at = now(),
      worker_id = p_worker_id,
      updated_at = now()
  where e.id in (select id from escolhidas)
  returning e.*;
$$;

revoke all on function public.fn_claim_publication_executions(integer, text, integer) from public, anon, authenticated;
grant execute on function public.fn_claim_publication_executions(integer, text, integer) to service_role;

-- Recalcula o status da ocorrência a partir da ÚLTIMA tentativa de cada unidade
-- (destino × grupo × mídia) e fecha a publicação quando nada mais resta.
-- Só UPDATEs: nenhuma chamada externa (CLAUDE.md, anti-pattern 9).
create or replace function public.fn_rollup_publication_occurrence(p_occurrence uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pub uuid;
  v_status text;
  v_total integer;
  v_abertas integer;
  v_sent integer;
  v_failed integer;
  v_skipped integer;
  v_cancelled integer;
  v_kind text;
  v_until timestamptz;
  v_max integer;
  v_geradas integer;
begin
  select publication_id, status into v_pub, v_status
  from public.publication_occurrences where id = p_occurrence;
  if v_pub is null then return null; end if;

  with ultimas as (
    select distinct on (target_id, coalesce(group_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(media_id, '00000000-0000-0000-0000-000000000000'::uuid))
      status
    from public.publication_executions
    where occurrence_id = p_occurrence
    order by target_id, coalesce(group_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(media_id, '00000000-0000-0000-0000-000000000000'::uuid), attempt desc
  )
  select count(*),
         count(*) filter (where status in ('pending', 'sending')),
         count(*) filter (where status = 'sent'),
         count(*) filter (where status = 'failed'),
         count(*) filter (where status = 'skipped'),
         count(*) filter (where status = 'cancelled')
  into v_total, v_abertas, v_sent, v_failed, v_skipped, v_cancelled
  from ultimas;

  -- Sem execução nenhuma: a ocorrência está como a expansão a deixou.
  if v_total = 0 then return v_status; end if;

  if v_status = 'cancelled' then
    return v_status;
  end if;

  if v_abertas > 0 then
    v_status := 'processing';
  elsif v_sent = v_total then
    v_status := 'done';
  elsif v_sent > 0 then
    v_status := 'partial';
  elsif v_failed > 0 then
    v_status := 'failed';
  elsif v_cancelled = v_total then
    v_status := 'cancelled';
  else
    v_status := 'skipped';
  end if;

  update public.publication_occurrences
  set status = v_status,
      skipped_reason = case when v_status = 'skipped' then coalesce(skipped_reason, 'all_executions_skipped') else skipped_reason end,
      finished_at = case when v_status in ('done', 'partial', 'failed', 'skipped', 'cancelled') then coalesce(finished_at, now()) else null end,
      updated_at = now()
  where id = p_occurrence;

  -- A publicação fecha quando não há ocorrência aberta e a recorrência (se
  -- houver) já chegou ao fim declarado. Recorrência sem fim nunca fecha.
  select recurrence_kind, repeat_until, max_occurrences into v_kind, v_until, v_max
  from public.publications where id = v_pub;
  select count(*) into v_geradas from public.publication_occurrences where publication_id = v_pub;

  if not exists (
    select 1 from public.publication_occurrences
    where publication_id = v_pub and status in ('pending', 'processing')
  ) and (
    v_kind = 'none'
    or (v_until is not null and v_until < now())
    or (v_max is not null and v_geradas >= v_max)
  ) then
    update public.publications
    set status = 'completed', updated_at = now()
    where id = v_pub and status = 'scheduled';
  end if;

  return v_status;
end;
$$;

revoke all on function public.fn_rollup_publication_occurrence(uuid) from public, anon, authenticated;
grant execute on function public.fn_rollup_publication_occurrence(uuid) to service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 9. Realtime — as duas tabelas que a tela assiste (padrão da 0266)
-- ══════════════════════════════════════════════════════════════════════════════

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'publication_occurrences'
  ) then
    execute 'alter publication supabase_realtime add table public.publication_occurrences';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'publication_executions'
  ) then
    execute 'alter publication supabase_realtime add table public.publication_executions';
  end if;
end $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- 10. Central de avisos — kind 'publication_failed' (lista ÚNICA, reconstruída
--     inteira: tests/unit/kind-check-migration-x-baseline.test.ts)
-- ══════════════════════════════════════════════════════════════════════════════

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
    'entitlement_changed',
    'publication_failed',
    'other'
  ));

-- ══════════════════════════════════════════════════════════════════════════════
-- 11. Cópia idempotente do legado (0265 → 0283)
-- ══════════════════════════════════════════════════════════════════════════════

-- 11.1 publicações: uma por lote (metadata.batch.id) ou por linha solta
with fonte as (
  select m.*,
    coalesce(m.metadata->'batch'->>'id', m.id::text) as lote,
    row_number() over (
      partition by m.organization_id, coalesce(m.metadata->'batch'->>'id', m.id::text)
      order by
        case when (m.metadata->'batch'->>'index') ~ '^[0-9]+$' then (m.metadata->'batch'->>'index')::integer else 0 end,
        m.created_at, m.id
    ) as rn
  from public.scheduled_group_messages m
)
insert into public.publications (
  organization_id, title, body, status, timezone, recurrence_kind, recurrence_config,
  repeat_until, max_occurrences, created_by, updated_by, cancelled_at, cancelled_by, cancel_reason,
  created_at, updated_at, legacy_scheduled_message_id, metadata
)
select
  f.organization_id, f.title, f.body,
  case f.status
    when 'scheduled' then 'scheduled'
    when 'draft' then 'draft'
    when 'paused' then 'draft'
    when 'cancelled' then 'cancelled'
    else 'completed'
  end,
  f.timezone, f.recurrence_kind, f.recurrence_config, f.repeat_until, f.max_runs,
  f.created_by, f.updated_by, f.cancelled_at, f.cancelled_by, f.cancel_reason,
  f.created_at, f.updated_at, f.id,
  jsonb_build_object(
    'legacy_batch_id', f.lote,
    'legacy_status', f.status,
    'legacy_metadata', (f.metadata - 'scheduled_media_items' - 'scheduled_media' - 'batch')
  )
from fonte f
where f.rn = 1
  and not exists (select 1 from public.publications p where p.legacy_scheduled_message_id = f.id);

-- 11.2 mídias: a lista `scheduled_media_items` da primeira linha do lote; senão o
--      formato antigo `scheduled_media` (um arquivo)
insert into public.publication_media (organization_id, publication_id, position, kind, storage_path, mime, size_bytes, filename, metadata)
select
  p.organization_id, p.id, it.ord,
  case when it.el->>'kind' in ('image','video','audio','document') then it.el->>'kind' else 'document' end,
  it.el->>'storage_path',
  coalesce(nullif(it.el->>'mime', ''), 'application/octet-stream'),
  case when (it.el->>'size_bytes') ~ '^[0-9]+$' then (it.el->>'size_bytes')::bigint else 0 end,
  nullif(it.el->>'filename', ''),
  jsonb_build_object('legacy', true)
from public.publications p
join public.scheduled_group_messages m on m.id = p.legacy_scheduled_message_id
cross join lateral (
  select el, ord from jsonb_array_elements(
    case
      when jsonb_typeof(m.metadata->'scheduled_media_items') = 'array' and jsonb_array_length(m.metadata->'scheduled_media_items') > 0
        then m.metadata->'scheduled_media_items'
      when jsonb_typeof(m.metadata->'scheduled_media') = 'object'
        then jsonb_build_array(m.metadata->'scheduled_media')
      else '[]'::jsonb
    end
  ) with ordinality as x(el, ord)
) it
where nullif(it.el->>'storage_path', '') is not null
  and not exists (select 1 from public.publication_media pm where pm.publication_id = p.id);

-- 11.3 destinos: um WhatsApp por conexão presente no lote
insert into public.publication_targets (organization_id, publication_id, channel_session_id, network, format, settings, metadata)
select distinct p.organization_id, p.id, m.channel_session_id, 'whatsapp', 'group_message', '{}'::jsonb, jsonb_build_object('legacy', true)
from public.publications p
join public.scheduled_group_messages m
  on m.organization_id = p.organization_id
 and coalesce(m.metadata->'batch'->>'id', m.id::text) = p.metadata->>'legacy_batch_id'
where p.legacy_scheduled_message_id is not null
  and not exists (
    select 1 from public.publication_targets t
    where t.publication_id = p.id and t.channel_session_id = m.channel_session_id and t.network = 'whatsapp'
  );

-- 11.4 grupos de cada destino
insert into public.publication_target_groups (organization_id, channel_session_id, target_id, group_id)
select t.organization_id, t.channel_session_id, t.id, m.group_id
from public.publications p
join public.scheduled_group_messages m
  on m.organization_id = p.organization_id
 and coalesce(m.metadata->'batch'->>'id', m.id::text) = p.metadata->>'legacy_batch_id'
join public.publication_targets t
  on t.publication_id = p.id and t.channel_session_id = m.channel_session_id and t.network = 'whatsapp'
where p.legacy_scheduled_message_id is not null
on conflict (target_id, group_id) do nothing;

-- 11.5 ocorrências: o próximo horário das agendadas + todo horário já executado
insert into public.publication_occurrences (organization_id, publication_id, scheduled_at, source, status, metadata)
select p.organization_id, p.id, h.quando,
  case when p.recurrence_kind = 'none' then 'manual' else 'recurrence' end,
  'pending',
  jsonb_build_object('legacy', true)
from public.publications p
join public.scheduled_group_messages m on m.id = p.legacy_scheduled_message_id
cross join lateral (
  select m.next_run_at as quando where m.status = 'scheduled' and m.next_run_at is not null
  union
  select r.scheduled_for
  from public.scheduled_group_message_runs r
  join public.scheduled_group_messages mm
    on mm.id = r.scheduled_message_id
   and mm.organization_id = p.organization_id
   and coalesce(mm.metadata->'batch'->>'id', mm.id::text) = p.metadata->>'legacy_batch_id'
) h
where h.quando is not null
on conflict (publication_id, scheduled_at) do nothing;

-- 11.6 execuções: uma por run legada
insert into public.publication_executions (
  organization_id, publication_id, occurrence_id, target_id, group_id, position, attempt, status,
  external_post_id, error_code, error_message, worker_id, request_id, claimed_at, started_at, finished_at,
  created_at, updated_at, legacy_run_id, metadata
)
select
  r.organization_id, p.id, o.id, t.id, r.group_id, 0, r.attempt,
  case r.status
    when 'sent' then 'sent'
    when 'failed' then 'failed'
    when 'skipped' then 'skipped'
    when 'cancelled' then 'cancelled'
    else 'failed'
  end,
  r.external_message_id,
  case when r.status in ('failed', 'pending', 'sending') then coalesce(r.error_code, 'worker_timeout') else r.error_code end,
  r.error_message,
  r.worker_id,
  r.metadata->>'request_id',
  r.claimed_at, r.started_at,
  coalesce(r.sent_at, case when r.status in ('failed', 'skipped', 'cancelled', 'pending', 'sending') then r.updated_at end),
  r.created_at, r.updated_at, r.id,
  jsonb_build_object('legacy', true, 'legacy_status', r.status, 'external_message_ids', coalesce(r.metadata->'external_message_ids', '[]'::jsonb))
from public.scheduled_group_message_runs r
join public.scheduled_group_messages m on m.id = r.scheduled_message_id
join public.publications p
  on p.organization_id = m.organization_id
 and p.metadata->>'legacy_batch_id' = coalesce(m.metadata->'batch'->>'id', m.id::text)
join public.publication_occurrences o on o.publication_id = p.id and o.scheduled_at = r.scheduled_for
join public.publication_targets t
  on t.publication_id = p.id and t.channel_session_id = m.channel_session_id and t.network = 'whatsapp'
where not exists (select 1 from public.publication_executions e where e.legacy_run_id = r.id);

-- 11.7 status das ocorrências copiadas: o rollup lê as execuções que acabaram de nascer
do $$
declare o record;
begin
  for o in
    select distinct e.occurrence_id
    from public.publication_executions e
    join public.publication_occurrences oc on oc.id = e.occurrence_id
    where oc.status = 'pending' and (oc.metadata->>'legacy') = 'true'
  loop
    perform public.fn_rollup_publication_occurrence(o.occurrence_id);
  end loop;
end $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- 12. Comentários, travas de suporte e recarga do PostgREST
-- ══════════════════════════════════════════════════════════════════════════════

comment on table public.publications is
  'Conteúdo de uma publicação (Publicações): título, legenda, fuso e regra de recorrência. Destinos em publication_targets, datas em publication_occurrences, resultado em publication_executions.';
comment on table public.publication_media is
  'Arquivos de uma publicação, em ordem (position numeric). storage_path no bucket whatsapp-media sob <org>/publications/ (ou <org>/scheduled-groups/ quando copiado do legado).';
comment on table public.publication_targets is
  'Destino de uma publicação: (rede, formato, conexão). WhatsApp liga grupos por publication_target_groups.';
comment on table public.publication_target_groups is
  'Grupos de um destino WhatsApp. FK tripla (org, sessão, grupo) impede grupo de outra conexão.';
comment on table public.publication_occurrences is
  'Cada data/hora em que a publicação sai. Recorrência materializa ocorrências num horizonte; status é o rollup das execuções.';
comment on table public.publication_executions is
  'Uma linha por ocorrência × destino (× grupo no WhatsApp; × arquivo em Stories), por tentativa. A única linha que fala com o provedor.';

do $f$ begin perform public.fn_aplicar_travas_de_suporte(); end $f$;

notify pgrst, 'reload schema';
