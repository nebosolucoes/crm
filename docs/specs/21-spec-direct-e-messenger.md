# Spec 21 — Instagram Direct e Facebook Messenger (via Zernio)

> Estado (2026-09-29): **fases 1–6 implementadas** na branch `feat/canais-meta-zernio`, a partir da
> `nebo-custom` — destino **só o fork Nebo**. Provado: `pnpm test:db` (invariantes novos em
> `tests/invariants/canais-sociais.test.ts`), unit em `tests/unit/canais-sociais.test.ts`, webhook HMAC
> real contra o servidor local e `tests/e2e/canais-sociais.spec.ts` (3/3). **Falta medir com conta real**
> (§9) antes de ligar em produção.
> Decisões fechadas com o dono em 29/09 (§1). Lei que este plano obedece: `CLAUDE.md`,
> `docs/doctrine/restricao-de-canal.md` (feature pergunta capacidade, nunca identidade),
> `docs/specs/20-spec-setores-de-atendimento.md` (roteamento por setor, que este canal herda).
> Contrato da API externa: `docs.zernio.com` (inbox, webhooks, connect) — lido em 29/09.

---

## 0. O problema, medido no código

A Zernio **já é um provider do CRM** (`lib/channels/zernio/*`, `channel_sessions.provider='zernio'`),
só que para WhatsApp. A mesma conta Zernio entrega DMs de Instagram e Messenger no mesmo formato de
inbox — e o CRM joga fora de propósito:

- `lib/channels/zernio/webhook.ts:205` e `:180`: `if (str(m.platform) !== "whatsapp") return null;`
- `conversations_channel_check`: `CHECK (channel = 'whatsapp')` (baseline, tabela `conversations`).
  A spec 03 já o desenhou como "prep multi-canal".
- Identidade de contato é telefone/WhatsApp (`fn_upsert_wa_contact`, `wa_identity`, `wa_lid`).
  DM de Instagram/Messenger não traz telefone: traz o id da pessoa **escopado à conta** (IGSID/PSID).
- `CHANNEL_CAPABILITIES` é por **provider**; Instagram e Messenger sob a Zernio herdariam a física do
  WhatsApp (templates, `opus-only`, grupos).
- `findPartnerSession` assume **uma** sessão Zernio por organização (`.maybeSingle()`).
- O gate pré-go-live só aceita **telefone** na lista de teste — a IA nunca abriria num canal social.

## 1. Decisões fechadas

| Tema | Decisão | Por quê |
|---|---|---|
| Conta Zernio | **uma conta, a da instalação** (`ZERNIO_API_KEY` no `.env`) — *mudou em 30/09; a versão de 29/09 era uma chave por organização* | Pedido do dono (30/09): a Nebo opera a conta e revende as conexões. Cada conexão é um profile nessa conta; "Desconectar" remove a conta e o profile de lá para parar a cobrança. |
| Conexão | **botão OAuth** ("Conectar Instagram" / "Conectar Messenger") com o seletor hospedado pela Zernio | Leigo não sabe o que é `accountId`. A chave da Zernio é colada **uma vez** por organização. |
| Tela | **lista única** em `/app/connections` com botão "Adicionar conexão" (popup com WhatsApp QR, API oficial, parceiro, Instagram, Messenger, voz) — *mudou em 30/09; era uma aba por tipo* | Pedido do dono: ver todas as conexões num lugar só. Os links `?aba=` antigos abrem o painel certo no popup. |
| Roteamento | **idêntico ao de hoje**: agente/roteador amarrado à sessão, fila humana, setores, políticas por número | Pedido do dono. O roteamento já é por sessão e por conversa, nunca por telefone (auditoria de 29/09). |
| IA | **atende desde a primeira entrega** | Pedido do dono. Exige gate pré-go-live por `@usuário` (§6) e janela de 24h por plataforma (§5). |
| Uma sessão por conta conectada | cada conta de Instagram / página do Facebook = **uma linha** de `channel_sessions` (`provider='zernio'`) | Agente, roteador, política e setor já se amarram a sessão. Nada novo a inventar. |
| Um *profile* Zernio por conexão | o CRM cria o profile na Zernio ao conectar | Doc da Zernio: **um Instagram por profile**, e trocar o Instagram de um profile **apaga** as conversas do anterior. Profile compartilhado seria perda de histórico. |
| Destino (DoD 18) | **núcleo** | Toca identidade de contato, a cadeia de envio e o gate da IA. Com zero conexões sociais a operação comum é idêntica. |

## 2. Modelo de dados (migration `0280`)

Tripla de sempre: `supabase/migrations/…_0280_canais_sociais.sql` + apêndice idempotente no
`baseline.sql` + linha no `MANIFEST.md`.

