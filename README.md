# Rota Fácil

App de roteirização de última milha (SPX/Mercado Livre) — importa a
planilha `.xlsx` do galpão, agrupa pacotes, calcula a melhor sequência de
paradas e guia a entrega.

## Estrutura do projeto

- `www/index.html` — o app inteiro (HTML+CSS+JS num arquivo só, sem etapa
  de build). Roda igual dentro do app instalado (Capacitor) e direto num
  navegador comum — as partes que dependem do celular (câmera, GPS,
  atualização automática) já verificam se estão disponíveis antes de usar.
- `android/` — projeto Capacitor que empacota `www/` num `.apk`.
- `backend/` — ainda não ativo; molde pronto pro Firebase (login + banco de
  dados) assim que o projeto Firebase existir. Ver `backend/README.md`.
- `tests/` — teste automatizado (`npm test`) que simula um motorista
  usando o app do começo ao fim.
- `dist/` — `.apk` publicado + `version.json` que o próprio app consulta
  pra saber se tem versão nova.
- `android-signing/` — chave usada pra assinar os builds de teste (ver
  `android-signing/README.md`).

## Testar mudanças

```bash
npm install                    # só na primeira vez (ou quando mudar package.json)
npx playwright install chromium # idem — baixa o navegador que o teste usa
npm test                       # roda o teste automatizado
```

Pra abrir o app e mexer manualmente, sirva a pasta `www/` com qualquer
servidor local e abra `index.html` no navegador — por exemplo:

```bash
npx http-server www -p 8080
# depois abra http://localhost:8080/index.html
```

## Build do APK (Android)

Este ambiente não tinha o Android SDK — os passos abaixo recriam o setup:

```bash
# 1. baixar e instalar o SDK cmdline-tools
mkdir -p /opt/android-sdk/cmdline-tools
curl -L -o /tmp/cmdline-tools.zip \
  "https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"
unzip -q /tmp/cmdline-tools.zip -d /opt/android-sdk/cmdline-tools
mv /opt/android-sdk/cmdline-tools/cmdline-tools /opt/android-sdk/cmdline-tools/latest

export ANDROID_HOME=/opt/android-sdk
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"
yes | sdkmanager --sdk_root=$ANDROID_HOME --licenses
sdkmanager --sdk_root=$ANDROID_HOME "platform-tools" "platforms;android-34" "build-tools;34.0.0"

# 2. apontar o projeto Android pro SDK
echo "sdk.dir=$ANDROID_HOME" > android/local.properties

# 3. instalar deps JS e sincronizar os assets web -> Android
npm install
npx cap copy android

# 4. buildar o apk assinado (usa a chave em android-signing/, ver seu README)
cd android && ./gradlew assembleRelease
# saída: android/app/build/outputs/apk/release/app-release.apk
```

## Publicar uma atualização

1. Edite `www/index.html` e, se der, rode `npm test` antes de publicar.
2. Suba o `versionCode`/`versionName` em `android/app/build.gradle` **e**
   a constante `APP_VERSION_CODE` no topo do bloco de auto-update em
   `www/index.html` (precisam ficar iguais).
3. `npx cap copy android && cd android && ./gradlew assembleRelease`.
4. Copie o apk pra `dist/rotafacil.apk` e atualize `dist/version.json`
   (`versionCode`, `versionName`, `notes`).
5. Commit + push. Quem já tem o app instalado recebe um banner de
   atualização na próxima vez que abrir (compara com
   `dist/version.json` via `raw.githubusercontent.com`).
