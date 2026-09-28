-- 0278 — Setores de atendimento (fase 1: schema, RLS e passagem de bastão).
--
-- Spec: docs/specs/20-spec-setores-de-atendimento.md. Prosa do bloco novo no
-- próprio bloco abaixo (é o mesmo texto do apêndice do baseline).
--
-- Este arquivo tem DUAS partes:
--   1. o bloco novo — tabelas `sectors`/`sector_members`, colunas em
--      `conversations`, `ai_agents` e `conversation_assignment_events`, a regra
--      de visibilidade parametrizada, a versão com setor de
--      `fn_can_view_conversation`, o gatilho que encerra a passagem de bastão e
--      a RPC `fn_conversation_transfer_sector`;
--   2. os chamadores da regra de visibilidade, redefinidos com a assinatura
--      nova — `fn_appointment_stamp`, `fn_meet_action`, `fn_reply_action`, a
--      policy de `ai_reply_drafts`, as duas funções de worker que tinham a
--      regra copiada inline (`fn_meet_delivery_current`,
--      `fn_reply_delivery_policy`), `fn_conversation_assign` (bastão + "quem
--      chama só mexe no que vê") e `fn_channel_routing_claim` (setor restringe
--      quem recebe). Os corpos são os MESMOS do baseline, byte a byte — o
--      espelho é cobrado por
--      tests/unit/apendice-do-baseline-nao-diverge-da-cadeia.test.ts.
--
-- Com zero setores criados nada muda para quem instala: `sector_id` nulo cai
-- na regra antiga de `visibility_mode`, e nenhum caminho grava setor até a
-- fase 3 (handoff) e a fase 2 (rotas) existirem.

-- ---- setores de atendimento: setor, membros, visibilidade por setor e passagem de bastão (migration 0278) ----
--
-- Spec: docs/specs/20-spec-setores-de-atendimento.md. Fase 1 (schema + RLS).
--
-- O que entra:
--   * `sectors` e `sector_members` — o setor (financeiro, comercial…) e quem
--     atende nele. `scope='all'` é o setor que vê tudo (supervisão).
--   * `conversations.sector_id` — em que setor a conversa está. NULO é permitido
--     e significa "sem setor": vale a regra antiga de `visibility_mode`. Com
--     zero setores criados, a instalação se comporta byte a byte como antes.
--   * `conversations.handover_from_user_id` — a PASSAGEM DE BASTÃO: quem
--     transferiu continua vendo e respondendo até o novo dono mandar a
--     primeira mensagem ao cliente (gatilho em `messages`). Nunca existe um
--     instante em que ninguém pode responder.
--   * `ai_agents.sector_id` — o setor de entrega do agente de IA (fase 3 usa).
--   * `fn_user_can_view_conversation` — a REGRA de visibilidade, parametrizada
--     por usuário e papel, para as funções de worker que reconferem "o
--     aprovador ainda vê a conversa?" sem `auth.uid()`. As duas cópias inline
--     dessa regra (`fn_meet_delivery_current`, `fn_reply_delivery_policy`)
--     passam a chamá-la; regra em dois lugares foi o que este bloco veio tirar.
--   * `fn_can_view_conversation(org, dono, setor, bastão)` — a mesma regra com
--     `auth.uid()`, para as policies. A sobrecarga de dois argumentos fica como
--     compatibilidade e NENHUM chamador do baseline a usa.
--   * `fn_conversation_transfer_sector` — transferir para um setor: zera o
--     dono, muda o setor, guarda o bastão com quem transferiu, grava o evento
--     `sector_transfer` e reabre o roteamento. Só `service_role`: a rota valida
--     a sessão e passa `p_actor`; a função revalida papel e visibilidade.
--
-- Este bloco mora AQUI, logo depois da função de visibilidade da 0035 e ANTES
-- da policy `conversations_select`, de propósito: as funções em `language sql`
-- que o chamam mais adiante (`fn_meet_delivery_current`,
-- `fn_reply_delivery_policy`) são validadas na criação, e a instalação fresca
-- precisa que a função e as colunas já existam quando chegar lá.
--
-- Idempotente: `create ... if not exists`, FKs guardadas por `do` block,
-- `create or replace`, `drop policy if exists`.

create table if not exists public.sectors (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  -- O que o agente de IA usa no payload da ferramenta de handoff (fase 3).
  slug            text not null,
  -- Vai para o prompt: "quando mandar para cá". Escrita pelo admin.
  description     text not null default '',
  -- 'own' = vê só o próprio setor; 'all' = vê todos (supervisão).
  scope           text not null default 'own',
  is_active       boolean not null default true,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint sectors_name_check        check (length(btrim(name)) between 1 and 60),
  constraint sectors_slug_check        check (slug ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  constraint sectors_scope_check       check (scope in ('own', 'all')),
  constraint sectors_description_check check (length(description) <= 500),
  unique (organization_id, id),
  unique (organization_id, slug)
);

comment on table public.sectors is
  'Setor de atendimento da organização (financeiro, comercial…). Nome na tela: Setor — "Equipe" já é a tela de membros. scope=all é o setor que vê tudo. Vocabulário de scope: SECTOR_SCOPES em lib/setores/vocabulario.ts (paridade em tests/invariants/vocabulario-banco-x-typescript.test.ts). Spec 20.';

create index if not exists idx_sectors_org_active
  on public.sectors (organization_id) where is_active;

create table if not exists public.sector_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sector_id       uuid not null,
  user_id         uuid not null,
  created_at      timestamptz not null default now(),
  primary key (sector_id, user_id),
  foreign key (organization_id, sector_id) references public.sectors(organization_id, id) on delete cascade,
  -- Sair da organização (ou ser revogado) sai dos setores — mesmo desenho de
  -- channel_routing_responsibles.
  foreign key (organization_id, user_id) references public.user_organizations(organization_id, user_id) on delete cascade
);

