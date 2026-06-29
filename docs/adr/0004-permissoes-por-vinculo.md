# Autoridade por Vínculo (papéis com escopo de ramo), identidade na Pessoa

A permissão de acesso **mora no Vínculo**, não na Pessoa. Uma mesma Pessoa pode ter
papéis diferentes em ramos diferentes — ex.: Liderança sob o gestor X e
Coordenadora sob o gestor Y, simultaneamente.

- **Identidade + credenciais (login):** na Pessoa. Um ser humano = um login.
- **Autoridade:** no Vínculo. Avaliada **sempre relativa ao ramo** onde a ação
  ocorre — nunca global.

## Escada de papéis

Superadmin (fora da campanha) · Gestor · Coordenador · Liderança · Apoiador (sem
login). **Colaborador** é transversal (equipe administrativa): edita amplamente,
mas não comanda a árvore política nem concede poderes.

**Permissão efetiva = papel-base do vínculo + poderes concedidos** (interruptores
por pessoa: ver dashboard completo, gerar relatórios, exportar — sem mudar a
posição na árvore).

## Considered Options

- **Papel por Vínculo (escolhido).** Exigido pelo cenário real (mesma pessoa
  comanda um ramo e é base em outro).
- **Papel único por Pessoa.** Mais simples e auditável, mas não comporta o caso.
  Rejeitado a pedido.

## Consequences

- RLS e checagens de autoridade devem ser **relativas ao ramo/sub-árvore alvo**,
  não a um papel global da pessoa. Risco principal a blindar: vazamento de poder
  entre ramos. Exige teste explícito.
- Ter login depende de a Pessoa ter ao menos um Vínculo com papel >= Liderança.
- Gestor/Colaborador têm escopo de campanha inteira; Coordenador/Liderança têm
  escopo de sub-árvore.
