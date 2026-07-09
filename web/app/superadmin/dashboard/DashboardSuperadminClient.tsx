'use client';
import { useEffect, useState } from 'react';
import { Input } from '../../components/Input';
import { Button } from '../../components/Button';
import { Message } from '../../components/Message';
import { MODULOS, type Modulo } from '../../../lib/modulos';
import { CARGOS, ABRANGENCIAS, type Cargo, type Abrangencia } from '../../../lib/campanha/constantes';

const focoVisivel =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

const selectClassName = `rounded border border-outline bg-surface-container-lowest px-4 py-3 text-body-lg text-on-surface hover:border-on-surface-variant ${focoVisivel}`;

type StatusCampanha = 'ativa' | 'suspensa' | 'encerrada';

type Campanha = {
  id: string;
  nome: string;
  subdominio: string;
  modulos_habilitados: string[];
  status: StatusCampanha;
};

const PROXIMOS_STATUS: Record<StatusCampanha, { novoStatus: StatusCampanha; rotulo: string }[]> = {
  ativa: [
    { novoStatus: 'suspensa', rotulo: 'Suspender' },
    { novoStatus: 'encerrada', rotulo: 'Encerrar' },
  ],
  suspensa: [
    { novoStatus: 'ativa', rotulo: 'Reativar' },
    { novoStatus: 'encerrada', rotulo: 'Encerrar' },
  ],
  encerrada: [],
};

export function DashboardSuperadminClient() {
  const [campanhas, setCampanhas] = useState<Campanha[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState<string | null>(null);

  const [subdominio, setSubdominio] = useState('');
  const [nome, setNome] = useState('');
  const [cargo, setCargo] = useState<Cargo>(CARGOS[0]);
  const [abrangencia, setAbrangencia] = useState<Abrangencia>(ABRANGENCIAS[0]);
  const [municipioId, setMunicipioId] = useState('');
  const [uf, setUf] = useState('');
  const [dataEleicao, setDataEleicao] = useState('');
  const [erroCriar, setErroCriar] = useState<string | null>(null);

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

  async function criarCampanha(e: React.FormEvent) {
    e.preventDefault();
    setErroCriar(null);
    const res = await fetch('/api/superadmin/campanhas', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        subdominio,
        nome,
        cargo,
        abrangencia,
        municipioId: abrangencia === 'municipal' ? Number(municipioId) : undefined,
        uf: abrangencia === 'estadual' ? uf : undefined,
        dataEleicao,
      }),
    });
    if (!res.ok) {
      const body = await res.json();
      setErroCriar(body.erro ?? 'Não foi possível criar a campanha.');
      return;
    }
    const nova: Campanha = await res.json();
    setCampanhas((atual) => [nova, ...(atual ?? [])]);
    setSubdominio('');
    setNome('');
    setMunicipioId('');
    setUf('');
    setDataEleicao('');
  }

  async function mudarStatus(campanha: Campanha, novoStatus: StatusCampanha) {
    const chave = `status:${campanha.id}`;
    setCarregando(chave);
    try {
      const res = await fetch('/api/superadmin/campanhas/status', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ campanhaId: campanha.id, novoStatus }),
      });
      if (res.ok) {
        setCampanhas((atual) =>
          (atual ?? []).map((c) => (c.id === campanha.id ? { ...c, status: novoStatus } : c)),
        );
      } else {
        setErro('Não foi possível mudar o status.');
      }
    } catch {
      setErro('Não foi possível mudar o status.');
    } finally {
      setCarregando(null);
    }
  }

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
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-outline-variant bg-surface-container-low px-6 py-4">
        <p className="text-headline-md text-on-surface">Painel Superadmin</p>
        <button
          type="button"
          onClick={sair}
          className={`rounded px-4 py-2 text-body-md text-on-surface-variant transition-colors hover:text-on-surface ${focoVisivel}`}
        >
          Sair
        </button>
      </header>
      <main className="flex flex-col gap-6 p-6">
      <div className="rounded border border-outline-variant bg-surface-container-lowest p-6">
        <h2 className="mb-4 text-headline-md text-on-surface">Cadastrar nova campanha</h2>
        <form onSubmit={criarCampanha} className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Input
            label="Subdomínio"
            value={subdominio}
            onChange={(e) => setSubdominio(e.target.value)}
            placeholder="Subdomínio"
          />
          <Input
            label="Nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Nome"
          />
          <label className="flex flex-col gap-1">
            <span className="text-label-md text-on-surface-variant">Cargo</span>
            <select
              aria-label="cargo"
              value={cargo}
              onChange={(e) => setCargo(e.target.value as Cargo)}
              className={selectClassName}
            >
              {CARGOS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-label-md text-on-surface-variant">Abrangência</span>
            <select
              aria-label="abrangência"
              value={abrangencia}
              onChange={(e) => setAbrangencia(e.target.value as Abrangencia)}
              className={selectClassName}
            >
              {ABRANGENCIAS.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </label>
          {abrangencia === 'municipal' ? (
            <Input
              label="Código IBGE do município"
              type="number"
              value={municipioId}
              onChange={(e) => setMunicipioId(e.target.value)}
              placeholder="Código IBGE do município"
            />
          ) : (
            <Input
              label="UF"
              value={uf}
              onChange={(e) => setUf(e.target.value)}
              placeholder="UF"
              maxLength={2}
            />
          )}
          <Input
            label="Data da eleição"
            type="date"
            value={dataEleicao}
            onChange={(e) => setDataEleicao(e.target.value)}
            placeholder="Data da eleição"
          />
          <Button type="submit" className="md:col-span-2">
            Nova campanha
          </Button>
          {erroCriar && <Message variant="error">{erroCriar}</Message>}
        </form>
      </div>

      <table>
        <thead>
          <tr>
            <th>Campanha</th>
            {MODULOS.map((m) => (
              <th key={m}>{m}</th>
            ))}
            <th>Status</th>
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
              <td>
                {c.status}
                {PROXIMOS_STATUS[c.status].map(({ novoStatus, rotulo }) => (
                  <button
                    key={novoStatus}
                    type="button"
                    disabled={carregando === `status:${c.id}`}
                    onClick={() => mudarStatus(c, novoStatus)}
                  >
                    {rotulo}
                  </button>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </main>
    </div>
  );
}
