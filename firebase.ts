import { initializeApp } from 'firebase/app';
import { coalesceOfflineMutation, overlayOfflineMutations, recordVersionMatches, type OfflineMutation } from './offlineSync';
import { listenToRecordCollections, type LiveRecordCallbacks } from './liveRecords';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { initializeFirestore, getFirestore, collection, doc, getDoc, getDocFromCache, getDocs, getDocsFromCache, setDoc, deleteDoc, onSnapshot, persistentLocalCache, persistentMultipleTabManager, waitForPendingWrites, runTransaction, type Firestore } from 'firebase/firestore';

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

function userMutationsRef(user:User){ return collection(db,'users',user.uid,'offline_mutations'); }
async function queueOfflineMutation(user:User,collectionName:string,recordId:string,action:'replace'|'delete',value?:unknown,expectedVersion?:number){
  const opsRef=userMutationsRef(user);
  let cachedOperation:OfflineMutation|undefined;
  let cachedOperationRef:any;
  try{
    const operationSnapshot=await getDocsFromCache(opsRef);
    const matching=operationSnapshot.docs.filter(row=>{const data=row.data();return data.collection===collectionName&&data.recordId===recordId;});
    const conflict=matching.find(row=>row.data().kind==='conflict');
    if(conflict) throw new Error('This record has an unresolved sync conflict. Resolve it online before editing again.');
    const match=matching.find(row=>row.data().kind==='mutation');
    if(match){cachedOperation=match.data() as OfflineMutation;cachedOperationRef=match.ref;}
  }catch{}
  if(cachedOperation?.kind==='conflict') throw new Error('This record has an unresolved sync conflict. Resolve it online before editing again.');
  let baseVersion=expectedVersion;
  if(cachedOperation) baseVersion=cachedOperation.expectedUpdatedAt;
  if(baseVersion===undefined){
    try{const cached=await getDocFromCache(doc(db,'users',user.uid,'data',collectionName,'records',recordId));if(!cached.exists())throw new Error('missing');baseVersion=Number(cached.data()?.updatedAt||0);}
    catch{throw new Error('Cannot safely edit this record offline because its current version is not cached. Reconnect and reload it first.');}
  }
  const operationRef=cachedOperationRef||doc(opsRef);
  const operation=coalesceOfflineMutation(cachedOperation,{id:operationRef.id,kind:'mutation',collection:collectionName,recordId,action,value:action==='replace'?stripUndefined(value):undefined,expectedUpdatedAt:baseVersion,createdAt:Date.now()});
  const write=setDoc(operationRef,stripUndefined(operation));
  watchWrite(write);
  return operation;
}

const mutationRuns = new Map<string,{again:boolean;promise:Promise<void>}>();
function processQueuedMutations(user:User):Promise<void>{
  if(typeof navigator!=='undefined'&&!navigator.onLine) return Promise.resolve();
  const running=mutationRuns.get(user.uid);
  if(running){ running.again=true; return running.promise; }
  const task={again:false,promise:Promise.resolve()};
  mutationRuns.set(user.uid,task);
  task.promise=(async()=>{
    try{
      do{
        task.again=false;
        await processQueuedMutationsOnce(user);
      }while(task.again && (typeof navigator==='undefined'||navigator.onLine));
    }finally{mutationRuns.delete(user.uid);}
  })();
  return task.promise;
}

export async function syncUserRecords(user:User){
  if(typeof navigator!=='undefined'&&!navigator.onLine) return;
  await waitForCloudSync();
  await processQueuedMutations(user);
  await waitForCloudSync();
}

export function subscribeToUserRecords(user:User,callbacks:LiveRecordCallbacks):()=>void{
  return listenToRecordCollections((source,next,error)=>{
    const ref=source==='offline_mutations'?userMutationsRef(user):collection(db,'users',user.uid,'data',source,'records');
    return onSnapshot(ref,{includeMetadataChanges:true},snapshot=>next({
      records:snapshot.docs.map(row=>({id:row.id,value:source==='offline_mutations'?row.data():row.data().value,updatedAt:Number(row.data().updatedAt||0)})),
      fromCache:snapshot.metadata.fromCache,
      hasPendingWrites:snapshot.metadata.hasPendingWrites,
    }),error);
  },{...callbacks,onPendingMutations:()=>{
    void processQueuedMutations(user);
    callbacks.onPendingMutations?.();
  }});
}

