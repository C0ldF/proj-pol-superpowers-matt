import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { seedBairros, type BairrosJson } from '../bairros-seed';
import { buildBairrosSeedDeps } from '../build-bairros-seed-deps';

const { values } = parseArgs({
  options: {
    json: { type: 'string' },
    municipio: { type: 'string' },
  },
});

if (!values.json || !values.municipio) {
  console.error('uso: tre:seed-bairros --json <path> --municipio <cod_ibge>');
  process.exit(1);
}

const json = JSON.parse(readFileSync(values.json, 'utf8')) as BairrosJson;
const municipioId = Number(values.municipio);

seedBairros(json, municipioId, buildBairrosSeedDeps())
  .then(({ total }) => {
    console.log(`bairro_oficial: ${total} registros upsertados para município ${municipioId}`);
  })
  .catch((err) => {
    console.error('erro ao semear bairros:', err);
    process.exit(1);
  });
