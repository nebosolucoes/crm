---
impacto: nada_mudou
secao: corrigido
titulo: Mídia recebida volta a usar o endereço do provedor configurado no ponto
---
Quando um ponto de IA era apontado para um serviço compatível — um endereço que não é o oficial do provedor, como um gateway interno —, o atendimento pelo chat funcionava, mas as imagens que os clientes enviavam continuavam sendo descritas pelo endereço oficial, e falhavam, porque a chave era daquele outro serviço. A leitura de mídia agora pega o endereço cadastrado no mesmo lugar em que o chat pega, então imagem e conversa usam o mesmo provedor. Quem nunca cadastrou endereço próprio não percebe diferença: vale o padrão do provedor, como antes. A transcrição de áudio não era afetada por este caminho.

Duas recusas passam a existir nesse caminho, e as duas abrem aviso na Central em vez de falharem em silêncio: se o endereço cadastrado apontar para dentro do próprio servidor (endereço local, rede interna do Docker, metadados da nuvem), a imagem e a chave não saem para lá; e se a empresa tiver endereço próprio cadastrado mas estiver usando a chave de IA da instalação, a leitura é recusada com a instrução de cadastrar a chave da empresa — a chave que paga a conta da instalação inteira não viaja para um endereço escolhido por uma das empresas.
