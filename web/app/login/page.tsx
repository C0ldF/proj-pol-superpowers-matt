'use client';
import { useState } from 'react';
import { Button } from '../components/Button';
import { Input } from '../components/Input';

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
    <div className="flex min-h-screen flex-col md:flex-row">
      <div className="flex items-center justify-center bg-primary px-8 py-16 md:w-[42%]">
        <p className="text-headline-md text-on-primary">Sistema Campanha</p>
      </div>
      <div className="flex flex-1 items-center justify-center bg-surface px-6 py-16 md:px-24">
        <form onSubmit={entrar} className="flex w-full max-w-md flex-col gap-6">
          <h1 className="text-headline-lg text-on-surface">Acesse sua conta</h1>
          <Input
            label="CPF ou e-mail"
            value={identificador}
            onChange={(e) => setIdentificador(e.target.value)}
            placeholder="CPF ou e-mail"
          />
          <Input
            label="Senha"
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            placeholder="Senha"
          />
          <Button type="submit" disabled={enviando} className="w-full">
            Entrar
          </Button>
          {erro && (
            <p
              role="alert"
              className="rounded bg-error-container px-4 py-3 text-body-md text-on-error-container"
            >
              {erro}
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
