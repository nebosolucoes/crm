-- 0288 — Registro de erros da API (`api_error_log`).
--
-- Toda resposta de erro da API devolve um `X-Request-Id`, e a tela o mostra
-- ("ID: …") para o usuário mandar ao suporte. Até aqui esse número não era
-- gravado em lugar nenhum: a auditoria só registra mutação BEM-SUCEDIDA, e o
-- `fail()` sorteava o ID e o esquecia. Quem recebia o ID não tinha onde
-- procurá-lo (medido em 30/10/2026 num ID real: zero linhas em todo o schema).
--
-- Agora cada `fail()` e cada exceção não tratada de request viram uma linha
-- aqui, procurável pelo ID que a tela mostrou.
--
-- Sem `organization_id` de propósito: o erro acontece muitas vezes ANTES de a
-- organização ser resolvida (sessão expirada, corpo inválido), e a tabela é de
-- diagnóstico da instalação, não dado do tenant. Nenhum papel do PostgREST lê
-- ou escreve; só o service role (o servidor) grava e o operador consulta.
--
-- Retenção: 30 dias, podada em lotes pelo cron `data-retention`.

create table if not exists public.api_error_log (
  id          uuid primary key default gen_random_uuid(),
  request_id  text not null,
  method      text,
  path        text,
  status      int  not null,
  code        text not null,
  message     text not null,
  details     jsonb,
  user_id     uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_api_error_log_request_id on public.api_error_log (request_id);
create index if not exists idx_api_error_log_created_at on public.api_error_log (created_at);

alter table public.api_error_log enable row level security;

-- O default ACL do Supabase concede tudo aos três papéis em toda tabela nova
-- de `public` (ver CLAUDE.md, migration 0258): o revoke é explícito.
revoke all on table public.api_error_log from anon, authenticated;

comment on table public.api_error_log is
  'Erros devolvidos pela API (fail()) e exceções não tratadas de request, procuráveis pelo X-Request-Id mostrado na tela. Só service role. Retenção de 30 dias (cron data-retention, fn_expurgar_erros_da_api).';

-- A quinta poda do `data-retention`. Assinatura idêntica às irmãs.
create or replace function public.fn_expurgar_erros_da_api(p_retencao_dias int, p_limite int default 1000)
returns int
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_removidas int;
begin
  -- Piso no CORPO: um chamador que passe 0 não apaga o erro de agora há pouco.
  if p_retencao_dias is null or p_retencao_dias < 7 then
    p_retencao_dias := 7;
  end if;

  with alvo as (
    select id
      from public.api_error_log
     where created_at < now() - make_interval(days => p_retencao_dias)
     limit greatest(p_limite, 1)
  )
  delete from public.api_error_log e
   using alvo
   where e.id = alvo.id;

  get diagnostics v_removidas = row_count;
  return v_removidas;
end$$;

revoke execute on function public.fn_expurgar_erros_da_api(int, int) from public, anon, authenticated;
grant execute on function public.fn_expurgar_erros_da_api(int, int) to service_role;
