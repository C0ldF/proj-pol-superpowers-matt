import { parseArgs } from 'node:util';
import { geocodarPendentes } from '../geocode-pendentes';
import { buildGeocodePendentesDeps } from '../build-geocode-pendentes-deps';

const { values } = parseArgs({
  options: {
    importacao: { type: 'string' },
    retry: { type: 'boolean', default: false },
  },
});

if (!values.importacao) {
  console.error('uso: tre:geocode --importacao <id> [--retry]');
  process.exit(1);
}

geocodarPendentes(
  { importacaoId: values.importacao, incluirFalhados: values.retry },
  buildGeocodePendentesDeps(),
)
  .then((r) => {
    console.log(`geocode: total=${r.total} sucesso=${r.sucesso} falha=${r.falha}`);
  })
  .catch((err) => {
    console.error('erro no geocode:', err);
    process.exit(1);
  });
