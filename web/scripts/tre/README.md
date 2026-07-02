# Ingestão TRE — pipeline em fases

Pipeline curado de importação do cadastro oficial do TRE (locais de votação,
seções, aptos) — Superadmin only, roda via CLI server-side (nunca no browser).
Env necessário: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY` (ver
`web/lib/supabase/server.ts#adminClient`).

## Fases (nesta ordem)

1. `npm run tre:seed-bairros -- --json <bairros.json> --municipio <cod_ibge>`
   Carrega/atualiza `bairro_oficial` a partir do JSON oficial de bairros.
   Idempotente — seguro rodar de novo.

2. `npm run tre:dry-run -- --csv <arquivo.csv> --municipio <cod_ibge> --ano <ano>`
   Parseia + casa bairro **sem gravar nada**. Mostra quantas linhas
   virariam `local_votacao`, quantas ficariam em staging e quantas dariam
   erro de parse. Rode sempre antes do `tre:ingest` real.

3. `npm run tre:ingest -- --csv <arquivo.csv> --municipio <cod_ibge> --ano <ano> [--limiar 0.4] [--operador nome]`
   Cria o lote (`importacao_tre`), parseia, casa bairro, insere
   `local_votacao`/`secao` (bairro casado) ou `local_votacao_staging`
   (sem match / erro de parse). **Não geocodifica, não publica.** Termina em
   `status='pendente_revisao'`.

4. `npm run tre:revisar [-- --importacao <id>]`
   Lista staging pendente. Para resolver uma linha:
   `npm run tre:revisar -- --id <staging_id> --bairro-oficial-id <id>` (promove)
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
- `COD_BAIRRO` do CSV é sempre ignorado (lixo — ADR 0011); o casamento de
  bairro é só por nome normalizado (`pg_trgm` + `unaccent`, limiar padrão 0.4).
- Local sem bairro casado nunca aparece em `local_votacao` — só em
  `local_votacao_staging`, até revisão manual.
- `elegivel_calor` (mapa de calor do S4) não depende de `geo`/`geo_status`.
- Mapas de calor, mapa de apoiadores por CEP e "voto por local" **não fazem
  parte desta fatia** — ver seção "Notas para S4 e além" do spec
  (`docs/superpowers/specs/2026-06-30-s3-ingestao-tre-design.md`).
- `NUM_LOCAL` do TRE só é único **dentro da zona eleitoral**, não no
  município inteiro — descoberto rodando o CSV real (3555 linhas de
  Teresina/2026): 1176 linhas colidem zona+`NUM_LOCAL` com outra linha do
  mesmo lote (alguns números repetem até 6x na mesma zona). Toda colisão
  cai em `local_votacao_staging` com `motivos: ['num_local_duplicado_mesma_zona']`
  — nunca é auto-resolvida, fica pra revisão manual junto com
  `bairro_sem_match`.
- Os scripts `npm run tre:*` não carregam `.env.local` automaticamente nesta
  fatia — rode via `npx tsx --env-file=.env.local scripts/tre/cli/<fase>.ts ...`
  se as variáveis de ambiente não aparecerem.
