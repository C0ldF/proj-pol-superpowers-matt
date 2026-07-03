# Ingestão TRE — pipeline em fases

Pipeline curado de importação do cadastro oficial do TRE (locais de votação,
seções, aptos) — Superadmin only, roda via CLI server-side (nunca no browser).
Env necessário: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY` (ver
`web/lib/supabase/server.ts#adminClient`).

## Fases (nesta ordem)

1. `npm run tre:seed-bairros -- --json <bairros.json> --municipio <cod_ibge>`
   Carrega/atualiza `bairro_oficial` a partir do JSON oficial de bairros.
   Idempotente — seguro rodar de novo. **Não é pré-requisito** pras fases
   2-3 abaixo: `local_votacao` (CSV do TRE) nunca casa bairro. Esta fase
   alimenta só a feature separada de `bairro_local`/reconciliação (ADR 0017,
   Tasks 8-9).

2. `npm run tre:dry-run -- --csv <arquivo.csv> --municipio <cod_ibge> --ano <ano>`
   Filtra o CSV (estadual) pelo `COD_LOCALIDADE_IBGE` informado e parseia
   **sem gravar nada**. Mostra quantas linhas do município virariam
   `local_votacao`, quantas ficariam em staging e quantas dariam erro de
   parse. Rode sempre antes do `tre:ingest` real.

3. `npm run tre:ingest -- --csv <arquivo.csv> --municipio <cod_ibge> --ano <ano> [--operador nome]`
   Cria o lote (`importacao_tre`), filtra o CSV pelo município pedido,
   parseia e insere em `local_votacao`/`secao` (linha válida) ou
   `local_votacao_staging` (erro de parse ou `NUM_LOCAL` duplicado na mesma
   zona). **Não geocodifica, não publica.** Termina em
   `status='pendente_revisao'`.

4. `npm run tre:revisar [-- --importacao <id>]`
   Lista staging pendente. Para resolver uma linha:
   `npm run tre:revisar -- --id <staging_id>` (promove pra `local_votacao`)
   ou `npm run tre:revisar -- --id <staging_id> --descartar` (descarta).

5. `npm run tre:geocode -- --importacao <id> [--retry]`
   Geocodifica (Nominatim/OSM, 1 req/s) os locais com `geo_status='pendente'`
   do lote. `--retry` também reprocessa quem falhou antes. Reexecutável
   livremente — nunca roda dentro do `ingest`.

6. `npm run tre:publicar -- --importacao <id>`
   Torna o lote visível pras campanhas (RLS liga em `status='publicado'`) e
   dispara a checagem de reconciliação de bairro (ADR 0017). Exige o lote em
   `pendente_revisao`. Falha se já existe outro lote `publicado` do mesmo
   município+ano — rode `tre:despublicar` no antigo primeiro.

7. `npm run tre:despublicar -- --importacao <id>`
   Arquiva um lote publicado (`'publicado' → 'arquivado'`), liberando o
   município+ano pra um novo `tre:publicar`.

`npm run tre:stats` lista todos os lotes e seus contadores a qualquer momento.

## Decisões que valem lembrar

- CSV do TRE é **Latin-1/CP1252**, nunca UTF-8 — decodificado automaticamente,
  não precisa converter o arquivo antes.
- CSV do TRE é **estadual**, não municipal — cobre todos os municípios do
  estado numa linha só de arquivo. `tre:dry-run`/`tre:ingest` filtram as
  linhas cujo `COD_LOCALIDADE_IBGE` bate com o `--municipio` pedido antes de
  qualquer outra coisa; as demais são descartadas silenciosamente (não
  contam em nenhum total do lote).
- **`local_votacao` não casa bairro contra `bairro_oficial`.** `bairro_oficial_id`
  vem sempre `NULL` do CSV do TRE — não há requisito de bairro pra uma linha
  virar `local_votacao`. `COD_BAIRRO` do CSV é sempre ignorado (lixo — ADR
  0011). O match fuzzy de bairro (`pg_trgm` + `unaccent`, `match_bairro_oficial`)
  continua existindo, mas só serve à feature separada de
  `bairro_local`/reconciliação (ADR 0017, Tasks 8-9) — não a este pipeline.
- Linha do CSV só cai em `local_votacao_staging` por erro de parse ou por
  `NUM_LOCAL` duplicado na mesma zona (ver abaixo) — nunca por bairro.
- `elegivel_calor` (mapa de calor do S4) não depende de `geo`/`geo_status`.
- Mapas de calor, mapa de apoiadores por CEP e "voto por local" **não fazem
  parte desta fatia** — ver seção "Notas para S4 e além" do spec
  (`docs/superpowers/specs/2026-06-30-s3-ingestao-tre-design.md`).
- `NUM_LOCAL` do TRE só é único **dentro da zona eleitoral**, não no
  município inteiro. Toda colisão de zona+`NUM_LOCAL` dentro do mesmo lote
  cai em `local_votacao_staging` com `motivos: ['num_local_duplicado_mesma_zona']`
  — nunca é auto-resolvida, fica pra revisão manual.
- Rodada real de referência (Task 27, lote `81d77111-c382-4849-9616-774d4fdff7f5`,
  Teresina/2211001/2026): CSV estadual bruto tem 3555 linhas; filtradas pro
  município são **334**; todas as 334 entraram em `local_votacao`
  (`publicados=334 staging=0 erros=0`) — nenhuma colisão de `NUM_LOCAL` nem
  erro de parse nesse lote. Uma tentativa anterior (Task 23) tratou
  erroneamente as 3555 linhas estaduais como se fossem todas de Teresina —
  lote contaminado, apagado; corrigido nas Tasks 24-26 (filtro de município)
  antes desta rodada.
- Os scripts `npm run tre:*` não carregam `.env.local` automaticamente nesta
  fatia — rode via `npx tsx --env-file=.env.local scripts/tre/cli/<fase>.ts ...`
  se as variáveis de ambiente não aparecerem.
