import { parseArgs } from 'node:util';
import { publicarLote } from '../lote';
import { buildLoteDeps } from '../build-lote-deps';

const { values } = parseArgs({ options: { importacao: { type: 'string' } } });
if (!values.importacao) {
  console.error('uso: tre:publicar --importacao <id>');
  process.exit(1);
}

publicarLote(values.importacao, buildLoteDeps())
  .then((r) => console.log(`lote ${values.importacao} publicado. alertas de reconciliação gerados: ${r.alertasReconciliacao}`))
  .catch((err) => {
    console.error('erro ao publicar:', err);
    process.exit(1);
  });
