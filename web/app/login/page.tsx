'use client';
import { useState } from 'react';

export default function LoginPage() {
  const [identificador, setIdentificador] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identificador, senha }),
      });
      if (res.ok) {
        window.location.href = '/dashboard';
        return; // fica desabilitado — a página já está navegando embora
      }
      let body: { erro?: string } = {};
      try {
        body = await res.json();
      } catch {
        // resposta de erro sem JSON válido — cai no fallback abaixo
      }
      setErro(body.erro ?? 'Não foi possível entrar.');
    } catch {
      setErro('Não foi possível entrar.'); // fetch rejeitou (falha de rede)
    }
    setEnviando(false);
  }

  return (
    <form onSubmit={entrar}>
      <input
        value={identificador}
        onChange={(e) => setIdentificador(e.target.value)}
        placeholder="CPF ou e-mail"
      />
      <input
        type="password"
        value={senha}
        onChange={(e) => setSenha(e.target.value)}
        placeholder="Senha"
      />
      <button type="submit" disabled={enviando}>Entrar</button>
      {erro && <p role="alert">{erro}</p>}
    </form>
  );
}
