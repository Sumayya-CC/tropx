export const environment = {
  production: true,
  useEmulator: false,
  firebase: {
    projectId: 'tropx-wholesale-prod',
    appId: '1:735499758886:web:ff7e3dbbdf5668a0b265e7',
    storageBucket: 'tropx-wholesale-prod.firebasestorage.app',
    apiKey: 'AIzaSyD78ERYinKWMK61WRQ4OPoTRezuRLNPiWM',
    authDomain: 'tropx-wholesale-prod.firebaseapp.com',
    messagingSenderId: '735499758886'
  },
  databaseName: 'tropx-prod',
  emulator: {
    host: 'localhost',
    ports: {
      auth: 9099,
      firestore: 8080,
      functions: 5001,
    },
  },
};