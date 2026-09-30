# Spec 22 — Comentários de Instagram e Facebook na inbox (via Zernio)

> Plano de implementação. Estado (2026-09-30): **plano, nada implementado.** Destino **só o fork
> Nebo**, a partir da `feat/canais-meta-zernio` (spec 21 já entregue: conexão OAuth, Direct e
> Messenger na inbox, `channel_sessions.platform`, `contact_platform_identities`).
> Lei que este plano obedece: `CLAUDE.md`, `docs/doctrine/restricao-de-canal.md`,
> `docs/doctrine/sistema-vivo.md`, spec 21 e spec 20 (setores).
> Contrato externo: `docs.zernio.com` (comments, webhooks) — lido em 29/09/2026.

---

## 0. O que o dono pediu

1. Comentário em post (e em anúncio/post impulsionado) de cada Instagram e página de Facebook
   conectados **cai na inbox**, é respondido e fechado. Meta: **nenhum comentário sem resposta**.
2. Na lista e no cabeçalho, o selo de canal mostra um **ícone de comentário** da rede e o **nome da
   conta** (`@certoatacado`). Uma organização pode ter 3 ou 4 Instagrams e várias páginas, cada uma
   recebendo Direct e comentários — o selo diz de qual conta e de qual porta veio.
3. **Respondeu pelo celular, fecha na inbox.**
4. Ao conectar a rede (e depois, editando), o admin escolhe **o que entra na inbox**: Direct/Messenger,
   Comentários, ou os dois.

## 1. O que existe hoje, medido no código

| Fato | Onde | Consequência para este plano |
|---|---|---|
| Uma conversa por contato + conexão | `uniq_conversations_1to1_per_contact_session` (baseline ~4942) e `fn_upsert_wa_conversation` (`on conflict (org, contact, session) where is_group = false`) | **Trava principal.** Comentário da mesma pessoa na mesma conta cairia DENTRO do Direct dela. §2.1 resolve. |
| O webhook social não assina comentário | `EVENTOS_DA_CONEXAO_SOCIAL` em `lib/channels/zernio/social.ts:47` | Conexões já feitas não recebem nada até o webhook ser atualizado (`PUT /v1/webhooks/settings`). |
| O parser só conhece `message.*` | `parseZernioInbound` / `parseZernioEdicao` em `lib/channels/zernio/webhook.ts`; despacho em `lib/channels/inbound.ts:~208` | `comment.received` hoje é descartado em silêncio. |
| Envio social sai sempre pelo endpoint de DM | `lib/channels/adapters/zernio.ts:171` (`/v1/inbox/conversations/{id}/messages`); envelope montado em `app/api/v1/messages/_handler.ts` | Precisa de um ramo por tipo de conversa. |
| Janela de 24h lê `last_inbound_at` | `marcarConversa` em `ingest.ts`; guardrail do agente; selo do composer | Comentário não tem janela de 24h — a capacidade tem de ser por **tipo de conversa**, não só por rede. |
| A IA acorda em toda entrada | `aplicarEfeitosPosEntrada` chamado por `efeitosDaEntrada` (`ingest.ts:254`) | Comentário não pode acordar a IA por padrão (§6). |
| Fechar = `fn_service_status(p_status: 'closed')` | `app/api/v1/conversations/[id]/close/route.ts` | Reaproveitável para o fechamento automático (§5). |
| Selo "Entrou por" com ícone da rede | `components/inbox/ConversationListItem.tsx:~310`, `ConversationHeader.tsx:161`, `components/channels/IconeDaPlataforma.tsx` | Estender, não criar outro selo. |

## 2. Modelo de dados — migration `0283` (tripla: arquivo + apêndice do baseline + MANIFEST)

Conferir o número antes: `ls supabase/migrations/ | grep -oE '_[0-9]{4}_' | tr -d _ | sort -n | tail -1`.

### 2.1 Tipo de conversa

```sql
alter table conversations add column if not exists kind text not null default 'direct';
-- check (kind in ('direct','comment'))   -- vocabulário fechado → entra no invariante banco × TS
```

- Índice 1:1 recriado **só para Direct**:
  `uniq_conversations_1to1_per_contact_session ... where is_group = false and kind = 'direct'`.
  `drop index if exists` + `create unique index if not exists` no apêndice (dados atuais são todos
  `direct`, então recriar não falha).
- Índice novo para comentário: `unique (organization_id, channel_session_id, provider_conversation_id)
  where kind = 'comment'` — `provider_conversation_id` = **id do comentário raiz**.
- `fn_upsert_wa_conversation` passa a inserir `kind = 'direct'` explícito (o `on conflict` precisa casar
  o predicado novo). Nova `fn_upsert_comment_conversation(p_org, p_contact, p_session, p_root_comment_id,
  p_post jsonb)`, `security definer`, **revogada de `public, anon`** e concedida só a `service_role`.
