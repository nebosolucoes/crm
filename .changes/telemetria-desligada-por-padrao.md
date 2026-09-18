---
impacto: nada_mudou
secao: corrigido
titulo: Telemetria de erro desligada por padrão — nenhum erro sai da sua VPS sem você pedir
---
O código trazia um DSN do Sentry fixo, do projeto de origem, como destino padrão: `SENTRY_DSN`
vazio no `.env` — exatamente como os dois arquivos de exemplo saíam — fazia os erros de produção
da instalação irem para a conta de um terceiro. Nada na tela, nada no log de quem hospeda: o
default era mandar, e era preciso saber escrever `SENTRY_DSN=off` para não mandar.

Agora vazio significa **não enviar**. Quem quiser receber os próprios erros aponta `SENTRY_DSN`
para o seu Sentry e recebe tudo, como antes. Quem não configurar nada não manda dado nenhum a
lugar nenhum — e a linha de boot diz qual dos dois estados está em vigor.

Quem já tem uma instalação de pé não precisa fazer nada: a mudança entra no próximo deploy.
Para fechar antes disso, basta pôr `SENTRY_DSN=off` no `.env` da VPS e reiniciar.