comment on table public.sector_members is
  'Quem atende em cada setor. Uma pessoa pode estar em vários. Spec 20.';

create index if not exists idx_sector_members_org_user
  on public.sector_members (organization_id, user_id);

alter table public.conversations add column if not exists sector_id uuid;
alter table public.conversations add column if not exists handover_from_user_id uuid;
alter table public.conversations add column if not exists handover_started_at timestamptz;
alter table public.ai_agents add column if not exists sector_id uuid;
alter table public.conversation_assignment_events add column if not exists from_sector_id uuid;
alter table public.conversation_assignment_events add column if not exists to_sector_id uuid;

comment on column public.conversations.sector_id is
  'Setor em que a conversa está. NULL = sem setor (vale visibility_mode). Muda pelo handoff da IA (fase 3) e por fn_conversation_transfer_sector.';
comment on column public.conversations.handover_from_user_id is
  'Passagem de bastão: quem transferiu e continua vendo/respondendo até o novo dono mandar a primeira mensagem (trg_handover_concluida_por_mensagem). NULL = sem passagem em curso.';
comment on column public.ai_agents.sector_id is
  'Setor de entrega: para onde o handoff deste agente manda a conversa quando a ferramenta não diz outro (fase 3). NULL = sem setor.';

-- FKs compostas (organization_id, sector_id): setor de outra organização é
-- recusado pelo próprio schema. `on delete restrict`: setor sai de circulação
-- por is_active=false; apagar exige antes tirar as referências (a rota faz).
-- Um `set null` composto anularia organization_id junto — por isso não.
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.conversations'::regclass and conname = 'conversations_sector_fk') then
    alter table public.conversations
      add constraint conversations_sector_fk
      foreign key (organization_id, sector_id) references public.sectors(organization_id, id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.conversations'::regclass and conname = 'conversations_handover_from_user_fk') then
    alter table public.conversations
      add constraint conversations_handover_from_user_fk
      foreign key (handover_from_user_id) references auth.users(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.ai_agents'::regclass and conname = 'ai_agents_sector_fk') then
    alter table public.ai_agents
      add constraint ai_agents_sector_fk
      foreign key (organization_id, sector_id) references public.sectors(organization_id, id) on delete restrict;
  end if;
  -- O histórico é append-only e sobrevive ao setor: set null simples.
  if not exists (select 1 from pg_constraint where conrelid = 'public.conversation_assignment_events'::regclass and conname = 'cae_from_sector_fk') then
    alter table public.conversation_assignment_events
      add constraint cae_from_sector_fk foreign key (from_sector_id) references public.sectors(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.conversation_assignment_events'::regclass and conname = 'cae_to_sector_fk') then
    alter table public.conversation_assignment_events
      add constraint cae_to_sector_fk foreign key (to_sector_id) references public.sectors(id) on delete set null;
  end if;
end $$;

create index if not exists idx_conversations_org_sector
  on public.conversations (organization_id, sector_id) where sector_id is not null;
create index if not exists idx_conversations_org_handover_from
  on public.conversations (organization_id, handover_from_user_id) where handover_from_user_id is not null;
create index if not exists idx_ai_agents_org_sector
  on public.ai_agents (organization_id, sector_id) where sector_id is not null;

-- ESTE É O BLOCO ÚNICO desta constraint (baseline-constraint-reconstruida).
-- Quem acrescentar um motivo mexe em DOIS lugares: esta lista e a última
-- migration que a reconstrói (kind-check-migration-x-baseline). O vocabulário
-- TypeScript é ASSIGNMENT_REASONS em lib/routing/assignment-reasons.ts.
alter table public.conversation_assignment_events
  drop constraint if exists conversation_assignment_events_reason_check;
alter table public.conversation_assignment_events
  add constraint conversation_assignment_events_reason_check
  check (reason in ('claim', 'transfer', 'release', 'routing', 'handoff', 'sector_transfer'));

-- RLS. Leitura para todo membro da organização (o atendente precisa listar os
-- setores para transferir); escrita só manager+ (configuração de governança,
-- spec 13 §4). As travas do modo somente leitura do suporte entram pelo bloco
-- final do arquivo (fn_aplicar_travas_de_suporte).
alter table public.sectors        enable row level security;
alter table public.sector_members enable row level security;
revoke all on public.sectors, public.sector_members from public, anon;
grant select, insert, update, delete on public.sectors, public.sector_members to authenticated, service_role;

drop policy if exists tenant_isolation_sectors_select on public.sectors;
create policy tenant_isolation_sectors_select on public.sectors
  for select to authenticated
  using (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin());

drop policy if exists tenant_isolation_sectors_write on public.sectors;
create policy tenant_isolation_sectors_write on public.sectors
  for all to authenticated
  using (public.fn_is_platform_admin()
         or (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'manager')))
  with check (public.fn_is_platform_admin()
         or (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'manager')));

drop policy if exists tenant_isolation_sector_members_select on public.sector_members;
create policy tenant_isolation_sector_members_select on public.sector_members
  for select to authenticated
  using (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin());

drop policy if exists tenant_isolation_sector_members_write on public.sector_members;
create policy tenant_isolation_sector_members_write on public.sector_members
  for all to authenticated
  using (public.fn_is_platform_admin()
         or (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'manager')))
  with check (public.fn_is_platform_admin()
         or (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'manager')));

