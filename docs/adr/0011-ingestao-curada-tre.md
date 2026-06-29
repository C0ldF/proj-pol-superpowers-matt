# Ingestão curada dos dados do TRE (não despejo do CSV cru)

O CSV do TRE vem sujo/incompleto, e o mapa de calor depende dele. Por isso a
ingestão é um **pipeline curado, rodado só pelo Superadmin, com revisão antes de
publicar** — não um import cru:

1. **Parse** de `SECOES` (texto `"(s: N, apt: M)"`) em seções estruturadas
   (seção → aptos); idem demais campos.
2. **Bairro casado por nome** (normalização + fuzzy) contra a lista oficial
   (`bairros_teresina_zonas.json`), **ignorando `COD_BAIRRO`** (lixo
   inconsistente). Sem casamento → fila de revisão do Superadmin.
3. **Lat/long faltante** → tenta geocodificar pelo endereço e marca como
   **aproximado**; sem isso, fica fora do mapa até correção.
4. **Elegibilidade no calor:** só `TIPO=CONVENCIONAL` + `SITUACAO=ATIVO` +
   `aptos>0` entram no **Potencial**. Voto em trânsito, preso provisório e
   bloqueado são **armazenados e visíveis**, mas **fora** do cálculo.
5. Versionado por **ano + município/UF**.

## Consequences

- `COD_BAIRRO` do TRE não é chave confiável; o vínculo bairro↔local é por nome
  normalizado + revisão.
- Há um estado "aproximado" para locais geocodificados, sinalizado na UI.