- **Auditoria de chamadores** (tarefa explícita da fase 1): todo lugar que acha "a conversa do contato
  nesta conexão" passa a filtrar `kind = 'direct'`. Lista inicial medida:
  `fn_service_begin` (baseline ~19619 e ~28425), as duas funções com
  `contact_id = p_contact and channel_session_id = p_session` (~20285, ~20892),
  `lib/routing/eligibles.ts:50`, `app/api/v1/conversations/[id]/retention/route.ts:82`,
  `workers/ai-sentiment-worker.ts:174`, `app/api/v1/ai/pacing/route.ts`, `lib/automation/janela-do-canal.ts`,
  `lib/automation/throttle.ts`. Refazer o grep na hora — a lista envelhece.

### 2.2 Contexto do post e do comentário

- `conversations.metadata.comentario = { post_id, platform_post_id, permalink, post_text, post_image_url,
  is_ad, ad_title, private_reply: { status: 'disponivel'|'usada'|'expirada', em } }`.
  É `jsonb`, então **um leitor central** (`lib/channels/comentarios/contexto.ts`, com Zod) — a UI não lê
  o path direto (anti-pattern 6).
- Cada comentário e cada resposta é uma linha de `messages` com `external_id` = id do comentário na
  plataforma (dedupe `unique (organization_id, external_id)` + `23505`, como hoje) e
  `metadata.comentario = { parent_comment_id, is_own_account, origem: 'crm'|'app' }`.

### 2.3 O que a conexão entrega para a inbox

```sql
alter table channel_sessions add column if not exists inbox_direct   boolean not null default true;
alter table channel_sessions add column if not exists inbox_comments boolean not null default false;
```

- Colunas, não `jsonb`: são lidas no caminho quente do webhook e filtradas na tela.
- **Default `false` para comentários em conexões antigas**: ligar sozinho encheria a fila de quem não
  pediu. Conexão **nova** grava os dois `true` (§4). WhatsApp ignora as colunas (CHECK cruzado:
  `inbox_comments` só pode ser `true` quando `platform in ('instagram','messenger')`).
- Pelo menos um dos dois ligado (CHECK) — conexão que não entrega nada é conexão morta.

### 2.4 Vocabulário e avisos

- `lib/channels/comentarios/vocabulario.ts`: `KIND_DIRECT`, `KIND_COMMENT`, motivos de fechamento
  (`respondido_no_crm`, `respondido_pelo_app`, `sem_resposta_necessaria`, `spam`, `ocultado`).
- Novo `agent_inbox_items.kind = 'comment_unanswered'` (acrescentar ao CHECK no bloco único do fim,
  como os demais).

## 3. Entrada (webhook)

1. `EVENTOS_DA_CONEXAO_SOCIAL` vira **função da escolha da conexão**: `message.*` quando
   `inbox_direct`, `comment.received` quando `inbox_comments`, `account.*` sempre.
2. `parseZernioComentario(payload)` em `lib/channels/zernio/comentarios.ts` → `{ commentId, rootCommentId,
   parentCommentId, isReply, texto, autor{id, username, name, picture, isOwnAccount}, post{...}, ad?,
   anexo?, createdAt, accountId, plataforma }`. Mapeia `facebook → messenger` como o parser de mensagem.
3. Despacho em `lib/channels/inbound.ts`, **antes** da ingestão de mensagem (mesmo lugar das edições):
   conta confere (`account.accountId` = `zernio_account_id`), plataforma confere, e
   `inbox_comments = false` → 200 `comentarios_desligados`, nada gravado (defesa se a Zernio ainda
   entregar depois de desligar).
4. **Raiz do fio:** `isReply = false` → a raiz é o próprio comentário. `isReply = true` → procura a
   conversa cujo `provider_conversation_id` = `parentCommentId`; se não achar (resposta a comentário
   antigo que nunca entrou), a raiz vira o `parentCommentId` mesmo assim — a conversa nasce e o texto do
   pai é buscado uma vez por `GET /v1/inbox/comments/{postId}?commentId=` para dar contexto.
5. **Comentário de terceiro** → `fn_upsert_social_contact` (mesmo contato do Direct no Instagram:
   `comment.author.id` é o mesmo IGSID de `sender.id` — doc da Zernio) → `fn_upsert_comment_conversation`
   → `messages` inbound → reabre a conversa se estava fechada (§5.3) → carimba `last_inbound_at` e
   não lidas.