drop trigger if exists trg_sectors_updated_at on public.sectors;
create trigger trg_sectors_updated_at
  before update on public.sectors
  for each row execute function public.fn_set_updated_at();

-- A REGRA, parametrizada por usuário e papel. Só é chamada por dentro de outras
-- `security definer` (policies via fn_can_view_conversation; funções de worker)
-- — por isso não tem EXECUTE para authenticated: função interna, não RPC.
--
-- Ordem, e a ordem importa:
--   1. sem usuário/papel → não vê;
--   2. viewer/manager/admin → vê (matriz da spec 13 §4, inalterada);
--   3. dono da conversa → vê (transferência direta a uma pessoa não some da tela dela);
--   4. quem está passando o bastão → vê, até o novo dono responder;
--   5. membro de um setor ativo com scope='all' → vê tudo;
--   6. conversa com setor ATIVO → vê somente se é membro dele. Aqui termina:
--      visibility_mode NÃO se aplica a conversa com setor;
--   7. sem setor (ou setor inativo) → a regra antiga de visibility_mode, byte a byte.
create or replace function public.fn_user_can_view_conversation(
  p_user uuid,
  p_role text,
  p_org uuid,
  p_assigned_to_user_id uuid,
  p_sector_id uuid,
  p_handover_from_user_id uuid
) returns boolean
language sql stable security definer
set search_path = public
as $$
  select case
    when p_user is null or p_role is null then false
    when p_role in ('viewer', 'manager', 'admin') then true
    when p_assigned_to_user_id = p_user then true
    when p_handover_from_user_id = p_user then true
    when exists (
      select 1 from public.sector_members m
        join public.sectors s on s.organization_id = m.organization_id and s.id = m.sector_id
       where m.organization_id = p_org and m.user_id = p_user and s.is_active and s.scope = 'all'
    ) then true
    when p_sector_id is not null and exists (
      select 1 from public.sectors s where s.organization_id = p_org and s.id = p_sector_id and s.is_active
    ) then exists (
      select 1 from public.sector_members m
       where m.organization_id = p_org and m.sector_id = p_sector_id and m.user_id = p_user
    )
    else case coalesce(
           (select settings->>'visibility_mode' from public.organizations where id = p_org),
           'own_and_unassigned')
         when 'all' then true
         when 'own_and_unassigned' then p_assigned_to_user_id is null
         else false
       end
  end;
$$;

