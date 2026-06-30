import { describe, it, expect, beforeEach } from 'vitest';
import { adminClient } from './server';

describe('adminClient', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://exemplo.supabase.co';
    process.env.SUPABASE_SECRET_KEY = 'service-role-fake';
  });
  it('constrói um cliente com as funções do Supabase', () => {
    const c = adminClient();
    expect(typeof c.rpc).toBe('function');
    expect(typeof c.from).toBe('function');
  });
  it('lança se SUPABASE_SECRET_KEY está ausente', () => {
    delete process.env.SUPABASE_SECRET_KEY;
    expect(() => adminClient()).toThrow();
  });
});
