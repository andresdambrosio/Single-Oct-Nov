// Configuración web de Firebase (Consola → Configuración del proyecto → Tus apps → SDK config).
// Estos valores son públicos por diseño: la seguridad la dan las reglas de firestore.rules.
// Si se pone en null, el sitio vuelve al modo local (apuestas guardadas en el navegador).
export const firebaseConfig = {
  apiKey: 'AIzaSyC_dwFV9coDPZ37zABRFHdSDduoN2jblEQ',
  authDomain: 'tini-tennis-tour.firebaseapp.com',
  projectId: 'tini-tennis-tour',
  storageBucket: 'tini-tennis-tour.firebasestorage.app',
  messagingSenderId: '307651726977',
  appId: '1:307651726977:web:067d5a4c91708fd2734780',
};
