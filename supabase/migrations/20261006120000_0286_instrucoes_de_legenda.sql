-- 0286 — Publicações: a instrução de legenda de cada rede ("prompt prévio")
--
-- O botão "Sugerir legenda" do Agendar manda à IA as imagens anexadas, o texto
-- que já está no campo (como ideia) e a INSTRUÇÃO da rede escolhida — o tom, o
-- tamanho, se leva hashtag, o que a marca nunca diz. Uma linha por (organização,
-- rede); sem linha = a instrução padrão do produto, que mora no código
-- (`lib/publicacoes/legenda/instrucoes.ts`) e por isso melhora com o produto.
--
-- Tabela e não `organizations.settings`: RLS e auditoria próprias, nenhuma
-- escrita concorrente sobrescreve outra chave do jsonb, e a porta fica aberta
-- para instrução por conta conectada sem migrar dado.
--
-- Vocabulário de `network` espelhado em `lib/publicacoes/schema.ts`
-- (REDES_DA_PUBLICACAO). Leitura: membro; escrita: manager — como as demais
-- tabelas de Publicações (0283).

create table if not exists public.publication_caption_instructions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  network text not null,
  instructions text not null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint publication_caption_instructions_network_check check (network in ('instagram', 'facebook', 'whatsapp')),
  constraint publication_caption_instructions_instructions_check check (char_length(instructions) between 1 and 4000),
  constraint publication_caption_instructions_org_network_key unique (organization_id, network)
);

drop trigger if exists trg_publication_caption_instructions_updated_at on public.publication_caption_instructions;
create trigger trg_publication_caption_instructions_updated_at
  before update on public.publication_caption_instructions
  for each row execute function public.fn_set_updated_at();

alter table public.publication_caption_instructions enable row level security;

drop policy if exists tenant_isolation_publication_caption_instructions_select on public.publication_caption_instructions;
create policy tenant_isolation_publication_caption_instructions_select on public.publication_caption_instructions
  for select using (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin());

drop policy if exists tenant_isolation_publication_caption_instructions_all on public.publication_caption_instructions;
create policy tenant_isolation_publication_caption_instructions_all on public.publication_caption_instructions
  for all using (
    public.fn_is_platform_admin()
    or (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'manager'))
  )
  with check (
    public.fn_is_platform_admin()
    or (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'manager'))
  );

revoke all on public.publication_caption_instructions from public, anon;
grant select, insert, update, delete on public.publication_caption_instructions to authenticated;
grant all on public.publication_caption_instructions to service_role;

comment on table public.publication_caption_instructions is
  'Instrução de legenda ("prompt prévio") por rede, usada por Sugerir legenda em Publicações. Sem linha = instrução padrão do produto (lib/publicacoes/legenda/instrucoes.ts).';

do $f$ begin perform public.fn_aplicar_travas_de_suporte(); end $f$;

notify pgrst, 'reload schema';