### 2.1 Eixo de plataforma

```sql
alter table channel_sessions add column if not exists platform text not null default 'whatsapp';
-- check (platform in ('whatsapp','instagram','messenger'))
```

- `provider` continua dizendo **quem transporta** (waha, meta_cloud, zernio); `platform` diz
  **com que rede se fala**. WAHA/Meta Cloud são sempre `whatsapp` (CHECK cruzado).
- `conversations_channel_check` passa a `channel in ('whatsapp','instagram','messenger')`.
  `conversations.channel` = `channel_sessions.platform` da sessão, gravado na criação.
- Vocabulário no TS: `lib/channels/plataformas.ts` (constantes, rótulos, nunca literal espalhado);
  entra no invariante `vocabulario-banco-x-typescript`.

### 2.2 Identidade de contato por plataforma

```sql
create table contact_platform_identities (
  id uuid pk, organization_id uuid not null → organizations on delete cascade,
  contact_id uuid not null → contacts on delete cascade,
  platform text not null check (platform in ('instagram','messenger')),
  platform_user_id text not null,     -- IGSID / PSID (escopado à conta conectada)
  channel_session_id uuid → channel_sessions on delete set null,
  username text, display_name text, avatar_url text,
  created_at, updated_at,
  unique (organization_id, platform, platform_user_id)
);
```

- RLS `tenant_isolation_contact_platform_identities_all` via `fn_user_org_ids()`.
- DIRC: **Integrar** — a identidade aponta para o contato, não duplica nome/telefone.
- RPC `fn_upsert_social_contact(p_org, p_platform, p_user_id, p_session, p_username, p_name)`,
  `security definer`, revogada de `public, anon` e concedida só a `service_role` (regra 9).
  Resolve a corrida de dois webhooks por `unique_violation`, segue `is_merged_into`, e cria o
  contato com `source = p_platform`.
- O id **não** entra em `wa_lid`/`wa_identity`: são namespaces diferentes, e misturar faria um
  IGSID colidir com a correlação do WhatsApp.

### 2.3 Chave da Zernio da organização

```sql
create table channel_provider_keys (
  organization_id uuid not null → organizations on delete cascade,
  provider text not null check (provider in ('zernio')),
  api_key_encrypted bytea not null,    -- fn_encrypt_oauth, como zernio_token_encrypted
  created_at, updated_at, primary key (organization_id, provider)
);
```

- RLS ligada **sem** policy para `authenticated`: só o service role lê. A chave nunca volta num GET.
- Cada sessão social copia a chave cifrada para `zernio_token_encrypted` — assim
  `resolveZernioCreds` (envio, mídia, saúde) funciona sem mudança.

### 2.4 Conversa nasce com o canal certo

`fn_upsert_wa_conversation` grava `'whatsapp'` literal. Nova `fn_upsert_channel_conversation(p_org,
p_contact, p_session)` lê `platform` da sessão; a antiga passa a delegar. `fn_service_begin` e
`sessaoProntaParaEnvio` (automação) passam a filtrar `platform = 'whatsapp'` quando o destino é um
**telefone** — hoje escolheriam uma sessão de Instagram para um contato de WhatsApp.

## 3. Conexão (tela + OAuth)

1. **Aba "Redes sociais"** em `/app/connections` (`ConexoesShell`), papel `admin`.
2. **Sem chave:** campo "Chave de API da Zernio" → `POST /api/v1/channels/social/key`.
   Valida (`GET /v1/accounts` 200) **e** o addon de inbox (`GET /v1/inbox/conversations?limit=1`
   ≠ 403), cifra e grava. Rede caída ≠ chave inválida (mensagens diferentes).
3. **Conectar:** `POST /api/v1/channels/social/connect {platform}` →
   cria profile Zernio (`POST /v1/profiles`, `Idempotency-Key`), emite `state` assinado
   (org, usuário, plataforma, profileId, 10 min — padrão de `lib/nuvemshop/state.ts`) e devolve o
   `authUrl` de `GET /v1/connect/{instagram|facebook}?profileId&redirect_url`.
4. **Callback:** `GET /api/v1/channels/social/callback?state&connected&accountId&error…`
   - `requireRole("admin")` pela sessão do browser **e** `state.orgId === org da sessão`.
   - `error` primeiro (vocabulário da Zernio → frase em português).
   - Confere a conta (`GET /v1/accounts?profileId`) — plataforma certa, ativa.
   - Cria a sessão (`provider='zernio'`, `platform`, `zernio_account_id`, chave cifrada, token e
     segredo de webhook, `metadata.zernio_profile_id`, `metadataInicialDoCanal()`), respeitando
     `max_channels`.
   - **Registra o webhook sozinho** (`POST /v1/webhooks/settings`, `accountIds=[accountId]`,
     `secret` gerado aqui, eventos de inbox + `account.*`) e guarda o `_id` em
     `metadata.zernio_webhook_id`. O operador não cola nada.
   - Redireciona para `/app/connections?aba=social&conectado=<plataforma>`.
