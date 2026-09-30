# Spec 23 — Publicações (social publisher: WhatsApp, Instagram e Facebook)

> Status: **implementado na migration 0283** (30/09/2026). Sucede o Disparo (spec informal da 0265, jornada J28).
> Plano de origem e decisões D1–D14: `~/.claude/plans/pasted-content-id-ca34-evolu-o-vast-naur.md` (fora do repo).
> Mapa vivo: `docs/architecture/publicacoes.architecture.json`. Jornada: `docs/testing/user-journey-map.md` J31.

## 1. O que é

Uma ferramenta única de planejamento de conteúdo: a pessoa cria **uma publicação** (arquivos em ordem + legenda) e escolhe **onde** sai (grupos do WhatsApp; Feed, Stories e Reels do Instagram e do Facebook), **quando** (várias datas) e **com que repetição**. O sistema executa cada destino de forma independente e mostra o desfecho por destino, conta e grupo.

Vocabulário fixo, usado em todo o código e na tela:

| Termo | Tabela | O que é |
|---|---|---|
| **Publicação** | `publications` | o conteúdo: título, legenda, fuso, regra de recorrência, ciclo de vida |
| **Mídia** | `publication_media` | os arquivos, em ordem (`position numeric`), com dicas de dimensão/duração |
| **Destino** | `publication_targets` (+ `publication_target_groups`) | (rede, formato, conexão); WhatsApp liga grupos por FK tripla org+sessão+grupo |
| **Ocorrência** | `publication_occurrences` | cada data/hora; `source manual|recurrence`; status é o **rollup** das execuções |
| **Destinos da ocorrência** | `publication_occurrence_targets` (0284) | o SUBCONJUNTO de destinos que sai naquela data. **Sem linha = todos** (é o que a recorrência gera e o que o legado tem). A tela manda `occurrences[{scheduled_at, targets: chaves|null}]`; o worker filtra a expansão por aqui |
| **Execução** | `publication_executions` | uma por ocorrência × destino (× grupo no WhatsApp; × arquivo em Stories), por tentativa; a única linha com id externo |

Máquina de estados (a verdade está embaixo):

```
publications.status:  draft → scheduled → completed | cancelled   (+ deleted_at = soft delete)
occurrences.status:   pending → processing → done | partial | failed | skipped | cancelled
executions.status:    pending → sending → sent | failed | skipped | cancelled   (retry = attempt+1)
```

A publicação **nunca** "é publicada"; a ocorrência é. "Instagram ✓ · Facebook ✗ · WhatsApp 3/4" é a leitura de uma ocorrência.

## 2. Onde cada coisa mora

| Camada | Caminho | Responsabilidade |
|---|---|---|
| Schema + vocabulário | `supabase/migrations/20260930150000_0283_publicacoes.sql`, apêndice no `baseline.sql`, `lib/publicacoes/schema.ts` | tabelas, CHECKs, RLS, `fn_claim_publication_executions`, `fn_rollup_publication_occurrence`, realtime, kind `publication_failed`, cópia idempotente do legado |
| Política | `lib/publicacoes/politica.ts` | tolerância de 30 min, horizonte 90 d / 100 pendentes, 3 tentativas (1/5/15 min), lease 300 s, pausas anti-abuso, orçamento do tick |
| Regras por formato | `lib/publicacoes/regras-por-destino.ts` | tabela **neutra** (rede, formato, contagem, mime, tamanho, duração, proporção); a tela pré-checa, a API confere de novo |
| Recorrência | `lib/publicacoes/recorrencia.ts` | regra → datas em **hora de parede** no fuso da publicação (`instanteDe` de `lib/agenda/fuso.ts`) |
| Serviço de domínio | `lib/publicacoes/servico.ts` | criar/editar/cancelar/excluir/reagendar/reenviar, contas publicáveis, listagens, materialização |
| API | `app/api/v1/publicacoes/**` | `requireRole(.., { feature: "broadcast" })`, admin client + `organization_id`, `Idempotency-Key` no POST, audit por mutação |
| Worker | `lib/publicacoes/worker/{index,expandir,executar,reconciliar,avisos}.ts` | o tick: materializar → expandir → claim/executar → reconciliar |
| Cron | `app/api/v1/cron/publications-worker/route.ts` | 1×/min (`docker/scheduler/entrypoint.sh`, `scripts/dev-crons.ts`, `lib/relogio/tarefas.ts`) |
| Publicadores | `lib/channels/publicacao/{contrato,index,grupos,social}.ts`, `lib/channels/zernio/posts.ts` | o contrato neutro e quem entrega, escolhidos pela capability `publishing` |
| Telas | `app/app/publicacoes/{lista,agendar,calendario,grupos,historico}`, `components/publicacoes/*`, `hooks/publicacoes/usePublicacoes.ts` | uma página = um client; TanStack Query + realtime |

