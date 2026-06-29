# Inteligência do dashboard: BI determinístico agora, IA depois só sobre agregados

O "dashboard inteligente" é entregue em duas fases:

- **Fase 1 (agora): BI determinístico.** Rankings (Força/Potencial/Penetração),
  mapa de calor, evolução temporal e **alertas por regra** (ex.: alto potencial +
  baixa penetração; liderança estagnada). Sem LLM — rápido, barato, auditável.
- **Fase 2 (depois): insights com IA** em linguagem natural. Provedor pretendido:
  **Gemini** (boa cota gratuita). Diferido.

## Fronteira dura (independe do provedor)

**Nenhuma PII individual (nome, CPF, título, telefone, endereço) jamais é enviada
a um LLM.** A IA recebe **somente dados agregados/anonimizados** (contagens por
bairro/zona/seção). Esta é uma regra de conformidade LGPD, não uma preferência —
vale para Gemini, Claude ou qualquer modelo externo.

## Consequences

- A camada de IA consome uma view agregada; não tem acesso às tabelas de PII.
- Trocar de provedor de LLM não afeta a fronteira.
