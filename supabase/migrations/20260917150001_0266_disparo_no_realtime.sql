-- 0266 — o disparo programado entra na publicação de realtime
--
-- A tela /app/disparo (lista e histórico) só sabia do desfecho de um envio por
-- polling de 15 s; a de "Agendar" nem isso. O worker grava `pending` → `sending`
-- → `sent|failed|skipped` em `scheduled_group_message_runs` e avança o pai em
-- `scheduled_group_messages`, e nada disso chegava ao navegador até o próximo
-- tick — medido ao vivo em 2026-09-17: envio às 14:45:06, tela parada.
--
-- Sem a tabela na publicação `supabase_realtime`, o `.channel()` sobe, o
-- `subscribe()` devolve SUBSCRIBED e nenhum evento chega, nunca (o modo de
-- falha que `tests/unit/realtime-assinatura-tem-publicacao.test.ts` vigia).
--
-- Só as duas tabelas que mudam de estado publicam. `scheduled_whatsapp_groups`
-- fica fora de propósito: é catálogo reescrito em lote pelo "Listar grupos da
-- conexão", e um sync de 50 grupos viraria 50 pulsos — o "pulso que mente" da
-- 0183. A RLS de SELECT das duas tabelas (0265) é o que filtra o evento por
-- organização do outro lado do socket; o filtro `organization_id=eq.<org>` do
-- cliente é só recorte.
--
-- Sem `replica identity full`: a tela invalida e rebusca a lista, não aplica o
-- payload — o DELETE não precisa carregar a linha inteira no WAL.
--
-- Idempotente: só adiciona se ainda não estiver na publicação. Os dois nomes
-- ficam literais (e não num `format`) porque é assim que o gate do baseline os lê.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'scheduled_group_messages'
  ) then
    execute 'alter publication supabase_realtime add table public.scheduled_group_messages';
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'scheduled_group_message_runs'
  ) then
    execute 'alter publication supabase_realtime add table public.scheduled_group_message_runs';
  end if;
end $$;
