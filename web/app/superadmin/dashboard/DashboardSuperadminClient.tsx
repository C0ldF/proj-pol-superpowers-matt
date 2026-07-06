'use client';
import { useEffect, useState } from 'react';
import { MODULOS, type Modulo } from '../../../lib/modulos';

type Campanha = {
  id: string;
  nome: string;
  subdominio: string;
  modulos_habilitados: string[];
};

export function DashboardSuperadminClient() {
  const [campanhas, setCampanhas] = useState<Campanha[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    setErro(null);
    fetch('/api/superadmin/campanhas')
      .then((res) => {
        if (!res.ok) throw new Error('falha ao carregar campanhas');
        return res.json();
      })
      .then((data: Campanha[]) => {
        if (!cancelado) setCampanhas(data);
      })
      .catch(() => {
        if (!cancelado) setErro('Não foi possível carregar as campanhas.');
      });
    return () => {
      cancelado = true;
    };
  }, []);

  async function alternar(campanha: Campanha, modulo: Modulo, habilitado: boolean) {
    const chave = `${campanha.id}:${modulo}`;
    setCarregando(chave);
    const acao = habilitado ? 'desabilitar' : 'habilitar';
    try {
      const res = await fetch('/api/superadmin/modulos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ campanhaId: campanha.id, modulo, acao }),
      });
      if (res.ok) {
        setCampanhas((atual) =>
          (atual ?? []).map((c) =>
            c.id === campanha.id
              ? {
                  ...c,
                  modulos_habilitados: habilitado
                    ? c.modulos_habilitados.filter((m) => m !== modulo)
                    : [...c.modulos_habilitados, modulo],
                }
              : c,
          ),
        );
      } else {
        setErro('Não foi possível atualizar o módulo.');
      }
    } catch {
      setErro('Não foi possível atualizar o módulo.');
    } finally {
      setCarregando(null);
    }
  }

  async function sair() {
    await fetch('/api/superadmin/logout', { method: 'POST' });
    window.location.href = '/superadmin/login';
  }

  if (erro) return <p role="alert">{erro}</p>;
  if (!campanhas) return null;

  return (
    <div>
      <button onClick={sair}>Sair</button>
      <table>
        <thead>
          <tr>
            <th>Campanha</th>
            {MODULOS.map((m) => (
              <th key={m}>{m}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {campanhas.map((c) => (
            <tr key={c.id}>
              <td>
                {c.nome} ({c.subdominio})
              </td>
              {MODULOS.map((m) => {
                const habilitado = c.modulos_habilitados.includes(m);
                const chave = `${c.id}:${m}`;
                return (
                  <td key={m}>
                    <input
                      type="checkbox"
                      aria-label={m}
                      checked={habilitado}
                      disabled={carregando === chave}
                      onChange={() => alternar(c, m, habilitado)}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
