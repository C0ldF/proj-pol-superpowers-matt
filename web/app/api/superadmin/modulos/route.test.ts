import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../lib/supabase/require-superadmin', () => ({
  requireSuperadmin: vi.fn(async () => null),
}));

vi.mock('../../../../scripts/modulos/toggle-modulo', () => ({
  toggleModulo: vi.fn(async () => {}),
}));

vi.mock('../../../../scripts/modulos/build-toggle-modulo-deps', () => ({
  buildToggleModuloDeps: vi.fn(() => ({ chamarRpc: vi.fn() })),
}));

function req(body: unknown) {
  return new Request('http://localhost/api/superadmin/modulos', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

import { POST } from './route';
import { requireSuperadmin } from '../../../../lib/supabase/require-superadmin';
import { toggleModulo } from '../../../../scripts/modulos/toggle-modulo';

describe('POST /api/superadmin/modulos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it('200 quando o toggle é bem-sucedido', async () => {
    const res = await POST(req({ campanhaId: 'c-1', modulo: 'comunicacao', acao: 'habilitar' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(toggleModulo).toHaveBeenCalledWith('habilitar', 'c-1', 'comunicacao', expect.anything());
  });

  it('repassa o bloqueio de requireSuperadmin', async () => {
    const { NextResponse } = await import('next/server');
    const blocked = NextResponse.json({ erro: 'acesso restrito ao superadmin' }, { status: 403 });
    vi.mocked(requireSuperadmin).mockResolvedValueOnce(blocked);
    const res = await POST(req({ campanhaId: 'c-1', modulo: 'comunicacao', acao: 'habilitar' }));
    expect(res.status).toBe(403);
  });

  it('400 com campanhaId/modulo/acao ausentes', async () => {
    const res = await POST(req({ modulo: 'comunicacao', acao: 'habilitar' }));
    expect(res.status).toBe(400);
    expect(toggleModulo).not.toHaveBeenCalled();
  });

  it('400 com modulo inválido, sem chamar toggleModulo', async () => {
    const res = await POST(req({ campanhaId: 'c-1', modulo: 'nao-existe', acao: 'habilitar' }));
    expect(res.status).toBe(400);
    expect(toggleModulo).not.toHaveBeenCalled();
  });

  it('400 com acao inválida, sem chamar toggleModulo', async () => {
    const res = await POST(req({ campanhaId: 'c-1', modulo: 'comunicacao', acao: 'apagar' }));
    expect(res.status).toBe(400);
    expect(toggleModulo).not.toHaveBeenCalled();
  });

  it('400 quando toggleModulo lança erro (ex.: campanha inexistente)', async () => {
    vi.mocked(toggleModulo).mockRejectedValueOnce(new Error('campanha c-1 não encontrada'));
    const res = await POST(req({ campanhaId: 'c-1', modulo: 'comunicacao', acao: 'habilitar' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ erro: 'campanha c-1 não encontrada' });
  });
});
