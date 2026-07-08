// web/app/redefinir-senha/page.tsx
'use client';
import { useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Message } from '../components/Message';

type Resultado =
  | { tipo: 'erro'; texto: string }
  | { tipo: 'sucesso'; texto: string };

export default function RedefinirSenha() {
  const [senha, setSenha] = useState('');
  const [resultado, setResultado] = useState<Resultado | null>(null);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setResultado(null);
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { error } = await supabase.auth.updateUser({ password: senha });
    setResultado(
      error
        ? { tipo: 'erro', texto: 'Não foi possível redefinir.' }
        : { tipo: 'sucesso', texto: 'Senha redefinida.' },
    );
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <div className="flex items-center justify-center bg-primary px-8 py-16 md:w-[42%]">
        <p className="text-headline-md text-on-primary">Sistema Campanha</p>
      </div>
      <div className="flex flex-1 items-center justify-center bg-surface px-6 py-16 md:px-24">
        <form onSubmit={salvar} className="flex w-full max-w-md flex-col gap-6">
          <h1 className="text-headline-lg text-on-surface">Redefinir senha</h1>
          <Input
            label="Nova senha"
            type="password"
            autoComplete="new-password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            placeholder="Nova senha"
          />
          <Button type="submit" className="w-full">
            Salvar
          </Button>
          {resultado && (
            <Message variant={resultado.tipo === 'sucesso' ? 'success' : 'error'}>
              {resultado.texto}
            </Message>
          )}
        </form>
      </div>
    </div>
  );
}