Regra de fronteira (`lint:channels`): **nada fora de `lib/channels/` nomeia provedor.** O worker pede `getPublisher(provider, plataforma)`; a tela conhece rede e formato. Adicionar uma rede nova = uma linha em `capabilities.ts` (`publishing`), um publicador em `lib/channels/publicacao/`, e o vocabulário em `schema.ts` + CHECK.

## 3. Fluxo de uma publicação

1. **Agendar** (`/app/publicacoes/agendar`): arquivos (dropzone, ordem por arraste, dicas de dimensão/duração lidas no navegador), legenda, destinos por rede (só contas conectadas; duas contas → seletor), grupos (`SeletorDeGrupos`), datas (+ "Amanhã, mesmo horário", "Depois de amanhã") e recorrência. Regras por formato rodam a cada mudança. Rascunho a qualquer momento.
2. **POST /api/v1/publicacoes**: valida contas (rede da conta = rede do destino; grupos da MESMA conexão), posse da mídia (`<org>/publications/`), regras por formato, datas no futuro; grava conteúdo, mídias, destinos, ocorrências manuais e materializa a recorrência até o horizonte.
3. **Tick** (a cada minuto): materializa recorrências pendentes; ocorrência vencida → `processing` (guarda no status) → execuções por unidade; vencida há > 30 min → `skipped/missed_window` + aviso; sem recurso no plano → `skipped/feature_not_entitled`; claim por (ocorrência, destino) com `for update skip locked` e lease; cada execução vai a `sending` ANTES da chamada externa; desfecho gravado com guarda de status e worker.
4. **Publicar**: WhatsApp = uma mensagem por arquivo no grupo, legenda no último, 1,2 s + jitter entre arquivos, 5 s entre grupos da mesma conexão, progresso gravado por arquivo (`metadata.sent_files`). Social = um post por execução via `POST /v1/posts` com `publishNow`, `Idempotency-Key` = chave da execução, `metadata.crm_execution_id`; `201/207` → `sent` ou `accepted` (vídeo processando); mídia em URL assinada de 10 min, ou re-hospedada pelo presign do provedor quando o Storage não é alcançável pela internet.
5. **Desfecho**: `sent` (id externo, URL), `failed` transitório (retry em 1/5/15 min, `attempt+1`) ou permanente (sem retry, aviso `publication_failed` na Central com link para a ocorrência). `accepted` fecha pelo webhook `post.platform.*` ou pela reconciliação (`GET /v1/posts/{id}`) após 10 min de silêncio. WhatsApp preso em `sending` → `failed/worker_timeout`, **nunca reenvio automático**.
6. **Rollup**: `fn_rollup_publication_occurrence` lê a última tentativa de cada unidade → `done`/`partial`/`failed`/`skipped`; a publicação fecha quando não há pendente e a recorrência acabou.
7. **Telas**: Lista (só pendentes, por dia, no fuso da org), Calendário (um chip por ocorrência, "+N", lista por dia em 390 px), Sheet (destinos, execuções, erro em frase de gente, ações), Histórico (o que saiu do pendente, cursor, filtros, "Reenviar").

## 4. Decisões e por quê

