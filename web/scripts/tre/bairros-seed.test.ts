import { describe, it, expect, vi } from 'vitest';
import { seedBairros } from './bairros-seed';

describe('seedBairros', () => {
  it('chama upsertBairro para cada bairro do JSON, com nome_normalizado e regiao corretos', async () => {
    const upsertBairro = vi.fn(async () => {});
    const json = {
      regiao_central: [{ bairro: 'Centro' }, { bairro: 'Cabral' }],
      zona_norte: [{ bairro: 'Aeroporto' }],
    };

    const { total } = await seedBairros(json, 2211001, { upsertBairro });

    expect(total).toBe(3);
    expect(upsertBairro).toHaveBeenCalledTimes(3);
    expect(upsertBairro).toHaveBeenCalledWith({
      municipioId: 2211001, nome: 'Centro', nomeNormalizado: 'centro', regiao: 'regiao_central',
    });
    expect(upsertBairro).toHaveBeenCalledWith({
      municipioId: 2211001, nome: 'Aeroporto', nomeNormalizado: 'aeroporto', regiao: 'zona_norte',
    });
  });

  it('JSON vazio retorna total 0 e não chama upsertBairro', async () => {
    const upsertBairro = vi.fn(async () => {});
    const { total } = await seedBairros({}, 2211001, { upsertBairro });
    expect(total).toBe(0);
    expect(upsertBairro).not.toHaveBeenCalled();
  });
});
