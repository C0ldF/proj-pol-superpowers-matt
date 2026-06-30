'use client';
import { useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';

export default function RedefinirSenha() {
  const [senha, setSenha] = useState('');
  const [msg, setMsg] = useState('');

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { error } = await supabase.auth.updateUser({ password: senha });
    setMsg(error ? 'Não foi possível redefinir.' : 'Senha redefinida.');
  }

  return (
    <form onSubmit={salvar}>
      <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="Nova senha" />
      <button type="submit">Salvar</button>
      {msg && <p>{msg}</p>}
    </form>
  );
}
