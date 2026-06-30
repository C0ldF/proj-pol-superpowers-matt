// AES-GCM para cifrar título de eleitor (LGPD Art. 18 — direito de acesso).
// TITULO_ENC_KEY: 64 chars hex (32 bytes). Nunca no banco.

function resolveKey(key?: string): Uint8Array {
  const raw = key ?? process.env.TITULO_ENC_KEY;
  if (!raw) throw new Error('TITULO_ENC_KEY ausente no ambiente do servidor');
  if (raw.length !== 64) throw new Error('TITULO_ENC_KEY deve ter 64 chars hex (32 bytes)');
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(raw.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

async function importKey(raw: Uint8Array, usage: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, usage);
}

export async function encryptTitulo(titulo: string, key?: string): Promise<string> {
  const keyBytes = resolveKey(key);
  const ck = await importKey(keyBytes, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    ck,
    new TextEncoder().encode(titulo),
  );
  const combined = new Uint8Array(12 + enc.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(enc), 12);
  return Buffer.from(combined).toString('base64');
}

export async function decryptTitulo(encrypted: string, key?: string): Promise<string> {
  const keyBytes = resolveKey(key);
  const ck = await importKey(keyBytes, ['decrypt']);
  const combined = Buffer.from(encrypted, 'base64');
  const iv = combined.subarray(0, 12);
  const ciphertext = combined.subarray(12);
  const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, ck, ciphertext);
  return new TextDecoder().decode(dec);
}
