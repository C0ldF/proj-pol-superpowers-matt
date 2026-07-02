import { parseArgs } from 'node:util';
import { despublicarLote } from '../lote';
import { buildLoteDeps } from '../build-lote-deps';

const { values } = parseArgs({ options: { importacao: { type: 'string' } } });
if (!values.importacao) {
  console.error('uso: tre:despublicar --importacao <id>');
  process.exit(1);
}

despublicarLote(values.importacao, buildLoteDeps())
  .then(() => console.log(`lote ${values.importacao} arquivado`))
  .catch((err) => {
    console.error('erro ao despublicar:', err);
    process.exit(1);
  });