6. **Comentário da própria conta** (`author.isOwnAccount = true`):
   - se o `id` já existe em `messages` (eco do que o CRM enviou) → só dedupe;
   - senão é **resposta dada pelo app** → grava como outbound com `origem: 'app'` e **fecha** a conversa
     (§5.2).
   - Nunca cria contato nem conversa nova para a própria conta.
7. **Mídia:** Instagram não tem anexo em comentário; Facebook traz `attachment` com URL efêmera — mesma
   regra da spec 21: persistir pelo `media-persist`, nunca mandar o Bearer para host de terceiro.
8. **Não medido (§11):** no Facebook, se o id do autor do comentário é o mesmo PSID do Messenger. Até
   medir, **não funde** — identidade por `(platform, platform_user_id)` separa sozinha se forem
   diferentes.

## 4. Conexão — escolher o que entra

- `NovaConexaoDialog.tsx`: depois de escolher a rede, dois checkboxes — "Mensagens diretas" e
  "Comentários nas publicações" (os dois marcados). A escolha viaja no `state` assinado do OAuth
  (`POST /api/v1/channels/social/connect { platform, inbox_direct, inbox_comments }`) e o callback grava
  nas colunas e registra o webhook já com os eventos certos.
- `ConnectionsClient.tsx`: na linha da conexão social, "O que entra na inbox" editável.
  `PATCH /api/v1/channel-sessions/{id}/inbox` (admin, Zod, audit `channel.inbox_scope_changed`) →
  grava → `PUT /v1/webhooks/settings` com os eventos novos. Falha remota: grava a escolha, abre aviso
  na Central ("não consegui atualizar o provedor, tente de novo") e a defesa do §3.3 segura a entrada.
- Conexões que já existem: aparecem com Comentários **desligado** e o botão para ligar. Nada de edição
  manual de arquivo (doutrina de packaging).

## 5. Responder e fechar

### 5.1 Responder

- Composer de conversa `kind = 'comment'` mostra o post (miniatura, texto, link) no topo e **dois modos**:
  - **Responder no post** (padrão) → `POST /v1/inbox/comments/{platformPostId}` `{accountId, message,
    commentId}` com `Idempotency-Key` = id da mensagem. Aviso visível: "esta resposta é pública".
    Responde ao comentário mais recente do cliente no fio (ou ao que o atendente escolher).
  - **Responder no Direct** → `POST /v1/inbox/comments/{postId}/{commentId}/private-reply`.
    Desabilitado quando `private_reply.status` ≠ `disponivel` ou o comentário tem mais de 7 dias.
    Só texto. 400 com `privateReplyConsumed` → marca `usada`, **nunca retenta**. A DM que nasce entra
    pelo fluxo da spec 21 como conversa `direct` separada (só se `inbox_direct`).
- Adapter: `ZernioAdapter.send` ganha o ramo `envelope.conversationKind === 'comment'` →
  `enviarRespostaDeComentario`. O envelope carrega `conversationKind` e `replyToCommentId`
  (`app/api/v1/messages/_handler.ts`).
- Capacidades: `capabilitiesDoCanal({ provider, platform, kind })` — comentário: sem janela de 24h, sem
  template, sem áudio, sem documento; imagem só Facebook (`attachmentUrl`).
- Ações extras no cabeçalho: **Ocultar comentário** (`/hide`) e **Curtir** só onde a Zernio devolve
  `canLike` (no Instagram é beta e dá 403 — esconder o botão, não mostrar erro).

### 5.2 Fechar

- **Respondeu pelo CRM** → fecha sozinho ao confirmar o envio (motivo `respondido_no_crm`), com opção de
  desligar isso nas Configurações de atendimento se o dono preferir fechar à mão.
- **Respondeu pelo celular** → §3.6 fecha com `respondido_pelo_app` e linha na timeline
  "Respondido pelo app do Instagram".
- **Fechar sem responder** → exige motivo (`sem_resposta_necessaria`, `spam`, `ocultado`).
- Todos passam por `fn_service_status` e auditam `conversation.closed` com o motivo.

### 5.3 Reabrir

Comentário novo do cliente no mesmo fio reabre a conversa (volta para a fila/atendente conforme as
regras de setor). Comentário novo em **outro** post ou fora do fio = conversa nova.

## 6. IA

- **Desligada para comentários na primeira entrega.** `efeitosDaEntrada` passa `kind`; o dispatcher do
  agente pula `kind = 'comment'` com motivo registrado (`skipped: comentario`), nunca silêncio.
- Fase posterior (fora deste plano): opção por conexão "IA responde comentários", com gate pré-go-live e
  revisão humana antes de publicar.

## 7. Inbox e telas

- `IconeDaPlataforma` ganha `origem?: 'direct' | 'comentario'`: comentário = balão de fala com a cor da
  rede (desenho próprio, sem logotipo de terceiro). `title`: "Comentário no Instagram".
