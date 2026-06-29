// supabase/seed/s1_seed_usuarios.mjs
// Seed de usuários de teste do S1 (1 Gestor por campanha).
//
// Execução:
//   node supabase/seed/s1_seed_usuarios.mjs
//
// Variáveis de ambiente obrigatórias:
//   SUPABASE_URL ou NEXT_PUBLIC_SUPABASE_URL  — URL do projeto Supabase
//   SUPABASE_SECRET_KEY                       — chave service-role (nunca exposta no front)
//   CPF_HMAC_KEY                              — segredo HMAC para hash do CPF (≥32 bytes aleatórios)
//
// Nota de execução: @supabase/supabase-js deve ser resolvível no momento da chamada.
// O pacote está instalado em web/node_modules. Execute de dentro de web/ ou garanta
// que a dependência esteja disponível na raiz (ex.: npm i @supabase/supabase-js na raiz).

import { createClient } from '@supabase/supabase-js';
import { createHmac } from 'node:crypto';

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const hmac = (cpf) => createHmac('sha256', process.env.CPF_HMAC_KEY).update(cpf).digest('hex');

// CPFs de teste válidos (dígitos verificadores corretos).
const usuarios = [
  { sub: 'campanha-a', email: 'gestor.a@teste.local', senha: 'SenhaForte!A1', cpf: '52998224725', papel: 'gestor' },
  { sub: 'campanha-b', email: 'gestor.b@teste.local', senha: 'SenhaForte!B1', cpf: '11144477735', papel: 'gestor' },
];

for (const u of usuarios) {
  const { data: created, error: e1 } = await admin.auth.admin.createUser({
    email: u.email, password: u.senha, email_confirm: true,
  });
  if (e1 && !String(e1.message).includes('already')) throw e1;
  const userId = created?.user?.id
    ?? (await admin.auth.admin.listUsers()).data.users.find((x) => x.email === u.email)?.id;

  const { data: camp } = await admin.from('campanha').select('id').eq('subdominio', u.sub).maybeSingle();
  const { error: e2 } = await admin.from('usuario_campanha').upsert({
    user_id: userId, campanha_id: camp.id, papel: u.papel, cpf_hmac: hmac(u.cpf),
  });
  if (e2) throw e2;
  console.log(`seed ok: ${u.email} -> ${u.sub} (${u.papel})`);
}
