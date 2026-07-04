'use client';
import { useEffect, useState } from 'react';

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

  if (erro) return <p role="alert">{erro}</p>;
  if (!linhas) return null;

  if (linhas.length === 0) {
    return <p>Nenhum líder com sub-árvore ainda.</p>;
  }

  const { soma_ramos, total_real } = linhas[0];

  return (
    <section>
      <h2>Ranking de lideranças</h2>
      <table>
        <thead>
          <tr>
            <th>Nome</th>
            <th>Tamanho da sub-árvore</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.pessoa_id}>
              <td>{l.nome}</td>
              <td>{l.subarvore_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Soma dos ramos: {soma_ramos} · Total real da campanha: {total_real}
        {soma_ramos !== total_real && (
          <> · {soma_ramos - total_real} apoiador(es) compartilhado(s) entre ramos.</>
        )}
      </p>
    </section>
  );
}
