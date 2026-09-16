---
impacto: nada_mudou
secao: corrigido
titulo: Automação com condição de tag passa a funcionar quando a caixa difere
---
Numa automação, a condição sobre tags só disparava quando o texto digitado era idêntico à tag, maiúsculas incluídas: a regra escrita para "Google" não rodava para a tag "google", que é exatamente como o Inbox grava toda tag de contato. A regra existia, aparecia ativa na tela e nunca acontecia. Agora a condição compara a tag inteira sem diferenciar maiúsculas — "Google" pega "google" e continua não pegando "Google Ads", que é outra tag. Nada que funcionava antes deixa de funcionar, e nenhuma regra passa a alcançar quem não alcançava. Na tela de regras, o operador desses campos passa a se chamar "tem a tag", que é o que ele faz.
