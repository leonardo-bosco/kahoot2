// Firebase project config.
// Safe to be public — security is enforced by the Realtime Database rules, not by this key.
const firebaseConfig = {
  apiKey: "AIzaSyDvm4zVpgAFMuvYUFvRvJUYjwBIrHWZ9QE",
  authDomain: "kahoot-vault.firebaseapp.com",
  databaseURL: "https://kahoot-vault-default-rtdb.firebaseio.com",
  projectId: "kahoot-vault",
  storageBucket: "kahoot-vault.firebasestorage.app",
  messagingSenderId: "472889573611",
  appId: "1:472889573611:web:72cd83a820869d52a57eae"
};

firebase.initializeApp(firebaseConfig);
window.db = firebase.database();
