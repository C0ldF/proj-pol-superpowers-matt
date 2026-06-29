# Mapas com MapLibre GL + OpenStreetMap (Google só para deep-link)

A renderização de mapas e mapa de calor usa **MapLibre GL + tiles OpenStreetMap**.
Motivo: num SaaS multi-tenant com muitos mapas abertos, provedores que cobram por
*map load* (Google) fazem a fatura — paga pelo dono do sistema — disparar.
MapLibre/OSM não tem custo por carregamento e tem suporte nativo a heatmap/cluster.

- **Google Maps** fica só para o **deep-link** "abrir endereço aproximado" (é uma
  URL, grátis) e, no máximo, fallback de geocodificação.
- Geocodificação do **endereço residencial**: ViaCEP → Mundipagg (fallback) +
  geocoder leve se precisar de lat/long. O dado do **calor** não depende disso (vem
  pronto do TRE).

## Considered Options

- **MapLibre + OSM (escolhido).** Sem custo por load; melhor para escala.
- **Mapbox.** Bom, mas pago no volume.
- **Google Maps.** Familiar, mas custo por load inviável no multi-tenant.
