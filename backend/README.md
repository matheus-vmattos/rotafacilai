# Backend (Firebase) — pendente

Hoje o Rota Fácil não tem backend: cada motorista tem seus dados só no
próprio celular (rota, entregas, fotos — tudo em `localStorage`/`IndexedDB`
do app). Isso funciona bem pra um motorista sozinho, mas não dá pra ter
login, acompanhar uma frota, ou cobrar assinatura sem um servidor por trás.

O plano combinado é usar **Firebase** (Auth + Firestore) — sem precisar
manter servidor próprio. Esta pasta é o esqueleto pronto pra isso; falta só
uma coisa que só o dono do projeto pode fazer:

## O que falta (ação do Matheus)

1. Criar um projeto em [console.firebase.google.com](https://console.firebase.google.com)
   (gratuito no plano Spark pra começar).
2. Ativar **Authentication** (método Google, ou e-mail/senha) e
   **Firestore Database**.
3. Baixar o `google-services.json` do app Android cadastrado no projeto
   Firebase e me enviar (ou colar o conteúdo aqui pra eu configurar).
4. Me passar o **Project ID** (aparece nas configurações do projeto).

Com isso em mãos, os próximos passos (que eu faço) são:

- Preencher `.firebaserc` com o Project ID de verdade (o `.firebaserc.example`
  aqui é só o molde).
- Adicionar o SDK do Firebase no app (`www/index.html`) e o plugin nativo de
  autenticação do Capacitor (login pelo Google não funciona só com o SDK
  web dentro do WebView do app — precisa do plugin nativo).
- Desenhar as regras de segurança do Firestore (`firestore.rules`) de
  verdade — o arquivo aqui hoje **nega tudo por padrão**, de propósito,
  até decidirmos o que cada motorista pode ler/escrever.
- Decidir o formato dos dados (uma rota por motorista? por dia? o que fica
  só no celular vs. o que sincroniza?) — ainda não decidido, não vou supor.

## Por que essa pasta existe já, mesmo sem o Firebase pronto

Só pra deixar o projeto organizado: quando o backend entrar, ele fica
separado do código do app (pasta `www/`), sem misturar as duas coisas num
arquivo só. Nada aqui roda ainda — é só o molde.
