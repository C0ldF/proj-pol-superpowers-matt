# Reconciliação de bairro local com bairro oficial: alerta + revisão

Quando uma importação oficial do TRE (Superadmin) traz um bairro parecido com um
**bairro local** que uma Campanha já criou (ADR 0002), o sistema **não funde
automaticamente**. Levanta um **alerta de possível duplicata** numa fila de
revisão; o operador confirma:

- **"É o mesmo" → fundir:** os apoiadores apontados ao bairro local são
  **re-apontados** ao oficial; o local é aposentado. Tudo no log.
- **"São diferentes" → manter separados.**

## Por quê

Fusão é destrutiva e mexe em dado de campanha. Automatizar (risco de fundir
errado e corromper mapas de calor) é perigoso; deixar duplicado corrói rankings.
A revisão mantém o Superadmin como árbitro do canônico (governança pedida).

## Escopo

A reconciliação ocorre **dentro da Campanha** que tinha o bairro local (overlay
por campanha — ADR 0002), não globalmente.
