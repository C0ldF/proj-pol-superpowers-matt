import { listarLotes } from '../lote';
import { buildLoteDeps } from '../build-lote-deps';

listarLotes(buildLoteDeps())
  .then((lotes) => {
    if (lotes.length === 0) {
      console.log('nenhum lote importado ainda.');
      return;
    }
    for (const l of lotes) {
      console.log(
        `${l.id} — municipio=${l.municipioId} ano=${l.ano} status=${l.status} ` +
        `publicados=${l.totalPublicados ?? '-'} staging=${l.totalStaging ?? '-'} erros=${l.totalErros ?? '-'} ` +
        `publicado_em=${l.publicadoEm ?? '-'}`,
      );
    }
  })
  .catch((err) => {
    console.error('erro ao listar lotes:', err);
    process.exit(1);
  });
