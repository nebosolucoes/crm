# Spec 20 — Setores de atendimento (times por departamento)

> Plano de desenvolvimento. Estado (2026-09-28): **fase 1 em execução** na branch
> `feat/setores-fase-1`, a partir da `nebo-custom` — o destino é **só o fork Nebo**, não o upstream.
> Decisões fechadas com o dono em 28/09: transferência para pessoa E para setor (§3.4);
> **passagem de bastão** (§2.4); uma pessoa em vários setores; notificações push de atribuição (§11).
> Lei que este plano obedece: `CLAUDE.md` (multi-tenancy, migrations, entitlements, sistema vivo),
> `docs/specs/13-spec-governanca-atendimento.md` (roteamento e visibilidade atuais),
> `docs/specs/01-spec-platform-base.md` §5.1 (plano × recurso × limite).

---

## 0. O problema

Hoje o produto não tem departamento. Medido no código antes deste plano:

- O agente de IA passa a conversa a humano por `request_human_handoff`, que aceita **só `reason`**
  (`lib/agent-engine/agent/human-handoff.ts:240`). A conversa fica em `pending`, sem dono, e cai no
  mesmo balde para todo mundo.
- Quem pega a conversa é decidido por `lib/routing/eligibles.ts`: membro ativo, disponível, dentro
  do horário, com folga e, se o número tiver política, **responsável por aquele número**. Não há
  filtro por área.
- O "roteador" de `app/app/ai/routers/` escolhe **qual agente de IA** responde. Nunca qual humano.
- Visibilidade do papel `agent` é `organizations.settings.visibility_mode`
  (`all | own_and_unassigned | own`), aplicada por `fn_can_view_conversation(org, assigned_to)`
  na RLS de `conversations` e `messages` (`supabase/baseline.sql:5326`). Não conhece área.
- Transferência é pessoa → pessoa, imediata, por `POST /api/v1/conversations/[id]/transfer`.

O pedido: **setor** (financeiro, comercial, suporte…) com atendentes e agentes de IA dentro dele;
a IA decide o setor no handoff; o atendente só vê as conversas dos seus setores, mas pode
transferir para outro setor; admin (e um setor de supervisão) vê tudo, com o que está respondido e
o que está pendente; e o número de setores é limite de plano.

## 1. Vocabulário e decisões fechadas

| Termo | Decisão | Por quê |
|---|---|---|
| Nome na tela | **Setor** | "Equipe" já é o nome de `/app/team` (todos os membros da organização) e de `team_invites`. Reusar a palavra confundiria as duas telas. |
| Tabelas | `sectors`, `sector_members` | Inglês snake_case como o resto do schema. |
| Conversa sem setor | **permitida** (`conversations.sector_id null`) | O núcleo continua inteiro com zero setores (doutrina de extensões, pergunta-chave). Sem setor, vale a regra antiga de visibilidade. |
| Usuário em vários setores | **permitido** | Clínica pequena tem a mesma pessoa no financeiro e na recepção. |
| Agente de IA | **um setor, opcional** (`ai_agents.sector_id null`) | O agente "financeiro" entrega ao setor financeiro por padrão. Sem setor, o handoff cai sem setor, como hoje. |
| Setor que vê tudo | `sectors.scope in ('own','all')` | Atende "um setor que consegue ver tudo" sem inventar papel novo. Supervisão = setor com `scope='all'`. |
| Papéis | `manager` e `admin` **seguem vendo tudo**; `viewer` também (é leitura org-wide hoje) | Não muda a matriz da spec 13 §4. O setor só **restringe o `agent`**. |
| Conversa atribuída a mim | **sempre visível**, mesmo fora dos meus setores | Transferência direta a uma pessoa não pode sumir da tela dela. |
| Transferência | **para pessoa** (existe) **e para setor** (nova), no mesmo diálogo | Pedido do dono. Pessoa: imediata, mantém o setor. Setor: sem dono, roteamento reaberto no setor novo. |
| Passagem de bastão | quem transferiu **continua vendo e respondendo** até o novo dono mandar a **primeira mensagem** ao cliente (§2.4) | Pedido do dono. Hoje a transferência é seca e o cliente pode ficar no vácuo entre um atendente e outro. |
| Política por número | **soma** com o setor (interseção) | Quem recebe = elegível do setor ∩ responsável do número (se houver política). Nenhuma das duas cercas afrouxa a outra. |
| Leads (kanban) | **fora da v1** | `crm_leads` não ganha setor agora. A RLS 0036 do kanban fica como está. Registrado como pendência em §9. |
| Limite de plano | chave `max_sectors` em `platform_plans.limits` | Plano é dado, recurso é código. `0` = plano sem setor; ausente/`null` = sem limite. Recurso dono: `inbox`. Não cria recurso vendável novo: um `sectors` em `RECURSOS_VENDAVEIS` exigiria gate em rota e página que não existem sem o setor, e o limite `0` já entrega "plano sem setores". |
| Destino (DoD 18) | **núcleo**, opcional por dado | Toca RLS, roteamento e a cadeia de handoff, que extensão não pode tocar. Com zero setores criados a operação comum continua idêntica à de hoje. |

