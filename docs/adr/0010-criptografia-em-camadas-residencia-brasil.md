# Criptografia em camadas + índice cego para CPF/título + residência no Brasil

"Criptografia avançada" é implementada por camadas, cada uma contra uma ameaça
específica — em vez de cifrar tudo (o que quebraria busca, dedup e mapas):

- **Trânsito:** TLS em tudo (Supabase + Vercel).
- **Repouso:** disco AES-256 (padrão Supabase).
- **Barreira de acesso principal:** **RLS** — a muralha do dia a dia.
- **Cifra de coluna onde agrega:** CPF e título guardados como **índice cego
  (HMAC) para busca/dedup + valor cifrado para exibição**; chave de cifra
  **fora** do banco. Permite "existe esse título?" sem texto puro e mantém
  CPF/título ilegíveis mesmo num vazamento do banco.
- **Residência:** Supabase na região **Brasil (São Paulo)**; Vercel próximo.

## Considered Options

- **Camadas + índice cego (escolhido).** Forte onde muda o jogo, sem quebrar
  dedup por título (ADR 0003) nem dashboards/mapas.
- **Cifra cega de CPF/título.** Rejeitado: inviabiliza dedup e login lookup.
- **Ponta-a-ponta ("nem o superadmin lê").** Rejeitado: inviabilizaria
  dashboards, buscas e mapa de calor.

## Consequences

- CPF/título: duas representações (HMAC + cifrado). Migração de chave exige
  recomputar índices.
- Decisão de mecanismo exato (função server-side vs extensão) fica para o build,
  mas o padrão índice-cego é fixo.
