'use client';
import { useEffect, useState } from 'react';

type Alerta = {
  tipo: 'area' | 'lideranca_estagnada';
  alvo_id: string;
  label: string;
  detalhe: Record<string, unknown>;
};

export function AlertasList() {
  const [alertas, setAlertas] = useState<Alerta[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    setErro(null);
    fetch('/api/dashboard/alertas')
      .then((res) => {
        if (!res.ok) throw new Error('falha ao carregar alertas');
        return res.json();
      })
      .then((data: Alerta[]) => {
        if (!cancelado) setAlertas(data);
      })
      .catch(() => {
        if (!cancelado) setErro('Não foi possível carregar os alertas.');
      });
    return () => {
      cancelado = true;
    };
  }, []);

  if (erro) return <p role="alert">{erro}</p>;
  if (!alertas) return null;

  if (alertas.length === 0) {
    return <p>Nenhum alerta no momento.</p>;
  }

  return (
    <section>
      <h2>Alertas</h2>
      <ul>
        {alertas.map((a) => (
          <li key={`${a.tipo}-${a.alvo_id}`}>
            {a.tipo === 'area'
              ? `Zona ${a.label}: potencial acima da média com baixa penetração.`
              : `${a.label}: sem crescimento na sub-árvore nos últimos 30 dias.`}
          </li>
        ))}
      </ul>
    </section>
  );
}
