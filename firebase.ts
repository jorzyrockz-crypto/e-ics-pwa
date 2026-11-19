import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, deleteDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyDSzRMrsCvxA6faVN7TUsL9-tfCNTJJTzk',
  authDomain: 'russapps-eload.firebaseapp.com',
  projectId: 'russapps-eload',
  storageBucket: 'russapps-eload.firebasestorage.app',
  messagingSenderId: '50857051737',
  appId: '1:50857051737:web:1642613bc19377704f1348',
  measurementId: 'G-TC7H9M97YK',
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const observeAuth = onAuthStateChanged;
export const signInWithGoogle = () => signInWithPopup(auth, new GoogleAuthProvider());
export const logOut = () => signOut(auth);
export type { User };

// Every record is isolated under its authenticated user's Firestore namespace.
export async function firestoreRecords(action: string, args: any, user: User) {
  const { collection: name, id, value } = args || {};
  if (!name) throw new Error('A record collection is required.');
  const recordsRef = collection(db, 'users', user.uid, 'data', name, 'records');
  if (action === 'records.list') {
    let snapshot = await getDocs(recordsRef);
    // One-time import of this browser's legacy records when a signed-in account has no cloud copy.
    if (snapshot.empty && typeof localStorage !== 'undefined') {
      try {
        const legacy = JSON.parse(localStorage.getItem(`eics.records.${name}`) || '[]');
        if (Array.isArray(legacy) && legacy.length) {
          await Promise.all(legacy.filter(row => row?.id).map(row => setDoc(doc(recordsRef, String(row.id)), { value: row.value })));
          snapshot = await getDocs(recordsRef);
        }
      } catch (error) {
        console.warn(`Could not import local ${name} records`, error);
      }
    }
    const records = snapshot.docs.map(row => ({ id: row.id, value: row.data().value }));
    records.sort((a, b) => Number(b.value?.createdAt || 0) - Number(a.value?.createdAt || 0));
    return { records: records.slice(0, args.limit || records.length) };
  }
  if (action === 'records.create') {
    const row = id ? doc(recordsRef, String(id)) : doc(recordsRef);
    if (id) {
      const existing = await getDoc(row);
      if (existing.exists()) return { id: row.id, value: existing.data().value, skipped: true };
    }
    await setDoc(row, { value });
    return { id: row.id, value, skipped: false };
  }
  if (action === 'records.replace') {
    const row = doc(recordsRef, id);
    await setDoc(row, { value });
    return { id, value };
  }
  if (action === 'records.delete') {
    await deleteDoc(doc(recordsRef, id));
    return { id };
  }
  throw new Error(`Unsupported action: ${action}`);
}
