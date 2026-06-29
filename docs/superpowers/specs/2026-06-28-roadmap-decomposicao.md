# Roadmap de decomposição — Sistema de Gestão de Campanha Política

Data: 2026-06-28

O projeto é grande demais para um único spec. Decomposto em fatias independentes,
cada uma com seu próprio ciclo spec → plano → build. Ordem por dependência real
(RLS embaixo de tudo; audit log nasce na fundação por ADR 0014; mapa de calor
depende do TRE ingerido).

## Fatias

### S0 — Fundação multi-tenant *(base de tudo)*
Schema base, entidade `campanha` + estados (ativa/suspensa/encerrada), RLS por
`campanha_id`, middleware de subdomínio, audit log append-only (nasce aqui),
seed do Superadmin.
ADRs: 0001, 0010, 0014, 0015.

### S1 — Auth & papéis *(depende S0)*
Login CPF→e-mail server-side, JWT custom access token hook (papel + campanha),
recuperação de senha, rate-limit / captcha, escada de papéis no token.
ADRs: 0008, 0004.

### S2 — Pessoa & Vínculo (grafo) *(depende S1)*
CRUD Pessoa (dedup por título, índice cego HMAC), Vínculo, prevenção de ciclo,
realocação de sub-árvore órfã, visibilidade por sub-árvore, campos LGPD (base
legal, consentimento, contato estruturado).
ADRs: 0003, 0004, 0009, 0016, 0018.

### S3 — Ingestão TRE (Superadmin) *(paralelo a S2, depende S0)*
Pipeline curado: parse `SECOES`, casamento de bairro fuzzy, geocode aproximado,
elegibilidade no calor, versão por ano + município/UF, fila de revisão, PostGIS.
ADRs: 0002, 0011, 0017, 0019.

### S4 — Mapa de calor *(depende S2 + S3)*
MapLibre GL + OSM, ancoragem na seção, três camadas (Força/Potencial/Penetração),
agregação por abrangência (municipal/estadual com drill-down).
ADRs: 0005, 0006, 0012.

### S5 — Dashboard BI determinístico *(depende S2 + S4)*
Rankings por sub-árvore (com nota "soma dos ramos ≠ total"), evolução temporal,
alertas por regra. Sem LLM.
ADRs: 0013 (fase 1).

### S6 — Módulos & entitlements *(depende S0; gateia o resto)*
Conjunto de módulos habilitados por campanha, gate de rotas/telas. Entra cedo
como flag.
ADRs: 0018.

## Diferidos (pós-MVP)
- IA sobre agregados — ADR 0013 fase 2.
- Comunicação WhatsApp/SMS — ADR 0018.
- Gateway de pagamento automático — ADR 0015.

## Caminho crítico
S0 → S1 → S2 → (S3 em paralelo) → S4 → S5. S6 entra como flag desde S0.

## Primeira fatia a detalhar
S0 — Fundação.