## 2. Modelo de dados (migration `0278` — **implementada na fase 1**)

O que está abaixo é o desenho; o que vale é `supabase/migrations/20260928120000_0278_setores_de_atendimento.sql`
e o bloco `-- ---- setores de atendimento ... (migration 0278) ----` do `baseline.sql`. Três decisões
tomadas na implementação que o desenho original não tinha:

- **O bloco mora cedo no baseline**, logo depois da função de visibilidade da 0035 e antes da
  policy `conversations_select`, porque as funções `language sql` de worker que passam a chamá-lo
  (`fn_meet_delivery_current`, `fn_reply_delivery_policy`) são validadas na criação: numa
  instalação fresca, a função e as colunas precisam existir quando o arquivo chega lá.
- **A regra de visibilidade é uma função parametrizada por usuário e papel**
  (`fn_user_can_view_conversation`), interna, sem EXECUTE para `authenticated`. As duas cópias
  inline da regra que viviam nas funções de worker passaram a chamá-la. `fn_can_view_conversation`
  ganhou a sobrecarga `(org, dono, setor, bastão)`; a de dois argumentos ficou por compatibilidade
  e **nenhum chamador do baseline a usa** (os cinco foram editados no lugar; a migration carrega
  os corpos idênticos — `apendice-do-baseline-nao-diverge-da-cadeia` cobra o espelho).
- **FKs compostas com `on delete restrict`**, não `set null`: um `set null` composto anularia
  `organization_id` junto. Setor sai de circulação por `is_active=false`; apagar exige antes
  tirar as referências (a rota da fase 2 faz).

Também entrou já na fase 1, porque é SQL: `fn_conversation_assign` recusa quem chama com a sessão
e não VÊ a conversa (a RLS esconde a linha da lista, mas a RPC recebe o id — sem isso um agent de
fora do setor pegaria a conversa adivinhando o uuid) e grava o bastão; `fn_channel_routing_claim`
recusa candidato que não é membro do setor da conversa (`candidate_not_allowed`).

```sql
create table if not exists public.sectors (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  slug            text not null,                       -- o que o agente de IA usa no payload
  description     text not null default '',            -- vai para o prompt: "quando mandar para cá"
  scope           text not null default 'own',
  is_active       boolean not null default true,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint sectors_name_check  check (length(btrim(name)) between 1 and 60),
  constraint sectors_slug_check  check (slug ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  constraint sectors_scope_check check (scope in ('own','all')),
  unique (organization_id, id),
  unique (organization_id, slug)
);

create table if not exists public.sector_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sector_id       uuid not null,
  user_id         uuid not null,
  created_at      timestamptz not null default now(),
  primary key (sector_id, user_id),
  foreign key (organization_id, sector_id) references public.sectors(organization_id, id) on delete cascade,
  foreign key (organization_id, user_id)   references public.user_organizations(organization_id, user_id) on delete cascade
);
create index if not exists sector_members_org_user on public.sector_members(organization_id, user_id);

alter table public.conversations add column if not exists sector_id uuid;
alter table public.conversations
  add constraint conversations_sector_fk foreign key (organization_id, sector_id)
  references public.sectors(organization_id, id) on delete set null;   -- idempotente: guardar com if not exists no catálogo
create index if not exists idx_conversations_org_sector on public.conversations(organization_id, sector_id) where sector_id is not null;

alter table public.ai_agents add column if not exists sector_id uuid;
-- mesma FK composta (organization_id, sector_id) → sectors, on delete set null

alter table public.conversation_assignment_events add column if not exists from_sector_id uuid;
alter table public.conversation_assignment_events add column if not exists to_sector_id   uuid;
-- reason ganha 'sector_transfer' no CHECK (reconstruir o CHECK num bloco só; vocabulário TS em
-- lib/routing/ ou lib/inbox/ com constante compartilhada — o invariante
-- tests/invariants/vocabulario-banco-x-typescript.test.ts cobra paridade)
```

