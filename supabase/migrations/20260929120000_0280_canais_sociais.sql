-- 0280 — Instagram Direct e Facebook Messenger (fase 1: schema).
--
-- Spec: docs/specs/21-spec-direct-e-messenger.md. O mesmo texto está no bloco
-- `-- ---- canais sociais ... (migration 0280) ----` do apêndice do baseline.

-- ---- canais sociais: plataforma da sessão, identidade social do contato e chave do intermediário (migration 0280) ----
--
-- Spec: docs/specs/21-spec-direct-e-messenger.md, §2.
--
-- O que entra:
--   * `channel_sessions.platform` — COM QUE REDE a sessão fala
--     (`whatsapp` | `instagram` | `messenger`). `provider` continua dizendo
--     QUEM transporta. Só o intermediário (`zernio`) fala com rede que não é
--     WhatsApp; o CHECK cruzado recusa um WAHA "de Instagram".
--   * `conversations_channel_check` passa a aceitar as três redes. A coluna
--     sempre existiu com esse propósito (spec 03: "prep multi-canal").
--   * `contact_platform_identities` — quem a pessoa é NA REDE (IGSID/PSID,
--     @usuário). Não reusa `wa_lid`/`wa_identity`: são namespaces diferentes,
--     e um id de Instagram na correlação do WhatsApp poderia casar a pessoa
--     errada. DIRC: integra (aponta para o contato), não duplica.
--   * `fn_upsert_social_contact` — reencontra ou cria o contato pela
--     identidade social, resolvendo a corrida de dois webhooks simultâneos.
--   * `channel_provider_keys` — a chave de API do intermediário, UMA por
--     organização, cifrada. Só o service role alcança; a chave nunca volta
--     numa leitura. Cada sessão conectada copia a cifra para
--     `zernio_token_encrypted`, que é de onde o envio já lê.
--   * `fn_upsert_wa_conversation` e `fn_service_begin` gravam o canal da
--     SESSÃO, não o literal 'whatsapp'; e `fn_service_begin`, quando escolhe a
--     sessão sozinho, escolhe uma de WhatsApp — o destino ali é um contato
--     por telefone, e DM não se abre a frio.
--
-- Com zero conexões sociais nada muda: toda sessão existente ganha
-- `platform='whatsapp'` pelo default, e as funções redefinidas gravam o mesmo
-- 'whatsapp' de antes.
--
-- Idempotente: `add column if not exists`, `drop constraint if exists` antes
-- de `add constraint`, `create ... if not exists`, `create or replace`.

-- 1 · a rede da sessão ------------------------------------------------------
alter table public.channel_sessions
  add column if not exists platform text not null default 'whatsapp';

alter table public.channel_sessions
  drop constraint if exists channel_sessions_platform_check;
alter table public.channel_sessions
  add constraint channel_sessions_platform_check
  check (platform in ('whatsapp', 'instagram', 'messenger'));

-- Só o intermediário transporta rede que não é WhatsApp. Nenhuma linha
-- existente viola: todas acabaram de receber 'whatsapp' pelo default.
alter table public.channel_sessions
  drop constraint if exists channel_sessions_platform_provider_check;
alter table public.channel_sessions
  add constraint channel_sessions_platform_provider_check
  check (platform = 'whatsapp' or provider = 'zernio');

comment on column public.channel_sessions.platform is
  'Com que rede a sessão fala: whatsapp | instagram | messenger. `provider` diz quem transporta. Vocabulário em lib/channels/plataformas.ts. Spec 21.';

-- 2 · a rede da conversa ----------------------------------------------------
alter table public.conversations
  drop constraint if exists conversations_channel_check;
alter table public.conversations
  add constraint conversations_channel_check
  check (channel in ('whatsapp', 'instagram', 'messenger'));

