// Configuração da nuvem (Firebase). Enquanto estiver vazia, o sistema funciona só no aparelho.
// Estes dados não são senha: quem protege as informações são as regras do Firestore (firestore.rules),
// que só deixam entrar a conta Google do Felipão.

export const firebaseConfig = {
  apiKey: 'AIzaSyBZI32rYjp2MNNXq0M2kyQMKeX2tOUVmKc',
  authDomain: 'gestao-felipao.firebaseapp.com',
  projectId: 'gestao-felipao',
  storageBucket: 'gestao-felipao.firebasestorage.app',
  messagingSenderId: '267766855836',
  appId: '1:267766855836:web:3f022ca8d3a77c00e25559',
};

// Conta Google que pode entrar no sistema.
export const emailPermitido = 'passossuplementos@gmail.com';