5. **Remover:** arquiva a sessão (padrão `archived_at`) e apaga o webhook na Zernio
   (`DELETE /v1/webhooks/settings?webhookId=`). Falha remota vira aviso, não bloqueio.

## 4. Entrada (webhook)

Mesma rota genérica `app/api/v1/webhooks/channel/[token]` — o token identifica a sessão, que dá
`organization_id` (fonte confiável, nunca o body). Mudanças em `lib/channels/zernio/`:

- **Conta confere:** `account.accountId` do payload ≠ `zernio_account_id` da sessão → 200
  `conta_de_outra_sessao`, nada gravado. Defesa contra webhook compartilhado.
- **Plataforma confere:** `message.platform` mapeado (`instagram`→`instagram`,
  `facebook`→`messenger`) tem de ser a `platform` da sessão.
- **Identidade social:** `sender.id` (entrada) / `conversation.participantId` (saída — o `sender` do
  `message.sent` é a própria empresa). **Nunca** vira telefone (`participanteDaConversa` hoje faria
  `+<IGSID>`).
- Thread primeiro (`provider_conversation_id`), como hoje; depois `fn_upsert_social_contact`.
- **Eco do nosso envio:** `message.sent` com `sentVia='api'` não pausa a IA
  (`pausarIaPorAtendimentoManual` só para `sentVia` nulo/`human` — enviado pelo app do Instagram).
  Dedupe por `platformMessageId` = `data.messageId` do envio (**a confirmar em conta real**).
- **Mídia:** URL de CDN da Meta é pública e expira — **nunca** mandar o Bearer da Zernio para host
  de terceiro. Guardar `{conversationId, platformMessageId, index, accountId}` para re-emitir o link
  por `GET /v1/inbox/conversations/{cid}/messages/{mid}/attachments/{i}?format=json` quando expirar.
  `share`/`story_mention`/`reel` ganham tratamento legível em vez de "documento".
- `message.failed` não existe para IG/FB — falha só aparece síncrona no envio (403/400
  `platform_api_error`).
- `account.disconnected` → saúde da conexão (`sincronizarSaudeDaConexao`) → aviso na Central.

## 5. Saída e capacidades por plataforma

`capabilitiesOf(provider)` vira `capabilitiesDoCanal({ provider, platform })` (6 chamadores de
produção, listados na auditoria). Para `zernio × instagram|messenger`:

| capacidade | valor | motivo |
|---|---|---|
| `freeformOutsideWindow` | `false` | Janela de 24h da Meta. |
| `requiresTemplates` / `canManageTemplates` | `false` | Não há template aprovado em DM. A ferramenta `send_template` some do agente. |
| `humanAgentWindowHours` (nova) | `168` | Humano pode responder até 7 dias com a tag `HUMAN_AGENT` (Instagram só aceita esta). **A IA não usa.** |
| `banRisk` | `false` | Sem warm-up, sem throttle anti-ban, sem janela de cortesia 7h–22h. |
| `voiceNote` | `"none"` (novo valor) | IG/Messenger não aceitam ogg/opus como nota de voz. Áudio sai como anexo. |
| `groups` | `"none"` | Sem grupos. |
| `documents` (nova) | IG `false`, Messenger `true` | Instagram DM não aceita arquivo. |

Envio: o adapter Zernio já usa `POST /v1/inbox/conversations/{providerConversationId}/messages`.
Entra: `attachmentUrl`+`attachmentType` (um anexo), `messagingType: MESSAGE_TAG` +
`messageTag: HUMAN_AGENT` quando é humano entre 24h e 7 dias, `Idempotency-Key`, e leitura de
`partialFailure`. `resolveRecipient` não exige telefone quando há thread.

## 6. IA e automações

- **Pré-go-live:** a lista de teste aceita `@usuario` além de telefone (`ai_test_handles`); os
  gates (`gate.ts`, `consulta-pg.ts`, `consulta-supabase.ts`, `_handler.ts`) passam a comparar as
  identidades sociais do contato. Canal social nasce fechado, como todo canal.
- Agente/roteador: o seletor "Número conectado" vira "Canal conectado" e lista as sessões sociais
  com rótulo de plataforma. Nenhuma regra nova — é a amarração por sessão que já existe.
