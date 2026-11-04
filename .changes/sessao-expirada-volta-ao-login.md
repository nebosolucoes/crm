---
impacto: nada_mudou
secao: corrigido
titulo: Quando a sessão expira, a tela volta para o login em vez de ficar quebrada
---
Se a sessão acabava com o sistema aberto (expirou, ou houve saída em outra aba), as telas continuavam consultando o servidor, cada consulta recusada, até a pessoa recarregar à mão. Agora a primeira recusa leva ao login, e depois de entrar a pessoa volta para a mesma tela.
