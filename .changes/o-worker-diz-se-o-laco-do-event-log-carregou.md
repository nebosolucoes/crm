---
impacto: nada_mudou
secao: corrigido
titulo: O worker passa a dizer se o laço do event_log carregou, e a publicação exige isso antes de marcar stable
---

Nada muda na sua VPS: nenhuma migration, nenhuma variável, nenhum comando. O `/healthz` do worker passa a publicar um campo a mais (`event_log_drain`, com o motivo quando o laço não carregou) e a falha ao carregar o laço deixa de ser um aviso de rotina para ser erro — era o aviso que fazia um drain parado parecer normal, e foi assim que a fila do `event_log` ficou dez dias sem drenar com o worker respondendo saudável. Do lado da publicação, o CI passa a executar as imagens do worker e do scheduler antes de publicá-las: worker que não sobe ou laço que não carrega não vira a versão `stable` de quem self-hospeda. Crédito: @webtecnica.
