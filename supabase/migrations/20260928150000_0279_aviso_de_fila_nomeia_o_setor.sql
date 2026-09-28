-- 0279 — O aviso "conversa aguarda um responsável" nomeia o SETOR (spec 20, fase 5).
--
-- Desde a 0278 uma conversa pode estar num setor, e o roteamento só a entrega a
-- membros dele. Quando ninguém do setor está disponível, o aviso da Central
-- dizia "Uma conversa aguarda um responsável" e mandava olhar os responsáveis
-- do CANAL — a tela errada para o problema. Agora o título nomeia o setor e o
-- corpo aponta para Configurações → Setores de atendimento. Sem setor, o texto
-- é o de sempre. O upsert passa a atualizar também o título: a conversa pode
-- ter mudado de setor entre um aviso e outro.
--
-- Corpo idêntico ao do baseline (apendice-do-baseline-nao-diverge-da-cadeia).

create or replace function public.fn_routing_unassigned_notice(p_org uuid,p_conversation uuid,p_reason text)
returns void language plpgsql security definer set search_path=public as $$
declare v_setor text;
begin
 if not exists(select 1 from public.conversations where organization_id=p_org and id=p_conversation and assigned_to_user_id is null
  and status in('open','pending','claimed','ai_handling')) then return;end if;
 -- Setores (migration 0279): o aviso nomeia o setor da conversa e aponta para a
 -- tela certa — quem lê a Central precisa saber QUAL fila está parada.
 select s.name into v_setor from public.conversations c
  join public.sectors s on s.organization_id=c.organization_id and s.id=c.sector_id and s.is_active
  where c.organization_id=p_org and c.id=p_conversation;
 insert into public.agent_inbox_items(organization_id,kind,severity,title,body,ref_kind,ref_id)
 values(p_org,'routing_unassigned','warn',
  case when v_setor is null then 'Uma conversa aguarda um responsável'
   else 'Uma conversa do setor '||v_setor||' aguarda um responsável' end,
  case when p_reason='invalid_channel' then 'Confira o canal de origem desta conversa nas Conexões.'
   when v_setor is not null then 'Confira quem atende no setor '||v_setor||' em Configurações → Setores de atendimento e a disponibilidade dessas pessoas. A distribuição continuará tentando.'
   else 'Confira os responsáveis do canal em Configurações → Atendimento e a disponibilidade da equipe. A distribuição continuará tentando.' end,
  'conversation',p_conversation)
 on conflict(organization_id,ref_id,kind) where kind='routing_unassigned'
 do update set status='open',title=excluded.title,body=excluded.body;
end;
$$;
revoke all on function public.fn_routing_unassigned_notice(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.fn_routing_unassigned_notice(uuid,uuid,text) to service_role;
