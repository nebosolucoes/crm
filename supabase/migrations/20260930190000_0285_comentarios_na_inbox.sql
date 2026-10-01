-- 0285 — Comentários de Instagram e Facebook na inbox (fase 1: schema)
--
-- Spec docs/specs/22-spec-comentarios-na-inbox.md §2. O mesmo texto (sem a
-- seção 6) está no bloco `comentários na inbox` do apêndice do baseline; a
-- seção 6 lá é a lista ÚNICA de agent_inbox_items_kind_check, editada no lugar.

-- ---- comentários na inbox: tipo de conversa, o que a conexão entrega e o fio do comentário (migration 0285) ----
--
-- Spec: docs/specs/22-spec-comentarios-na-inbox.md (§2). Comentário de post ou
-- anúncio do Instagram/Facebook vira um atendimento na inbox — UM por
-- comentário principal (decisão do dono, 30/09/2026), com as respostas no
-- mesmo fio.
--
-- A trava que este bloco remove: `uniq_conversations_1to1_per_contact_session`
-- permitia UMA conversa por contato em cada conexão. A mesma pessoa que manda
-- Direct e comenta no mesmo Instagram teria o comentário enfiado dentro do
-- Direct. O índice passa a valer só para `kind = 'direct'`; comentário tem o
-- seu, pelo id do comentário raiz.
--
-- Quem dependia do 1:1 e por isso ganha `kind = 'direct'` aqui:
--   * fn_upsert_wa_conversation — o `on conflict` precisa casar o predicado novo;
--   * fn_service_begin / fn_service_observe / fn_service_observe_command /
--     fn_service_event_origin — escolhem "a conversa do contato" para abrir
--     atendimento, comando e automação. Sem o filtro, uma automação que fala
--     com o cliente cairia num fio de comentário e responderia em público.
-- Os corpos são os vigentes no baseline com SÓ esse filtro acrescentado.
--
-- O bloco "B2. Merge de conversas 1:1 duplicadas" (unificação da 0027), que o
-- update.sh reaplica, também passou a olhar só `kind = 'direct'` — sem isso ele
-- fundiria cada fio de comentário no Direct do contato e APAGARIA a conversa do
-- comentário a cada atualização. A coluna é criada lá, antes do B2, pelo mesmo
-- motivo.
--
-- `fn_mesclar_contatos` não muda: ela conta com o índice para detectar colisão
-- de conversa no mesmo canal, e conversa de comentário não colide — é
-- repontada inteira para o contato que fica, que é o certo.
--
-- Idempotente: `add column if not exists`, constraints e índice guardados no
-- catálogo, `create or replace function`.

-- 1 · tipo de conversa ------------------------------------------------------
alter table public.conversations add column if not exists kind text not null default 'direct';

do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.conversations'::regclass
                  and conname = 'conversations_kind_check') then
    alter table public.conversations
      add constraint conversations_kind_check check (kind in ('direct', 'comment'));
  end if;
end $$;

comment on column public.conversations.kind is
  'direct = mensagens (WhatsApp, Direct, Messenger), uma por contato e conexão; comment = um comentário principal de post/anúncio e as respostas dele, cujo id está em provider_conversation_id. Vocabulário em lib/channels/comentarios/vocabulario.ts (TIPOS_DE_CONVERSA). Spec 22.';

-- 2 · o que cada conexão entrega para a inbox --------------------------------
-- Conexão antiga nasce com comentários DESLIGADOS (decisão do dono): ligar
-- sozinho encheria a fila de quem não pediu. Conexão nova grava os dois.
alter table public.channel_sessions add column if not exists inbox_direct boolean not null default true;
alter table public.channel_sessions add column if not exists inbox_comments boolean not null default false;

