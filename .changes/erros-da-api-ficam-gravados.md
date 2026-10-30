---
impacto: capacidade_nova
secao: adicionado
titulo: O ID mostrado no aviso de erro passa a ter onde ser procurado
---

Quando uma ação falha, a tela mostra um "ID:" para mandar ao suporte, mas esse número não ficava guardado em lugar nenhum. Agora todo erro da API e toda falha inesperada de tela ficam gravados na tabela `api_error_log`, com o mesmo ID, a rota, o status, a mensagem e quem estava logado, e também aparecem numa linha do log do contêiner `app`. Para achar um erro: `select * from api_error_log where request_id = '<ID>';`. Os registros com mais de 30 dias são apagados pela limpeza diária. Quem atualiza recebe a tabela pelo `update.sh`, sem editar nada.
