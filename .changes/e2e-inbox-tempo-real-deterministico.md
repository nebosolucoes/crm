---
impacto: nada_mudou
secao: corrigido
titulo: A spec do inbox em tempo real volta a medir o que conserta o canal, e não só a tela
---

Nada muda na sua VPS: nenhuma migration, nenhuma variável, nenhuma imagem. O que muda é o que o teste mede. A spec do inbox em tempo real olhava só a saída — o texto na tela, que chega por dois caminhos por causa do `refetchOnWindowFocus` — e por isso ficava verde com o canal de tempo real mudo. Agora ela assere o que trafega no socket (`phx_join` autenticado e o `postgres_changes` com o corpo da mensagem) e reprova quando o conserto do #327 não está no bundle. Crédito: @webtecnica.
