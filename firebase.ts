import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { initializeFirestore, getFirestore, collection, doc, getDoc, getDocFromCache, getDocs, getDocsFromCache, setDoc, deleteDoc, persistentLocalCache, persistentMultipleTabManager, waitForPendingWrites, type Firestore } from 'firebase/firestore';

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
// Persist Firestore's document cache and queued writes in IndexedDB so previously
// opened accounts can keep working offline and sync changes when connectivity returns.
let persistentFirestore = true;
let firestoreDb: Firestore;
try {
  firestoreDb = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
} catch (error) {
  persistentFirestore = false;
  console.warn('Persistent Firestore cache is unavailable; using the in-memory cache.', error);
  firestoreDb = getFirestore(app);
}
export const db = firestoreDb;
export const hasPersistentOfflineCache = () => persistentFirestore;
let pendingWriteCount = 0;
let lastWriteError = '';
const pendingWriteListeners = new Set<(count:number,error:string)=>void>();
function emitPendingWrites(){ pendingWriteListeners.forEach(listener=>listener(pendingWriteCount,lastWriteError)); }
function watchWrite<T extends Promise<unknown>>(write:T){
  pendingWriteCount++;
  emitPendingWrites();
  void write.then(()=>{
    pendingWriteCount=Math.max(0,pendingWriteCount-1);
    emitPendingWrites();
  },error=>{
    pendingWriteCount=Math.max(0,pendingWriteCount-1);
    lastWriteError=error instanceof Error?error.message:String(error);
    emitPendingWrites();
    console.error('A queued Firestore write was rejected and may need attention.',error);
  });
  return write;
}
export const subscribePendingWrites=(listener:(count:number,error:string)=>void)=>{
  pendingWriteListeners.add(listener); listener(pendingWriteCount,lastWriteError);
  return ()=>{ pendingWriteListeners.delete(listener); };
};
export const getPendingWriteCount=()=>pendingWriteCount;
export const clearSyncError=()=>{ lastWriteError=''; emitPendingWrites(); };
export const waitForCloudSync=()=>waitForPendingWrites(db);
export const observeAuth = onAuthStateChanged;
export const signInWithGoogle = () => signInWithPopup(auth, new GoogleAuthProvider());
export const logOut = () => signOut(auth);
export type { User };

async function finishWriteOrQueue(write: Promise<void>, timeoutMs = 2500) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Firestore applies writes to its local cache immediately, but its write promise
  // normally resolves only after the server acknowledges the mutation.
  const trackedWrite=watchWrite(write);
  const timeout = new Promise<void>(resolve => { timer = setTimeout(resolve, timeoutMs); });
  try { await Promise.race([trackedWrite, timeout]); }
  finally { if (timer) clearTimeout(timer); }
}

function stripUndefined(value: any): any {
  if (Array.isArray(value)) return value.map(item => item === undefined ? null : stripUndefined(item));
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, stripUndefined(item)]));
  }
  return value;
}

// Every record is isolated under its authenticated user's Firestore namespace.
export async function firestoreRecords(action: string, args: any, user: User) {
  const { collection: name, id, value } = args || {};
  if (!name) throw new Error('A record collection is required.');
  const recordsRef = collection(db, 'users', user.uid, 'data', name, 'records');
  if (action === 'records.list') {
    let snapshot;
    try {
      snapshot = typeof navigator !== 'undefined' && !navigator.onLine
        ? await getDocsFromCache(recordsRef)
        : await getDocs(recordsRef);
    } catch (serverError) {
      try { snapshot = await getDocsFromCache(recordsRef); }
      catch (cacheError) {
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          console.warn(`No cached ${name} records are available offline.`, cacheError);
          throw new Error(`No offline copy of ${name} is available yet. Connect to the internet once to cache your account data.`);
        }
        throw serverError;
      }
    }
    // One-time import of this browser's legacy records when a signed-in account has no cloud copy.
    if (typeof navigator !== 'undefined' && navigator.onLine && snapshot.empty && typeof localStorage !== 'undefined') {
      try {
        const legacy = JSON.parse(localStorage.getItem(`eics.records.${name}`) || '[]');
        if (Array.isArray(legacy) && legacy.length) {
          await Promise.all(legacy.filter(row => row?.id).map(row => setDoc(doc(recordsRef, String(row.id)), { value: stripUndefined(row.value), updatedAt: Date.now() })));
          snapshot = await getDocs(recordsRef);
        }
      } catch (error) {
        console.warn(`Could not import local ${name} records`, error);
      }
    }
    const records = snapshot.docs.map(row => ({ id: row.id, value: row.data().value, updatedAt: Number(row.data().updatedAt || 0) }));
    records.sort((a, b) => Number(b.value?.createdAt || 0) - Number(a.value?.createdAt || 0));
    return { records: records.slice(0, args.limit || records.length) };
  }
  if (action === 'records.create') {
    const row = id ? doc(recordsRef, String(id)) : doc(recordsRef);
    if (id) {
      try {
        const existing = typeof navigator !== 'undefined' && !navigator.onLine
          ? await getDocFromCache(row)
          : await getDoc(row);
        if (existing.exists()) return { id: row.id, value: existing.data().value, skipped: true };
      } catch (error) {
        if (typeof navigator === 'undefined' || navigator.onLine) throw error;
      }
    }
    const cleanValue = stripUndefined(value);
    const updatedAt=Date.now();
    const write = setDoc(row, { value: cleanValue, updatedAt });
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      watchWrite(write);
      return { id: row.id, value: cleanValue, updatedAt, skipped: false };
    }
    await finishWriteOrQueue(write);
    return { id: row.id, value: cleanValue, updatedAt, skipped: false };
  }
  if (action === 'records.replace') {
    const row = doc(recordsRef, id);
    if (args.expectedUpdatedAt !== undefined && typeof navigator !== 'undefined' && navigator.onLine) {
      const latest=await getDoc(row);
      const latestUpdatedAt=Number(latest.data()?.updatedAt || 0);
      if (!latest.exists() || latestUpdatedAt!==Number(args.expectedUpdatedAt)) {
        throw new Error('This record changed or was removed on another device. Reload records and review the latest version before saving.');
      }
    }
    const cleanValue = stripUndefined(value);
    const updatedAt=Date.now();
    const write = setDoc(row, { value: cleanValue, updatedAt });
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      watchWrite(write);
      return { id, value: cleanValue, updatedAt };
    }
    await finishWriteOrQueue(write);
    return { id, value: cleanValue, updatedAt };
  }
  if (action === 'records.delete') {
    const remove = deleteDoc(doc(recordsRef, id));
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      watchWrite(remove);
      return { id };
    }
    await finishWriteOrQueue(remove);
    return { id };
  }
  throw new Error(`Unsupported action: ${action}`);
}