async function processQueuedMutationsOnce(user:User){
  if(typeof navigator!=='undefined'&&!navigator.onLine) return;
  let snapshot;
  try{snapshot=await getDocs(userMutationsRef(user));}catch{return;}
  for(const operationDoc of snapshot.docs){
    const operationRef=operationDoc.ref;
    const data=operationDoc.data() as OfflineMutation;
    if(data.kind!=='mutation'||!data.collection||!data.recordId) continue;
    const targetRef=doc(db,'users',user.uid,'data',data.collection,'records',data.recordId);
    try{
      await runTransaction(db,async transaction=>{
        const op=await transaction.get(operationRef);
        if(!op.exists()||op.data().kind!=='mutation') return;
        const target=await transaction.get(targetRef);
        const current=target.data();
        const actualUpdatedAt=Number(current?.updatedAt||0);
        if(recordVersionMatches(Number(op.data().expectedUpdatedAt||0),target.exists(),actualUpdatedAt)){
          if(op.data().action==='delete') transaction.delete(targetRef);
          else transaction.set(targetRef,{value:stripUndefined(op.data().value),updatedAt:Math.max(Date.now(),actualUpdatedAt+1)});
          transaction.delete(operationRef);
        }else{
          transaction.update(operationRef,{kind:'conflict',remoteValue:target.exists()?current?.value:null,remoteUpdatedAt:actualUpdatedAt,conflictAt:Date.now()});
        }
      });
    }catch(error){console.warn('Deferred offline edit is waiting for connection or needs attention.',error);}
  }
}

