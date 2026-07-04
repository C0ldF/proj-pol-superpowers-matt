'use client';
import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

type Ponto = { dia: string; total: number };

export function EvolucaoChart() {
  const [pontos, setPontos] = useState<Ponto[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    setErro(null);
    fetch('/api/dashboard/evolucao')
      .then((res) => {
        if (!res.ok) throw new Error('falha ao carregar evolução');
        return res.json();
      })
      .then((data: Ponto[]) => {
        if (!cancelado) setPontos(data);
      })
      .catch(() => {
        if (!cancelado) setErro('Não foi possível carregar a evolução.');
      });
    return () => {
      cancelado = true;
    };
  }, []);

  if (erro) return <p role="alert">{erro}</p>;
  if (!pontos) return null;

  const temMovimentacao = pontos.some((p) => p.total > 0);
  if (!temMovimentacao) {
    return <p>Nenhuma movimentação nos últimos 90 dias.</p>;
  }

  return (
    <section>
      <h2>Evolução (90 dias)</h2>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={pontos}>
          <XAxis dataKey="dia" />
          <YAxis allowDecimals={false} />
          <Tooltip />
          <Line type="monotone" dataKey="total" stroke="#2563eb" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </section>
  );
}
