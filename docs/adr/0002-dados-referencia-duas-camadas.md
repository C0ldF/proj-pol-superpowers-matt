# Dados geográficos em duas camadas: oficial (global) + overlay da campanha

Os dados geográfico-eleitorais existem em duas camadas distintas:

1. **Camada oficial / canônica (GLOBAL, fora do RLS por campanha).** Locais de
   votação do TRE, zonas, seções, aptos, lat/long e a lista oficial de bairros
   (IBGE). Versionados por **ano** e escopados por **município/UF**. Somente o
   superadmin edita; todas as Campanhas leem. Não são duplicados por campanha.

2. **Camada da campanha (overlay, sob RLS por `campanha_id`).** Locais e bairros
   que a equipe cria quando não existem na base oficial. Visíveis e editáveis por
   **todo o grupo do Gestor** (não picotado por indivíduo). Pessoas/eleitores
   também vivem aqui (mas com regra de visibilidade própria — ver hierarquia).

## Por quê

Atende à governança exigida (o oficial é fornecido e mantido só pelo superadmin),
preserva a integridade dos mapas de calor (lat/long confiáveis e únicos) e evita
que um cliente "estrague" o bairro de outro. A base oficial permanece limpa e
única.

## Consequences

- Bairro oficial é somente-leitura para campanhas; precisando de um inexistente,
  a campanha cria um **bairro local** na camada 2.
- Na criação de bairro local, fazer *fuzzy match* contra a lista oficial para
  sugerir o canônico e conter divergência.
- Há DUAS regras de visibilidade no sistema: referência criada pela equipe é
  compartilhada no grupo; árvore de apoiadores é restrita à sub-árvore de cada
  liderança.
