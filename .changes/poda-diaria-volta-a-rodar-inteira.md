---
impacto: nada_mudou
secao: corrigido
titulo: A limpeza diária do histórico volta a rodar inteira, e uma etapa que falha não trava as outras
---
A limpeza diária do histórico falhava todo dia na etapa dos códigos de conexão com o Google, porque chamava essa etapa com nomes de parâmetro que o banco não reconhecia. As etapas seguintes não chegavam a rodar, e o registro de erros da API crescia sem limite. Agora a chamada usa os nomes certos, e cada etapa roda por conta própria: se uma falhar, as outras seguem e a falha aparece na auditoria com o motivo. A variável `CALENDAR_MIRROR_RETENTION_DAYS`, que nunca chegava à limpeza, passa a valer (o padrão continua 90 dias).
