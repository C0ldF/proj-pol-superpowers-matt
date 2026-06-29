# Sistema de Gestão de Campanha Política

Plataforma multi-tenant para gestão de campanhas eleitorais: cadastro de
eleitores e lideranças em árvore, geolocalização, mapas de calor por zona/seção
eleitoral, com isolamento de dados por campanha e conformidade com a LGPD.

## Language

**Campanha**:
A unidade isolável de dados do sistema — corresponde à campanha de um candidato
num pleito/ano. É a fronteira de isolamento (tudo que um cliente vê e edita vive
dentro de uma Campanha). Cada Campanha tem seu próprio subdomínio.
_Avoid_: cliente, conta, tenant

**Contratante**:
Quem contrata o sistema (paga). Pode ter mais de uma Campanha. Hoje é gerido
fora do sistema (administração manual), não é entidade operacional.
_Avoid_: cliente

**Pessoa**:
Um ser humano dentro de uma Campanha. Existe uma única vez por Campanha,
deduplicada pelo **título de eleitor** (chave de identidade primária; CPF é
secundário). Carrega dados pessoais, contato, endereço e seção/zona eleitoral.
_Avoid_: eleitor, cadastro, usuário, membro

**Vínculo**:
A aresta que liga uma Pessoa ao seu responsável na rede ("está sob"). Uma Pessoa
pode ter mais de um Vínculo (vários responsáveis) — por isso a rede é um grafo,
não uma árvore pura. O **papel de acesso** da Pessoa naquela posição vive no
Vínculo (autoridade é por ramo, não global).
_Avoid_: relacionamento, filiação, aresta

**Cargo**:
O posto disputado pela Campanha. Hoje, apenas: vereador, prefeito, deputado
estadual. Define a Abrangência e o template da rede.

**Abrangência**:
O universo geográfico da Campanha. **Municipal** (vereador, prefeito) → um
Município; **Estadual** (deputado estadual) → uma UF (todos os seus municípios).
Determina quais dados oficiais a Campanha carrega e a granularidade do mapa de
calor.

**Local de Votação**:
Ponto físico oficial do TRE onde se vota (escola, etc.), com lat/long, endereço,
bairro, zona e suas seções. Dado de referência (ADR 0002). É a âncora geográfica
do mapa de calor eleitoral.

**Seção**:
A menor unidade eleitoral (`s: NNN`), pertencente a um Local de Votação e a uma
Zona, com uma quantidade de aptos a votar (`apt`). É por seção que se ancora um
apoiador no mapa.

**Zona Eleitoral**:
Agrupamento oficial de seções/locais definido pelo TRE. Não confundir com Bairro
(bairro é geografia urbana; zona é divisão eleitoral).
_Avoid_: zona (sem qualificar)

**Bairro**:
Geografia urbana. Camada oficial (IBGE/TRE, somente-leitura) + bairros locais
criados pela campanha (ADR 0002). Distinto de Zona Eleitoral.

**Gestor**:
Papel canônico do topo da Campanha; acesso total dentro dela. Pode haver vários
(prefeito, deputado). Em campanha de vereador, acumula o papel de Coordenador.

**Coordenador**:
Papel canônico intermediário; comanda um grande ramo e concede poderes às
lideranças abaixo. Em campanhas de prefeito/deputado costuma ser exibido como
"Vereador" (ver Rótulo de exibição).

**Liderança**:
Papel canônico que cadastra lideranças e apoiadores; por padrão vê só a própria
sub-árvore.

**Apoiador**:
Registro de eleitor sem acesso ao sistema (não loga). Pode ser cadastrado
incompleto (só nome + telefone).

**Colaborador**:
Papel transversal (equipe administrativa): edita dados amplamente, mas não comanda
a árvore política nem concede poderes.

**Módulo**:
Conjunto de funcionalidades habilitável por Campanha (entitlement). O núcleo é
sempre incluso; módulos extras (ex.: Comunicação, IA) são pagos à parte e ligados
manualmente pelo Superadmin. A aplicação libera/bloqueia telas conforme os módulos
contratados pela Campanha.

**Rótulo de exibição**:
Nome que uma Campanha mostra na tela para um papel canônico (ex.: "Vereador" para
Coordenador). É cosmético; a segurança/RLS usa sempre o papel canônico, nunca o
rótulo.

**Força / Potencial / Penetração**:
As três medidas do mapa de calor. **Força** = nº de apoiadores meus por área.
**Potencial** = nº de aptos por área (do TRE). **Penetração** = Força ÷ Potencial
(cobertura). Todas agregadas a partir da seção/local de votação.