- **Deskcomm é o relógio; o provedor social recebe `publishNow`.** Um agendador só; cancelar/reagendar não sincroniza com ninguém; URL assinada curta basta. `scheduledFor` no provedor publicaria na hora se caísse no passado (dobraria em catch-up) e exigiria mídia durável.
- **Claim por (ocorrência, destino).** Stories saem na ordem; grupos de um destino vão ao mesmo worker (pausa entre eles é possível).
- **Recorrência = regra + materialização com horizonte.** O calendário vê o futuro; cada ocorrência pode ser mexida; a regra pode mudar sem reescrever o passado.
- **Catch-up não existe.** Passou 30 min, pulou e avisou. O Disparo replicava tudo que perdeu, uma por minuto.
- **WhatsApp continua no WAHA.** O provedor social só tem Cloud API (grupos só em número sem QR, broadcasts, custo por mensagem). O publicador de grupos é genérico sobre `getAdapter(provider).send`.
- **Erro tem classe.** `transitorio` (timeout, 5xx, 429, `platform_error`, conexão `STARTING`) tenta de novo; `permanente` (token, conta desconectada, mídia recusada, grupo inativo, `duplicate_content`, `partial_send`) para e avisa.
- **Fuso da organização, nunca do navegador.** `organizations.timezone` → `publications.timezone`; a tela converte parede↔instante com `lib/agenda/fuso.ts`; o banco só guarda `timestamptz`.
- **Recurso do plano**: `broadcast` (rótulo "Publicações"). Não há recurso separado para redes sociais nesta versão.
- **Legado**: a 0283 copia `scheduled_group_messages`/`_runs` para o modelo novo (`legacy_scheduled_message_id`, `legacy_run_id`, `where not exists`); `paused` vira `draft`; as tabelas antigas ficam uma release sem escrita e saem numa migration posterior (0284). `scheduled_whatsapp_groups` continua sendo o cache de grupos.

- **Cada data escolhe seus destinos (0284).** O uso real pede "Feed e Facebook às 19:30, Stories só amanhã ao meio-dia, WhatsApp nos dois". Join table (org, ocorrência, destino) com FKs compostas, e não `uuid[]` na ocorrência: a FK garante que o destino é desta organização e cascateia quando ele some. Semântica **sem linha = todos**, para nada mudar em quem já agendou, na recorrência e no legado. A tela guarda o que está DESLIGADO por data (`excluidos`) e manda o complemento: assim uma rede marcada depois nasce acesa em todas as datas. Uma data com todas as redes apagadas não agenda (`Esta data está sem nenhuma rede.`, na tela e no zod).
- **A prévia enquadra como a rede.** Feed: o quadro segue a proporção da mídia dentro do limite (Instagram 4:5–1.91:1; Facebook até 1:2), a primeira foto dita o carrossel, e fora disso a prévia AVISA que a rede corta (`components/publicacoes/previa/proporcao.ts`). Stories e Reels: `object-contain` no 9:16 — faixas pretas, nunca zoom. Antes, Stories dava zoom e o Feed cortava tudo em 1:1, e a pessoa não via o que ia sair.

## 5. Limites que valem hoje

- Vídeo até **50 MB** (limite do bucket `whatsapp-media`, `MAX_MEDIA_BYTES`); duração e proporção são dicas do navegador — a recusa definitiva é do provedor e aparece no Histórico.
- Instagram: Feed 1–10 mídias (1 vídeo único vira **Reel**), Story 1 mídia por post (≤ 60 s), Reel 3–90 s; até **10 Stories por publicação** (25 posts/h por conta no provedor).
- Facebook: Feed até 10 fotos **ou** 1 vídeo (sem misturar), Story 1 mídia (vídeo ≤ 120 s), Reel 3–60 s. Link carousel não é oferecido.
- Provedor social: dedup por hash de conteúdo em 24 h (mesmo texto + mesmas URLs na mesma conta → `duplicate_content`); `ACCOUNT_NOT_ENABLED_FOR_POSTING` exige reconectar a conta autorizando publicação.
- Uma instalação sem o contêiner `scheduler` publica pelo relógio HTTP (`lib/relogio/tarefas.ts`, orçamento de 20 s por tick).

## 6. Como testar

