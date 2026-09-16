---
impacto: capacidade_nova
secao: adicionado
titulo: Áudio pode ser transcrito em outro serviço compatível, sem trocar a chave da conversa
---
Quem quiser transcrever áudio num serviço diferente do padrão — Groq, um Whisper próprio, qualquer endereço com o mesmo formato de transcrição da OpenAI — agora preenche `TRANSCRIPTION_API_KEY` no `.env`, e opcionalmente `TRANSCRIPTION_BASE_URL` (o endereço do serviço) e `TRANSCRIPTION_MODEL` (o modelo de transcrição). A chave vale só para a transcrição: a conversa com o cliente e a leitura de imagem continuam usando o provedor que já está configurado. Sem essas variáveis, nada muda — a transcrição segue usando a chave da OpenAI, e se ela também não existir, o comportamento é o de hoje, com o aviso na Central e a orientação para cadastrar a chave.
