// Dónde viven las apuestas.
// - Con Firebase configurado (src/firebase-config.js): login con Google y apuestas compartidas en Firestore.
// - Sin configurar: modo local, las apuestas quedan en el navegador (como antes).
// Ambos exponen la misma interfaz: { mode, user, bets, users, signIn, signOut, place, reset, onChange }.
import { firebaseConfig } from './firebase-config.js';

const FB = 'https://www.gstatic.com/firebasejs/10.12.4';

// Una apuesta por usuario, partido y mercado: el id del documento lo garantiza.
export const betDocId = (uid, bet) => (bet.market === 'champion' ? `${uid}_champion` : `${uid}_${bet.matchId}_${bet.market}`);

export async function createStore() {
  return firebaseConfig?.apiKey ? createFirebaseStore(firebaseConfig) : createLocalStore();
}

function createLocalStore() {
  const KEY = 'ttt.wallet.v1';
  const listeners = new Set();
  let bets = [];
  try { bets = JSON.parse(localStorage.getItem(KEY))?.bets ?? []; } catch { /* sin storage */ }
  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify({ bets })); } catch { /* modo privado */ }
    listeners.forEach(fn => fn());
  };
  const user = { uid: 'local', name: 'Vos' };
  return {
    mode: 'local',
    user,
    get bets() { return bets.map(b => ({ ...b, uid: 'local' })); },
    users: { local: user },
    signIn() {},
    signOut() {},
    async place(bet) { bets.push({ ...bet, placedAt: new Date().toISOString() }); save(); },
    reset() { bets = []; save(); },
    onChange(fn) { listeners.add(fn); },
  };
}

async function createFirebaseStore(config) {
  const [{ initializeApp }, auth, fs] = await Promise.all([
    import(`${FB}/firebase-app.js`),
    import(`${FB}/firebase-auth.js`),
    import(`${FB}/firebase-firestore.js`),
  ]);
  const app = initializeApp(config);
  const a = auth.getAuth(app);
  const db = fs.getFirestore(app);
  const listeners = new Set();
  const emit = () => listeners.forEach(fn => fn());

  const store = {
    mode: 'firebase',
    user: null,
    bets: [],
    users: {},
    authReady: false,
    async signIn() {
      const provider = new auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      try {
        await auth.signInWithPopup(a, provider);
      } catch (e) {
        if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
          await auth.signInWithRedirect(a, provider);
        } else if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') {
          throw e;
        }
      }
    },
    signOut: () => auth.signOut(a),
    async place(bet) {
      const uid = store.user.uid;
      const { matchId = null, market, pick, odds, stake, title, desc } = bet;
      await fs.setDoc(fs.doc(db, 'bets', betDocId(uid, bet)), {
        uid, matchId, market, pick, odds, stake, title, desc, placedAt: fs.serverTimestamp(),
      });
    },
    reset: null, // en modo compartido las apuestas no se borran
    onChange(fn) { listeners.add(fn); },
  };

  let unsub = [];
  auth.onAuthStateChanged(a, async u => {
    unsub.forEach(fn => fn());
    unsub = [];
    store.authReady = true;
    store.user = u ? { uid: u.uid, name: u.displayName || u.email.split('@')[0], photo: u.photoURL } : null;
    store.bets = [];
    store.users = {};
    emit();
    if (!u) return;
    // Perfil público: sólo nombre y foto (el mail no se comparte con el resto).
    await fs.setDoc(fs.doc(db, 'users', u.uid), { name: store.user.name, photo: store.user.photo ?? null, updatedAt: fs.serverTimestamp() });
    unsub.push(fs.onSnapshot(fs.collection(db, 'bets'), snap => {
      store.bets = snap.docs.map(d => {
        const b = d.data();
        return { ...b, id: d.id, placedAt: b.placedAt?.toDate?.().toISOString() ?? new Date().toISOString() };
      });
      emit();
    }));
    unsub.push(fs.onSnapshot(fs.collection(db, 'users'), snap => {
      store.users = Object.fromEntries(snap.docs.map(d => [d.id, { uid: d.id, ...d.data() }]));
      emit();
    }));
  });
  return store;
}
