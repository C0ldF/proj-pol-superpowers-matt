# Abrangência da Campanha: amarrada a Município (municipal) ou UF (estadual)

A Campanha nasce com um **Cargo** e uma **Abrangência** derivada dele, fixos na
criação e difíceis de mudar depois (determinam todo o universo geográfico):

- **Municipal** (vereador, prefeito) → um Município. Mapa de calor em bairro e
  zona/seção.
- **Estadual** (deputado estadual) → uma UF (todos os municípios). Mapa de calor
  por município, com drill-down para bairros/zonas de uma cidade.

O dado base é sempre **ponto geográfico** (lat/long por local de votação, aptos
por seção); o mapa de calor é esse ponto **agregado** na granularidade da
abrangência — não são mapas distintos.

## Escopo atual

Apenas **vereador, prefeito, deputado estadual**. A modelagem (Cargo +
Abrangência ∈ {municipal, estadual, federal}) é extensível para cargos federais
no futuro, mas o enum fica travado nos três por ora.

## Consequences

- Mudar a Abrangência de uma Campanha depois é caro (troca a base geográfica
  inteira) — tratado como imutável na prática.
- Dados oficiais (ADR 0002) são carregados por município/UF + ano conforme a
  Abrangência.
