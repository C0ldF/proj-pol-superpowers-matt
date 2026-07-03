import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
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
    operador: { type: 'string', default: process.env.USER ?? process.env.USERNAME ?? 'desconhecido' },
  },
});

if (!values.csv || !values.municipio || !values.ano) {
  console.error('uso: tre:ingest --csv <path> --municipio <cod_ibge> --ano <ano>');
  process.exit(1);
}

const buffer = readFileSync(values.csv);
const arquivoSha256 = createHash('sha256').update(buffer).digest('hex');
const arquivoTamanhoBytes = statSync(values.csv).size;
const linhas = parseCsvTre(buffer);

ingerirLote(
  {
    linhas,
    municipioId: Number(values.municipio),
    municipioNome: values['municipio-nome']!,
    uf: values.uf!,
    ano: Number(values.ano),
    arquivoNome: values.csv,
    arquivoSha256,
    arquivoTamanhoBytes,
    operador: values.operador!,
  },
  buildIngestDeps(),
)
  .then((r) => {
    console.log(
      `importacao ${r.importacaoId}: linhas=${r.totalLinhas} publicados=${r.totalPublicados} ` +
      `staging=${r.totalStaging} erros=${r.totalErros} — status=pendente_revisao (rode tre:revisar/tre:geocode/tre:publicar em seguida)`,
    );
  })
  .catch((err) => {
    console.error('erro na ingestão:', err);
    process.exit(1);
  });
