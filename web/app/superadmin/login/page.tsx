'use client';
import { useState } from 'react';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { Message } from '../../components/Message';

export default function SuperadminLoginPage() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    const res = await fetch('/api/superadmin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, senha }),
    });
    if (!res.ok) {
      // res.json() assume corpo JSON válido — comportamento idêntico
      // ao arquivo original (nunca tratou resposta não-JSON). Não é
      // uma das 3 lacunas combinadas desta fatia; preservado
      // deliberadamente, não é um bug esquecido.
      const body = await res.json();
      setErro(body.erro ?? 'Não foi possível entrar.');
      setEnviando(false);
      return;
    }
    window.location.href = '/superadmin/dashboard';
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <div className="flex items-center justify-center bg-primary px-8 py-16 md:w-[42%]">
        <p className="text-headline-md text-on-primary">Painel Superadmin</p>
      </div>
      <div className="flex flex-1 items-center justify-center bg-surface px-6 py-16 md:px-24">
        <form onSubmit={entrar} className="flex w-full max-w-md flex-col gap-6">
          <h1 className="text-headline-lg text-on-surface">Acesso restrito</h1>
          <Input
            label="E-mail"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="E-mail"
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
          {erro && <Message variant="error">{erro}</Message>}
        </form>
      </div>
    </div>
  );
}
