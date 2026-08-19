# Chave de assinatura de testes

`rotafacil-testing.jks` é a chave usada pra assinar os builds de teste do
Rota Fácil (os `.apk` enviados direto pros testadores, fora da Play Store).

- alias: `rotafacil`
- senha da store e da chave: `RotaFacil2026Test!`

**Por que está commitada no repo:** pra que qualquer build futuro (de
qualquer sessão/máquina) assine o APK com a mesma identidade. Isso é
obrigatório pro auto-update funcionar — o Android só deixa instalar uma
`.apk` por cima de uma já instalada se a assinatura for idêntica. Se essa
chave mudar, todo mundo que já tem o app instalado precisa desinstalar e
instalar de novo.

**Isso NÃO é uma chave de produção.** É autoassinada, feita só pra permitir
sideload + atualização entre os testadores. Antes de publicar na Play
Store, gere uma chave de release de verdade e guarde num cofre de
segredos — não commite ela no git.
