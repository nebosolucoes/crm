---
impacto: nada_mudou
secao: corrigido
titulo: Worker local volta a processar respostas automáticas
---
Quando o Supabase local roda no computador, o worker Docker agora alcança o banco pelo gateway do host em vez de reiniciar tentando conectar no próprio contêiner. Sugestões de resposta assistida também deixam de aguardar um checkpoint interno que não aparece nem é salvo no rascunho.
