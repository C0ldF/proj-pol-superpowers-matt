'use client';
import { useEffect, useState } from 'react';
import { Message } from '../components/Message';

type RankingRow = {
  pessoa_id: string;
  nome: string;
  subarvore_count: number;
  soma_ramos: number;
  total_real: number;
};

export function RankingTable() {
  const [linhas, setLinhas] = useState<RankingRow[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    setErro(null);
    fetch('/api/dashboard/ranking')
      .then((res) => {
        if (!res.ok) throw new Error('falha ao carregar ranking');
        return res.json();
      })
      .then((data: RankingRow[]) => {
        if (!cancelado) setLinhas(data);
      })
      .catch(() => {
        if (!cancelado) setErro('Não foi possível carregar o ranking.');
      });
    return () => {
      cancelado = true;
    };
  }, []);

  if (erro) return <Message variant="error">{erro}</Message>;
  if (!linhas) return null;

  if (linhas.length === 0) {
    return <p className="text-body-md text-on-surface-variant">Nenhum líder com sub-árvore ainda.</p>;
  }

  const { soma_ramos, total_real } = linhas[0];

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-headline-md text-on-surface">Ranking de lideranças</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-body-md text-on-surface">
          <thead className="bg-surface-container-low">
            <tr>
              <th className="px-4 py-2 font-medium">Nome</th>
              <th className="px-4 py-2 text-right font-medium">Tamanho da sub-árvore</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.pessoa_id} className="border-t border-outline-variant">
                <td className="px-4 py-2">{l.nome}</td>
                <td className="px-4 py-2 text-right text-data-mono tabular-nums">
                  {l.subarvore_count}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-body-md text-on-surface-variant">
        Soma dos ramos: {soma_ramos} · Total real da campanha: {total_real}
        {soma_ramos !== total_real && (
          <> · {soma_ramos - total_real} apoiador(es) compartilhado(s) entre ramos.</>
        )}
      </p>
    </section>
  );
}
