---
impacto: nada_mudou
secao: corrigido
titulo: O webhook de erro abre um card por tipo de erro por hora, e não um por requisição
---
Uma rajada do mesmo erro abria um card para cada requisição na central de chamados. Agora o mesmo erro (mesma rota, status, código e mensagem) na mesma hora vira um card só, e o ID da primeira requisição continua no campo "ID do erro". O card também passa a mostrar o endereço real da instalação, e não mais `placeholder.invalid`. Erros sem mensagem passam a dizer o código e o status, e a conexão fechada pelo navegador no meio do carregamento deixa de ser registrada como erro.
