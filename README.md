# Caso Arquivado — como configurar

Jogo de dedução online (companion digital para tabuleiro físico), em HTML/CSS/JS puro, usando Firebase Firestore como banco de dados em tempo real.

## Arquivos

- `index.html` — estrutura da página
- `style.css` — visual (tema noir/detetive)
- `main.js` — toda a lógica do jogo
- `firebase-config.js` — **você precisa preencher com as credenciais do seu projeto Firebase**

## Passo 1 — Criar o projeto Firebase (gratuito)

1. Acesse https://console.firebase.google.com e clique em "Adicionar projeto"
2. Dê um nome (ex: `caso-arquivado`) e conclua a criação
3. No menu lateral, vá em **Compilação > Firestore Database**
4. Clique em **Criar banco de dados**, escolha uma região próxima de você e inicie em **modo de produção**

## Passo 2 — Pegar as credenciais do app Web

1. No console, clique no ícone de engrenagem > **Configurações do projeto**
2. Na aba **Geral**, role até "Seus apps" e clique no ícone `</>` (Web)
3. Dê um nome ao app e clique em "Registrar app"
4. O Firebase vai mostrar um bloco `firebaseConfig = {...}` — copie esses valores
5. Cole esses valores dentro de `firebase-config.js`, substituindo os valores de exemplo

## Passo 3 — Configurar as regras de segurança do Firestore

No console, vá em **Firestore Database > Regras** e substitua o conteúdo por:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /rooms/{code} {
      allow read, write: if true;
    }
    match /hands/{id} {
      allow read, write: if true;
    }
    match /notifications/{id} {
      allow read, write: if true;
    }
    match /history/{id} {
      allow read, write: if true;
    }
    match /notes/{id} {
      allow read, write: if true;
    }
  }
}
```

Clique em **Publicar**.

**Importante:** essas regras deixam o banco totalmente aberto (sem login). Isso é o suficiente para jogar com amigos usando o código da sala como "senha" informal, mas qualquer pessoa que souber o código (ou explorar o banco diretamente) consegue ler/escrever os dados. Não é recomendado para dados sensíveis — é um app de jogo casual, não um produto com dados privados.

## Passo 4 — Hospedar os arquivos

Qualquer hospedagem de site estático funciona. Opções simples e gratuitas:

- **GitHub Pages** — suba os 4 arquivos para um repositório e ative o Pages nas configurações
- **Netlify Drop** (https://app.netlify.com/drop) — arraste a pasta inteira e pronto, gera um link na hora
- **Firebase Hosting** (já que você criou o projeto) — `npm install -g firebase-tools`, depois `firebase init hosting` e `firebase deploy`
- **Vercel** — importe a pasta como projeto estático

Evite abrir só clicando duas vezes no `index.html` (`file://`) — alguns navegadores bloqueiam esse tipo de acesso a arquivos locais. Um servidor local simples também resolve para testar:

```
python3 -m http.server 8000
```
e acesse `http://localhost:8000`.

## Como jogar

1. Um jogador clica em "Criar Sala" e recebe um código de 5 caracteres
2. Os outros jogadores entram com "Entrar em Sala", usando esse código
3. Com pelo menos 3 detetives na sala, o anfitrião clica em "Iniciar Investigação"
4. Cada jogador recebe suas cartas, visíveis só para ele
5. Durante o jogo, qualquer jogador pode clicar em uma carta da própria mão e escolher para quem mostrá-la em segredo
6. Quando alguém tiver certeza da solução, usa "Acusação Final" — se acertar as 3 cartas secretas, vence e o caso entra no histórico

## Personalizando suspeitos, armas e cômodos

No topo do `main.js`, edite as três listas:

```js
var SUSPEITOS = [...];
var ARMAS = [...];
var LOCAIS = [...];
```

para bater com as cartas do seu jogo de tabuleiro físico.
