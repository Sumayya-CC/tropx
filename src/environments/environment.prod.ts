export const environment = {
  production: true,
  useEmulator: false,
  firebase: {
    projectId: 'tropx-wholesale-dev',
    appId: '1:542964163707:web:7a62a125d3ea344329eede',
    storageBucket: 'tropx-wholesale-dev.firebasestorage.app',
    apiKey: 'AIzaSyDxMpydGo1LzShOH8hr7Tg8sKEpE5o4wac',
    authDomain: 'tropx-wholesale-dev.firebaseapp.com',
    messagingSenderId: '542964163707'
  },
  databaseName: 'tropx-dev',
  emulator: {
    host: 'localhost',
    ports: {
      auth: 9099,
      firestore: 8080,
      functions: 5001,
    },
  },
};