```bash
pnpm typecheck && pnpm lint && pnpm lint:channels
npx vitest run lib/publicacoes lib/channels/publicacao lib/channels/zernio/posts.test.ts tests/unit/publicacoes-navegacao.test.ts
pnpm test:db          # 0283 install+update, RLS nas seis tabelas, vocabulário, realtime, travas de suporte
pnpm test:e2e         # tests/e2e/publicacoes-visual.spec.ts (API mockada)
```

Prova com recursos reais (doutrina de QA): banco fresco do `baseline.sql` + `bootstrap-owner.ts`, WAHA local com número pareado e 2 grupos salvos, conta Instagram/Facebook conectada em Conexões; agendar uma publicação para daqui a 2 minutos e acompanhar Lista → Histórico. Para forçar o tick sem esperar: `curl -X POST -H "Authorization: Bearer $INTERNAL_SECRET" http://localhost:3001/api/v1/cron/publications-worker`.

## 7. O que NÃO foi medido na entrega de 30/09/2026

- Envio real por WAHA: o ambiente local não tinha sessão pareada (todas `STOPPED`).
- Post real em conta social: as contas conectadas localmente são de cliente; publicar nelas sem autorização explícita seria efeito externo.
- O caminho de re-hospedagem de mídia (presign) contra o provedor real.
- `pnpm test:e2e` completo no CI (a spec entra em `SPECS_PARTE_*` no lugar da antiga).

## 8. Manutenção — onde mexer para…

- **…mudar como uma data escolhe redes:** `lib/publicacoes/schema.ts` (`ocorrenciaDaPublicacaoSchema`, `conferirOcorrencias`), `lib/publicacoes/servico.ts` (`horariosDaEntrada`, `gravarDestinosDasOcorrencias`, `destinosDasOcorrencias`), `lib/publicacoes/worker/expandir.ts` (o filtro), `components/publicacoes/SeletorDeHorarios.tsx` (`HorarioDaTela`, `destinosDaLinha`). Testes: `lib/publicacoes/schema.test.ts`, `expandir.test.ts` ("0284"), e2e `publicacoes-visual.spec.ts` (toggles `horario-N-destino-<rede>-<formato>`).
- **…mudar ou acrescentar um ícone de rede/formato:** `components/publicacoes/ChannelIcon.tsx` — `CHANNEL_CONFIG` (rede → glifo do simple-icons, pintura, formatos) e `FORMAT_TREATMENT` (formato → cheio / anel / reels). Validação visual em `/app/publicacoes/icones`; exportação para `public/icons/channels/` com `pnpm icones:exportar`. Teste: `ChannelIcon.test.tsx`.
- **…mudar o enquadramento da prévia:** `components/publicacoes/previa/proporcao.ts` (+ teste) e o `ajuste` de `MidiaVisual` em `Aparelho.tsx`.

| Quero… | Mexo em |
|---|---|
| mudar tolerância, horizonte, tentativas, pausas | `lib/publicacoes/politica.ts` (+ `politica.test.ts`) |
| aceitar outro formato ou limite | `regras-por-destino.ts` (+ teste), `schema.ts` (`FORMATOS_POR_REDE`), CHECK em migration nova |
| outra rede (ex.: LinkedIn) | `capabilities.ts` (`publishing`), publicador em `lib/channels/publicacao/`, `social.ts` mapeia formato→payload, `schema.ts` + migration, rótulos em `components/publicacoes/rotulos.ts` |
| outro tipo de recorrência | `recorrencia.ts` (+ teste DST), `schema.ts`, CHECK `publications_recurrence_kind_check`, `SeletorDeHorarios.tsx` |
| mensagem de erro nova na tela | `components/publicacoes/rotulos.ts` (`ROTULO_DO_ERRO`) + `lib/i18n/dicionario.ts` (es) |
| webhook `post.*` do provedor fechando execução | `lib/channels/zernio/social.ts` (`EVENTOS_DA_CONEXAO_SOCIAL`), `envelope.ts`, `inbound.ts` → hoje a reconciliação por `GET /v1/posts/{id}` cobre; o webhook é a próxima entrega (Fatia C do plano) |