- Nascimento do lead: `source` e título pela plataforma ("Novo contato pelo Instagram").
- Automações que **iniciam** conversa (`send_whatsapp_message`) seguem só WhatsApp — a Meta não
  permite abrir DM a frio. As que respondem dentro de conversa aberta usam a conversa.

## 7. Inbox e telas

- Ícone de plataforma (`components/channels/IconeDaPlataforma.tsx`) na lista, no cabeçalho e no
  filtro de canal. `channelLabel()` ganha a plataforma.
- Cabeçalho e ficha: `@usuario` e nome quando não há telefone; botão de ligar já é guardado por
  `hasPhone`.
- Selo de janela: "Janela de 24h — depois disso, só humano por até 7 dias".

## 8. Fases

| Fase | Entrega | Prova |
|---|---|---|
| 1 | Schema (§2) + tipos + vocabulário | `pnpm test:db` (install + update), invariante de isolamento da tabela nova |
| 2 | Chave + OAuth + webhook automático + aba de conexões (§3) | unit do fluxo com dublê da Zernio; tela |
| 3 | Entrada (§4) | unit do parser com payload IG/FB; ingest contra Postgres |
| 4 | Saída + capacidades (§5) | matriz de capacidades; envio com dublê |
| 5 | IA e automações (§6) | gate por `@usuario`; drain com sessão social |
| 6 | Inbox (§7) + prova em tela + `.changes/` | e2e com webhook assinado de verdade |

## 9. O que NÃO está medido (a confirmar com conta real)

Primeiro teste em produção, na ordem: conectar um Instagram profissional pela aba; mandar uma DM de
outra conta; responder pela inbox; conferir no banco que o eco `message.sent` casou com a linha do envio
(se não casar, o `ecoDoNossoEnvioSocial` segura por texto, mas vale confirmar); deixar passar 24h e
responder com a tag. Depois o mesmo com uma página do Messenger.

Pendências conhecidas, fora da primeira entrega:

- **Mídia expirada:** o link do CDN da Meta vence. O worker baixa logo na entrada; se ele atrasar, falta
  re-emitir o link por `GET /v1/inbox/conversations/{cid}/messages/{mid}/attachments/{i}`.
- **Áudio gravado no composer** sai convertido para ogg/opus (regra do WhatsApp); o Instagram pode recusar.
- **Documento no Instagram:** a DM não aceita arquivo; hoje o envio falha com o erro do provedor.
- **Messenger sem @:** a pessoa pode não ter `username`; aí o modo de teste da IA não tem como casá-la, e o
  caminho é abrir o canal ao público.
- **Automação de primeiro contato** segue só WhatsApp (a Meta não deixa abrir DM a frio).

- Nome exato dos campos de `conversation` e `account` no webhook de inbox (a doc não publica o
  schema; o parser aceita `account.id`/`account.accountId`, como já faz).
- Se `data.messageId` do envio é igual ao `platformMessageId` do eco `message.sent` em IG/FB.
- Se `conversation.participantPicture` existe.
- Tamanho máximo de anexo em IG/FB.

## 10. Limites por rede e conexões extras (30/09)

Decisões do dono em 30/09:

- **Limite por rede no plano:** `max_whatsapp`, `max_instagram`, `max_messenger` em
  `platform_plans.limits`, ao lado do `max_channels` (teto total). Uma conexão nova precisa caber nos
  dois (`recusaPorLimiteDeConexao`, em `lib/entitlements/exigir-na-rota.ts`). Aparecem sozinhas no editor
  de planos e no de liberação especial, porque os dois leem `CHAVES_DE_LIMITE`.
- **Conexões extras por empresa somam ao plano:** tabela `organization_limit_extras` (migration 0281).
  O admin da instalação vende "+N" em Admin › Empresa › Plano › Conexões extras. Teto efetivo = teto do
  plano (ou do override) + extras ativos; plano **sem** limite continua sem limite. Encerrar um extra não
  desconecta nada: só a próxima conexão é recusada.
- **Chave da instalação:** `ZERNIO_API_KEY` no `.env`. Sem ela, Instagram e Messenger aparecem desligados
  no popup, com o motivo. A tabela `channel_provider_keys` (chave por organização) saiu antes de ser
  distribuída.
- **Desconectar:** remove o webhook, a conta (`DELETE /v1/accounts/{id}`) e o profile na Zernio, e só
  então arquiva a sessão no CRM (histórico preservado). Se o provedor não confirmar a remoção da conta, a
  sessão **não** é arquivada e a tela mostra o erro, porque a conta segue cobrada enquanto existir lá.
