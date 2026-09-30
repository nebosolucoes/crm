# Dashboard Comercial Nebo

Recriação em HTML, CSS e JavaScript da imagem fornecida. A composição de desktop foi ajustada para **1671 × 941 px**, com adaptação para telas menores.

Abra **nebo-dashboard.html** no navegador com dois cliques. Esse arquivo contém a fonte, as imagens, os estilos e os scripts e funciona sem internet ou instalação.

Para editar, use **index.html**, que mantém os pequenos recursos visuais na pasta **assets/**. Os cards e gráficos são HTML e SVG editáveis; somente o logo, o avatar e as miniaturas foram extraídos da referência. A fonte Inter acompanha sua licença em `assets/FONT-LICENSE.txt`.

Os valores são os dados demonstrativos da imagem. Busca de produtos, seletor de período do gráfico, alternância da métrica das promoções, abas de insights, menu móvel e detalhes em janelas estão implementados localmente. Não há integração com banco de dados, autenticação ou com as rotas do CRM. Alguns ícones foram redesenhados em SVG; a reprodução não é uma identidade pixel a pixel.

## Verificação

Verificação em Chromium com Playwright: renderização em desktop e celular, ausência de erros de JavaScript, ausência de rolagem horizontal na página móvel, busca com e sem resultados, troca das abas, seletores, abertura e fechamento de detalhes e menu móvel. Capturas em `preview-desktop.png` e `preview-mobile.png`.

## Escopo arquitetural

Este é um artefato de referência independente, não uma funcionalidade do produto distribuído. Entrada: imagem e dados demonstrativos; saída: HTML local e capturas para comparação. Porta de entrada: abertura do arquivo. Configuração: constantes e CSS no HTML. Busca e filtros alteram apenas a apresentação em memória. Não há mutações de negócio, demandas, decisões automáticas, IA, eventos ou processos assíncronos; auditoria, continuidade IA/humano, anti-morte e laço de aprendizado não se aplicam. Nenhuma rota, tabela ou configuração do CRM foi alterada.
