-- 0291 — A caixa de entrada e a poda diária sob carga (erros de 03–04/11/2026)
--
-- Em 36 h de produção: 515 statement timeouts na lista de conversas (aba Fila),
-- 460 na contagem das abas e o pool do PostgREST esgotado duas vezes. A RLS de
-- `conversations` é avaliada linha a linha, então o que mais pesa é QUANTAS
-- linhas chegam até ela. Esta migration ataca isso do lado do banco; o código
-- (`comRecorteDoComando`) já manda os predicados que estes índices esperam.
--
-- 1. Índice da Fila. A aba pede `comando_da_conversa in (aguardando[,automatico])`
--    e o código acrescenta o que esse comando já implica: sem dono e não
--    encerrada. O `idx_conversations_open_unassigned` do baseline exige
--    `status = 'open'` e por isso não serve. O predicado abaixo é o MESMO texto
--    que o PostgREST gera a partir de `STATUS_ENCERRADOS`
--    (`lib/inbox/comando-da-conversa.ts`), na mesma ordem: sem isso o planner
--    não prova que a consulta cabe no índice parcial. A coluna de ordem é a da
--    Fila (`ORDEM_DA_ESPERA`: `last_inbound_at` asc, nulls last).
--
-- 2. Índice das conversas vivas ("Todas" e "Minhas" na contagem e na lista):
--    `status not in ('closed','archived')`, que é `CONVERSATION_TERMINAL_STATUSES`.
--    Corta o histórico encerrado antes da RLS.
--
-- 3. `comando_da_conversa(c)`: uma busca em `contacts` por linha, não duas. A
--    regra continua em `fn_comando_da_conversa`, intocada (o espelho com o
--    TypeScript é vigiado por `comando-da-conversa-espelha-o-ts.test.ts`).
--
-- 4. `ai_reply_drafts.send_job_id` passa a ser `on delete set null`. Nasceu na
--    0227 sem `on delete`, então a poda diária (`fn_podar_fila_de_jobs`) falharia
--    por FK assim que um job `approved_reply` terminado passasse da retenção
--    (90 dias, a partir de dez/2026) — e o lote inteiro iria junto. O rascunho
--    não perde nada: o envio já aconteceu e o vínculo com a mensagem fica em
--    `message_id`. Condicional: o baseline é reaplicado a cada deploy, e recriar
--    a FK revalidaria a tabela inteira toda vez.
--
-- Idempotente. Sem `concurrently` porque o runner envolve em transação; o
-- `deploy-nebo.sh` para app/worker/scheduler antes de reaplicar o baseline.

create index if not exists idx_conversations_fila_sem_dono
  on public.conversations (organization_id, last_inbound_at, id)
  where assigned_to_user_id is null
    and status not in ('closed', 'archived', 'resolved');

create index if not exists idx_conversations_vivas
  on public.conversations (organization_id, assigned_to_user_id)
  where status not in ('closed', 'archived');

create or replace function public.comando_da_conversa(c public.conversations)
returns text
language sql
stable
set search_path = public
as $comando$
  select public.fn_comando_da_conversa(
    c.status,
    c.assigned_to_user_id,
    c.bot_silenced_until,
    -- `coalesce` porque `contact_id` é anulável no schema: contato ausente não pode
    -- virar `null` e derrubar a linha inteira para fora de todo filtro — o efeito
    -- seria uma conversa invisível em TODAS as abas. O `left join` com `(select 1)`
    -- garante uma linha mesmo sem contato.
    coalesce(ct.force_human, false),
    coalesce(ct.is_blocked, false),
    now()
  )
  from (select 1) as uma_linha
  left join public.contacts ct on ct.id = c.contact_id;
$comando$;

comment on function public.comando_da_conversa(public.conversations)
  is 'Campo calculado exposto pelo PostgREST: ?select=comando_da_conversa e ?comando_da_conversa=in.(...). Resolve o contato (uma busca) e carimba now(); a regra em si é fn_comando_da_conversa.';

revoke execute on function public.comando_da_conversa(public.conversations) from public, anon;
grant execute on function public.comando_da_conversa(public.conversations) to authenticated, service_role;

do $fk$
begin
  if exists (
    select 1
      from pg_constraint
     where conrelid = 'public.ai_reply_drafts'::regclass
       and contype = 'f'
       and conname = 'ai_reply_drafts_send_job_id_fkey'
       and confdeltype <> 'n'
  ) then
    alter table public.ai_reply_drafts drop constraint ai_reply_drafts_send_job_id_fkey;
  end if;
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.ai_reply_drafts'::regclass
       and conname = 'ai_reply_drafts_send_job_id_fkey'
  ) then
    alter table public.ai_reply_drafts
      add constraint ai_reply_drafts_send_job_id_fkey
      foreign key (send_job_id) references public.job_queue(id) on delete set null;
  end if;
end
$fk$;

notify pgrst, 'reload schema';