// Every record is isolated under its authenticated user's Firestore namespace.
export async function firestoreRecords(action: string, args: any, user: User): Promise<any> {
  const { collection: name, id, value } = args || {};
  if (!name && action!=='sync.conflicts.resolve') throw new Error('A record collection is required.');
  const recordsRef = collection(db, 'users', user.uid, 'data', name||'meta', 'records');
  if (action === 'records.list') {
    if(name==='sync_conflicts'){
      if(typeof navigator==='undefined'||navigator.onLine) await processQueuedMutations(user);
      let operations;
      try{operations=typeof navigator!=='undefined'&&!navigator.onLine?await getDocsFromCache(userMutationsRef(user)):await getDocs(userMutationsRef(user));}
      catch{operations=await getDocsFromCache(userMutationsRef(user));}
      const conflicts=operations.docs.filter(row=>row.data().kind==='conflict').map(row=>({id:row.id,value:row.data(),updatedAt:Number(row.data().conflictAt||0)}));
      return {records:conflicts.slice(0,args.limit||conflicts.length)};
    }
    if(typeof navigator==='undefined'||navigator.onLine) void processQueuedMutations(user);
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
    let records = snapshot.docs.map(row => ({ id: row.id, value: row.data().value, updatedAt: Number(row.data().updatedAt || 0) }));
    let operations:any[]=[];
    try{const operationSnapshot=typeof navigator!=='undefined'&&!navigator.onLine?await getDocsFromCache(userMutationsRef(user)):await getDocs(userMutationsRef(user)); operations=operationSnapshot.docs.map(row=>({id:row.id,...row.data()} as OfflineMutation));}catch{}
    records=overlayOfflineMutations(records,operations,name);
    records.sort((a, b) => Number(b.value?.createdAt || 0) - Number(a.value?.createdAt || 0));
    return { records: records.slice(0, args.limit || records.length) };
  }
  if (action === 'records.save_transaction' || action === 'records.delete_transaction') {
    const deleting = action === 'records.delete_transaction';
    if (name !== 'transactions' || !id) throw new Error('A transaction ID is required for a financial save.');
    const companion = args.meta;
    if (companion && !companion.id) throw new Error('Load the wallet balances before changing this transaction.');
    if (args.requireOnline) {
      // A destination correction must never become two independent offline
      // proposals or overwrite wallet values overlaid by an unprocessed proposal.
      if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error('Reconnect before correcting a payment wallet.');
      const queued = await getDocs(userMutationsRef(user));
      if (queued.metadata?.fromCache || queued.metadata?.hasPendingWrites || queued.docs.some(row => ['transactions', 'meta'].includes(row.data().collection))) {
        throw new Error('Finish syncing and resolve any offline transaction / wallet proposals before correcting a payment wallet.');
      }
    }
    // Keep the existing offline proposal/overlay behavior. Online, a sale,
    // release, collection, tip, deletion, or Undo and its wallet change succeed
    // together: a rejected balance revision cannot leave a half-written ledger.
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      if (args.requireOnline) throw new Error('Reconnect before correcting a payment wallet.');
      const record = await firestoreRecords(deleting ? 'records.delete' : args.create ? 'records.create' : 'records.replace', {
        collection: name, id, value, expectedUpdatedAt: args.expectedUpdatedAt,
      }, user);
      const meta = !record.skipped && companion ? await firestoreRecords('records.replace', {
        collection: 'meta', id: companion.id, value: companion.value, expectedUpdatedAt: companion.expectedUpdatedAt,
      }, user) : undefined;
      return { record, meta };
    }
    const row = doc(recordsRef, String(id));
    const metaRow = companion ? doc(db, 'users', user.uid, 'data', 'meta', 'records', String(companion.id)) : null;
    return runTransaction(db, async transaction => {
      // All reads precede writes, including when the SDK retries a transaction.
      const current = await transaction.get(row);
      const currentMeta = metaRow ? await transaction.get(metaRow) : null;
      const version = Number(current.data()?.updatedAt || 0);
      const metaVersion = Number(currentMeta?.data()?.updatedAt || 0);
      if ((!deleting && args.create && current.exists()) || (deleting && !current.exists())) {
        // Stable IDs make create/Undo retries idempotent. An already-completed
        // deletion must likewise never refund its service/receipts twice.
        return {
          record: { id: row.id, value: current.data()?.value, updatedAt: version, skipped: true },
          meta: currentMeta?.exists() ? { id: metaRow!.id, value: currentMeta.data().value, updatedAt: metaVersion } : undefined,
        };
      }
      if ((deleting || !args.create) && !recordVersionMatches(Number(args.expectedUpdatedAt || 0), current.exists(), version)) {
        throw new Error('This record changed or was removed on another device. Reload records and review the latest version before saving.');
      }
      if (companion && !recordVersionMatches(Number(companion.expectedUpdatedAt || 0), Boolean(currentMeta?.exists()), metaVersion)) {
        throw new Error('Wallet balances changed on another device. No transaction or wallet changes were saved. Review the latest balances and try again.');
      }
      const updatedAt = Math.max(Date.now(), version + 1);
      const cleanValue = stripUndefined(value);
      if (deleting) transaction.delete(row);
      else transaction.set(row, { value: cleanValue, updatedAt });
      let meta;
      if (metaRow) {
        meta = { id: metaRow.id, value: stripUndefined(companion.value), updatedAt: Math.max(Date.now(), metaVersion + 1) };
        transaction.set(metaRow, { value: meta.value, updatedAt: meta.updatedAt });
      }
      return { record: { id: row.id, value: cleanValue, updatedAt }, meta };
    });
  }
  if (action === 'records.create') {
    const row = id ? doc(recordsRef, String(id)) : doc(recordsRef);
    if (id) {
      try {
        const existing = typeof navigator !== 'undefined' && !navigator.onLine
          ? await getDocFromCache(row)
          : await getDoc(row);
        if (existing.exists()) return { id: row.id, value: existing.data().value, updatedAt: Number(existing.data().updatedAt || 0), skipped: true };
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
    if(typeof navigator!=='undefined'&&!navigator.onLine){
      const operation=await queueOfflineMutation(user,name,String(id),'replace',value,args.expectedUpdatedAt);
      return {id,value:stripUndefined(value),updatedAt:operation.expectedUpdatedAt,queued:true};
    }
    let currentVersion=0;
    if (args.expectedUpdatedAt !== undefined && typeof navigator !== 'undefined' && navigator.onLine) {
      const latest=await getDoc(row);
      currentVersion=Number(latest.data()?.updatedAt || 0);
      if (!latest.exists() || currentVersion!==Number(args.expectedUpdatedAt)) {
        throw new Error('This record changed or was removed on another device. Reload records and review the latest version before saving.');
      }
    }
    const cleanValue = stripUndefined(value);
    const updatedAt=Math.max(Date.now(),currentVersion+1);
    const write = setDoc(row, { value: cleanValue, updatedAt });
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      watchWrite(write);
      return { id, value: cleanValue, updatedAt };
    }
    await finishWriteOrQueue(write);
    return { id, value: cleanValue, updatedAt };
  }
  if (action === 'records.delete') {
    if(typeof navigator!=='undefined'&&!navigator.onLine){
      const operation=await queueOfflineMutation(user,name,String(id),'delete',undefined,args.expectedUpdatedAt);
      return {id,queued:true,updatedAt:operation.expectedUpdatedAt};
    }
    if(args.expectedUpdatedAt!==undefined){const latest=await getDoc(doc(recordsRef,id));if(!recordVersionMatches(Number(args.expectedUpdatedAt),latest.exists(),Number(latest.data()?.updatedAt||0)))throw new Error('This record changed or was removed on another device. Reload records and review the latest version before deleting.');}
    const remove = deleteDoc(doc(recordsRef, id));
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      watchWrite(remove);
      return { id };
    }
    await finishWriteOrQueue(remove);
    return { id };
  }
  if(action==='sync.conflicts.resolve'){
    if(typeof navigator!=='undefined'&&!navigator.onLine) throw new Error('Reconnect to resolve this conflict safely.');
    const conflictRef=doc(userMutationsRef(user),String(args.id));
    let changedAgain=false;
    await runTransaction(db,async transaction=>{
      const conflict=await transaction.get(conflictRef);
      if(!conflict.exists()||conflict.data().kind!=='conflict') return;
      const item=conflict.data();
      const targetRef=doc(db,'users',user.uid,'data',item.collection,'records',item.recordId);
      const target=await transaction.get(targetRef);
      const latest=target.data();
      const latestVersion=Number(latest?.updatedAt||0);
      if(latestVersion!==Number(item.remoteUpdatedAt||0)||target.exists()!==(item.remoteValue!==null)){
        transaction.update(conflictRef,{remoteValue:target.exists()?latest?.value:null,remoteUpdatedAt:latestVersion,conflictAt:Date.now()});
        changedAgain=true;
        return;
      }
      if(args.choice==='keep_local'){
        if(item.action==='delete') transaction.delete(targetRef);
        else transaction.set(targetRef,{value:stripUndefined(item.value),updatedAt:Math.max(Date.now(),latestVersion+1)});
      }
      transaction.delete(conflictRef);
    });
    if(changedAgain) throw new Error('The cloud record changed again. Review the refreshed conflict and choose again.');
    return {id:args.id,resolved:true};
  }
  throw new Error(`Unsupported action: ${action}`);
}
