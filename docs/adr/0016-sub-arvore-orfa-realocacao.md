# Sub-árvore órfã: realocação automática para o responsável acima

Ao remover o vínculo de alguém com gente abaixo, a sub-árvore é **realocada para o
responsável imediatamente acima** (a árvore nunca quebra, nenhum apoiador some). O
evento é registrado no log de auditoria.

- **Sub-árvores grandes** (acima de um limite, ex.: 50 pessoas) disparam
  **confirmação** e permitem **redirecionar** para outro responsável em vez do
  default.
- **Exclusão em cascata é proibida** (perderia apoiadores reais).

## Vínculo ≠ Pessoa

"Remover o Carlos" = remover **vínculo/acesso**, não apagar a **Pessoa** (ela pode
seguir existindo como registro sem papel ativo). Apagar a Pessoa de fato é o fluxo
separado de **direito de exclusão** do titular (ADR 0009). Reforça ADR 0003.
