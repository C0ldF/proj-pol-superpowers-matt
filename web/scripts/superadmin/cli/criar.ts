import { parseArgs } from 'node:util';
import { criarSuperadmin } from '../criar-superadmin';
import { buildCriarSuperadminDeps } from '../build-criar-superadmin-deps';

const { values } = parseArgs({
  options: { email: { type: 'string' }, senha: { type: 'string' } },
});
if (!values.email || !values.senha) {
  console.error('uso: superadmin:criar --email <email> --senha <senha>');
  process.exit(1);
}

criarSuperadmin(values.email, values.senha, buildCriarSuperadminDeps())
  .then(() => console.log(`superadmin criado: ${values.email}`))
  .catch((err) => {
    console.error('erro ao criar superadmin:', err);
    process.exit(1);
  });
