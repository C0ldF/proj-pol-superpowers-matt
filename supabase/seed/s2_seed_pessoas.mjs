/**
 * S2 Seed: Pessoa & Vínculo — E2E verification fixtures
 *
 * Documents the test fixtures used in Task-13 E2E verification.
 * Applied manually via mcp__supabase__execute_sql (service_role) on project axcftjqdjvknrpqzrxls.
 *
 * Hierarchy (Campanha A):
 *
 *   Gestor (null responsável)
 *   └── Coordenador
 *       ├── Liderança A
 *       │   └── João Apoiador (vinculo_a)
 *       └── Liderança B
 *           └── João Apoiador (vinculo_b, shared — triggers notificação for Liderança A)
 */

// ── Campanhas (pre-existing) ──────────────────────────────────────────────────
export const CAMPANHA_A_ID = 'c19607ca-c468-474d-b75c-c48ddefd38ee';
export const CAMPANHA_B_ID = 'b82c6ec4-2fcd-4db1-aa8e-4c04a153d193';

// ── Auth users ────────────────────────────────────────────────────────────────
// Pre-existing gestors (already in auth.users + usuario_campanha):
export const UID_GESTOR_A = 'dc5e6cab-56f3-4586-be74-6d3031f30b9a'; // Campanha A
export const UID_GESTOR_B = 'c2979f41-0c27-406a-88e1-9016c6bd8762'; // Campanha B

// Test users inserted into auth.users (minimal, id-only) via execute_sql:
export const UID_COORD  = 'bbbb0001-0000-0000-0000-000000000002';
export const UID_LID_A  = 'bbbb0001-0000-0000-0000-000000000003';
export const UID_LID_B  = 'bbbb0001-0000-0000-0000-000000000004';
export const UID_TC6    = 'bbbb0001-0000-0000-0000-000000000007'; // TC6 sync test

// ── Pessoas (Campanha A) ──────────────────────────────────────────────────────
export const PESSOA_GESTOR_ID = 'aaaa0001-0000-0000-0000-000000000001';
export const PESSOA_COORD_ID  = 'aaaa0001-0000-0000-0000-000000000002';
export const PESSOA_LID_A_ID  = 'aaaa0001-0000-0000-0000-000000000003';
export const PESSOA_LID_B_ID  = 'aaaa0001-0000-0000-0000-000000000004';
export const PESSOA_JOAO_ID   = 'aaaa0001-0000-0000-0000-000000000005';

// Pessoa in Campanha B (TC19 isolation):
export const PESSOA_CAMP_B_ID = 'aaaa0001-0000-0000-0000-000000000006';

// TC6 sync test pessoa:
export const PESSOA_TC6_ID = 'aaaa0001-0000-0000-0000-000000000007';

// ── HMAC fingerprints (fake deterministic values — not real HMAC outputs) ─────
// Used in lugar of real HMAC so tests are reproducible without the HMAC key.
export const TITULO_HMAC_GESTOR   = 'hmac_tit_gestor_a001';
export const TITULO_HMAC_COORD    = 'hmac_tit_coord_a002';
export const TITULO_HMAC_LID_A    = 'hmac_tit_lida_a003';
export const TITULO_HMAC_LID_B    = 'hmac_tit_lidb_a004';
export const CPF_HMAC_JOAO        = 'hmac_cpf_joao_a005';
export const TITULO_HMAC_PESSOA_B = 'hmac_tit_pessoa_b006';
export const TITULO_HMAC_TC6      = 'hmac_tit_tc6_007';
export const TITULO_HMAC_TC13     = 'hmac_tit_audit_tc13';

// ── Vínculos ──────────────────────────────────────────────────────────────────
export const VINC_GESTOR_ID  = 'cccc0001-0000-0000-0000-000000000001'; // Gestor, null responsável
export const VINC_COORD_ID   = 'cccc0001-0000-0000-0000-000000000002'; // Coord → Gestor
export const VINC_LID_A_ID   = 'cccc0001-0000-0000-0000-000000000003'; // LidA → Coord
export const VINC_LID_B_ID   = 'cccc0001-0000-0000-0000-000000000004'; // LidB → Coord
export const VINC_JOAO_A_ID  = 'cccc0001-0000-0000-0000-000000000005'; // João → LidA (first registrant)
export const VINC_TC6_ID     = 'cccc0001-0000-0000-0000-000000000007'; // TC6 coord vínculo (deleted in test)
export const VINC_JOAO_B_ID  = 'cccc0001-0000-0000-0000-000000000008'; // João → LidB (TC7/TC9 shared)

// ── TC14 Security advisory baseline ──────────────────────────────────────────
// Pre-existing (from S0/S1 — not new in S2):
//   - rls_enabled_no_policy   : public.campanha  (INFO)
//   - security_definer_view   : public.campanha_publica  (ERROR)
//   - auth_leaked_password_protection  (WARN)
//
// New in S2:
//   - rls_disabled_in_public  : public.papel_prioridade  (ERROR)
//     ACTION NEEDED: enable RLS + add permissive SELECT policy for authenticated role
