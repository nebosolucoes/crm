---
impacto: capacidade_nova
secao: adicionado
titulo: Setores de atendimento pela API, transferência para um setor e limite de setores por plano
---
Os setores de atendimento (financeiro, comercial, suporte…) passam a existir na API: criar, editar, desativar e apagar um setor, e definir quem atende nele, em `/api/v1/sectors`. A transferência de conversa aceita agora um setor como destino, além de uma pessoa: a conversa fica sem dono na fila do setor, o rodízio a distribui entre os membros dele, e quem transferiu continua vendo e respondendo até alguém do setor mandar a primeira mensagem. Um atendente que já está em algum setor só transfere para pessoas dos seus setores; sem setores nada muda.

Cada agente de IA pode receber um setor de entrega, para onde a conversa vai quando ele chama um humano. Para quem administra a instalação, o plano ganhou o limite "Setores de atendimento": a criação é recusada ao chegar no teto, e um plano com 0 não tem setores. Tudo isto ainda é só pela API; as telas de setores e a escolha no diálogo de transferir chegam nas próximas versões.
