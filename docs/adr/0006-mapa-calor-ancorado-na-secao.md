# Mapa de calor ancorado na seção/local de votação, com três camadas

O mapa de calor eleitoral ancora cada apoiador na sua **seção / local de votação**
(lat/long precisa do TRE), **não** no endereço residencial. Razão: na política o
que conta é onde a pessoa **vota** (o voto cai na seção), e isso evita depender da
geolocalização aproximada do CEP para o dado mais importante.

Três camadas ligáveis sobre o mesmo dado de pontos, agregadas na granularidade da
Abrangência (bairro/zona ou município):

- **Força** — apoiadores meus por área.
- **Potencial** — aptos por área (`QTD_APTOS`/seção).
- **Penetração** — Força ÷ Potencial (onde há muito voto e pouca gente minha).

O endereço/CEP residencial serve ao **mapa de colaboradores** e visualização de
contato, não ao calor eleitoral.

## Consequences

- Todo apoiador deveria ter seção/zona para entrar no calor; apoiadores
  "incompletos" (sem título/seção) ficam fora do calor até enriquecimento.
- A agregação reaproveita o mesmo pipeline de pontos para os três níveis.