- Selo "Entrou por": `[ícone] @certoatacado` (Instagram) / `[ícone] Nome da Página` (Facebook) —
  `display_name` da `channel_session`, que o callback já grava. Vale para lista, cabeçalho e filtro.
- Filtro da inbox: "Canal" lista cada conta; novo filtro "Tipo": Mensagens | Comentários.
- Item da lista de comentário mostra no lugar da prévia: o texto do comentário e, abaixo, "em: <começo
  da legenda do post>".
- Cabeçalho: link "Ver publicação" (`permalink`), selo "Anúncio" quando `is_ad`.

## 8. Nada fica sem resposta (sistema vivo)

- **Aviso na Central** `comment_unanswered`: comentário aberto há mais de N horas (knob por organização
  em Configurações › Atendimento, default 4 h), agrupado por conta. Fecha sozinho quando a conversa fecha.
- **Cron de conferência** `app/api/v1/cron/comments-reconcile` (a cada 30 min, no `scheduler` do
  `docker-compose.prod.yml`): para cada conexão com `inbox_comments`, `GET /v1/inbox/comments?accountId&
  since=<última conferência>` e, para posts cuja contagem difere do banco, `GET
  /v1/inbox/comments/{postId}`; o que faltar entra pela **mesma** função de ingestão (dedupe garante
  idempotência). Alternativa mais barata a medir: `POST /v1/webhooks/logs/redeliver` para entregas
  falhas. Audita só quando ingeriu algo (`cron-audita-so-quando-ha-efeito`).
- **Painel:** em Análise, "Comentários: recebidos, respondidos, tempo até a resposta, sem resposta"
  por conta — fora da primeira entrega se apertar.
- **Laço de retorno (invariante 7):** comentário perdido pelo webhook → o cron o traz e registra
  `comments.reconciled` com a contagem; se o cron também falha, a saúde da conexão abre aviso.

## 9. Fases

| Fase | Entrega | Prova |
|---|---|---|
| 1 | Migration 0283 (§2) + auditoria de chamadores do 1:1 + vocabulário + tipos regenerados | `pnpm test:db` (install + update + update com dados); invariante: 2 conversas (direct + comment) do mesmo contato na mesma conexão; isolamento de 2 orgs na função nova |
| 2 | Escolha na conexão + webhook com eventos por escolha + rota PATCH (§4) | unit com dublê da Zernio (POST e PUT de webhook); tela: conectar com "só comentários" |
| 3 | Entrada (§3): parser, despacho, fio, eco, fechamento pelo app | unit com payloads IG e FB reais (raiz, resposta, própria conta, anúncio, sticker FB); ingestão contra Postgres |
| 4 | Saída (§5): resposta pública, Direct privado, ocultar, fechar com motivo, capacidades | matriz de capacidades por `kind`; envio com dublê; `privateReplyConsumed` não retenta |
| 5 | Inbox (§7): ícone, `@conta`, filtros, contexto do post | e2e dirigindo a tela |
| 6 | Sistema vivo (§8): aviso, cron de conferência | unit do cron (audita só com efeito); aviso abre e fecha |
| 7 | Prova com conta real + `.changes/` (`capacidade_nova`) + jornada em `user-journey-map.md` | Playwright em ambiente fresco; evidência em `.superpowers/evidence/` |

Destino (DoD 18): **núcleo** — toca conversa, identidade, envio e fila. Com zero conexões sociais (ou
comentários desligados) a operação é idêntica à de hoje.

## 10. Decisões para o dono (antes da fase 1)

1. **Unidade do atendimento:** um por comentário raiz (recomendado) ou um por post + pessoa?
2. **Fechar sozinho ao responder pelo CRM?** Recomendado sim, com opção de desligar.
3. **Conexões antigas:** comentários começam desligados (recomendado) ou ligados?
4. **Prazo do aviso** de comentário sem resposta: 4 h?
5. **Comentários da mesma pessoa em posts diferentes** viram atendimentos separados (recomendado) ou um só?
6. Contar comentários no limite/uso do plano (`fn_org_entitlements`)? Recomendado: não — o recurso é o
   canal, já contado.

## 11. Não medido (confirmar com conta real)

- Se no Facebook o id do autor do comentário = PSID do Messenger.
- Se `comment.received` da própria conta chega para respostas feitas **pelo CRM** (eco) e com o mesmo id
  que `POST /v1/inbox/comments` devolveu — o dedupe depende disso.
- Atraso real entre comentário e webhook, e se comentário em post antigo (fora do sync da Zernio) chega.
- Comportamento com comentário oculto/apagado depois de entrar (Instagram via Facebook Login não devolve
  ocultos na listagem — o cron não pode reabrir por ausência).
