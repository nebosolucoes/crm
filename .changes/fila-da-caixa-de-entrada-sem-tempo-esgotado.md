---
impacto: nada_mudou
secao: corrigido
titulo: A aba Fila da caixa de entrada deixa de estourar o tempo do banco em organizações com muito histórico
---
A aba Fila, que é a aba padrão da caixa de entrada, e o número dela nas abas filtram pelo campo "quem manda na conversa". O banco calcula esse campo conversa por conversa, consultando o contato de cada uma. Sem outro filtro, cada atualização da lista percorria todas as conversas da organização, inclusive o histórico fechado. Com dezenas de milhares de conversas, a consulta passava do limite de tempo do banco: a lista não abria ("canceling statement due to statement timeout") e as consultas presas esgotavam as conexões do banco para o resto do sistema.

Agora a Fila, a aba Automático e as posições da fila (usadas pelo MCP e pelo aviso de posição ao cliente) filtram antes pelo que esse campo já implica: conversa sem dono e não encerrada. São colunas comuns, então o histórico sai da conta antes do cálculo. O resultado é o mesmo. Medido com 60 mil conversas e usuário admin: a Fila passou de mais de 8 segundos (cancelada) para cerca de 1,3 segundo.
