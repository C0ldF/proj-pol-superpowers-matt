# Log de auditoria imutável, recortado por papel

Toda ação que muda ou expõe dado é registrada num **log append-only e imutável**:
criação/edição/exclusão de Pessoa e Vínculo, concessão/revogação de poderes,
exportações de relatório, logins e tentativas falhas. Cada entrada: quem, o quê,
qual registro, quando, e antes/depois quando relevante.

- **Imutável:** ninguém edita nem apaga o log no fluxo normal — **nem Gestor nem
  Superadmin**. Um log alterável não serve como prova. Só cresce.
- **Visível, recortado por papel:** Gestor/Coordenador veem o log do seu alcance;
  Liderança só vê com o poder concedido **"ver auditoria"** (ADR 0004), e só os
  eventos da própria sub-árvore.
- **Dois lugares:** feed geral filtrável + histórico na ficha de cada Pessoa.
- **Nasce na fundação** (Fase 0/1), junto do cadastro — senão há buraco no
  histórico.

## Retenção

Logs retidos até **1 mês após o fim da eleição** da Campanha (mais que o
necessário operacional, por accountability), depois expurgados. Exige uma **data
de eleição** por Campanha como âncora do prazo.

## Consequences

- Tabela de log separada, append-only, com RLS por sub-árvore; sem UPDATE/DELETE
  expostos.
- O log referencia PII indiretamente; seu acesso é restrito e ele mesmo registra
  leituras/exportações sensíveis.
