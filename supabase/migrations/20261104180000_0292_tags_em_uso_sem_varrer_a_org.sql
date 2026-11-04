-- 0292 — As etiquetas em uso sem passar a RLS em cada conversa, e o webhook de erro só com 5xx por padrão
--
-- ─── 1. `fn_tags_de_conversa_em_uso` ────────────────────────────────────────
--
-- Produção, 30/10 a 04/11/2026: 10 statement timeouts em
-- `GET /api/v1/conversation-tags`. A versão da 0244 era INVOKER e fazia
-- `select distinct t from conversations, unnest(tags)` na organização inteira:
-- a RLS de `conversations` (`fn_can_view_conversation`, de 4 a 7 buscas) rodava
-- em CADA conversa com etiqueta, e o `limit 200` só valia depois do `distinct`.
--
-- Agora o custo é por ETIQUETA, não por conversa:
--   (a) as etiquetas distintas da organização saem sem RLS — é só um `unnest`;
--   (b) cada uma só é devolvida se EXISTIR uma conversa com ela que a pessoa
--       pode ver, pela MESMA regra da policy `conversations_select`
--       (`fn_can_view_conversation(organization_id, assigned_to_user_id,
--       sector_id, handover_from_user_id)`), que é a ÚNICA policy de SELECT da
--       tabela — as restritivas do suporte são só de escrita. O `exists` para
--       na primeira conversa visível e usa `idx_conversations_tags_gin`.
--
-- O resultado é o mesmo da versão invoker, caso a caso: uma etiqueta aparece se
-- e só se a pessoa enxerga ao menos uma conversa com ela. Provado em
-- `tests/invariants/tags-em-uso-aparecem-no-filtro.test.ts`, que compara a
-- função com a consulta direta sob a RLS para cada papel.
--
-- ⛔ Por que DEFINER agora é seguro (a 0244 explica por que não era): a
-- organização vem por argumento, mas nada sai sem passar por
-- `fn_can_view_conversation`, que usa `auth.uid()` — quem não é membro de
-- `p_org` não vê conversa nenhuma dela, logo não recebe etiqueta nenhuma. A
-- guarda de entrada (`fn_user_role_in_org`) só evita fazer o trabalho (a) para
-- quem não é membro; a fronteira de segurança é (b). `stable`, sem escrita.
--
-- ─── 2. `platform_error_webhook.scope` passa a nascer `server` ──────────────
--
-- Com `all`, todo 401/403/404/422 de regra de negócio virava card na central
-- de chamados (29 dos 40 cards restantes de 04/11). Muda só o PADRÃO de
-- instalação nova: a linha que já existe guarda a escolha de quem configurou.
--
-- Idempotente.

create or replace function public.fn_tags_de_conversa_em_uso(p_org uuid)
returns table (tag text)
language sql
stable
security definer
set search_path = public
as $$
  with candidatas as (
    select distinct t
      from public.conversations c, unnest(c.tags) as t
     where c.organization_id = p_org
       and cardinality(c.tags) > 0
       -- Uma vez por consulta (InitPlan), não por linha.
       and (select public.fn_is_platform_admin() or public.fn_user_role_in_org(p_org) is not null)
  )
  select k.t as tag
    from candidatas k
   where exists (
     select 1
       from public.conversations c
      where c.organization_id = p_org
        and c.tags @> array[k.t]
        and public.fn_can_view_conversation(
              c.organization_id, c.assigned_to_user_id, c.sector_id, c.handover_from_user_id)
   )
   order by k.t
   -- Teto: numa organização bagunçada a união poderia crescer sem limite, e esta
   -- lista vai para um seletor de tela.
   limit 200;
$$;

comment on function public.fn_tags_de_conversa_em_uso(uuid)
  is 'Etiquetas de conversa em uso na organização que o chamador enxerga em ao menos uma conversa (mesma regra de conversations_select). Definer por desempenho; a fronteira é fn_can_view_conversation (migration 0292).';

revoke execute on function public.fn_tags_de_conversa_em_uso(uuid) from public, anon;
grant  execute on function public.fn_tags_de_conversa_em_uso(uuid) to authenticated, service_role;

alter table public.platform_error_webhook alter column scope set default 'server';

notify pgrst, 'reload schema';
