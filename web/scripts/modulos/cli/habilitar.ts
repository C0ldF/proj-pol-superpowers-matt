import { parseArgs } from 'node:util';
import { toggleModulo } from '../toggle-modulo';
import { buildToggleModuloDeps } from '../build-toggle-modulo-deps';
import { MODULOS, isModulo } from '../../../lib/modulos';

const { values } = parseArgs({
  options: { campanha: { type: 'string' }, modulo: { type: 'string' } },
});
if (!values.campanha || !values.modulo) {
  console.error('uso: modulos:habilitar --campanha <uuid> --modulo <comunicacao|ia>');
  process.exit(1);
}
if (!isModulo(values.modulo)) {
  console.error(`módulo inválido: "${values.modulo}" — válidos: ${MODULOS.join(', ')}`);
  process.exit(1);
}

toggleModulo('habilitar', values.campanha, values.modulo, buildToggleModuloDeps())
  .then(() => console.log(`módulo "${values.modulo}" habilitado pra campanha ${values.campanha}`))
  .catch((err) => {
    console.error('erro ao habilitar módulo:', err);
    process.exit(1);
  });
