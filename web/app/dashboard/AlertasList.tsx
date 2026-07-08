'use client';
import { useEffect, useState } from 'react';
import { Message } from '../components/Message';

type Alerta = {
  tipo: 'area' | 'lideranca_estagnada';
  alvo_id: string;
  label: string;
  detalhe: Record<string, unknown>;
};

function IconArea() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="h-5 w-5 flex-shrink-0 text-on-surface-variant"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10 18s6-5.686 6-10a6 6 0 1 0-12 0c0 4.314 6 10 6 10Z"
      />
      <circle cx="10" cy="8" r="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconLideranca() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="h-5 w-5 flex-shrink-0 text-on-surface-variant"
    >
      <circle cx="10" cy="6.5" r="3" strokeLinecap="round" strokeLinejoin="round" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 17c0-3.314 2.686-6 6-6s6 2.686 6 6" />
    </svg>
  );
}

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

  if (erro) return <Message variant="error">{erro}</Message>;
  if (!alertas) return null;

  if (alertas.length === 0) {
    return <p className="text-body-md text-on-surface-variant">Nenhum alerta no momento.</p>;
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-headline-md text-on-surface">Alertas</h2>
      <ul className="flex flex-col gap-3">
        {alertas.map((a) => (
          <li
            key={`${a.tipo}-${a.alvo_id}`}
            className="flex items-start gap-3 rounded border border-outline-variant bg-surface-container px-4 py-3"
          >
            {a.tipo === 'area' ? <IconArea /> : <IconLideranca />}
            <p className="text-body-md text-on-surface">
              {a.tipo === 'area'
                ? `Zona ${a.label}: potencial acima da média com baixa penetração.`
                : `${a.label}: sem crescimento na sub-árvore nos últimos 30 dias.`}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
