---
impacto: capacidade_nova
secao: adicionado
titulo: Instagram Direct e Messenger entram no Atendimento, com o mesmo robô, filas e setores do WhatsApp
---
As mensagens diretas do Instagram e da página do Facebook (Messenger) agora chegam ao Atendimento junto com as do WhatsApp. A tela de Conexões virou uma lista única com todas as conexões — WhatsApp, Instagram e Messenger — e um botão "Adicionar conexão" que abre as opções. Ao escolher Instagram ou Messenger, a tela da Meta pede a autorização e você volta ao CRM já conectado; o webhook é registrado sozinho. "Desconectar" remove a conta também no provedor, para ela deixar de ser cobrada.

Para quem instala: Instagram e Messenger usam a chave da conta Zernio da instalação, `ZERNIO_API_KEY` no `.env`. Sem ela, as duas opções aparecem desligadas com o motivo; nada mais muda. Os planos ganharam limites por rede (WhatsApp, Instagram, Messenger), e o admin da instalação pode vender conexões extras por empresa, que somam ao plano.

Cada conta conectada vira um canal como os outros. Você pode amarrar a ela um agente de IA ou um roteador, as conversas caem na fila e nos setores do jeito de sempre, e o lead nasce no funil como "Novo contato pelo Instagram". Na inbox, as conversas dessas redes aparecem com o ícone da rede e o @ do perfil do cliente.

A regra de prazo é a da Meta: nas primeiras 24 horas depois da última mensagem do cliente, a IA e a equipe respondem à vontade. Depois disso a IA para, e uma pessoa ainda pode responder por até 7 dias — o selo "Só humano" mostra quanto tempo resta. Esses canais nascem em modo de teste, como todo canal: para a IA responder durante os testes, cadastre o @ do perfil de quem vai testar na lista de acesso da IA do canal.

O Instagram precisa ser uma conta profissional (comercial ou criador). Nada muda para quem não conectar essas redes.