Regras que o schema mesmo garante:

- `on delete cascade` de `user_organizations` → sair da organização (ou ser revogado) sai dos
  setores. Mesmo padrão de `channel_routing_responsibles`.
- Apagar setor: `set null` nas conversas e agentes. **Desativar** (`is_active=false`) é o caminho
  normal; a rota de DELETE recusa quando há conversa aberta no setor (mesmo espírito de
  `platform_plans` com FK restrict).
- RLS: `tenant_isolation_sectors_*` e `tenant_isolation_sector_members_*` via `fn_user_org_ids()`.
  SELECT para todo membro da org (o atendente precisa listar setores para transferir). Escrita só
  `manager`+ (é configuração de governança, spec 13 §4). `revoke` de `anon`/`public` nas funções
  novas, as DUAS origens (doutrina de migrations, item 9).

### 2.1 Visibilidade: `fn_can_view_conversation` ganha o setor

Nova assinatura `fn_can_view_conversation(p_org, p_assigned_to_user_id, p_sector_id,
p_handover_from_user_id)`, que delega a `fn_user_can_view_conversation(user, role, ...)`. Ordem
das regras, e a ordem importa:

1. platform admin → vê; sem papel na org → não vê.
2. `viewer`/`manager`/`admin` → vê (inalterado).
3. `p_assigned_to_user_id = auth.uid()` → vê (inalterado, e é o que protege a transferência direta).
4. **novo:** `p_handover_from_user_id = auth.uid()` → vê (passagem de bastão, §2.4).
5. **novo:** o usuário é membro de algum setor ativo com `scope='all'` → vê.
6. **novo:** `p_sector_id` aponta para setor **ativo** → vê **somente se** é membro desse setor.
   Aqui termina: `visibility_mode` **não** se aplica a conversa com setor.
7. sem setor, ou setor inativo → regra antiga de `visibility_mode`, byte a byte.

Consumidores a reescrever no mesmo bloco (medir com `grep -n "fn_can_view_conversation\|visibility_mode" supabase/baseline.sql`):
policy `conversations_select`, `messages_select` (herda por `exists`), e as **duas regras
inline** em `baseline.sql:21366` e `:21687` que reimplementam a visibilidade à mão. Elas
precisam chamar a função, não copiar a regra de novo, senão o setor vale numa tela e não em outra.
Drop da assinatura antiga só depois de nenhuma policy apontar para ela.

### 2.2 Transferência entre setores: `fn_conversation_transfer_sector`

RPC `security definer`, **só `service_role`** (a rota valida a sessão e passa `p_actor`; a função
revalida papel e visibilidade no banco — instalar ou chamar não concede autoridade), uma
transação:

- valida ator `agent`+ na org, e que o ator **vê** a conversa hoje (`fn_user_can_view_conversation`);
- valida setor destino ativo da mesma org;
- `conversations.sector_id = destino`, `assigned_to_user_id = null`, `status = 'pending'`,
  `unread_count_for_assignee = 0`;
- insere `conversation_assignment_events(reason='sector_transfer', from_user_id=ator,
  to_user_id=null, from_sector_id, to_sector_id, changed_by, note)`;
- chama `fn_request_channel_routing(org, conversa)` para o roteamento distribuir dentro do setor
  novo. Essa função hoje só entra em `open/pending/claimed/ai_handling`; `pending` está coberto.
- Depois disso o ator, se for `agent` de outro setor, **deixa de ver** a conversa. É o
  comportamento pedido; a linha do tempo do lead registra a transferência (`registrarTrocaDeComando`)
  para o destino ver de onde veio.

### 2.4 Passagem de bastão (`conversations.handover_from_user_id`)

O pedido do dono: "quando transferir um atendimento, que ficasse disponível pra mim até o
atendente que vai assumir mandar a primeira mensagem". Hoje a transferência é seca e o cliente
pode ficar no vácuo entre um atendente e outro.

