import { parseArgs } from 'node:util';
import { toggleModulo } from '../toggle-modulo';
import { buildToggleModuloDeps } from '../build-toggle-modulo-deps';
import { MODULOS, isModulo } from '../../../lib/modulos';

const { values } = parseArgs({
  options: { campanha: { type: 'string' }, modulo: { type: 'string' } },
});
if (!values.campanha || !values.modulo) {
  console.error('uso: modulos:desabilitar --campanha <uuid> --modulo <comunicacao|ia>');
  process.exit(1);
}
if (!isModulo(values.modulo)) {
  console.error(`módulo inválido: "${values.modulo}" — válidos: ${MODULOS.join(', ')}`);
  process.exit(1);
}

toggleModulo('desabilitar', values.campanha, values.modulo, buildToggleModuloDeps())
  .then(() => console.log(`módulo "${values.modulo}" desabilitado pra campanha ${values.campanha}`))
  .catch((err) => {
    console.error('erro ao desabilitar módulo:', err);
    process.exit(1);
  });
