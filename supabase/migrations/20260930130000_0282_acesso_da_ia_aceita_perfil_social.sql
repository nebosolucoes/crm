-- 0282 · O acesso da IA aceita o @ do perfil na lista de teste
--
-- A 0280 trouxe Instagram Direct e Messenger, e a tela de "Configurar acesso da
-- IA" passou a aceitar, além do telefone com DDI, o @ do perfil (`@minhaloja`)
-- — é por ele que se autoriza um testador numa rede que não tem telefone. O
-- schema da rota (`lib/ai/elegibilidade/pre-go-live.ts`) aceita; a função que
-- grava, não: ela ainda validava só `^\+[1-9][0-9]{7,14}$`, levantava 22023, e
-- a rota devolvia 500 — o operador via "Não foi possível confirmar o
-- salvamento" em TODA gravação com um @ na lista, inclusive no WhatsApp.
--
-- A regra do @ aqui é a MESMA do TypeScript (`USUARIO_DE_TESTE`): minúsculas,
-- dígitos, ponto e sublinhado, 1 a 30 caracteres. O TypeScript já normaliza
-- para minúsculas antes de chamar; o banco recusa o que não vier normalizado,
-- porque a comparação no gate é exata.
--
-- Só o corpo muda: assinatura, grants e `security invoker` ficam como na 0251.
-- Idempotente (`create or replace`).

create or replace function public.fn_configurar_pre_go_live_canal(
  p_org uuid,
  p_canal uuid,
  p_modo text,
  p_numeros text[]
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_linhas integer;
  v_gate text;
begin
  if p_modo is null or p_modo not in ('open', 'pre_go_live') then
    raise exception 'modo de acesso da IA inválido' using errcode = '22023';
  end if;

  if p_numeros is null or exists (
    select 1
      from unnest(p_numeros) as n(numero)
     where numero is null
        or (numero !~ '^\+[1-9][0-9]{7,14}$' and numero !~ '^@[a-z0-9._]{1,30}$')
  ) then
    raise exception 'lista de contatos de teste inválida' using errcode = '22023';
  end if;

  v_gate := case when p_modo = 'pre_go_live' then 'allowlist' else 'open' end;

  update public.channel_sessions
     set metadata = jsonb_set(
       jsonb_set(
         jsonb_set(coalesce(metadata, '{}'::jsonb), '{ai_gate}', to_jsonb(v_gate), true),
         '{ai_gate_mode}', to_jsonb(p_modo), true
       ),
       '{ai_test_phone_numbers}', to_jsonb(p_numeros), true
     )
   where organization_id = p_org
     and id = p_canal
     and archived_at is null;

  get diagnostics v_linhas = row_count;
  return v_linhas;
end;
$$;

revoke execute on function public.fn_configurar_pre_go_live_canal(uuid, uuid, text, text[])
  from public, anon, authenticated;
grant execute on function public.fn_configurar_pre_go_live_canal(uuid, uuid, text, text[])
  to service_role;

notify pgrst, 'reload schema';
