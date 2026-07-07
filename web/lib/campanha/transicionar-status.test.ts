import { describe, it, expect } from 'vitest';
import { transicionarStatus } from './transicionar-status';

const AGORA = '2026-07-07T12:00:00.000Z';

describe('transicionarStatus', () => {
  it('ativa -> suspensa: válida, usa exatamente o "agora" recebido como suspensa_em', () => {
    const r = transicionarStatus('ativa', 'suspensa', AGORA);
    expect(r).toEqual({ valida: true, update: { status: 'suspensa', suspensa_em: AGORA } });
  });

  it('suspensa -> ativa: válida, limpa suspensa_em (null)', () => {
    const r = transicionarStatus('suspensa', 'ativa', AGORA);
    expect(r).toEqual({ valida: true, update: { status: 'ativa', suspensa_em: null } });
  });

  it('ativa -> encerrada: válida, NÃO tem a chave suspensa_em', () => {
    const r = transicionarStatus('ativa', 'encerrada', AGORA);
    expect(r.valida).toBe(true);
    if (r.valida) {
      expect(r.update).toEqual({ status: 'encerrada' });
      expect('suspensa_em' in r.update).toBe(false);
    }
  });

  it('suspensa -> encerrada: válida, NÃO tem a chave suspensa_em (preserva o histórico)', () => {
    const r = transicionarStatus('suspensa', 'encerrada', AGORA);
    expect(r.valida).toBe(true);
    if (r.valida) {
      expect(r.update).toEqual({ status: 'encerrada' });
      expect('suspensa_em' in r.update).toBe(false);
    }
  });

  it('encerrada -> ativa (ou qualquer coisa saindo de encerrada): inválida', () => {
    const r = transicionarStatus('encerrada', 'ativa');
    expect(r).toEqual({ valida: false, erro: 'campanha encerrada não pode mudar de status' });
  });

  it('ativa -> ativa (mesmo status): inválida', () => {
    const r = transicionarStatus('ativa', 'ativa');
    expect(r).toEqual({ valida: false, erro: 'já está nesse status' });
  });

  it('sem 3º argumento, usa o relógio real (chamada como em produção)', () => {
    const r = transicionarStatus('ativa', 'suspensa');
    expect(r.valida).toBe(true);
    if (r.valida) {
      expect(typeof r.update.suspensa_em).toBe('string');
      expect(Number.isNaN(Date.parse(r.update.suspensa_em!))).toBe(false);
    }
  });
});