- **Começa** numa transferência pessoa → pessoa (`fn_conversation_assign`, `reason='transfer'`,
  dono anterior ≠ destino) e numa transferência para setor (`fn_conversation_transfer_sector`,
  se havia dono). A coluna guarda quem passou o bastão; `handover_started_at` marca quando.
- **Enquanto dura**, quem passou o bastão **vê e responde** como se ainda fosse dono: é a regra 4
  de `fn_user_can_view_conversation`. O novo dono também vê. Nunca existe um instante em que
  ninguém pode responder.
- **Termina** quando o **novo dono** manda a primeira mensagem ao cliente: gatilho
  `trg_handover_concluida_por_mensagem` em `messages` (`direction='outbound'`,
  `sent_by_user_id = assigned_to_user_id`). Mensagem da IA (sem autor humano) e mensagem de quem
  está passando o bastão **não** encerram. Também termina se a conversa volta para quem passava
  (`p_to_user_id = handover_from_user_id`) ou é devolvida à fila (`release`).
- Claim, rodízio e handoff **preservam** um bastão em curso: depois de uma transferência para
  setor, a conversa pode ser roteada a alguém e quem transferiu continua vendo até esse alguém
  responder.
- Quando é a IA que passa ao setor não há bastão: a IA fica em silêncio e a conversa vai direto
  para a fila do setor.
- Fica com o dono decidir depois: se a passagem deve terminar **na primeira mensagem** (o que está
  implementado) ou já **no claim**. A primeira mensagem é a única prova de que o cliente foi
  atendido; é a recomendação.

### 2.3 Entitlement: `max_sectors`

Seguir a receita do cabeçalho de `lib/entitlements/limites.ts`:

- chave em `CHAVES_DE_LIMITE`, meta `{ recurso: "inbox", unidade: "quantidade", enforced: true }`;
- medidor em `lib/entitlements/consumo.ts`: `count(sectors) where organization_id = org and is_active`;
- `recusaPorLimite` em `POST /api/v1/sectors`;
- atualizar o `comment on column platform_plans.limits` com a chave nova;
- a aba Plano do admin já lista todas as chaves de `CHAVES_DE_LIMITE`, então aparece sozinha.
  Confirmar na tela, não supor.

Sem migration de dado: planos existentes ficam sem a chave = sem limite. Se o produto quiser
"plano básico sem setores", o platform admin grava `max_sectors: 0` no plano pela tela.

## 3. Roteamento e handoff

### 3.1 Elegíveis por setor (`lib/routing/eligibles.ts`)

`RoutingScope` de `conversation_channel` ganha `sectorId: string | null`. Quando não nulo:

- carrega `sector_members` do setor; **vazio = ninguém** (mesma leitura explícita da política por
  número: setor configurado sem gente é restrição, não ausência);
- `allowed = membros_do_setor ∩ responsáveis_do_número` quando o número tem política; só os
  membros quando não tem.

