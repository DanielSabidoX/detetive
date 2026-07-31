// 1. Crie um projeto gratuito em https://console.firebase.google.com
// 2. Dentro do projeto, ative o "Firestore Database" (modo de produção)
// 3. Em "Configurações do projeto" > "Geral" > "Seus apps", crie um app da Web
// 4. Copie as credenciais que aparecerem e cole abaixo, substituindo os valores de exemplo
// 5. Veja o README.md para as regras de segurança do Firestore que você precisa colar

// const firebaseConfig = {
//   apiKey: "SUA_API_KEY_AQUI",
//   authDomain: "seu-projeto.firebaseapp.com",
//   projectId: "seu-projeto",
//   storageBucket: "seu-projeto.appspot.com",
//   messagingSenderId: "000000000000",
//   appId: "1:000000000000:web:xxxxxxxxxxxxxxxxxxxxxx"
// };

const firebaseConfig = {
  apiKey: "AIzaSyAqf-HqsLtjijDhCrvCSvnTpu1SHD555iE",
  authDomain: "teste-a6c9f.firebaseapp.com",
  projectId: "teste-a6c9f",
  storageBucket: "teste-a6c9f.firebasestorage.app",
  messagingSenderId: "998282945061",
  appId: "1:998282945061:web:057e0c509758b7a19155cc",
  measurementId: "G-Q8WD5PPTB9"
};


firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
