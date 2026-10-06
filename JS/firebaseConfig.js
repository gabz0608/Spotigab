// Importa os módulos do SDK do Firebase diretamente dos arquivos hospedados pelo Google.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
    getAuth,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
    getDatabase,
    ref,
    push,
    onValue,
    remove,
    set,
    get,
    child,
    update
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

// Configuração do projeto Firebase.
// Este projeto usa somente Authentication e Realtime Database.
const firebaseConfig = {
    apiKey: "AIzaSyBM-GJfKwI8g-x-u9s_zRj7uoGzG-ZFpOY",
    authDomain: "clone-spotify-1bf3d.firebaseapp.com",
    databaseURL: "https://clone-spotify-1bf3d-default-rtdb.firebaseio.com",
    projectId: "clone-spotify-1bf3d",
    messagingSenderId: "341422591119",
    appId: "1:341422591119:web:cce7416fdd7be3ea05b4fa",
    measurementId: "G-Q5GF98W0XQ"
};

// Inicializa um único app Firebase e cria os clientes de Authentication e Realtime Database.
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// Exportamos somente recursos que realmente são usados pelo projeto.
export {
    db,
    auth,
    ref,
    push,
    onValue,
    remove,
    set,
    get,
    child,
    update,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged
};