O `worker.ts:172` passa `conv.sector_id` no escopo (a `select` da linha 146 inclui a coluna).
Sem elegível o fluxo atual já faz a coisa certa: espera crescente e aviso `routing_unassigned`
(`baseline.sql:22302`). O texto do aviso passa a nomear o setor ("Uma conversa do setor
Financeiro aguarda um responsável"), e a `fn_emit_conversation_routing` também dispara quando
`sector_id` muda (hoje dispara em perda de dono e mudança de disponibilidade).

O `crm_get_queue_status` e o `crm_request_human_handoff` do MCP usam o mesmo carregador e
passam a respeitar o setor sem código próprio.

### 3.2 A ferramenta do agente ganha `sector`

`request_human_handoff` em `lib/agent-engine/agent/inbound-turn.ts:296` e
`requestHumanHandoffInputSchema` em `human-handoff.ts:240`:

```ts
z.strictObject({
  reason: z.string().min(1).max(500).optional(),
  sector: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/).optional(),  // slug
})
```

Resolução do destino em `performHumanHandoff`, nesta ordem:

1. `sector` no payload → tem de ser slug de setor **ativo da org**; desconhecido devolve erro de
   ensino ao modelo (padrão já usado: `invalid_payload` com a lista de slugs válidos), sem lançar;
2. sem payload → `ai_agents.sector_id` do agente que está atendendo;
3. sem nenhum → `sector_id` fica como está na conversa (pode ser `null`).

O `performHumanHandoff` grava `conversations.sector_id` junto com o resto do UPDATE que já faz
(`force_human`, `pending`, `bot_silenced_until`). O aviso `agent_inbox_items(kind='handoff')`
recebe o nome do setor no título e no contexto.

Para o modelo escolher bem, o runtime injeta no system prompt um bloco fixo, só quando a org tem
≥1 setor ativo:

```
Setores disponíveis para request_human_handoff (use o slug em `sector`):
- financeiro — boletos, reembolso, cobrança, nota fiscal
- comercial — orçamento, proposta, fechamento
Se nenhum se aplicar, não envie `sector`.
```

A `description` de cada setor é o que o admin escreve na tela; é o mesmo campo que a spec 12
usa para `intent_description` no roteador, e o guia `deskcomm-cliente-novo` passa a orientar a
escrevê-la. O gatilho automático por frase ("me passa pro financeiro",
`human-handoff.ts:54-66`) **não** tenta adivinhar setor na v1: cai na regra 2.

### 3.3 A ferramenta do MCP

`crm_request_human_handoff` (`lib/mcp/tools/handoff.ts`) ganha `sector_id` opcional, com a
mesma resolução. `target_user_id` continua tendo precedência quando elegível. Segue bloqueada
para o motor de IA (`BLOCKED_TOOL_IDS`); nada muda ali.

### 3.4 Rota de transferência

**As duas opções, confirmadas pelo dono em 28/09:** transferir para uma **pessoa** (já existe)
ou para um **setor** (nova), no mesmo diálogo, em duas abas.

Opção escolhida: **estender** `POST /api/v1/conversations/[id]/transfer` com
`to_sector_id` (mutuamente exclusivo com `to_user_id`, Zod `refine`). Uma rota, um diálogo na
tela, uma auditoria (`conversation.sector_transferred`). Corpo de `to_sector_id` chama a RPC do
§2.2 com o **admin client** e `p_actor` = usuário da sessão validada (a RPC é só `service_role` e
revalida papel e visibilidade no banco); corpo de `to_user_id` segue como está. Quando
`to_user_id` aponta para alguém fora do setor atual, a conversa **mantém** o setor e a pessoa a
vê por estar atribuída (regra 3 do §2.1). Nas duas formas começa a passagem de bastão (§2.4).

Quem pode escolher quem: `manager` e `admin` transferem para qualquer pessoa ou setor; o `agent`
transfere para qualquer setor e para pessoas dos setores dele.

## 4. Telas

| Tela | O que muda | Porta (`lib/navigation/catalogo.ts`) |
|---|---|---|
| **Configurações › Setores** (`app/app/settings/setores/`) | CRUD de setor: nome, slug (gerado do nome, editável), descrição para a IA, escopo (só o próprio / todos), ativo. Membros por setor (mesmo componente de "Responsáveis por número" de `settings/atendimento/_channels-form.tsx`). Agentes de IA do setor (lista, com link para o agente). Aviso inline quando o setor não tem nenhum membro disponível agora. Contador "N de M setores do plano". | novo destino no grupo `organizacao`, `exigirRecurso("inbox")`, `manager`+ |
| **IA › Agentes › [id]** | select "Setor de entrega" (`ai_agents.sector_id`). | já tem porta |
| **Inbox** (`app/app/inbox/`) | chip do setor no cartão da conversa; filtro por setor (só os setores que o usuário vê); diálogo de transferir ganha aba "Para um setor". | já tem porta |
| **Equipe** (`/app/team`) | coluna "Setores" por membro, só leitura, link para Configurações › Setores. | já tem porta |
| **Central de avisos** | avisos `handoff` e `routing_unassigned` mostram o setor. | já tem porta |
| **Análise › Setores** (painel novo em `/app/metrics` ou seção própria) | por setor: pendentes sem dono, pendentes com dono, respondidas hoje, tempo até 1ª resposta. `manager`+ e membros de setor `scope='all'`. É a resposta a "o que foi respondido e o que está pendente". Reusa as views da spec 13 §6 agrupando por `sector_id`. | grupo `analise`, `exigirRecurso("analytics")` |

Todas passam pelas cercas `tests/unit/paginas-exigem-recurso.test.ts`,
`tests/unit/rotas-declaram-recurso.test.ts` e `tests/unit/navegacao-completude.test.ts`.

## 5. Sistema vivo (DoD 13) — respostas nomeando artefato

- **Entrada + saída:** entra pelo handoff da IA, pela transferência e pelo roteamento; sai na RLS
  (quem vê), no `eligibles.ts` (quem recebe) e no painel por setor.
- **Emite atividade/log:** `conversation_assignment_events(reason='sector_transfer')`,
  `api_audit_log` nas rotas de setor e na transferência, linha do tempo do lead via
  `registrarTrocaDeComando`.
- **Aparece na tela:** chip no inbox, Configurações › Setores, painel por setor.
- **Porta na navegação:** dois destinos novos no catálogo (§4).
- **Anti-morte:** setor sem elegível → `routing_unassigned` nomeando o setor (aviso já existe,
  ganha o nome); setor com zero membros → aviso inline na tela de Setores e aviso `warn` na Central
  quando uma conversa cai nele; agente de IA apontando para setor desativado → o handoff cai sem
  setor e a Central registra "setor inativo" no aviso de handoff.
- **Laço de retorno (invariante 7):** se a IA manda para o setor errado, o atendente transfere para
  o certo, e `sector_transfer` com `from_sector_id ≠ to_sector_id` logo após um `handoff` é
  **métrica**: "handoffs redirecionados por setor de origem" no painel, para o admin afinar a
  descrição do setor ou o prompt (`deskcomm-prompt`).
- **Mapa vivo:** `docs/architecture/setores-de-atendimento.architecture.json` com arestas para
  `roteamento-por-canal`, `escalacao-ciclo-humano`, `planos-e-entitlements` e
  `organizacoes-e-acesso`.

## 6. Testes (o que prova cada peça)

**Invariantes (`pnpm test:db`, obrigatório: toca RLS e roteamento)**

- Duas orgs, um setor em cada com o mesmo slug: nada vaza (tenant isolation das tabelas novas).
- `agent` membro de Financeiro **não** faz SELECT em conversa com `sector_id=Comercial`; faz em
  conversa sem setor conforme `visibility_mode`; faz na conversa atribuída a ele mesmo em qualquer
  setor; membro de setor `scope='all'` vê todas; `manager` vê todas.
- `messages` herda: agent fora do setor lê 0 mensagens da conversa.
- `fn_conversation_transfer_sector`: muda setor, zera dono, grava evento, insere
  `routing_requested`; recusa setor de outra org e setor inativo; recusa ator que não vê a
  conversa.
- Paridade CHECK × TypeScript: `reason` com `sector_transfer`; `scope`.
- `hardening-definer-varredura` cobre as funções novas sozinho; confirmar que ficaram verdes e não
  na allowlist.
- Baseline `install` (`ON_ERROR_STOP=1`) e `update` num banco com conversas existentes.

**Unit (`pnpm test:unit`, sem caminho)**

- `eligibles.ts`: setor sem membros = `[]`; interseção com política de número; setor nulo = igual a
  hoje (snapshot do comportamento atual antes de mexer).
- `requestHumanHandoffInputSchema`: aceita `sector` slug; recusa campo extra; slug desconhecido
  vira erro de ensino com a lista.
- Resolução do destino (payload > agente > conversa).
- `limites.ts`/`consumo.ts`: `max_sectors` medido e barrado; `0` recusa a primeira criação.
- Cercas existentes: recurso em rota/página, navegação, `cron-audita-so-quando-ha-efeito`.

**E2E (Playwright, ambiente fresco estilo VPS, evidência em `.superpowers/evidence/`)**

- **[P0]** admin cria Financeiro e Comercial pela tela, põe A no Financeiro e B no Comercial.
- **[P0]** conversa chega, agente de IA do Comercial faz handoff → aparece para B, **não** para A.
- **[P0]** B transfere para Financeiro → some da tela de B, aparece para A, linha do tempo mostra.
- Plano com `max_sectors: 2` → terceiro setor recusado com mensagem clara na tela.
- Painel por setor mostra a conversa como pendente e, depois da resposta de A, como respondida.

Registrar as jornadas em `docs/testing/user-journey-map.md`.

## 7. Fases e ordem de entrega

Cada fase é PR próprio, mergeável sozinho, sem quebrar quem não criou setor nenhum.

| Fase | Entrega | Prova de aceite | Tamanho |
|---|---|---|---|
| **1. Schema + RLS** (branch `feat/setores-fase-1`) | migration 0278, apêndice do baseline, MANIFEST, `database.types.ts`, `fn_user_can_view_conversation` + `fn_can_view_conversation` nova, passagem de bastão (§2.4), `fn_conversation_transfer_sector`, vocabulário TS (`SECTOR_SCOPES`, `ASSIGNMENT_REASONS`) | `tests/invariants/setores-de-atendimento.test.ts`; `test:db` install+update verdes; org sem setor se comporta byte a byte como antes | M |
| **2. API + limite** | `/api/v1/sectors` (CRUD, `manager`+), `/api/v1/sectors/[id]/members`, `max_sectors` enforced, `transfer` com `to_sector_id`, `ai_agents` PATCH aceita `sector_id` | unit + cerca de recurso; auditoria em toda mutação | M |
| **3. Roteamento + handoff** | `eligibles.ts` por setor, worker passa o escopo, tool `request_human_handoff` com `sector`, prompt injeta setores, `performHumanHandoff` grava setor, MCP `sector_id`, avisos nomeiam setor | unit do §6; teste do worker com setor sem membro caindo em `routing_unassigned` | M |
| **4. Telas** | Configurações › Setores, select no agente, inbox (chip, filtro, transferir para setor), Equipe (coluna) | e2e P0 do §6 em ambiente fresco; medidas por ferramenta | G |
| **5. Visão gerencial** | painel por setor (pendente/respondido/sem dono), métrica de handoff redirecionado, Central com setor | e2e do painel; snapshot dos números por SQL de controle | M |
| **5b. Notificações** (§11) | eventos `conversation.assigned` e `conversation.sector_pending`, handler de push para os dois, push de mensagem recebida só para quem vê, categorias na tela, VAPID gerado pelo `install.sh`, botão "Enviar notificação de teste" | `event_log` consumido com `sent:N`; unit do handler; prova manual no Chrome com screenshot | M |
| **6. Fechamento** | `.changes/setores-de-atendimento.md` (`capacidade_nova`), mapa `docs/architecture/`, `docs/current-state.md`, spec 13 §5 aponta para esta, guia `deskcomm-cliente-novo` ensina a descrição do setor, `AGENTS.md` se doutrina mudou | `pnpm release:conferir`; `gov:verify`; `test:db`; `test:e2e` | P |

Dependências: 2 depende de 1; 3 depende de 1; 4 depende de 2 e 3; 5 depende de 4. As fases 2 e 3
podem correr em paralelo em branches separadas, **cada uma atualizada com a base antes de começar**
(higiene de branches).

## 8. O que este plano deixa explicitamente de fora (v1)

- Setor em **leads** e no kanban (RLS 0036 não muda). Um lead segue visível pela regra atual mesmo
  que a conversa dele esteja em setor fechado ao atendente. Pendência com nota para v2.
- **Casos** (`agent_cases.kind` já tem `financeiro` como categoria de fila): não ganha `sector_id`
  agora; a categoria continua separando a fila da tela de casos.
- Setor por **número** (um WhatsApp inteiro pertencer a um setor): a política de responsáveis por
  número já cobre; somar as duas cercas atende sem coluna nova.
- Reconhecer o setor a partir da **frase do lead** no gatilho automático de handoff.
- Modo de roteamento `load` (menor carga): continua pós-MVP como na spec 13.
- Setor como **extensão declarativa**: recusado, porque toca RLS e cadeia de handoff (núcleo).

## 9. Riscos e como medir

- **Migrar a assinatura de `fn_can_view_conversation` em clone com dados.** Policies apontam para
  a assinatura antiga; criar a nova, reapontar policies, só então dropar a velha, tudo no mesmo
  bloco idempotente. Provar com `pnpm test:db:update`.
- **Regras de visibilidade duplicadas inline** (`baseline.sql:21366`, `:21687`). Se uma delas ficar
  sem o setor, o atendente vê a conversa numa lista e não em outra. O invariante do §6 tem de
  exercitar as duas superfícies, não só a policy.
- **Performance da RLS.** `fn_user_sector_ids` por statement, índice parcial em
  `conversations(organization_id, sector_id)`. Medir `explain analyze` da listagem do inbox com
  5 mil conversas antes e depois; o número entra no PR, não aqui.
- **Prompt maior a cada turno.** O bloco de setores é curto (uma linha por setor) e só entra com
  ≥1 setor. Medir tokens de sistema antes/depois em `ai_runs`.
- **Plano sem chave = sem limite.** É a semântica de todas as chaves hoje; quem quiser vender
  "sem setores" grava `0`. A aba Plano mostra "sem limite" para ausente, e isso tem de estar
  visível para o platform admin não se surpreender.

## 10. Para quem for implementar

1. Ler `CLAUDE.md` inteiro, `docs/specs/13-spec-governanca-atendimento.md` §3.5, §4 e §5, e o
   cabeçalho de `lib/entitlements/recursos.ts` e `limites.ts`.
2. Carregar a skill `deskcomm-contribuir` antes do primeiro commit (este clone é de contribuidor).
3. Atualizar a branch com a base antes de codar. **Decidido em 28/09: só o fork** — a base é
   `nebo-custom`, e nada disto sobe para o upstream `melgarafael/DeskcommCRM`.
4. Antes de tocar `eligibles.ts`, gravar um teste que congela o comportamento atual sem setor.
   É a prova de que "zero setores = produto de hoje".
5. Rodar `pnpm test:db` local antes de abrir cada PR das fases 1 e 3. `gov:verify` não cobre.

## 11. Notificações push (decidido em 28/09; fase 5b)

**O que já existe, medido em `lib/notifications/`:** Web Push real, com aba fechada, via
`push_subscriptions` e o handler `web-push-inbound.v1` que consome o `event_log`. Exige o par
`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` no `.env`; sem ele só há aviso na bandeja com a aba aberta,
e a tela de Notificações diz isso. Eventos com push hoje: mensagem recebida, lead atribuído,
lead ganho, lead perdido, menção.

**O que NÃO existe hoje, medido:**

- **Push quando uma conversa é atribuída a você.** `conversation.claimed` e
  `conversation.transferred` estão no vocabulário do `event_log`, mas nada os emite;
  `fn_conversation_assign` não escreve no `event_log`. Rodízio, transferência e handoff acontecem
  em silêncio para quem recebeu.
- **Push de mensagem recebida vai para a organização inteira** (`enviarPushDaOrg`). Com setores
  vira vazamento: o financeiro recebe push da conversa do comercial que ele nem pode abrir.
- **O `install.sh` não gera as chaves VAPID**: só copia a variável se ela já existir. Numa VPS
  fresca o push com aba fechada nasce desligado.

**O que entra (fase 5b):**

1. Emitir `conversation.assigned` em toda atribuição (rodízio, transferência, handoff com
   destino) e `conversation.sector_pending` quando uma conversa cai num setor sem dono — inclusive
   quando é a própria IA que transfere.
2. Handler de push para os dois: "Conversa atribuída a você" para a pessoa; "Nova conversa no
   setor Financeiro aguardando" para os membros do setor. Durante a passagem de bastão, quem
   passou recebe "Fulano assumiu" quando a passagem termina.
3. Trocar o push de mensagem recebida de "organização inteira" para "quem vê a conversa": dono
   (e quem passa o bastão), senão membros do setor, senão a regra de visibilidade atual — a
   mesma `fn_user_can_view_conversation`, chamada por usuário inscrito.
4. Categorias novas na tela de Notificações (`conversation_assigned`, `sector_pending`), com
   interruptor próprio. As preferências hoje são `localStorage` por navegador; fica assim na v1.
5. O `install.sh` gera o par VAPID sozinho quando ausente (`web-push generate-vapid-keys`), sem
   pedir edição manual — regra da doutrina de packaging.
6. Botão **"Enviar notificação de teste"** em Configurações › Notificações. É a única prova ponta
   a ponta na instalação do cliente: o Playwright não recebe push real. No CI a prova é a linha do
   `event_log` consumida com `sent:N` mais os testes do handler.

Limites de plataforma que não são nossos: push exige HTTPS (a VPS com domínio já tem) e no
iPhone só funciona com o site instalado na tela inicial como aplicativo.