revoke all on function public.fn_user_can_view_conversation(uuid, text, uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_user_can_view_conversation(uuid, text, uuid, uuid, uuid, uuid) to service_role;

-- A mesma regra com auth.uid(), para as policies (conversations_select,
-- messages via exists, ai_reply_drafts) e para as RPCs que rodam com a sessão.
create or replace function public.fn_can_view_conversation(
  p_org uuid,
  p_assigned_to_user_id uuid,
  p_sector_id uuid,
  p_handover_from_user_id uuid
) returns boolean
language sql stable security definer
set search_path = public
as $$
  select case
    when public.fn_is_platform_admin() then true
    else public.fn_user_can_view_conversation(
           auth.uid(), public.fn_user_role_in_org(p_org), p_org,
           p_assigned_to_user_id, p_sector_id, p_handover_from_user_id)
  end;
$$;

revoke all on function public.fn_can_view_conversation(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.fn_can_view_conversation(uuid, uuid, uuid, uuid) to authenticated, service_role;

-- Compatibilidade: a sobrecarga de dois argumentos fica (uma policy antiga num
-- clone pode depender dela até o update.sh recriá-la) e responde como "sem
-- setor, sem bastão". Nenhum chamador deste arquivo a usa.
create or replace function public.fn_can_view_conversation(
  p_org uuid,
  p_assigned_to_user_id uuid
) returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.fn_can_view_conversation(p_org, p_assigned_to_user_id, null::uuid, null::uuid);
$$;

revoke all on function public.fn_can_view_conversation(uuid, uuid) from public, anon;
grant execute on function public.fn_can_view_conversation(uuid, uuid) to authenticated, service_role;

-- A passagem de bastão termina quando o NOVO dono manda a primeira mensagem ao
-- cliente. Mensagem da IA (sent_by_user_id nulo) e mensagem de quem está
-- passando o bastão não encerram nada.
create or replace function public.fn_handover_concluida_por_mensagem()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.direction = 'outbound' and new.sent_by_user_id is not null then
    update public.conversations
       set handover_from_user_id = null,
           handover_started_at = null
     where organization_id = new.organization_id
       and id = new.conversation_id
       and handover_from_user_id is not null
       and assigned_to_user_id = new.sent_by_user_id;
  end if;
  return null;
end;
$$;

revoke all on function public.fn_handover_concluida_por_mensagem() from public, anon, authenticated;
drop trigger if exists trg_handover_concluida_por_mensagem on public.messages;
create trigger trg_handover_concluida_por_mensagem
  after insert on public.messages
  for each row execute function public.fn_handover_concluida_por_mensagem();

-- Transferir para um SETOR. Só service_role: a rota valida a sessão (papel,
-- suporte, MFA) e passa p_actor; aqui se revalida papel e visibilidade no
-- banco, porque instalar/chamar não concede autoridade. Numa transação:
-- setor novo, sem dono, `pending`, bastão com quem era dono, evento
-- `sector_transfer` e roteamento reaberto. Idempotente: repetir a mesma
-- transferência não gera segundo evento.
create or replace function public.fn_conversation_transfer_sector(
  p_org uuid,
  p_conversation uuid,
  p_to_sector uuid,
  p_actor uuid
) returns setof public.conversations
language plpgsql security definer
set search_path = public
as $$
declare
  c             public.conversations;
  v_role        text;
  v_from_user   uuid;
  v_from_sector uuid;
begin
  if p_actor is null then
    raise exception 'sector_transfer_forbidden' using errcode = '42501';
  end if;
  v_role := public.fn_member_role_in_org(p_actor, p_org);
  if v_role is null or v_role not in ('agent', 'manager', 'admin') then
    raise exception 'sector_transfer_forbidden' using errcode = '42501';
  end if;
  perform 1 from public.sectors where organization_id = p_org and id = p_to_sector and is_active;
  if not found then
    raise exception 'sector_not_found' using errcode = '22023';
  end if;

  select * into c from public.conversations
   where organization_id = p_org and id = p_conversation
     for no key update;
  if not found then
    return;
  end if;
  if not public.fn_user_can_view_conversation(p_actor, v_role, p_org, c.assigned_to_user_id, c.sector_id, c.handover_from_user_id) then
    raise exception 'sector_transfer_forbidden' using errcode = '42501';
  end if;
  if c.status not in ('open', 'pending', 'claimed', 'ai_handling') then
    raise exception 'conversation_not_open' using errcode = '22023';
  end if;
  if c.sector_id is not distinct from p_to_sector and c.assigned_to_user_id is null then
    return next c;
    return;
  end if;
  v_from_user   := c.assigned_to_user_id;
  v_from_sector := c.sector_id;

  update public.conversations
     set sector_id                 = p_to_sector,
         assigned_to_user_id       = null,
         assigned_to_user_name     = null,
         assigned_at               = null,
         assignee_kind             = null,
         status                    = 'pending',
         status_changed_at         = now(),
         unread_count_for_assignee = 0,
         handover_from_user_id     = coalesce(v_from_user, handover_from_user_id),
         handover_started_at       = case when v_from_user is not null then now() else handover_started_at end,
         updated_at                = now()
   where organization_id = p_org and id = p_conversation
   returning * into c;

  insert into public.conversation_assignment_events
    (organization_id, conversation_id, from_user_id, to_user_id, changed_by, reason, from_sector_id, to_sector_id)
  values
    (p_org, p_conversation, v_from_user, null, p_actor, 'sector_transfer', v_from_sector, p_to_sector);

  perform public.fn_request_channel_routing(p_org, p_conversation);
  return next c;
end;
$$;

revoke all on function public.fn_conversation_transfer_sector(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_conversation_transfer_sector(uuid, uuid, uuid, uuid) to service_role;

notify pgrst, 'reload schema';

-- ============================================================================
-- Parte 2 — chamadores da regra de visibilidade, com a assinatura nova.
-- ============================================================================

-- -- fn_appointment_stamp --
create or replace function public.fn_appointment_stamp()
returns trigger language plpgsql security definer set search_path=public as $$
declare changed boolean; actor uuid;
begin
 if new.contact_id is not null and not exists(select 1 from public.contacts where id=new.contact_id and organization_id=new.organization_id) then
  raise exception 'appointment_contact_scope' using errcode='23503'; end if;
 if new.conversation_id is not null and not exists(select 1 from public.conversations where id=new.conversation_id and organization_id=new.organization_id and contact_id=new.contact_id and not is_group and (auth.uid() is null or public.fn_can_view_conversation(organization_id,assigned_to_user_id,sector_id,handover_from_user_id))) then
  raise exception 'appointment_conversation_scope' using errcode='23503'; end if;
 if tg_op='INSERT' then
  new.revision:=1;
  -- Legado importado sem autoria não vira fato certificado.
  new.outcome_source_kind:=null; new.outcome_user_id:=null; new.outcome_message_id:=null;
  new.outcome_recorded_at:=null;
  return new;
 end if;
 changed:=row(new.starts_at,new.ends_at,new.status,new.contact_id,new.conversation_id) is distinct from row(old.starts_at,old.ends_at,old.status,old.contact_id,old.conversation_id);
 new.revision:=old.revision+case when changed then 1 else 0 end;
 new.revision_started_at:=case when changed then clock_timestamp() else old.revision_started_at end;
 if changed then new.confirmation_next_at:=null; end if;
 if new.status is distinct from old.status and new.status in ('completed','no_show') then
  actor:=auth.uid();
  if actor is null or not public.fn_role_at_least(new.organization_id,'agent') or not public.fn_support_write_allowed(new.organization_id) then
   raise exception 'appointment_human_confirmation_required' using errcode='42501'; end if;
  if new.starts_at>now() then raise exception 'appointment_not_started' using errcode='22023'; end if;
  new.outcome_user_id:=actor; new.outcome_recorded_at:=clock_timestamp();
  new.outcome_source_kind:=case when new.outcome_message_id is null then 'user' else 'contact_message' end;
  if new.outcome_message_id is not null and not exists(
   select 1 from public.messages m join public.conversations c on c.id=m.conversation_id and c.organization_id=m.organization_id
   where m.id=new.outcome_message_id and m.organization_id=new.organization_id and m.contact_id=new.contact_id
    and (new.conversation_id is null or m.conversation_id=new.conversation_id)
    and m.direction='inbound' and m.service_revision is not null and m.service_revision=c.service_revision
    and m.demanda_id is not distinct from c.current_demanda_id and m.created_at>=old.revision_started_at
    and not c.is_group and public.fn_can_view_conversation(c.organization_id,c.assigned_to_user_id,c.sector_id,c.handover_from_user_id)
  ) then raise exception 'appointment_message_not_evidence' using errcode='42501'; end if;
 elsif changed then
  new.outcome_source_kind:=null; new.outcome_user_id:=null; new.outcome_message_id:=null;
  new.outcome_recorded_at:=null;
 else
  new.outcome_source_kind:=old.outcome_source_kind;
  -- SET NULL por retenção da FK é erosão de referência, não nova autoria.
  new.outcome_user_id:=case when new.outcome_user_id is null and not exists(select 1 from auth.users where id=old.outcome_user_id) then null else old.outcome_user_id end;
  new.outcome_message_id:=case when new.outcome_message_id is null and not exists(select 1 from public.messages where id=old.outcome_message_id and organization_id=old.organization_id) then null else old.outcome_message_id end;
  new.outcome_recorded_at:=old.outcome_recorded_at;
 end if;
 return new;
end; $$;
revoke all on function public.fn_appointment_stamp() from public,anon,authenticated;

-- -- fn_meet_delivery_current --
create or replace function public.fn_meet_delivery_current(p_org uuid,p_job uuid,p_worker text,p_acquired_at timestamptz)
returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.job_queue j join public.calendar_appointments a on a.organization_id=j.organization_id and a.id::text=j.payload->>'appointment_id'
  join public.contacts c on c.organization_id=a.organization_id and c.id=a.contact_id
  join public.conversations v on v.organization_id=a.organization_id and v.contact_id=a.contact_id and v.id::text=j.payload->'service_boundary'->>'conversation_id'
  join public.channel_sessions cs on cs.organization_id=v.organization_id and cs.id=v.channel_session_id
  join public.organizations o on o.id=a.organization_id and o.status='active'
  where cs.archived_at is null and a.meeting_delivery->>'channel_session_id'=cs.id::text and j.organization_id=p_org and j.id=p_job and j.kind='transactional_delivery' and j.status='running' and j.locked_by=p_worker and j.locked_at=p_acquired_at
   and a.contact_id=j.contact_id and not c.is_anonymized and not c.is_blocked and a.status<>'cancelled' and a.meeting_state='ready' and a.meeting_url is not null
   and a.meeting_request_id::text=j.payload->>'meeting_request_id' and a.meeting_delivery->>'generation'=j.payload->>'delivery_generation'
   and a.meeting_delivery_job_id=j.id and a.meeting_delivery->>'state'='queued'
   and exists(select 1 from public.user_organizations where organization_id=p_org and user_id=a.owner_user_id and revoked_at is null)
   and (a.meeting_delivery->'authorized_by'->>'kind'='ai_agent' or
    (a.meeting_delivery->'authorized_by'->>'kind'='user' and a.meeting_delivery->'authorized_by'->>'id'=a.owner_user_id::text and exists(
     select 1 from public.user_organizations u where u.organization_id=p_org and u.user_id=a.owner_user_id and u.revoked_at is null and u.role in ('agent','manager','admin')
      and public.fn_user_can_view_conversation(u.user_id,u.role,v.organization_id,v.assigned_to_user_id,v.sector_id,v.handover_from_user_id))))
   and a.meeting_delivery->'service_boundary'=j.payload->'service_boundary' and public.fn_meet_boundary_current(j.payload->'service_boundary'));
$$;
revoke all on function public.fn_meet_delivery_current(uuid,uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.fn_meet_delivery_current(uuid,uuid,text,timestamptz) to service_role;

-- -- fn_meet_action --
create or replace function public.fn_meet_action(p_org uuid,p_id uuid,p_revision text,p_request uuid,p_action text,p_conversation uuid default null)
returns boolean language plpgsql security definer set search_path=public as $$
declare a public.calendar_appointments; contact uuid; b jsonb; destination_channel uuid;
begin
 if auth.uid() is null or not public.fn_role_at_least(p_org,'agent') or not public.fn_support_write_allowed(p_org) then raise exception 'meet_forbidden' using errcode='42501';end if;
 if not public.fn_session_mfa_proven() then raise exception 'meet_mfa_required' using errcode='42501';end if;
 select contact_id into contact from public.calendar_appointments where organization_id=p_org and id=p_id;
 if contact is not null then perform public.fn_service_lock(p_org,contact);end if;
 select * into a from public.calendar_appointments where organization_id=p_org and id=p_id for update;
 if not found or a.owner_user_id is distinct from auth.uid() or not exists(select 1 from public.user_organizations where organization_id=p_org and user_id=auth.uid() and revoked_at is null) then raise exception 'meet_forbidden' using errcode='42501';end if;
 if a.revision::text is distinct from p_revision or a.meeting_request_id is distinct from p_request or a.status='cancelled' or a.location_kind<>'google_meet'
  or exists(select 1 from public.contacts where id=a.contact_id and organization_id=p_org and is_anonymized) then raise exception 'meet_stale' using errcode='40001';end if;
 if p_action='retry' then
  if a.google_conflict is not null then raise exception 'google_conflict_requires_choice' using errcode='40001';end if;
  if a.meeting_state='ready' then return false;end if;
  if a.meeting_state<>'failed' then
   update public.calendar_appointments set meeting_next_attempt_at=now(),google_next_attempt_at=now() where organization_id=p_org and id=p_id;return true;
  end if;
  -- Tempo/timeout não provam rejeição. Somente failure recebido gira solicitação.
  update public.calendar_appointments set meeting_request_id=case when meeting_last_error='google_failure' and meeting_received_at is not null then gen_random_uuid() else meeting_request_id end,
   meeting_requested_at=case when meeting_last_error='google_failure' and meeting_received_at is not null then null else meeting_requested_at end,
   meeting_received_at=case when meeting_last_error='google_failure' then null else meeting_received_at end,
   meeting_state='pending',meeting_attempts=0,meeting_last_error=null,meeting_next_attempt_at=now(),google_next_attempt_at=now() where organization_id=p_org and id=p_id;
 elsif p_action='deliver' then
  if a.contact_id is null then raise exception 'meet_conversation_unavailable' using errcode='42501';end if;
  select channel_session_id into destination_channel from public.conversations where organization_id=p_org and id=p_conversation and contact_id=a.contact_id and not is_group and public.fn_can_view_conversation(organization_id,assigned_to_user_id,sector_id,handover_from_user_id) for update;
  if not found then raise exception 'meet_conversation_unavailable' using errcode='42501';end if;
  b:=public.fn_service_boundary(p_org,p_conversation)-'status'-'demanda_fechada_em'-'service_started_at';
  if not public.fn_meet_boundary_current(b) then raise exception 'meet_conversation_stale' using errcode='40001';end if;
  if a.meeting_delivery->'service_boundary'=b and a.meeting_delivery->>'channel_session_id'=destination_channel::text then
   if a.meeting_delivery->>'state' in ('waiting_for_link','sent') then return false;end if;
   if a.meeting_delivery->>'state'='queued' and a.meeting_delivery_job_id is not null then
    -- Recuperação humana de job morto conserva ledger/identidade. Não duplicar
    -- uma mensagem aceita antes do crash nem reconstruir fronteira antiga.
    update public.job_queue set status='pending',locked_by=null,locked_at=null,attempts=0,run_after=now(),last_error=null
     where organization_id=p_org and id=a.meeting_delivery_job_id and kind='transactional_delivery' and status in ('dead','failed','done');
    return found;
   end if;
  end if;
  update public.job_queue set status='failed',locked_by=null,locked_at=null,last_error='meet_delivery_superseded' where organization_id=p_org and id=a.meeting_delivery_job_id and kind='transactional_delivery' and status in ('pending','running');
  update public.calendar_appointments set meeting_delivery=jsonb_build_object('state','waiting_for_link','generation',gen_random_uuid(),'service_boundary',b,'authorized_by',jsonb_build_object('kind','user','id',auth.uid()),'source_operation_id',gen_random_uuid()),meeting_delivery_job_id=null where organization_id=p_org and id=p_id;
 else raise exception 'meet_action_invalid' using errcode='22023';end if;
 return true;
end;$$;
revoke all on function public.fn_meet_action(uuid,uuid,text,uuid,text,uuid) from public,anon;
grant execute on function public.fn_meet_action(uuid,uuid,text,uuid,text,uuid) to authenticated;

-- -- policy ai_reply_drafts --
drop policy if exists tenant_isolation_ai_reply_drafts_all on public.ai_reply_drafts;
create policy tenant_isolation_ai_reply_drafts_all on public.ai_reply_drafts for select to authenticated
 using(organization_id in(select public.fn_user_org_ids()) and exists(select 1 from public.conversations c where c.organization_id=ai_reply_drafts.organization_id and c.id=conversation_id and public.fn_can_view_conversation(c.organization_id,c.assigned_to_user_id,c.sector_id,c.handover_from_user_id)));

-- -- fn_reply_action --
create or replace function public.fn_reply_action(p_org uuid,p_id uuid,p_revision text,p_action text,p_body text default null,p_feedback text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare d public.ai_reply_drafts;contact uuid;jid uuid;a uuid;
begin
 if auth.uid() is null or not public.fn_role_at_least(p_org,'agent') or not public.fn_support_write_allowed(p_org) or not public.fn_session_mfa_proven() then raise exception 'reply_forbidden' using errcode='42501';end if;
 select contact_id,agent_id into contact,a from public.ai_reply_drafts where organization_id=p_org and id=p_id;
 if contact is null then raise exception 'reply_forbidden' using errcode='42501';end if;
 perform public.fn_service_lock(p_org,contact);
 perform 1 from public.ai_agents where organization_id=p_org and id=a for share;
 perform 1 from public.conversations c join public.ai_reply_drafts r on r.organization_id=c.organization_id and r.conversation_id=c.id where r.organization_id=p_org and r.id=p_id and public.fn_can_view_conversation(c.organization_id,c.assigned_to_user_id,c.sector_id,c.handover_from_user_id) for share of c;
 if not found then raise exception 'reply_forbidden' using errcode='42501';end if;
 select * into d from public.ai_reply_drafts where organization_id=p_org and id=p_id for update;
 if d.status in('approved','sending','sent') and p_action='approve' and d.approved_by=auth.uid() and d.approved_body=p_body then return d.send_job_id;end if;
 if d.revision::text is distinct from p_revision or d.status<>'pending' or not public.fn_reply_context_current(p_org,p_id) then raise exception 'reply_stale' using errcode='40001';end if;
 if p_action='reject' then
 update public.ai_reply_drafts set status='dismissed',feedback=jsonb_build_object('decision','rejected','reason',left(p_feedback,1000)),revision=revision+1,updated_at=now() where id=p_id and organization_id=p_org;return null;
 elsif p_action='approve' then
 if p_body is null or length(trim(p_body))=0 or length(p_body)>12000 then raise exception 'reply_body_invalid' using errcode='22023';end if;
 jid:=gen_random_uuid();
 insert into public.job_queue(id,organization_id,contact_id,kind,payload,run_after) values(jid,p_org,contact,'approved_reply',jsonb_build_object('draft_id',d.id,'service_boundary',d.service_boundary),now());
 update public.ai_reply_drafts set status='approved',edited_body=p_body,approved_body=p_body,approved_by=auth.uid(),approved_at=now(),approved_support_session_id=case when public.fn_support_context()->>'organization_id'=p_org::text then (public.fn_support_context()->>'id')::uuid else null end,send_job_id=jid,
 feedback=jsonb_build_object('decision',case when p_body is distinct from original_body then 'edited' else 'approved' end,'reason',left(p_feedback,1000),'correction',case when p_body is distinct from original_body then p_body else null end),revision=revision+1,updated_at=now()
 where id=p_id and organization_id=p_org;return jid;
 end if;
 raise exception 'reply_action_invalid' using errcode='22023';
end;$$;
revoke all on function public.fn_reply_action(uuid,uuid,text,text,text,text) from public,anon;
grant execute on function public.fn_reply_action(uuid,uuid,text,text,text,text) to authenticated;

-- -- fn_reply_delivery_policy --
create or replace function public.fn_reply_delivery_policy(p_org uuid,p_job uuid,p_worker text,p_acquired_at timestamptz)
returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce((select jsonb_build_object('current',true,'context_current',public.fn_reply_context_current(p_org,d.id),
 'contact_id',d.contact_id,'conversation_id',d.conversation_id,'channel_session_id',d.channel_session_id,'draft_id',d.id,'body',d.approved_body,'agent_id',d.agent_id)
 from public.job_queue j join public.ai_reply_drafts d on d.organization_id=j.organization_id and d.send_job_id=j.id and d.id::text=j.payload->>'draft_id'
 join public.conversations c on c.organization_id=d.organization_id and c.id=d.conversation_id and c.contact_id=d.contact_id
 join public.contacts p on p.organization_id=d.organization_id and p.id=d.contact_id
 join public.channel_sessions s on s.organization_id=d.organization_id and s.id=d.channel_session_id
 left join public.user_organizations u on u.organization_id=d.organization_id and u.user_id=d.approved_by and u.revoked_at is null and u.role in('agent','manager','admin')
 left join public.platform_support_sessions ss on ss.id=d.approved_support_session_id and ss.organization_id=d.organization_id and ss.actor_user_id=d.approved_by and ss.access_mode='full' and ss.ended_at is null and ss.expires_at>now()
 left join public.platform_admins pa on pa.user_id=ss.actor_user_id and pa.revoked_at is null and pa.scope='full'
 left join auth.sessions au on au.id=ss.auth_session_id and au.user_id=ss.actor_user_id and (au.not_after is null or au.not_after>now())
 join public.organizations o on o.id=d.organization_id and o.status='active'
 where j.organization_id=p_org and j.id=p_job and j.kind='approved_reply' and j.status='running' and j.locked_by=p_worker and j.locked_at=p_acquired_at
 and j.contact_id=d.contact_id and d.status in('approved','sending') and d.approved_body is not null and d.service_boundary=j.payload->'service_boundary'
 and not p.is_blocked and not p.is_anonymized and s.archived_at is null and c.channel_session_id=d.channel_session_id
 and public.fn_meet_boundary_current(d.service_boundary)
 and((d.approved_support_session_id is not null and ss.id is not null and pa.user_id is not null and au.id is not null and (not(pa.mfa_required or exists(select 1 from auth.mfa_factors mf where mf.user_id=ss.actor_user_id and mf.status='verified')) or au.aal='aal2'))
 or(d.approved_support_session_id is null and u.user_id is not null and public.fn_user_can_view_conversation(u.user_id,u.role,c.organization_id,c.assigned_to_user_id,c.sector_id,c.handover_from_user_id)))),'{"current":false}'::jsonb);
$$;
revoke all on function public.fn_reply_delivery_policy(uuid,uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.fn_reply_delivery_policy(uuid,uuid,text,timestamptz) to service_role;

-- -- fn_conversation_assign --
CREATE OR REPLACE FUNCTION public.fn_conversation_assign(p_organization_id uuid, p_conversation_id uuid, p_to_user_id uuid, p_reason text, p_expected_assignee uuid DEFAULT NULL::uuid, p_enforce_expected boolean DEFAULT false)
 RETURNS SETOF conversations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_from     uuid;
  v_sector   uuid;
  v_handover uuid;
  v_conv     public.conversations%rowtype;
begin
  if not public.fn_support_write_allowed(p_organization_id) then raise exception 'support_readonly' using errcode='42501'; end if;
  if auth.uid() is not null
     and not public.fn_role_at_least(p_organization_id, 'agent') then
    raise exception 'caller_not_authorized_for_org'
      using hint = 'caller must be an active agent+ member of the organization';
  end if;

  if p_to_user_id is not null then
    if coalesce(public.fn_member_role_in_org(p_to_user_id, p_organization_id), 'none')
         not in ('agent','manager','admin') then
      raise exception 'assignee_not_eligible_member'
        using hint = 'target must be an active agent+ member of the organization';
    end if;
  end if;

  select assigned_to_user_id, sector_id, handover_from_user_id
    into v_from, v_sector, v_handover
    from public.conversations
   where id = p_conversation_id
     and organization_id = p_organization_id
     for no key update;

  if not found then
    return;
  end if;

  if p_enforce_expected and v_from is distinct from p_expected_assignee then
    return;
  end if;

  -- Depois do optimistic lock, de propósito: claim perdido segue devolvendo 0 linhas
  -- (a rota responde 409), nunca erro. Setores (migration 0278): quem chama com a sessão só mexe no que VÊ. A RLS
  -- esconde a conversa de outro setor da lista, mas a RPC recebe o id — sem
  -- esta linha, um agent de fora do setor pegaria a conversa adivinhando o uuid.
  if auth.uid() is not null
     and not public.fn_can_view_conversation(p_organization_id, v_from, v_sector, v_handover) then
    raise exception 'conversation_not_visible' using errcode = '42501';
  end if;

  update public.conversations
     set assigned_to_user_id = p_to_user_id,
         -- Desnormalizado JUNTO com o dono, na mesma transação: nunca existe
         -- uma janela em que id e nome discordam. NULL junto com o id quando
         -- a atribuição é removida (release) — nunca sobra um nome órfão de
         -- dono nenhum. Lido de auth.users porque quem chama esta função
         -- (RPC) não necessariamente tem acesso ao Admin API — a definer
         -- resolve por dentro.
         assigned_to_user_name = case
           when p_to_user_id is null then null
           else (select raw_user_meta_data ->> 'full_name' from auth.users where id = p_to_user_id)
         end,
         assigned_at = case when p_to_user_id is null then null else now() end,
         assignee_kind = case when p_to_user_id is null then null else 'user' end,
         status = case when p_to_user_id is null then 'open' else 'claimed' end,
         status_changed_at = now(),
         unread_count_for_assignee = 0,
         bot_silenced_until = case
           when p_reason = 'routing'  then bot_silenced_until
           when p_to_user_id is null  then (case when last_handoff_at is null
                                                 then null
                                                 else bot_silenced_until end)
           else 'infinity'::timestamptz
         end,
         -- Passagem de bastão (migration 0278): numa transferência pessoa →
         -- pessoa, quem transferiu continua vendo até o novo dono responder.
         -- Release não tem a quem passar; a conversa voltar para quem passava
         -- encerra a passagem; claim/routing/handoff preservam a que existir.
         handover_from_user_id = case
           when p_to_user_id is null then null
           when p_to_user_id = v_handover then null
           when p_reason = 'transfer' and v_from is not null and v_from is distinct from p_to_user_id then v_from
           else handover_from_user_id
         end,
         handover_started_at = case
           when p_to_user_id is null then null
           when p_to_user_id = v_handover then null
           when p_reason = 'transfer' and v_from is not null and v_from is distinct from p_to_user_id then now()
           else handover_started_at
         end,
         updated_at = now()
   where id = p_conversation_id
   returning * into v_conv;

  insert into public.conversation_assignment_events
    (organization_id, conversation_id, from_user_id, to_user_id, changed_by, reason)
  values
    (p_organization_id, p_conversation_id, v_from, p_to_user_id, auth.uid(), p_reason);

  return next v_conv;
end;
$function$;

-- -- fn_channel_routing_claim --
create or replace function public.fn_channel_routing_claim(p_org uuid,p_conversation uuid,p_channel uuid,p_user uuid,p_schedule jsonb default null,p_reason text default 'routing')
returns text language plpgsql security definer set search_path=public as $$
declare c public.conversations; pre_contact uuid; member_id uuid; v_policy_id uuid; availability public.attendant_availability; current_load integer;
begin
 if p_reason not in('routing','handoff') then raise exception 'routing_reason_invalid' using errcode='22023';end if;
 select contact_id into pre_contact from public.conversations where organization_id=p_org and id=p_conversation;
 if not found then return 'conversation_changed';end if;
 perform public.fn_service_lock(p_org,pre_contact);
 perform pg_advisory_xact_lock(hashtextextended(p_org::text||':'||p_user::text,228));
 -- Task9: o trigger de status do canal toca conversas; ordem comum channel -> conversation.
 perform 1 from public.channel_sessions where organization_id=p_org and id=p_channel for share;
 if not found then return 'conversation_changed';end if;
 select * into c from public.conversations where organization_id=p_org and id=p_conversation for no key update;
 if not found or c.contact_id is distinct from pre_contact or c.channel_session_id is distinct from p_channel
  or c.status not in('open','pending','claimed','ai_handling') then return 'conversation_changed';end if;
 if c.assigned_to_user_id is not null then return 'already_assigned';end if;
 select id into member_id from public.user_organizations where organization_id=p_org and user_id=p_user
  and revoked_at is null and role in('agent','manager','admin') for share;
 if not found then return 'candidate_revoked';end if;
 select id into v_policy_id from public.channel_routing_policies where organization_id=p_org and channel_session_id=p_channel;
 if found and not exists(select 1 from public.channel_routing_responsibles r where r.organization_id=p_org and r.policy_id=v_policy_id and r.user_id=p_user)
 then return 'candidate_not_allowed';end if;
 -- Setores (migration 0278): conversa com setor ATIVO só vai para membro dele.
 if c.sector_id is not null and exists(select 1 from public.sectors s where s.organization_id=p_org and s.id=c.sector_id and s.is_active)
  and not exists(select 1 from public.sector_members m where m.organization_id=p_org and m.sector_id=c.sector_id and m.user_id=p_user)
 then return 'candidate_not_allowed';end if;
 select * into availability from public.attendant_availability where organization_id=p_org and user_id=p_user for share;
 if not found or not availability.is_available or (p_schedule is not null and availability.schedule is distinct from p_schedule)
 then return 'capacity_changed';end if;
 select count(*) into current_load from public.conversations where organization_id=p_org and assigned_to_user_id=p_user and status in('open','pending','claimed','ai_handling');
 if current_load>=availability.capacity then return 'capacity_changed';end if;
 perform public.fn_conversation_assign(p_org,p_conversation,p_user,p_reason,null,true);
 return 'assigned';
end;
$$;
revoke all on function public.fn_channel_routing_claim(uuid,uuid,uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.fn_channel_routing_claim(uuid,uuid,uuid,uuid,jsonb,text) to service_role;

-- -- policy conversations_select --
drop policy if exists "conversations_select" on public.conversations;
create policy "conversations_select" on public.conversations
  for select using (
    public.fn_can_view_conversation(organization_id, assigned_to_user_id, sector_id, handover_from_user_id)
  );

notify pgrst, 'reload schema';
