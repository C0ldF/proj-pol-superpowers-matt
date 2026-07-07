import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../lib/supabase/require-superadmin', () => ({
  requireSuperadmin: vi.fn(async () => null),
}));

const mockCampanhas = [
  {
    id: 'c-1', nome: 'Campanha A', subdominio: 'campanha-a',
    modulos_habilitados: ['comunicacao'], status: 'ativa',
  },
];

function mockAdmin(overrides: Partial<{
  selectData: unknown; selectError: unknown;
  insertData: unknown; insertError: unknown;
}> = {}) {
  const {
    selectData = mockCampanhas, selectError = null,
    insertData = { id: 'c-novo' }, insertError = null,
  } = overrides;
  const single = vi.fn(async () => ({ data: insertData, error: insertError }));
  const selectAfterInsert = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select: selectAfterInsert }));
  const select = vi.fn(async () => ({ data: selectData, error: selectError }));
  const from = vi.fn(() => ({ select, insert }));
  return { from, select, insert };
}

vi.mock('../../../../lib/supabase/server', () => ({ adminClient: vi.fn() }));

import { GET, POST } from './route';
import { requireSuperadmin } from '../../../../lib/supabase/require-superadmin';
import { adminClient } from '../../../../lib/supabase/server';

function postReq(bodyText: string) {
  return new Request('http://localhost/api/superadmin/campanhas', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: bodyText,
  });
}

const CORPO_VALIDO = {
  subdominio: 'campanha-nova', nome: 'Campanha Nova', cargo: 'prefeito',
  abrangencia: 'municipal', municipioId: 2211001, dataEleicao: '2028-10-01',
};

describe('GET /api/superadmin/campanhas', () => {
  it('retorna 200 com array de campanhas quando liberado', async () => {
    vi.mocked(adminClient).mockReturnValue(mockAdmin() as never);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(mockCampanhas);
  });

  it('repassa o bloqueio de requireSuperadmin', async () => {
    const { NextResponse } = await import('next/server');
    const blocked = NextResponse.json({ erro: 'acesso restrito ao superadmin' }, { status: 403 });
    vi.mocked(requireSuperadmin).mockResolvedValueOnce(blocked);
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it('500 quando a leitura falha', async () => {
    vi.mocked(adminClient).mockReturnValue(
      mockAdmin({ selectData: null, selectError: { message: 'falha' } }) as never,
    );
    const res = await GET();
    expect(res.status).toBe(500);
  });
});

describe('POST /api/superadmin/campanhas', () => {
  it('403 repassa o bloqueio de requireSuperadmin', async () => {
    const { NextResponse } = await import('next/server');
    const blocked = NextResponse.json({ erro: 'acesso restrito ao superadmin' }, { status: 403 });
    vi.mocked(requireSuperadmin).mockResolvedValueOnce(blocked);
    const res = await POST(postReq(JSON.stringify(CORPO_VALIDO)));
    expect(res.status).toBe(403);
  });

  it('400 com corpo que não é JSON válido, sem chamar insert', async () => {
    const admin = mockAdmin();
    vi.mocked(adminClient).mockReturnValue(admin as never);
    const res = await POST(postReq('não é json'));
    expect(res.status).toBe(400);
    expect(admin.insert).not.toHaveBeenCalled();
  });

  it('400 quando validarNovaCampanha rejeita (ex.: campo obrigatório ausente), sem chamar insert', async () => {
    const admin = mockAdmin();
    vi.mocked(adminClient).mockReturnValue(admin as never);
    const { nome: _nome, ...semNome } = CORPO_VALIDO;
    const res = await POST(postReq(JSON.stringify(semNome)));
    expect(res.status).toBe(400);
    expect(admin.insert).not.toHaveBeenCalled();
    expect((await res.json()).erro).toEqual(expect.any(String));
  });

  it('400 com subdominio duplicado, sem vazar erro cru do Postgres', async () => {
    vi.mocked(adminClient).mockReturnValue(
      mockAdmin({
        insertData: null,
        insertError: { code: '23505', message: 'duplicate key value violates unique constraint "campanha_subdominio_key"' },
      }) as never,
    );
    const res = await POST(postReq(JSON.stringify(CORPO_VALIDO)));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ erro: 'subdomínio já em uso' });
  });

  it('400 com outro erro de banco, repassando a mensagem', async () => {
    vi.mocked(adminClient).mockReturnValue(
      mockAdmin({ insertData: null, insertError: { code: '99999', message: 'erro genérico do banco' } }) as never,
    );
    const res = await POST(postReq(JSON.stringify(CORPO_VALIDO)));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ erro: 'erro genérico do banco' });
  });

  it('201 com a linha criada, chamando insert com o objeto já validado/normalizado', async () => {
    const linhaCriada = { id: 'c-novo', ...CORPO_VALIDO, status: 'ativa' };
    const admin = mockAdmin({ insertData: linhaCriada });
    vi.mocked(adminClient).mockReturnValue(admin as never);
    const res = await POST(postReq(JSON.stringify(CORPO_VALIDO)));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(linhaCriada);
    expect(admin.insert).toHaveBeenCalledWith({
      subdominio: 'campanha-nova', nome: 'Campanha Nova', cargo: 'prefeito',
      abrangencia: 'municipal', municipio_id: 2211001, uf: null, data_eleicao: '2028-10-01',
    });
  });
});
