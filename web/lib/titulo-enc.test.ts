import { describe, it, expect } from 'vitest';
import { encryptTitulo, decryptTitulo } from './titulo-enc';

// 32 bytes em hex (64 chars)
const KEY = '0'.repeat(64);

describe('encryptTitulo / decryptTitulo', () => {
  it('round-trip preserva valor', async () => {
    const titulo = '01234567890';
    const enc = await encryptTitulo(titulo, KEY);
    expect(await decryptTitulo(enc, KEY)).toBe(titulo);
  });
  it('criptogramas diferentes para mesma entrada (IV aleatório)', async () => {
    const a = await encryptTitulo('12345', KEY);
    const b = await encryptTitulo('12345', KEY);
    expect(a).not.toBe(b);
  });
  it('lança sem TITULO_ENC_KEY', async () => {
    await expect(encryptTitulo('123')).rejects.toThrow('TITULO_ENC_KEY');
  });
  it('lança ao decifrar dado corrompido', async () => {
    await expect(decryptTitulo('naoBase64!!', KEY)).rejects.toThrow();
  });
});
