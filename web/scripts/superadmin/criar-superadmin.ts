export type CriarSuperadminDeps = {
  criarAuthUser(email: string, senha: string): Promise<string>; // retorna user_id
  inserirSuperadmin(userId: string): Promise<void>;
  removerAuthUser(userId: string): Promise<void>;
};

export async function criarSuperadmin(
  email: string,
  senha: string,
  deps: CriarSuperadminDeps,
): Promise<void> {
  const userId = await deps.criarAuthUser(email, senha);
  try {
    await deps.inserirSuperadmin(userId);
  } catch (err) {
    await deps.removerAuthUser(userId);
    throw err;
  }
}