do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.channel_sessions'::regclass
                  and conname = 'channel_sessions_inbox_comments_social_check') then
    alter table public.channel_sessions
      add constraint channel_sessions_inbox_comments_social_check
      check (not inbox_comments or platform in ('instagram', 'messenger'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.channel_sessions'::regclass
                  and conname = 'channel_sessions_inbox_entrega_algo_check') then
    alter table public.channel_sessions
      add constraint channel_sessions_inbox_entrega_algo_check
      check (inbox_direct or inbox_comments);
  end if;
end $$;

comment on column public.channel_sessions.inbox_direct is
  'A conexão entrega mensagens diretas (Direct/Messenger; no WhatsApp, sempre true). Spec 22 §2.3.';
comment on column public.channel_sessions.inbox_comments is
  'A conexão entrega comentários de posts e anúncios como atendimentos (só Instagram/Messenger). Define os eventos assinados no webhook da Zernio. Spec 22 §2.3.';

-- 3 · o 1:1 vale só para Direct ----------------------------------------------
do $$ begin
  if exists (select 1 from pg_indexes
              where schemaname = 'public'
                and indexname = 'uniq_conversations_1to1_per_contact_session'
                and indexdef not like '%kind%') then
    drop index public.uniq_conversations_1to1_per_contact_session;
  end if;
end $$;

create unique index if not exists uniq_conversations_1to1_per_contact_session
  on public.conversations (organization_id, contact_id, channel_session_id)
  where is_group = false and kind = 'direct';

create unique index if not exists uniq_conversations_comentario_por_raiz
  on public.conversations (organization_id, channel_session_id, provider_conversation_id)
  where kind = 'comment';

-- 4 · upserts ----------------------------------------------------------------
create or replace function public.fn_upsert_wa_conversation(
  p_org uuid, p_contact uuid, p_session uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_channel text;
begin
  select coalesce(platform, 'whatsapp') into v_channel
    from public.channel_sessions where id = p_session and organization_id = p_org;
  insert into public.conversations (organization_id, contact_id, channel_session_id, channel, status, is_group, kind, unread_count_for_assignee, metadata)
  values (p_org, p_contact, p_session, coalesce(v_channel, 'whatsapp'), 'open', false, 'direct', 0, '{}'::jsonb)
  on conflict (organization_id, contact_id, channel_session_id) where is_group = false and kind = 'direct'
  do update set updated_at = now()
  returning id into v_id;
  return v_id;
end; $$;

revoke all on function public.fn_upsert_wa_conversation(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_upsert_wa_conversation(uuid, uuid, uuid) to service_role;

-- O fio de UM comentário principal. `p_contexto` é o post (permalink, texto,
-- miniatura, anúncio) — gravado em metadata.comentario e lido só por
-- lib/channels/comentarios/contexto.ts. Chamada repetida (resposta no mesmo
-- fio, reentrega do webhook) devolve a mesma conversa e completa o contexto.
create or replace function public.fn_upsert_comment_conversation(
  p_org uuid, p_contact uuid, p_session uuid, p_root_comment_id text, p_contexto jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_channel text;
begin
  if p_root_comment_id is null or btrim(p_root_comment_id) = '' then
    raise exception 'comment_root_required' using errcode = '22023';
  end if;
  select platform into v_channel from public.channel_sessions
   where id = p_session and organization_id = p_org and archived_at is null;
  if v_channel is null or v_channel not in ('instagram', 'messenger') then
    raise exception 'comment_session_not_social' using errcode = '22023';
  end if;
  if not exists (select 1 from public.contacts where id = p_contact and organization_id = p_org) then
    raise exception 'comment_contact_not_found' using errcode = 'P0002';
  end if;

  insert into public.conversations (organization_id, contact_id, channel_session_id, channel, status, is_group, kind,
                                    provider_conversation_id, unread_count_for_assignee, metadata)
  values (p_org, p_contact, p_session, v_channel, 'open', false, 'comment',
          p_root_comment_id, 0, jsonb_build_object('comentario', coalesce(p_contexto, '{}'::jsonb)))
  on conflict (organization_id, channel_session_id, provider_conversation_id) where kind = 'comment'
  do update set updated_at = now(),
    metadata = conversations.metadata || jsonb_build_object('comentario',
      coalesce(conversations.metadata->'comentario', '{}'::jsonb) || coalesce(p_contexto, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end; $$;

revoke execute on function public.fn_upsert_comment_conversation(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.fn_upsert_comment_conversation(uuid, uuid, uuid, text, jsonb) to service_role;

-- 5 · atendimento, comando e automação escolhem só Direct ---------------------

create or replace function public.fn_service_begin(p_org uuid,p_contact uuid,p_session uuid default null,p_observed jsonb default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.conversations; sid uuid; v_channel text;
begin
 perform public.fn_service_lock(p_org,p_contact);
 if not exists(select 1 from public.contacts where id=p_contact and organization_id=p_org and not is_anonymized and is_merged_into is null) then
  raise exception 'service_contact_not_found' using errcode='P0002'; end if;
 select * into c from public.conversations where organization_id=p_org and contact_id=p_contact and not is_group and kind='direct'
  and (p_session is null or channel_session_id=p_session) order by last_message_at desc nulls last,created_at desc limit 1 for no key update;
 if p_observed is not null then
   if p_observed->>'organization_id' is distinct from p_org::text or p_observed->>'contact_id' is distinct from p_contact::text then
     raise exception 'service_scope_mismatch' using errcode='23503'; end if;
   if c.id is null then
     if p_observed->>'absent' is distinct from 'true' then raise exception 'service_stale' using errcode='40001'; end if;
   elsif public.fn_service_boundary(p_org,c.id) is distinct from p_observed then
     raise exception 'service_stale' using errcode='40001';
   end if;
 end if;
 if c.id is not null then
   if c.status in ('closed','resolved','archived') then
     c:=public.fn_service_status(p_org,c.id,'open',c.service_revision);
   end if;
   if exists(select 1 from public.demandas where id=c.current_demanda_id and organization_id=p_org and fechada_em is not null) then
     update public.conversations set service_revision=service_revision+1,current_demanda_id=null,service_started_at=clock_timestamp()
      where id=c.id and organization_id=p_org returning * into c;
   end if;
   if c.service_started_at is null then
     update public.conversations set service_revision=service_revision+1,service_started_at=clock_timestamp()
      where id=c.id and organization_id=p_org returning * into c;
   end if;
   return public.fn_service_boundary(p_org,c.id);
 end if;
 select id, platform into sid, v_channel from public.channel_sessions where organization_id=p_org and archived_at is null
  and (p_session is null or id=p_session)
  and (p_session is not null or platform='whatsapp')
  order by (status='WORKING') desc,created_at limit 1;
 if sid is null then raise exception 'service_channel_not_found' using errcode='P0002'; end if;
 insert into public.conversations(organization_id,contact_id,channel_session_id,status,is_group,kind,channel,service_started_at)
  values(p_org,p_contact,sid,'open',false,'direct',coalesce(v_channel,'whatsapp'),clock_timestamp()) returning * into c;
 return public.fn_service_boundary(p_org,c.id);
end; $$;
revoke execute on function public.fn_service_begin(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.fn_service_begin(uuid,uuid,uuid,jsonb) to service_role;

create or replace function public.fn_service_observe(p_org uuid,p_contact uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare cid uuid;
begin
 select id into cid from public.conversations where organization_id=p_org and contact_id=p_contact and not is_group and kind='direct'
  order by last_message_at desc nulls last,created_at desc limit 1;
 if cid is null then return jsonb_build_object('absent',true,'organization_id',p_org,'contact_id',p_contact); end if;
 return public.fn_service_boundary(p_org,cid);
end; $$;
revoke execute on function public.fn_service_observe(uuid,uuid) from public,anon,authenticated;
grant execute on function public.fn_service_observe(uuid,uuid) to service_role;

create or replace function public.fn_service_observe_command(p_org uuid,p_contact uuid)
returns jsonb language sql stable security definer set search_path=public as $$
 with destinations as (
 select s.id sid,c.id cid,c.last_message_at,c.created_at conversation_created,s.created_at session_created,s.status,
 jsonb_build_object('channel_session_id',s.id,'observed',case when c.id is null then
   jsonb_build_object('organization_id',p_org,'contact_id',p_contact,'absent',true)
 else jsonb_build_object('organization_id',c.organization_id,'contact_id',c.contact_id,'conversation_id',c.id,
   'service_revision',c.service_revision,'demanda_id',d.id,'demanda_revision',d.revision,
   'status',c.status,'demanda_fechada_em',d.fechada_em,'service_started_at',c.service_started_at) end) snapshot
 from public.channel_sessions s
 left join public.conversations c on c.organization_id=s.organization_id and c.channel_session_id=s.id and c.contact_id=p_contact and not c.is_group and c.kind='direct'
 left join public.demandas d on d.organization_id=c.organization_id and d.contact_id=c.contact_id and d.id=c.current_demanda_id
 where s.organization_id=p_org and s.archived_at is null
 and exists(select 1 from public.contacts where organization_id=p_org and id=p_contact and not is_anonymized and is_merged_into is null)
 )
 select jsonb_build_object('organization_id',p_org,'contact_id',p_contact,
 'default_session_id',(select sid from destinations order by (cid is not null) desc,last_message_at desc nulls last,conversation_created desc nulls last,(status='WORKING') desc,session_created limit 1),
 'destinations',coalesce((select jsonb_agg(snapshot) from destinations),'[]'::jsonb));
$$;
revoke all on function public.fn_service_observe_command(uuid,uuid) from public,anon,authenticated;
grant execute on function public.fn_service_observe_command(uuid,uuid) to service_role;

create or replace function public.fn_service_event_origin(p_org uuid,p_event uuid,p_contact uuid,p_session uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare e public.event_log; origin jsonb; boundary jsonb; current_boundary jsonb; entity_contact uuid; cid uuid; sid uuid; observed jsonb; root_event uuid:=p_event; visited uuid[]:=array[]::uuid[];
begin
 -- O drain faz claim otimista em outra transação; não conserva row lock.
 -- Não travar event_log: advisory contato antecede os locks de conversa/FKs.
 perform public.fn_service_lock(p_org,p_contact);
 loop
 if root_event = any(visited) or cardinality(visited)>=32 then raise exception 'service_origin_cycle' using errcode='40001'; end if;
 visited:=array_append(visited,root_event);
 boundary:=null;
 entity_contact:=null;
 select * into e from public.event_log where organization_id=p_org and id=root_event;
 if not found then raise exception 'service_event_not_found' using errcode='P0002'; end if;
 if e.event_type in ('lead.created','lead.stage_changed','lead.tag_added') and e.entity_kind='crm_lead' then
   select contact_id into entity_contact from public.crm_leads where organization_id=p_org and id=e.entity_id;
 elsif e.event_type='contact.tag_added' and e.entity_kind='contact' then
   select id into entity_contact from public.contacts where organization_id=p_org and id=e.entity_id;
 elsif e.event_type='appointment.outcome_confirmed' and e.entity_kind='appointment' then
   select contact_id into entity_contact from public.calendar_appointments where organization_id=p_org and id=e.entity_id and revision=(e.payload->>'appointment_revision')::bigint and status='no_show' and outcome_recorded_at is not null;
 elsif e.event_type='message.received' and e.entity_kind='message' then
   select contact_id,jsonb_build_object('organization_id',organization_id,'contact_id',contact_id,
     'conversation_id',conversation_id,'service_revision',service_revision,'demanda_id',demanda_id,'demanda_revision',demanda_revision)
     into entity_contact,boundary from public.messages where organization_id=p_org and id=e.entity_id and direction='inbound';
 else raise exception 'service_event_origin_unsupported' using errcode='40001'; end if;
 if entity_contact is distinct from p_contact or not exists(select 1 from public.contacts where organization_id=p_org and id=p_contact and not is_anonymized and is_merged_into is null) then
   raise exception 'service_scope_mismatch' using errcode='23503'; end if;
 origin:=e.payload->'service_origin';
 if origin->>'kind'='event' then
   if origin->>'organization_id' is distinct from p_org::text or origin->>'contact_id' is distinct from p_contact::text then raise exception 'service_scope_mismatch' using errcode='23503'; end if;
   root_event:=(origin->>'event_id')::uuid;
   if root_event is null then raise exception 'service_stale' using errcode='40001'; end if;
   continue;
 end if;
 exit;
 end loop;
 if boundary is not null or origin->>'kind'='continuation' then
   boundary:=coalesce(boundary,origin->'boundary');
   select channel_session_id into sid from public.conversations where organization_id=p_org and contact_id=p_contact and id=(boundary->>'conversation_id')::uuid;
   if p_session is not null and p_session is distinct from sid then raise exception 'service_channel_mismatch' using errcode='23503'; end if;
 elsif origin->>'kind'='command' then
   observed:=origin->'observed';
   if observed->>'organization_id' is distinct from p_org::text or observed->>'contact_id' is distinct from p_contact::text then raise exception 'service_scope_mismatch' using errcode='23503'; end if;
   if jsonb_typeof(observed->'destinations')='array' then
     sid:=coalesce(p_session,(observed->>'default_session_id')::uuid);
     select item->'observed' into observed from jsonb_array_elements(observed->'destinations') item where item->>'channel_session_id'=sid::text;
   else
     -- Compatibilidade com snapshot anterior: prova somente sua conversa, nunca ausência de outro canal.
     select channel_session_id into sid from public.conversations where organization_id=p_org and contact_id=p_contact and id=(observed->>'conversation_id')::uuid;
     if p_session is not null and p_session is distinct from sid then raise exception 'service_channel_mismatch' using errcode='23503'; end if;
   end if;
 else raise exception 'service_stale' using errcode='40001'; end if;
 if sid is null then raise exception 'service_stale' using errcode='40001'; end if;
 if not exists(select 1 from public.channel_sessions where id=sid and organization_id=p_org and archived_at is null) then raise exception 'service_channel_mismatch' using errcode='23503'; end if;
 if boundary is null and observed is null then raise exception 'service_stale' using errcode='40001'; end if;
 select service_boundary into current_boundary from public.event_service_origins where organization_id=p_org and event_id=root_event and channel_session_id=sid;
 if found then boundary:=current_boundary;
 elsif boundary is null then
   -- PARA UM EVENTO, `absent` E PROCEDENCIA — NAO REIVINDICACAO DE ESTADO.
   --
   -- O CAS de `fn_service_begin` existe para que dois ATORES com a mesma
   -- observacao "ausente" nao ajam os dois: o segundo tem de perder, e o
   -- invariante de `fn_service_begin` guarda isso. Um evento e outra coisa: o
   -- retrato `absent` diz "quando este evento foi EMITIDO nao havia
   -- atendimento", e a resolucao de cada evento ja e idempotente pelo memo
   -- `event_service_origins` logo acima — nao ha corrida a arbitrar aqui.
   --
   -- Sem esta distincao o caminho ORDINARIO morria: um lead criado e depois
   -- movido de etapa gera DOIS eventos, cada um com seu retrato `absent`;
   -- resolver o primeiro cria a conversa e o segundo levantava 40001 — que
   -- `serviceForEvent` engole como `stale_origin`, entao o follow-up de etapa
   -- simplesmente nao nascia, sem erro em lugar nenhum.
   --
   -- Zerar `observed` so quando a conversa JA existe mantem o CAS de pe para o
   -- retrato que descreve uma fronteira concreta (esse continua sendo conferido
   -- contra a vigente) e para todo chamador direto de `fn_service_begin`.
   if observed->>'absent' = 'true' and exists(
        select 1 from public.conversations
         where organization_id=p_org and contact_id=p_contact
           and channel_session_id=sid and not is_group and kind='direct') then
     observed:=null;
   end if;
   boundary:=public.fn_service_begin(p_org,p_contact,sid,observed) - 'status' - 'demanda_fechada_em' - 'service_started_at';
 end if;
 if boundary->>'organization_id' is distinct from p_org::text or boundary->>'contact_id' is distinct from p_contact::text then
   raise exception 'service_scope_mismatch' using errcode='23503'; end if;
 cid:=(boundary->>'conversation_id')::uuid;
 if p_session is not null and not exists(select 1 from public.conversations where organization_id=p_org and id=cid and contact_id=p_contact and channel_session_id=p_session) then
   raise exception 'service_channel_mismatch' using errcode='23503'; end if;
 current_boundary:=public.fn_service_boundary(p_org,cid);
 if current_boundary is null or current_boundary->>'status' in ('closed','resolved','archived')
   or current_boundary->>'demanda_fechada_em' is not null
   or (current_boundary - 'status' - 'demanda_fechada_em' - 'service_started_at') is distinct from boundary then
   raise exception 'service_stale' using errcode='40001'; end if;
 insert into public.event_service_origins(event_id,channel_session_id,organization_id,service_boundary) values(root_event,sid,p_org,boundary)
 on conflict(event_id,channel_session_id) do nothing;
 return boundary;
end; $$;
revoke all on function public.fn_service_event_origin(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.fn_service_event_origin(uuid,uuid,uuid,uuid) to service_role;

-- 6 · Central de avisos — kind 'comment_unanswered' (lista ÚNICA, reconstruída
--     inteira: tests/unit/kind-check-migration-x-baseline.test.ts)
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
    'comment_unanswered',
    'other'
  ));

notify pgrst, 'reload schema';
