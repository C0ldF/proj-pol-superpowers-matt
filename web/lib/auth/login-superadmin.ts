export interface LoginSuperadminDeps {
  signIn(email: string, senha: string): Promise<boolean>;
  signOut(): Promise<void>;
}

export interface LoginSuperadminInput {
  email: string;
  senha: string;
}

export async function loginSuperadmin(
  input: LoginSuperadminInput,
  deps: LoginSuperadminDeps,
): Promise<{ ok: boolean }> {
  const ehSuperadmin = await deps.signIn(input.email, input.senha);
  if (!ehSuperadmin) {
    await deps.signOut();
    return { ok: false };
  }
  return { ok: true };
}
