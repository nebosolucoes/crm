---
impacto: capacidade_nova
secao: adicionado
titulo: Botão de suporte em todas as telas e webhook que abre um card por erro
---

Em Admin › Widget de suporte, cole o código de instalação da sua central de chamados: o botão aparece em todas as telas logadas e já identifica quem está usando, com verificação HMAC feita pelo servidor. Em Admin › Webhook de erro, informe o link de um webhook (por exemplo, a integração por webhook da central de chamados): cada erro que o sistema apresentar é enviado na hora, assinado, com o mesmo ID que aparece na tela, e vira um card. Dá para mandar todos os erros ou só as falhas do sistema, e um teto de 60 envios por minuto evita enxurrada. O botão "Enviar teste" confirma a ligação. Os dois vêm desligados.
