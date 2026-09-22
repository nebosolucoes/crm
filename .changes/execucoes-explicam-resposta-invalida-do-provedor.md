---
impacto: nada_mudou
secao: corrigido
titulo: A tela de Execuções explica por que o provedor de IA respondeu algo que o sistema não entendeu
---

Quando o provedor respondia com sucesso mas num formato inesperado — o caso mais comum é o Gemini barrar o pedido pelo filtro de segurança dele e devolver uma resposta sem conteúdo —, a execução aparecia como "erro desconhecido" com a frase técnica "Invalid JSON response" e nada mais. Agora a tela diz o que aconteceu: bloqueio pelo filtro do provedor (com o motivo que ele informou), resposta que não é JSON (com o início do corpo, para denunciar um proxy no caminho) ou formato que esta versão do sistema ainda não conhece (com as chaves recebidas e a razão do validador). A orientação de "o que fazer" acompanha cada caso. No mesmo conserto, a redação de chaves de API na mensagem de erro que a tela mostra passou a funcionar de fato — as expressões que a faziam estavam quebradas por um caractere invisível e nunca redigiam nada. Nada para configurar.
