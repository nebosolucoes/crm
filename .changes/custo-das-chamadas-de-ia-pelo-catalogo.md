---
impacto: capacidade_nova
secao: corrigido
titulo: O custo de cada chamada de IA aparece para todo modelo, inclusive via OpenRouter
---
A tela de Execuções e a de Uso mostravam "—" no custo de toda chamada feita por um modelo do OpenRouter (e de modelos novos da Anthropic), porque o motor só conhecia o preço de três modelos fixos. Agora o preço vem do catálogo de modelos que a instalação já sincroniza, e o histórico é recalculado na atualização a partir dos tokens que sempre foram gravados. Efeito prático: o teto de orçamento de IA da organização passa a ser consumido de verdade por uso via OpenRouter, e quem fornece o agente a um cliente consegue ver quanto cada execução custou.
