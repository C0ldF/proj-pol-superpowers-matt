import { parseArgs } from 'node:util';
import { listarStagingPendente, promoverStaging, descartarStaging } from '../revisar-staging';
import { buildRevisarDeps } from '../build-revisar-deps';

const { values } = parseArgs({
  options: {
    importacao: { type: 'string' },
    id: { type: 'string' },
    'bairro-oficial-id': { type: 'string' },
    descartar: { type: 'boolean', default: false },
    operador: { type: 'string', default: process.env.USER ?? process.env.USERNAME ?? 'desconhecido' },
  },
});

const deps = buildRevisarDeps();

async function main() {
  if (values.id && values['bairro-oficial-id']) {
    const r = await promoverStaging(values.id, values['bairro-oficial-id']!, values.operador!, deps);
    console.log(`staging ${values.id} promovido: ${r.promovido}`);
    return;
  }
  if (values.id && values.descartar) {
    await descartarStaging(values.id, values.operador!, deps);
    console.log(`staging ${values.id} descartado`);
    return;
  }

  const pendentes = await listarStagingPendente(values.importacao, deps);
  console.log(`${pendentes.length} linha(s) pendente(s) de revisão:`);
  for (const p of pendentes) {
    console.log(`  ${p.id} — motivos=[${p.motivos.join(', ')}] bairro="${p.linhaOriginal.bairro}" local="${p.linhaOriginal.localVotacao}"`);
  }
}

main().catch((err) => {
  console.error('erro na revisão:', err);
  process.exit(1);
});