-- 3 · identidade social do contato -------------------------------------------
create table if not exists public.contact_platform_identities (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  contact_id         uuid not null references public.contacts(id) on delete cascade,
  platform           text not null,
  -- IGSID / PSID: escopado à conta conectada, opaco, estável.
  platform_user_id   text not null,
  -- Por onde a identidade apareceu primeiro. `set null` ao apagar a sessão:
  -- a pessoa continua sendo quem é.
  channel_session_id uuid references public.channel_sessions(id) on delete set null,
  -- @usuário e nome mudam quando a pessoa quer: servem para EXIBIR, nunca para
  -- casar. Quem casa é `platform_user_id`.
  username           text,
  display_name       text,
  avatar_url         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint contact_platform_identities_platform_check
    check (platform in ('instagram', 'messenger')),
  constraint contact_platform_identities_user_id_check
    check (length(btrim(platform_user_id)) between 1 and 200)
);

create unique index if not exists uniq_contact_platform_identities_org_platform_user
  on public.contact_platform_identities (organization_id, platform, platform_user_id);
create index if not exists idx_contact_platform_identities_contact
  on public.contact_platform_identities (contact_id);

comment on table public.contact_platform_identities is
  'Quem o contato é numa rede social (Instagram, Messenger): id escopado à conta conectada + @usuário para exibir. Escrita só pelo service role (fn_upsert_social_contact). Spec 21 §2.2.';

-- Leitura para todo membro da organização (a inbox mostra o @usuário);
-- escrita só pelo service role, pela RPC abaixo.
alter table public.contact_platform_identities enable row level security;
revoke all on public.contact_platform_identities from public, anon, authenticated;
grant select on public.contact_platform_identities to authenticated;
grant select, insert, update, delete on public.contact_platform_identities to service_role;

drop policy if exists tenant_isolation_contact_platform_identities_select on public.contact_platform_identities;
create policy tenant_isolation_contact_platform_identities_select on public.contact_platform_identities
  for select to authenticated
  using (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin());

-- LGPD: anonimizar o contato apaga quem ele é na rede. Se a pessoa escrever de
-- novo, nasce um contato novo — que é o que a anonimização promete.
create or replace function public.fn_apagar_identidade_social_do_contato_anonimizado()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.contact_platform_identities
   where organization_id = new.organization_id
     and contact_id = new.id;
  return new;
end;
$$;

revoke execute on function public.fn_apagar_identidade_social_do_contato_anonimizado() from public, anon, authenticated;
grant execute on function public.fn_apagar_identidade_social_do_contato_anonimizado() to service_role;

drop trigger if exists trg_apagar_identidade_social_ao_anonimizar on public.contacts;
create trigger trg_apagar_identidade_social_ao_anonimizar
  after update of is_anonymized on public.contacts
  for each row
  when (new.is_anonymized is true and old.is_anonymized is distinct from true)
  execute function public.fn_apagar_identidade_social_do_contato_anonimizado();

