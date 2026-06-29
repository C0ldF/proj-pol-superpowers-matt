# Módulos pagos por Campanha (entitlements) + comunicação no roadmap

O produto tem um **núcleo** (cadastro, árvore, mapa, dashboard, relatórios,
auditoria) e **módulos extras pagos** habilitáveis por Campanha. O Superadmin liga
cada módulo manualmente (coerente com a cobrança manual — ADR 0015); a aplicação
**gateia** telas/rotas conforme os módulos contratados.

## Comunicação (roadmap)

Disparo de WhatsApp/SMS para apoiadores é **módulo futuro pago**, fora do MVP. Mas
já se embute, sem custo:

- **Telefone estruturado** (DDD, validado).
- **Consentimento/opt-out de contato por canal** por Pessoa — para um disparo
  futuro respeitar a LGPD desde o primeiro dia.

Não se constrói integração, telas de campanha nem gateway agora — só o **dado fica
pronto**.

## Consequences

- Campanha carrega o conjunto de **módulos habilitados**; checagem de
  entitlement nas rotas/telas.
- Bloquear o modelo de dados de contato agora seria retrabalho caro depois —
  evitado.
