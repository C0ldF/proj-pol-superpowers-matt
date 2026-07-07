import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../../lib/supabase/require-superadmin', () => ({
  requireSuperadmin: vi.fn(async () => null),
}));

function mockAdmin(overrides: Partial<{
  selectData: unknown; selectError: unknown;
  updateData: unknown; updateError: unknown;
}> = {}) {
  const {
    selectData = { status: 'ativa' }, selectError = null,
    updateData = { id: 'c-1', status: 'suspensa' }, updateError = null,
  } = overrides;

  const singleSelect = vi.fn(async () => ({ data: selectData, error: selectError }));
  const eqSelect = vi.fn(() => ({ single: singleSelect }));
  const select = vi.fn(() => ({ eq: eqSelect }));

  const singleUpdate = vi.fn(async () => ({ data: updateData, error: updateError }));
  const selectAfterUpdate = vi.fn(() => ({ single: singleUpdate }));
  const eqUpdate = vi.fn(() => ({ select: selectAfterUpdate }));
  const update = vi.fn(() => ({ eq: eqUpdate }));

  const from = vi.fn(() => ({ select, update }));
  return { from, select, update };
}

vi.mock('../../../../../lib/supabase/server', () => ({ adminClient: vi.fn() }));

import { POST } from './route';
import { requireSuperadmin } from '../../../../../lib/supabase/require-superadmin';
import { adminClient } from '../../../../../lib/supabase/server';

function req(bodyText: string) {
  return new Request('http://localhost/api/superadmin/campanhas/status', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: bodyText,
  });
}

describe('POST /api/superadmin/campanhas/status', () => {
  it('403 repassa o bloqueio de requireSuperadmin', async () => {
    const { NextResponse } = await import('next/server');
    const blocked = NextResponse.json({ erro: 'acesso restrito ao superadmin' }, { status: 403 });
    vi.mocked(requireSuperadmin).mockResolvedValueOnce(blocked);
    const res = await POST(req(JSON.stringify({ campanhaId: 'c-1', novoStatus: 'suspensa' })));
    expect(res.status).toBe(403);
  });

  it('400 com corpo que não é JSON válido, sem chamar update', async () => {
    const admin = mockAdmin();
    vi.mocked(adminClient).mockReturnValue(admin as never);
    const res = await POST(req('não é json'));
    expect(res.status).toBe(400);
    expect(admin.update).not.toHaveBeenCalled();
  });

  it('400 quando a campanha não existe', async () => {
    vi.mocked(adminClient).mockReturnValue(
      mockAdmin({ selectData: null, selectError: { message: 'not found' } }) as never,
    );
    const res = await POST(req(JSON.stringify({ campanhaId: 'c-inexistente', novoStatus: 'suspensa' })));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ erro: 'campanha não encontrada' });
  });

  it('400 quando novoStatus não é um StatusCampanha válido, sem chamar update', async () => {
    const admin = mockAdmin();
    vi.mocked(adminClient).mockReturnValue(admin as never);
    const res = await POST(req(JSON.stringify({ campanhaId: 'c-1', novoStatus: 'banana' })));
    expect(res.status).toBe(400);
    expect(admin.update).not.toHaveBeenCalled();
  });

  it('500 quando o status atual lido do banco não é um StatusCampanha válido (dado corrompido)', async () => {
    const admin = mockAdmin({ selectData: { status: 'algo-corrompido' } });
    vi.mocked(adminClient).mockReturnValue(admin as never);
    const res = await POST(req(JSON.stringify({ campanhaId: 'c-1', novoStatus: 'suspensa' })));
    expect(res.status).toBe(500);
    expect(admin.update).not.toHaveBeenCalled();
  });

  it('400 quando a transição é inválida (sair de encerrada), sem chamar update', async () => {
    const admin = mockAdmin({ selectData: { status: 'encerrada' } });
    vi.mocked(adminClient).mockReturnValue(admin as never);
    const res = await POST(req(JSON.stringify({ campanhaId: 'c-1', novoStatus: 'ativa' })));
    expect(res.status).toBe(400);
    expect(admin.update).not.toHaveBeenCalled();
  });

  it('200 com transição válida: aplica exatamente o resultado de transicionarStatus e retorna a linha', async () => {
    const admin = mockAdmin({
      selectData: { status: 'ativa' },
      updateData: { id: 'c-1', status: 'suspensa', suspensa_em: '2026-07-07T00:00:00.000Z' },
    });
    vi.mocked(adminClient).mockReturnValue(admin as never);
    const res = await POST(req(JSON.stringify({ campanhaId: 'c-1', novoStatus: 'suspensa' })));
    expect(res.status).toBe(200);
    expect(admin.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'suspensa', suspensa_em: expect.any(String) }),
    );
    expect(await res.json()).toEqual({
      campanha: { id: 'c-1', status: 'suspensa', suspensa_em: '2026-07-07T00:00:00.000Z' },
    });
  });
});
