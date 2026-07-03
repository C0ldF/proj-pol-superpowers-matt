import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { parseCsvTre } from '../parse-csv';
import { ingerirLote } from '../ingest';
import { buildIngestDeps } from '../build-ingest-deps';

const { values } = parseArgs({
  options: {
    csv: { type: 'string' },
    municipio: { type: 'string' },
    'municipio-nome': { type: 'string', default: 'TERESINA' },
    uf: { type: 'string', default: 'PI' },
    ano: { type: 'string' },
  },
});

if (!values.csv || !values.municipio || !values.ano) {
  console.error('uso: tre:dry-run --csv <path> --municipio <cod_ibge> --ano <ano>');
  process.exit(1);
}

const linhas = parseCsvTre(readFileSync(values.csv));

ingerirLote(
  {
    linhas,
    municipioId: Number(values.municipio),
    municipioNome: values['municipio-nome']!,
    uf: values.uf!,
    ano: Number(values.ano),
    arquivoNome: values.csv,
    arquivoSha256: '',
    arquivoTamanhoBytes: 0,
    operador: 'dry-run',
    dryRun: true,
  },
  buildIngestDeps(),
)
  .then((r) => {
    console.log(`[dry-run] linhas=${r.totalLinhas} importaria=${r.totalPublicados} staging=${r.totalStaging} erros=${r.totalErros}`);
  })
  .catch((err) => {
    console.error('erro no dry-run:', err);
    process.exit(1);
  });
