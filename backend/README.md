# Backend (Firebase)

O Rota Fácil usa **Firebase** (Auth + Firestore), sem servidor próprio.

- **Authentication** (Google + e-mail/senha): pronto e em uso — é a tela de
  login obrigatória do app.
- **Firestore**: guarda o **histórico de entregas** de cada motorista
  (endereço, coordenada, dia da semana, se entregou ou não), pra no futuro
  dar pra calcular coisas como "rua com mais entrega" ou "dia mais cheio".
  Cada motorista só enxerga o próprio histórico — nunca o de outro
  (`firestore.rules`).

Tudo o resto do app continua funcionando **só com o celular** (rota do dia,
paradas, baú) — o Firestore é um extra que tenta sincronizar em segundo
plano, nunca trava nem impede o motorista de trabalhar se estiver sem
sinal ou se a sincronização falhar por qualquer motivo.

## Ação pendente (Matheus) — só falta isso

O código já manda os dados pro Firestore, mas o banco de dados de verdade
(no [console.firebase.google.com](https://console.firebase.google.com),
projeto `rota-facil-f0eb6`) ainda está com as regras antigas, que travam
tudo. Até você publicar a regra nova, a sincronização tenta e falha
silenciosamente — sem problema nenhum pro motorista, só não guarda nada
na nuvem ainda.

**Pra ativar:**
1. Abra o projeto no console do Firebase → **Firestore Database** → aba
   **Regras**.
2. Apague o conteúdo e cole o texto do arquivo `firestore.rules` desta
   pasta.
3. Clique em **Publicar**.

Pronto — a partir daí, toda vez que uma rota terminar (ou for encerrada
manualmente), as entregas daquele dia sobem sozinhas pro Firestore.

## O que ainda NÃO existe (próximos passos, quando fizer sentido)

- Uma tela no app mostrando os números calculados a partir desse
  histórico ("rua com mais entrega", "dia mais cheio") — hoje só os
  dados brutos são guardados; ainda não tem nenhuma tela de relatório
  lendo isso de volta.
- Nenhuma lógica ainda usa esse histórico pra ajustar a rota (ex: avisar
  "essa rua já deu problema antes") — é só a base de dados, o
  aproveitamento dela é um passo separado.
