-- 0287 — O setor é a regra principal da visibilidade (pedido do dono, 14/10/2026)
--
-- Até a 0278, setor só restringia conversa QUE TINHA setor. A conversa sem setor
-- caía no `visibility_mode` da organização (padrão `own_and_unassigned`), e com
-- isso a fila inteira sem setor aparecia para todo atendente — medido em
-- produção em 14/10: 161 conversas abertas sem setor visíveis ao atendente do
-- Financeiro, que só deveria ver o Financeiro. E gerente via tudo, sempre.
--
-- A regra nova, decidida pelo dono:
--   * admin e viewer: veem tudo (como antes);
--   * dono direto e quem está passando o bastão: veem (como antes);
--   * membro de setor `scope='all'`: vê tudo (como antes);
--   * conversa de setor ATIVO: só membros dele — e o gerente SEM setor nenhum,
--     que supervisiona a organização inteira;
--   * conversa sem setor (ou de setor inativo):
--       - gerente vê (é quem distribui para um setor);
--       - atendente que pertence a algum setor ativo NÃO vê;
--       - atendente sem setor nenhum segue o `visibility_mode`, byte a byte.
--
-- Organização sem setor criado: nada muda (todo mundo cai nos ramos antigos).
-- Só `create or replace` da função interna; a assinatura é a mesma, então
-- policies, RPCs e o realtime (que herda a RLS) passam a responder pela regra
-- nova sem mais nada. Idempotente.

create or replace function public.fn_user_can_view_conversation(
  p_user uuid,
  p_role text,
  p_org uuid,
  p_assigned_to_user_id uuid,
  p_sector_id uuid,
  p_handover_from_user_id uuid
) returns boolean
language sql stable security definer
set search_path = public
as $$
  with meus_setores as (
    select s.id, s.scope
      from public.sector_members m
      join public.sectors s on s.organization_id = m.organization_id and s.id = m.sector_id
     where m.organization_id = p_org and m.user_id = p_user and s.is_active
  )
  select case
    when p_user is null or p_role is null then false
    when p_role in ('viewer', 'admin') then true
    when p_assigned_to_user_id = p_user then true
    when p_handover_from_user_id = p_user then true
    when exists (select 1 from meus_setores where scope = 'all') then true
    -- Gerente fora de todo setor supervisiona a organização inteira.
    when p_role = 'manager' and not exists (select 1 from meus_setores) then true
    -- Conversa de setor ativo: só quem é do setor.
    when p_sector_id is not null and exists (
      select 1 from public.sectors s where s.organization_id = p_org and s.id = p_sector_id and s.is_active
    ) then exists (select 1 from meus_setores where id = p_sector_id)
    -- Daqui para baixo: conversa sem setor (ou de setor inativo).
    when p_role = 'manager' then true
    when exists (select 1 from meus_setores) then false
    else case coalesce(
           (select settings->>'visibility_mode' from public.organizations where id = p_org),
           'own_and_unassigned')
         when 'all' then true
         when 'own_and_unassigned' then p_assigned_to_user_id is null
         else false
       end
  end;
$$;

revoke all on function public.fn_user_can_view_conversation(uuid, text, uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_user_can_view_conversation(uuid, text, uuid, uuid, uuid, uuid) to service_role;
