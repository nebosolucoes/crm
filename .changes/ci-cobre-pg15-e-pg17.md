---
impacto: nada_mudou
secao: corrigido
titulo: O CI volta a medir a instalação em PostgreSQL 17, além do 15
---

Nada muda na sua VPS: nenhuma variável nova, nenhuma migration, nenhuma imagem. O que muda é o que o pipeline mede antes de a release sair — o gate de banco do CI voltou a rodar nas duas majors do PostgreSQL (15 e 17) e passou a exercitar também o `update.sh` sobre um banco COM DADOS, que é o caso da sua instalação e não o de um banco vazio. Crédito: @webtecnica.
