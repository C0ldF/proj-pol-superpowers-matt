'use client';
import { useState } from 'react';

export default function SuperadminLoginPage() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    const res = await fetch('/api/superadmin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, senha }),
    });
    if (!res.ok) {
      const body = await res.json();
      setErro(body.erro ?? 'Não foi possível entrar.');
      return;
    }
    window.location.href = '/superadmin/dashboard';
  }

  return (
    <form onSubmit={entrar}>
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail" />
      <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="Senha" />
      <button type="submit">Entrar</button>
      {erro && <p role="alert">{erro}</p>}
    </form>
  );
}
