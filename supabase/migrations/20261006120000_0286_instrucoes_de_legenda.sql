-- 0286 — Publicações: prompts de legenda, ligados às CONTAS que os usam
--
-- O botão "Sugerir legenda" do Agendar manda à IA as imagens anexadas, o texto
-- que já está no campo (como ideia) e um PROMPT — o jeito de escrever da marca:
-- tom, tamanho, se leva hashtag, o que nunca se diz.
--
-- O prompt é da MARCA, não da rede: uma organização pode ter dois perfis de
-- Instagram de empresas diferentes, e o Instagram e o Facebook da mesma empresa
-- falam do mesmo jeito. Então o prompt tem nome e se liga a CONTAS
-- (`channel_sessions`) de qualquer plataforma; no Agendar, as contas marcadas
-- dizem quais prompts estão em jogo, e com mais de um a tela pergunta qual usar.
-- Conta sem prompt usa o padrão do produto para a rede dela, que mora no código
-- (`lib/publicacoes/legenda/instrucoes.ts`) e melhora com o produto.
--
-- Uma conta pertence a NO MÁXIMO um prompt (PK em channel_session_id): é o que
-- torna a pergunta do Agendar finita e a resposta "qual prompt esta conta usa?"
-- única. Mover a conta de prompt é trocar a linha.
--
-- FKs compostas (organization_id, …): o prompt e a conta são da MESMA
-- organização do vínculo — o banco recusa o cruzamento, não só a aplicação.
-- Leitura: membro; escrita: manager — como as demais tabelas de Publicações (0283).

create table if not exists public.publication_caption_prompts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  instructions text not null,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint publication_caption_prompts_name_check check (char_length(btrim(name)) between 1 and 120),
  constraint publication_caption_prompts_instructions_check check (char_length(btrim(instructions)) between 1 and 4000),
  constraint publication_caption_prompts_org_id_unique unique (organization_id, id)
);

create index if not exists publication_caption_prompts_org_idx
  on public.publication_caption_prompts (organization_id, created_at);

drop trigger if exists trg_publication_caption_prompts_updated_at on public.publication_caption_prompts;
create trigger trg_publication_caption_prompts_updated_at
  before update on public.publication_caption_prompts
  for each row execute function public.fn_set_updated_at();

create table if not exists public.publication_caption_prompt_accounts (
  channel_session_id uuid primary key references public.channel_sessions(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  prompt_id uuid not null references public.publication_caption_prompts(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint publication_caption_prompt_accounts_prompt_org_fkey foreign key (organization_id, prompt_id)
    references public.publication_caption_prompts(organization_id, id) on delete cascade,
  constraint publication_caption_prompt_accounts_channel_org_fkey foreign key (organization_id, channel_session_id)
    references public.channel_sessions(organization_id, id) on delete cascade
);

create index if not exists publication_caption_prompt_accounts_prompt_idx
  on public.publication_caption_prompt_accounts (organization_id, prompt_id);

alter table public.publication_caption_prompts enable row level security;
alter table public.publication_caption_prompt_accounts enable row level security;

drop policy if exists tenant_isolation_publication_caption_prompts_select on public.publication_caption_prompts;
create policy tenant_isolation_publication_caption_prompts_select on public.publication_caption_prompts
  for select using (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin());

drop policy if exists tenant_isolation_publication_caption_prompts_all on public.publication_caption_prompts;
create policy tenant_isolation_publication_caption_prompts_all on public.publication_caption_prompts
  for all using (
    public.fn_is_platform_admin()
    or (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'manager'))
  )
  with check (
    public.fn_is_platform_admin()
    or (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'manager'))
  );

drop policy if exists tenant_isolation_publication_caption_prompt_accounts_select on public.publication_caption_prompt_accounts;
create policy tenant_isolation_publication_caption_prompt_accounts_select on public.publication_caption_prompt_accounts
  for select using (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin());

drop policy if exists tenant_isolation_publication_caption_prompt_accounts_all on public.publication_caption_prompt_accounts;
create policy tenant_isolation_publication_caption_prompt_accounts_all on public.publication_caption_prompt_accounts
  for all using (
    public.fn_is_platform_admin()
    or (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'manager'))
  )
  with check (
    public.fn_is_platform_admin()
    or (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'manager'))
  );

revoke all on public.publication_caption_prompts from public, anon;
grant select, insert, update, delete on public.publication_caption_prompts to authenticated;
grant all on public.publication_caption_prompts to service_role;
revoke all on public.publication_caption_prompt_accounts from public, anon;
grant select, insert, update, delete on public.publication_caption_prompt_accounts to authenticated;
grant all on public.publication_caption_prompt_accounts to service_role;

comment on table public.publication_caption_prompts is
  'Prompt de legenda (nome + instrução) usado por Sugerir legenda em Publicações. Ligado a contas por publication_caption_prompt_accounts; conta sem prompt usa o padrão da rede (lib/publicacoes/legenda/instrucoes.ts).';
comment on table public.publication_caption_prompt_accounts is
  'Qual prompt de legenda cada conta (channel_session) usa. No máximo um por conta.';

do $f$ begin perform public.fn_aplicar_travas_de_suporte(); end $f$;

notify pgrst, 'reload schema';