-- 4 · reencontrar ou criar o contato pela identidade social ------------------
--
-- Segue `is_merged_into`: contato fundido depois que a identidade nasceu
-- continua sendo alcançado pelo sobrevivente. O @usuário e o nome são
-- atualizados a cada evento (a pessoa troca), mas o `display_name` do CONTATO
-- só é preenchido quando vazio — a correção feita à mão na tela vence.
create or replace function public.fn_upsert_social_contact(
  p_org uuid, p_platform text, p_user_id text, p_session uuid, p_username text, p_name text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_contact uuid;
  v_user text := nullif(btrim(coalesce(p_user_id, '')), '');
  v_username text := nullif(btrim(coalesce(p_username, '')), '');
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
begin
  if v_user is null or p_platform not in ('instagram', 'messenger') then
    return null;
  end if;

  -- Dois webhooks da MESMA pessoa ao mesmo tempo (mensagem + eco, reentrega)
  -- esperam um pelo outro aqui, até o fim da transação. Sem a trava, os dois
  -- criariam um contato cada e um deles ficaria órfão. A trava é por
  -- identidade, então pessoas diferentes nunca se esperam.
  perform pg_advisory_xact_lock(hashtextextended(p_org::text || ':' || p_platform || ':' || v_user, 0));

  select coalesce(c.is_merged_into, c.id) into v_contact
    from public.contact_platform_identities i
    join public.contacts c on c.id = i.contact_id
   where i.organization_id = p_org and i.platform = p_platform and i.platform_user_id = v_user;

  if v_contact is not null then
    update public.contact_platform_identities set
      contact_id = v_contact,
      username = coalesce(v_username, username),
      display_name = coalesce(v_name, display_name),
      updated_at = now()
     where organization_id = p_org and platform = p_platform and platform_user_id = v_user;
    update public.contacts set
      display_name = coalesce(display_name, v_name, v_username),
      updated_at = now()
     where id = v_contact and organization_id = p_org;
    return v_contact;
  end if;

  insert into public.contacts (organization_id, source, consent, tags, source_metadata, display_name)
  values (p_org, p_platform, '{}'::jsonb, '{}'::text[],
          jsonb_build_object('platform', p_platform, 'username', v_username),
          coalesce(v_name, v_username))
  returning id into v_contact;

  insert into public.contact_platform_identities
    (organization_id, contact_id, platform, platform_user_id, channel_session_id, username, display_name)
  values (p_org, v_contact, p_platform, v_user, p_session, v_username, v_name);

  return v_contact;
end; $$;

revoke execute on function public.fn_upsert_social_contact(uuid, text, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.fn_upsert_social_contact(uuid, text, text, uuid, text, text) to service_role;

-- 5 · a chave do intermediário, uma por organização -------------------------
create table if not exists public.channel_provider_keys (
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  provider          text not null,
  -- fn_encrypt_oauth, a mesma cifra de `zernio_token_encrypted`.
  api_key_encrypted bytea not null,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (organization_id, provider),
  constraint channel_provider_keys_provider_check check (provider in ('zernio'))
);

comment on table public.channel_provider_keys is
  'Chave de API do intermediário de canais, uma por organização, cifrada (fn_encrypt_oauth). Server-side only: RLS ligada, zero policy e zero grant a anon/authenticated. Spec 21 §2.3.';

alter table public.channel_provider_keys enable row level security;
revoke all on public.channel_provider_keys from public, anon, authenticated;
grant select, insert, update, delete on public.channel_provider_keys to service_role;

-- 6 · a conversa nasce com a rede da sessão ---------------------------------
create or replace function public.fn_upsert_wa_conversation(
  p_org uuid, p_contact uuid, p_session uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_channel text;
begin
  select coalesce(platform, 'whatsapp') into v_channel
    from public.channel_sessions where id = p_session and organization_id = p_org;
  insert into public.conversations (organization_id, contact_id, channel_session_id, channel, status, is_group, unread_count_for_assignee, metadata)
  values (p_org, p_contact, p_session, coalesce(v_channel, 'whatsapp'), 'open', false, 0, '{}'::jsonb)
  on conflict (organization_id, contact_id, channel_session_id) where is_group = false
  do update set updated_at = now()
  returning id into v_id;
  return v_id;
end; $$;

revoke all on function public.fn_upsert_wa_conversation(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_upsert_wa_conversation(uuid, uuid, uuid) to service_role;

create or replace function public.fn_service_begin(p_org uuid,p_contact uuid,p_session uuid default null,p_observed jsonb default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.conversations; sid uuid; v_channel text;
begin
 perform public.fn_service_lock(p_org,p_contact);
 if not exists(select 1 from public.contacts where id=p_contact and organization_id=p_org and not is_anonymized and is_merged_into is null) then
  raise exception 'service_contact_not_found' using errcode='P0002'; end if;
 select * into c from public.conversations where organization_id=p_org and contact_id=p_contact and not is_group
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
 insert into public.conversations(organization_id,contact_id,channel_session_id,status,is_group,channel,service_started_at)
  values(p_org,p_contact,sid,'open',false,coalesce(v_channel,'whatsapp'),clock_timestamp()) returning * into c;
 return public.fn_service_boundary(p_org,c.id);
end; $$;
revoke execute on function public.fn_service_begin(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.fn_service_begin(uuid,uuid,uuid,jsonb) to service_role;

-- 7 · a cascata de LGPD alcança a identidade social --------------------------
-- `fn_lgpd_cascade_redact_contact` é o caminho que o redator executa e o que
-- `tests/invariants/lgpd-cascata-alcanca-quem-guarda-pessoa.test.ts` lê. O
-- gatilho do passo 3 cobre os OUTROS caminhos que marcam `is_anonymized`; este
-- passo põe a tabela na cascata e na contagem que o audit grava. Corpo idêntico
-- ao da 0235, com o passo 7c acrescentado.
CREATE OR REPLACE FUNCTION "public"."fn_lgpd_cascade_redact_contact"("p_organization_id" "uuid", "p_contact_id" "uuid", "p_request_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_already bool;
  v_counts jsonb := '{}'::jsonb;
  v_media_paths text[] := '{}';
  v_anon_label text;
  v_count int;
begin
  perform public.fn_service_lock(p_organization_id,p_contact_id);
  select is_anonymized into v_already
    from contacts
    where id = p_contact_id and organization_id = p_organization_id;

  if not found then
    raise exception 'contact not found' using errcode = 'P0002';
  end if;

  if v_already then
    return jsonb_build_object('already_anonymized', true, 'counts', v_counts, 'media_paths', v_media_paths);
  end if;

  v_anon_label := 'Cliente Anonimizado #' || substring(p_contact_id::text from 1 for 8);

  -- Collect media storage paths (we only delete what we own — media_storage_path)
  select coalesce(array_agg(distinct media_storage_path) filter (where media_storage_path is not null), '{}')
    into v_media_paths
    from messages
    where organization_id = p_organization_id
      and conversation_id in (
        select id from conversations
          where contact_id = p_contact_id and organization_id = p_organization_id
      );

  -- 1. contacts (irreversible)
  update contacts set
    name = v_anon_label,
    display_name = v_anon_label,
    email = null,
    -- email_normalized NÃO entra: é GENERATED ALWAYS AS (lower(trim(email)))
    -- e o Postgres recusa escrita nela — a linha acima já a zera por derivação.
    -- Com a atribuição, o cascade INTEIRO abortava e nada era anonimizado.
    phone_number = null,
    cpf_encrypted = null,
    cpf_hash = null,
    birthdate = null,
    is_anonymized = true,
    anonymized_at = now(),
    consent = '{}'::jsonb,
    source_metadata = '{}'::jsonb,
    tags = '{}'::text[],
    updated_at = now()
  where id = p_contact_id and organization_id = p_organization_id;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('contacts', v_count);

  -- 2. conversations metadata + preview strip
  update conversations set
    metadata = '{}'::jsonb,
    last_message_preview = null,
    updated_at = now()
  where contact_id = p_contact_id and organization_id = p_organization_id;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('conversations', v_count);

  -- 3. messages: redact body + null media + strip metadata (preserve status/timestamps/conversation_id)
  update messages set
    body = '[mensagem anonimizada]',
    media_url = null,
    media_mime = null,
    media_size_bytes = null,
    media_storage_path = null,
    metadata = '{}'::jsonb,
    updated_at = now()
  where organization_id = p_organization_id
    and conversation_id in (
      select id from conversations
        where contact_id = p_contact_id and organization_id = p_organization_id
    );
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('messages', v_count);

  -- 4. crm_lead_activities — strip payload, metadata E reason (migration 0071).
  --    `reason` é texto livre escrito por LLM sobre a conversa do lead: supor que
  --    nunca conterá um nome é a suposição que falha. `evidence` NÃO é limpa —
  --    guarda só ids, e as linhas apontadas são redigidas por conta própria.
  update crm_lead_activities set
    payload = '{}'::jsonb,
    metadata = '{}'::jsonb,
    reason = null
  where organization_id = p_organization_id
    and (
      contact_id = p_contact_id
      or lead_id in (
        select lead_id from crm_lead_links
          where target_kind = 'contact'
            and target_id = p_contact_id
            and organization_id = p_organization_id
      )
      or lead_id in (
        select id from crm_leads
          where contact_id = p_contact_id and organization_id = p_organization_id
      )
    );
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('activities', v_count);

  -- 5. crm_leads — strip title/description/custom_fields/source_metadata/tags but PRESERVE pipeline/stage/value
  update crm_leads set
    title = v_anon_label,
    description = null,
    custom_fields = '{}'::jsonb,
    source_metadata = '{}'::jsonb,
    tags = '{}'::text[],
    updated_at = now()
  where organization_id = p_organization_id
    and (
      contact_id = p_contact_id
      or id in (
        select lead_id from crm_lead_links
          where target_kind = 'contact'
            and target_id = p_contact_id
            and organization_id = p_organization_id
      )
    );
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('leads', v_count);

  -- 6. orders — PRESERVE values + status + timestamps. Strip personal fields from payload jsonb
  --    and replace customer_external_id with null (FK-safe; soft de-link). Keep contact_id null.
  update orders set
    payload = (coalesce(payload, '{}'::jsonb))
      - 'customer'
      - 'customer_name'
      - 'customer_email'
      - 'customer_phone'
      - 'shipping_address'
      - 'billing_address'
      - 'contact_identification',
    customer_external_id = null,
    contact_id = null,
    is_anonymized = true,
    updated_at = now()
  where organization_id = p_organization_id
    and contact_id = p_contact_id;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('orders', v_count);

  -- 7. enqueue media for async deletion (idempotent via unique (bucket, object_path))
  if array_length(v_media_paths, 1) > 0 then
    insert into storage_redaction_queue (organization_id, request_id, bucket, object_path)
    select p_organization_id, p_request_id, 'whatsapp-media', path
      from unnest(v_media_paths) as path
      where path is not null and length(path) > 0
    on conflict (bucket, object_path) do nothing;
  end if;

  -- 7b. voice_calls — o TELEFONE de quem falou ao telefone (migration 0235).
  --
  -- `peer_phone` é `not null` e guarda o número da outra ponta: depois de
  -- anonimizar o contato, ele sobrevivia ligado ao `contact_id` e reidentificava
  -- a pessoa que pediu para ser esquecida. É o mesmo argumento que a foto de
  -- perfil já tinha (ver o bloco do avatar em `lib/lgpd/redact-cascade.ts`):
  -- anonimizar em toda parte menos numa é não ter anonimizado.
  --
  -- O que fica: direção, status, motivo do fim, marcas de tempo e duração. Um
  -- registro de "houve uma chamada de 12 minutos" sem número e sem dono não
  -- identifica ninguém e é o que sustenta a métrica do atendente e a fatura.
  -- `peer_phone` é NOT NULL, então recebe o rótulo, não `null`.
  update voice_calls set
    peer_phone = v_anon_label,
    owner_user_id = null,
    created_by = null,
    updated_at = now()
  where organization_id = p_organization_id
    and contact_id = p_contact_id;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('voice_calls', v_count);

  -- 7c. contact_platform_identities — quem a pessoa é no Instagram/Messenger
  -- (migration 0280, spec 21). O IGSID/PSID e o @usuário reidentificam quem
  -- pediu para ser esquecido; apagar (não rotular) porque a linha só existe
  -- para casar a próxima mensagem com este contato — e a promessa da
  -- anonimização é justamente que ela não case mais.
  delete from contact_platform_identities
  where organization_id = p_organization_id
    and contact_id = p_contact_id;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('platform_identities', v_count);

  -- 8. dense audit row
  insert into api_audit_log (organization_id, action, actor_user_id, resource_type, resource_id, metadata, bypassed_rls)
  values (
    p_organization_id,
    'lgpd.redact_executed',
    null,
    'contact',
    p_contact_id,
    jsonb_build_object(
      'cascaded_to', v_counts,
      'media_queued', coalesce(array_length(v_media_paths, 1), 0),
      'request_id', p_request_id
    ),
    true
  );

  return jsonb_build_object(
    'already_anonymized', false,
    'counts', v_counts,
    'media_paths', v_media_paths
  );
end;
$$;
revoke all on function public.fn_lgpd_cascade_redact_contact(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.fn_lgpd_cascade_redact_contact(uuid,uuid,uuid) to service_role;

-- ---- travas do modo somente leitura do suporte nas tabelas novas ----
-- Mesma razão da 0278: na CADEIA ninguém replanta as travas depois da 0274, e
-- `contact_platform_identities`/`channel_provider_keys` nasceriam sem elas. No
-- baseline quem planta é o último bloco do arquivo. Guardado pela existência
-- da função.
do $f$
begin
  if to_regprocedure('public.fn_aplicar_travas_de_suporte()') is not null then
    perform public.fn_aplicar_travas_de_suporte();
  end if;
end $f$;
