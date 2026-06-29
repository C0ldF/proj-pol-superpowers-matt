# Rede política como grafo: Pessoa (identidade) + Vínculo (posição)

Separamos a **identidade** da pessoa da sua **posição na rede**:

- **Pessoa** — o ser humano, único por Campanha, deduplicado por **título de
  eleitor** (CPF é secundário). Uma só fonte de verdade dos dados pessoais.
- **Vínculo** — aresta "Pessoa está sob Responsável", carregando o papel/nível
  naquela posição. Uma Pessoa pode ter vários Vínculos.

A rede é portanto um **grafo acíclico**, não uma árvore pura: a mesma Pessoa pode
estar sob coordenadores/gestores diferentes. Ciclos são proibidos.

## Considered Options

- **Pessoa + Vínculo (escolhido).** Suporta multi-responsável sem duplicar o
  humano; mantém dedup honesto por título; rankings por sub-árvore e visibilidade
  por sub-árvore continuam consultas de grafo.
- **Árvore pura (parent_id em Pessoa).** Rejeitado: não comporta a mesma pessoa
  sob dois responsáveis sem duplicar cadastro.

## Consequences

- **Contagem dos rankings:** um apoiador compartilhado conta para CADA ramo em que
  participa (cada responsável recebe crédito). O **total da Campanha deduplica por
  título** — logo "soma dos ramos ≠ total da campanha"; a diferença é o número de
  apoiadores compartilhados. Essa distinção precisa estar visível na UI.
- Necessário prevenir ciclos ao criar Vínculo.
- Visibilidade ("liderança vê só sua sub-árvore") = consulta de sub-árvore sobre
  o grafo.
