import React, { useEffect, useMemo, useRef, useState } from 'react';
import { firestoreRecords, auth, observeAuth, signInWithGoogle, logOut, subscribePendingWrites, waitForCloudSync, clearSyncError, type User as FirebaseUser } from './firebase';
import { LogOut, LoaderCircle, Share2, Copy } from 'lucide-react';
import { Smartphone, ArrowDownToLine, ArrowUpFromLine, Wallet, Plus, Search, Settings as SettingsIcon, BarChart3, Home, ArrowLeftRight, TrendingUp, AlertTriangle, X, Pencil, Trash2, ChevronRight, CalendarDays, Banknote, Zap, Phone, CheckCircle2, Download, RefreshCw, Users, UserPlus, Crown, User, Star, WifiOff, Undo2, FileDown, HandCoins, ChevronDown } from 'lucide-react';

type TxType = 'E-Load' | 'Cash In' | 'Cash Out' | 'Top-Up';
type Tx = { kind?:string; type:TxType; network:string; eloadKind?:'regular'|'promo'; promoName?:string; promoDetails?:string; promoValidity?:string; provider:string; amount:number; fee:number; selling:number; discount?:number; phone:string; customerName?:string; payment:string; notes:string; date:string; time:string; createdAt:number; sample?:boolean; utang?:boolean; utangStatus?:'unpaid'|'paid'; promiseDate?:string; paidAmount?:number; history?:{oldAmount:number;newAmount:number;time:string;date:string}[] };
type Wallets = { cash:number; maribank:number };
type WalletAdjustment = { wallet:keyof Wallets; mode:'add'|'deduct'; amount:number; category:string; note:string; date:string; time:string; createdAt:number };
type WalletAdjustmentRecord = { id:string; value:WalletAdjustment; updatedAt?:number };
type Meta = { kind:string; businessName:string; eloadPct:number; cashInPct:number; cashOutPct:number; palawanFee:number; wallets:Wallets; lastClosed:string; lowThreshold:number; startingFloat?:number; startingFloatDate?:string };
type TxRecord = { id:string; value:Tx; updatedAt?:number };
type Customer = { name:string; phone:string; notes:string; createdAt:number; totalTransactions:number; totalAmount:number; sample?:boolean };
type CustomerRecord = { id:string; value:Customer; updatedAt?:number };
type Favorite = { phone:string; name:string; type:TxType; amount:number; network:string; createdAt:number };
type FavoriteRecord = { id:string; value:Favorite; updatedAt?:number };
type DailyReport = { date:string; sales:number; profit:number; count:number; cash:number; maribank:number; topUp:number; wallets:Wallets; startingFloat:number; actualCash:number; difference:number; tomorrowFloat:number; createdAt:number };
type DailyReportRecord = { id:string; value:DailyReport };
type SyncConflictRecord = {id:string;value:{kind:'conflict';collection:string;recordId:string;action:'replace'|'delete';value?:any;remoteValue?:any;remoteUpdatedAt:number;conflictAt:number}};

const peso = (n:number)=> '₱' + (isNaN(n)?0:n).toLocaleString('en-PH',{minimumFractionDigits: n%1?2:0, maximumFractionDigits:2});
const todayKey = ()=>{ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const currentTimeLabel = ()=>new Date().toLocaleTimeString('en-PH',{hour:'numeric',minute:'2-digit'});
const tomorrowKey = ()=>{ const d=new Date(); d.setDate(d.getDate()+1); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const dateLabel = (key:string)=>{ const [y,m,d]=key.split('-').map(Number); return new Date(y,m-1,d).toLocaleDateString('en-PH',{weekday:'short', month:'short', day:'numeric'}); };
const fullDate = (key:string)=>{ const [y,m,d]=key.split('-').map(Number); return new Date(y,m-1,d).toLocaleDateString('en-PH',{weekday:'long', month:'long', day:'numeric', year:'numeric'}); };
const addDaysKey = (key:string, days:number)=>{ const [y,m,d]=key.split('-').map(Number); const dt=new Date(y,m-1,d); dt.setDate(dt.getDate()+days); return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`; };
const daysBetween = (fromKey:string, toKey:string)=>{ const [y1,m1,d1]=fromKey.split('-').map(Number); const [y2,m2,d2]=toKey.split('-').map(Number); return Math.round((new Date(y2,m2-1,d2).getTime()-new Date(y1,m1-1,d1).getTime())/86400000); };
const utangRemaining = (t:Tx)=> t.utangStatus==='paid' ? 0 : Math.max(0, round2(t.amount - (t.paidAmount||0)));
const utangPromiseStatus = (t:Tx):'paid'|'overdue'|'due-today'|'due-soon'|'no-date'=>{ if(t.utangStatus==='paid') return 'paid'; if(!t.promiseDate) return 'no-date'; const diff=daysBetween(todayKey(), t.promiseDate); if(diff<0) return 'overdue'; if(diff===0) return 'due-today'; return 'due-soon'; };
const utangPromiseLabel = (t:Tx):string=>{ const s=utangPromiseStatus(t); if(s==='paid') return 'Paid'; if(s==='no-date') return 'No date'; if(s==='due-today') return 'Due Today'; if(s==='overdue'){ const late=Math.abs(daysBetween(todayKey(), t.promiseDate||todayKey())); return `Overdue — ${late} day${late>1?'s':''} late`; } const days=daysBetween(todayKey(), t.promiseDate||todayKey()); return `Due in ${days} day${days>1?'s':''}`; };
const utangPromiseDateLabel = (t:Tx)=> t.promiseDate ? dateLabel(t.promiseDate) : 'No date yet';
const uid = ()=> Math.random().toString(36).slice(2,10)+Date.now().toString(36);
const round2 = (n:number)=> Math.round(n*100)/100;
const eLoadDiscount = (t:Tx)=> t.type==='E-Load' ? Math.min(Math.max(0,round2(t.discount||0)),t.amount) : 0;
const txPortion = (tx:Tx, amount:number):Tx=>{ const ratio=tx.amount>0?amount/tx.amount:0; return {...tx, amount:round2(amount), selling:tx.type==='E-Load'?round2(amount):tx.selling, fee:round2((tx.fee||0)*ratio), discount:round2(eLoadDiscount(tx)*ratio)}; };
const txProfit = (t:Tx)=> t.type==='Top-Up' ? -round2(t.fee||0) : round2((t.fee||0)+eLoadDiscount(t));
type PromoOffer={id:string; network:string; name:string; amount:number; details:string; validity:string};
const promoOffers:PromoOffer[]=[
  // Globe prepaid (current Go+ lineup; exact inclusions can vary by registration channel).
  {id:'globe-go99',network:'Globe',name:'Go+99',amount:99,details:'20GB total: 8GB all sites + 4GB 5G + 8GB choice apps; unli all-net texts',validity:'7 days'},
  {id:'globe-go109',network:'Globe',name:'Go+109',amount:109,details:'22GB total: 10GB all sites + 4GB 5G + 8GB choice apps; unli all-net texts',validity:'7 days'},
  {id:'globe-go129',network:'Globe',name:'Go+129',amount:129,details:'27GB total: 11GB all sites + 8GB 5G + 8GB choice apps; unli all-net texts',validity:'7 days'},
  {id:'globe-go149',network:'Globe',name:'Go+149',amount:149,details:'29GB total: 13GB all sites + 8GB 5G + 8GB choice apps; unli all-net texts',validity:'7 days'},
  {id:'globe-go179',network:'Globe',name:'Go+179',amount:179,details:'24GB total: 8GB all sites + 8GB 5G + 8GB choice apps; unli all-net texts',validity:'15 days'},
  {id:'globe-go250',network:'Globe',name:'Go+250',amount:250,details:'38GB total: 15GB all sites + 8GB 5G + 15GB choice apps',validity:'15 days'},
  {id:'globe-go400',network:'Globe',name:'Go+400',amount:400,details:'48GB total: 25GB all sites + 8GB 5G + 15GB choice apps',validity:'15 days'},
  {id:'globe-starlink99',network:'Globe',name:'Globe Starlink 99',amount:99,details:'2GB satellite data + 100 satellite texts to all networks; requires Starlink connection',validity:'30 days'},
  {id:'globe-starlink299',network:'Globe',name:'Globe Starlink 299',amount:299,details:'10GB satellite data + 500 satellite texts to all networks; requires Starlink connection',validity:'90 days'},
  // Smart prepaid.
  {id:'smart-pa59',network:'Smart',name:'Power All 59',amount:59,details:'5GB data + unli calls and texts',validity:'3 days'},
  {id:'smart-pa99',network:'Smart',name:'Power All 99',amount:99,details:'Power All variant (FB/TikTok/Khan Academy); check chosen version for data inclusions',validity:'7 days'},
  {id:'smart-pa109',network:'Smart',name:'Power All YouTube 109',amount:109,details:'YouTube-focused Power All offer; confirm data and call/text inclusions in retailer menu',validity:'Check retailer menu'},
  {id:'smart-pa149',network:'Smart',name:'Power All 149',amount:149,details:'Power All variant with unli 5G; confirm selected app and inclusions in retailer menu',validity:'7 days'},
  {id:'smart-pa449',network:'Smart',name:'Power All 449',amount:449,details:'Power All variant with unli 5G; confirm selected app and inclusions in retailer menu',validity:'28 days'},
  {id:'smart-md149',network:'Smart',name:'Magic Data 149',amount:149,details:'3GB data, no expiry',validity:'No expiry'},
  {id:'smart-md249',network:'Smart',name:'Magic Data 249',amount:249,details:'8GB data, no expiry',validity:'No expiry'},
  {id:'smart-md349',network:'Smart',name:'Magic Data 349',amount:349,details:'16GB data, no expiry',validity:'No expiry'},
  {id:'smart-md449',network:'Smart',name:'Magic Data 449',amount:449,details:'26GB data, no expiry',validity:'No expiry'},
  {id:'smart-md549',network:'Smart',name:'Magic Data 549',amount:549,details:'38GB data, no expiry',validity:'No expiry'},
  {id:'smart-md649',network:'Smart',name:'Magic Data 649',amount:649,details:'50GB data, no expiry',validity:'No expiry'},
  {id:'smart-md749',network:'Smart',name:'Magic Data 749',amount:749,details:'65GB data, no expiry',validity:'No expiry'},
  {id:'smart-md988',network:'Smart',name:'Magic Data 988',amount:988,details:'88GB data, no expiry',validity:'No expiry'},
  {id:'smart-ad50',network:'Smart',name:'All Data 50',amount:50,details:'2GB all-sites data',validity:'3 days'},
  {id:'smart-ad99',network:'Smart',name:'All Data 99',amount:99,details:'6GB all-sites data',validity:'7 days'},
  {id:'smart-ad299',network:'Smart',name:'All Data 299',amount:299,details:'24GB all-sites data',validity:'30 days'},
  // TNT (All Access+ and Saya All offers).
  {id:'tnt-aa99',network:'TNT',name:'All Access+ 99',amount:99,details:'5GB open-access data, unli all-net calls and texts',validity:'15 days'},
  {id:'tnt-saya50',network:'TNT',name:'Saya All 50',amount:50,details:'3GB open-access data + 3GB app data; unli all-net calls and texts',validity:'3 days'},
  {id:'tnt-saya99',network:'TNT',name:'Saya All 99',amount:99,details:'7GB open-access + 10GB app data + 3GB 5G; unli all-net calls and texts',validity:'7 days'},
  {id:'tnt-saya109',network:'TNT',name:'Saya All 109',amount:109,details:'7GB open-access data + unlimited FB/TikTok/ML app data; unli all-net calls and texts',validity:'7 days'},
  {id:'tnt-saya149',network:'TNT',name:'Saya All 149',amount:149,details:'12GB open-access + unlimited FB/TikTok/ML app data + 7GB 5G; unli all-net calls and texts',validity:'7 days'},
  {id:'tnt-saya449',network:'TNT',name:'Saya All 449',amount:449,details:'20GB open-access + unlimited FB/TikTok/ML app data + 15GB 5G; unli all-net calls and texts',validity:'28 days'},
  // DITO Level-Up, 5G double-data, and Socials.
  {id:'dito-lu99',network:'DITO',name:'Level-Up 99',amount:99,details:'7GB data, unli DITO calls, 300 mins other-network calls, unli texts',validity:'30 days'},
  {id:'dito-lu99-15',network:'DITO',name:'New Level-Up 99',amount:99,details:'9GB data, unli DITO calls, 150 mins other-network calls, unli texts',validity:'15 days'},
  {id:'dito-lu99-5g',network:'DITO',name:'New Level-Up 99 5G Double Data',amount:99,details:'18GB total: 9GB all-access + 9GB 5G; unli DITO calls/texts, 150 mins other-network calls',validity:'15 days'},
  {id:'dito-lu109',network:'DITO',name:'Level-Up 109',amount:109,details:'10GB data, unli DITO calls, 300 mins other-network calls, unli texts',validity:'30 days'},
  {id:'dito-lu109-social',network:'DITO',name:'Level-Up 109 with FB & TikTok',amount:109,details:'8GB all-access + 30GB FB/TikTok; unli DITO calls/texts, 300 mins other-network calls',validity:'30 days'},
  {id:'dito-lu129',network:'DITO',name:'Level-Up 129',amount:129,details:'12GB data, unli DITO calls, 300 mins other-network calls, unli texts',validity:'30 days'},
  {id:'dito-lu129-5g',network:'DITO',name:'Level-Up 129 5G Double Data',amount:129,details:'20GB total: 10GB all-access + 10GB 5G; unli DITO calls/texts, 300 mins other-network calls',validity:'30 days'},
  {id:'dito-lu169',network:'DITO',name:'Level-Up 169',amount:169,details:'16GB data, unli DITO calls, 300 mins other-network calls, unli texts; includes Prime Video mobile subscription',validity:'30 days'},
  {id:'dito-lu199',network:'DITO',name:'Level-Up 199',amount:199,details:'20GB data, unli DITO calls, 300 mins other-network calls, unli texts',validity:'30 days'},
  {id:'dito-lu299',network:'DITO',name:'Level-Up 299',amount:299,details:'32GB data, unli DITO calls, 300 mins other-network calls, unli texts',validity:'30 days'},
  {id:'dito-lu499',network:'DITO',name:'Level-Up 499',amount:499,details:'62GB data, unli DITO calls, 300 mins other-network calls, unli texts',validity:'30 days'},
  {id:'dito-lu999',network:'DITO',name:'Level-Up 999',amount:999,details:'130GB data, unli DITO calls, 300 mins other-network calls, unli texts',validity:'30 days'},
  {id:'dito-socials20',network:'DITO',name:'Level-Up Socials 20',amount:20,details:'2.5GB: 2GB app data + 0.5GB all-access',validity:'1 day'},
  {id:'dito-socials50',network:'DITO',name:'Level-Up Socials 50',amount:50,details:'7GB: 3.5GB app data + 3.5GB all-access',validity:'3 days'},
  {id:'dito-socials70',network:'DITO',name:'Level-Up Socials 70',amount:70,details:'Unlimited social app data + 5GB all-access',validity:'7 days'},
];
const defaultWallets:Wallets={cash:10000, maribank:5000};
const defaultMeta:Meta={kind:'meta', businessName:'E-Load & Cash In/Out App', eloadPct:3, cashInPct:2, cashOutPct:2, palawanFee:10, wallets:{...defaultWallets}, lastClosed:'', lowThreshold:1000};
const digitsOnly = (s:string)=> (s||'').replace(/\D/g,'');
const formatPhone = (raw:string)=>{ const d=digitsOnly(raw).slice(0,11); if(d.length<=4) return d; if(d.length<=7) return `${d.slice(0,4)} ${d.slice(4)}`; return `${d.slice(0,4)} ${d.slice(4,7)} ${d.slice(7)}`; };
const initials = (name:string)=>{ const parts=(name||'').trim().split(/\s+/).filter(Boolean); if(!parts.length) return '?'; if(parts.length===1) return parts[0].slice(0,2).toUpperCase(); return (parts[0][0]+parts[parts.length-1][0]).toUpperCase(); };
const isRealName = (name:string|undefined, phone:string|undefined)=>{ const n=(name||'').trim(); if(!n) return false; const nd=digitsOnly(n); const pd=digitsOnly(phone||''); if(pd && nd===pd) return false; if(nd && nd.length>=7 && n.replace(/[\s\-•]/g,'').length===nd.length) return false; return true; };
const displayNameOnly = (name:string|undefined, phone:string|undefined)=> isRealName(name,phone) ? (name||'').trim() : formatPhone(phone||'');
const displayNamePhone = (name:string|undefined, phone:string|undefined)=> isRealName(name,phone) ? `${(name||'').trim()} • ${formatPhone(phone||'')}` : formatPhone(phone||'');
const displayInitials = (name:string|undefined, phone:string|undefined)=> isRealName(name,phone) ? initials(name||'') : (digitsOnly(phone||'').slice(0,2)||'?');
const xmlText = (text:string)=>text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
type ReminderTheme='classic'|'holiday'|'love'|'sunshine'|'ocean';
const reminderThemeNames:Record<ReminderTheme,string>={classic:'Classic green',holiday:'Holiday',love:'Valentine',sunshine:'Birthday sunshine',ocean:'Ocean blue'};
function clayReminderArt(theme:ReminderTheme){
  const shadow='<ellipse cx="125" cy="198" rx="112" ry="24" fill="#153c2c" opacity=".16"/><ellipse cx="116" cy="194" rx="84" ry="13" fill="#fff" opacity=".15"/>';
  const art:Record<ReminderTheme,string>={
    classic:`<defs><linearGradient id="clayWallet" x2="0" y2="1"><stop stop-color="#36c985"/><stop offset="1" stop-color="#087344"/></linearGradient><linearGradient id="clayCoin" x2="0" y2="1"><stop stop-color="#ffe99a"/><stop offset="1" stop-color="#e5a62b"/></linearGradient></defs>${shadow}<ellipse cx="118" cy="150" rx="102" ry="62" fill="#083d2e" opacity=".55"/><rect x="34" y="59" width="174" height="112" rx="32" fill="url(#clayWallet)"/><path d="M47 78q10-15 32-15h108q18 0 18 18v12H47z" fill="#8aefba" opacity=".6"/><rect x="139" y="100" width="89" height="58" rx="22" fill="#0a5c3b"/><circle cx="187" cy="129" r="8" fill="#ffd773"/><circle cx="86" cy="111" r="24" fill="url(#clayCoin)"/><text x="86" y="120" text-anchor="middle" fill="#8c5b10" font-family="Arial,sans-serif" font-size="25" font-weight="900">₱</text><ellipse cx="70" cy="83" rx="31" ry="8" fill="#fff" opacity=".24"/>`,
    holiday:`<defs><linearGradient id="clayTree" x2="0" y2="1"><stop stop-color="#56d29a"/><stop offset="1" stop-color="#087249"/></linearGradient><linearGradient id="clayBauble" x2="0" y2="1"><stop stop-color="#ffda80"/><stop offset="1" stop-color="#e88b32"/></linearGradient></defs>${shadow}<path d="m126 30 14 25 28 4-20 19 5 28-27-13-26 14 5-29-21-18 29-5z" fill="#ffce68"/><path d="M126 60 55 176h142L126 60Z" fill="url(#clayTree)"/><path d="M126 83 73 160h106z" fill="#91edbd" opacity=".42"/><rect x="114" y="164" width="25" height="39" rx="9" fill="#8f4a32"/><circle cx="93" cy="132" r="13" fill="url(#clayBauble)"/><circle cx="151" cy="148" r="15" fill="#f17c83"/><circle cx="128" cy="103" r="11" fill="#ffdf83"/><ellipse cx="98" cy="126" rx="6" ry="3" fill="#fff" opacity=".55"/>`,
    love:`<defs><linearGradient id="clayHeart" x2="0" y2="1"><stop stop-color="#ffb2ca"/><stop offset="1" stop-color="#d83e78"/></linearGradient></defs>${shadow}<path d="M126 187C105 168 35 118 40 78c4-33 49-48 78-10 25-40 76-27 82 7 8 43-51 88-74 112Z" fill="url(#clayHeart)"/><path d="M59 80c5-20 26-28 43-18" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" opacity=".55"/><path d="M196 49c10 14 23 19 37 20-15 8-20 18-21 33-8-14-18-20-32-21 13-7 18-17 16-32Z" fill="#ffd886"/><circle cx="62" cy="154" r="11" fill="#ffda80"/><circle cx="194" cy="158" r="8" fill="#ffe7ef"/>`,
    sunshine:`<defs><linearGradient id="clayCake" x2="0" y2="1"><stop stop-color="#fff0aa"/><stop offset="1" stop-color="#ffad45"/></linearGradient></defs>${shadow}<ellipse cx="126" cy="164" rx="100" ry="37" fill="#fff7d9"/><rect x="50" y="105" width="152" height="74" rx="25" fill="url(#clayCake)"/><path d="M50 125q18 20 38 0t38 0 38 0 38 0v25q-18 18-38 0t-38 0-38 0-38 0z" fill="#ff87a4"/><ellipse cx="126" cy="108" rx="76" ry="27" fill="#fff5d9"/><path d="M126 52v38" stroke="#e77832" stroke-width="11" stroke-linecap="round"/><path d="M126 32c-20 18-8 29 0 33 13-12 13-22 0-33Z" fill="#ffb833"/><path d="M120 43q-4 8 2 13" fill="none" stroke="#fff2a9" stroke-width="5" stroke-linecap="round"/><circle cx="86" cy="111" r="9" fill="#ff7e9b"/><circle cx="165" cy="101" r="9" fill="#75c9e7"/>`,
    ocean:`<defs><linearGradient id="clayFish" x2="0" y2="1"><stop stop-color="#82d9ef"/><stop offset="1" stop-color="#2188b4"/></linearGradient></defs>${shadow}<path d="M32 144q40-45 78 0t78 0q24-26 45-18-18 20 0 39-22 8-45-16-40 45-78 0t-78 0Z" fill="#9be5f0" opacity=".55"/><ellipse cx="121" cy="118" rx="75" ry="49" fill="url(#clayFish)"/><path d="m184 118 44-34v68z" fill="#48b7d4"/><path d="M103 83q25 18 0 35 28 18 0 36" fill="none" stroke="#d9f7fb" stroke-width="8" opacity=".75"/><circle cx="153" cy="109" r="7" fill="#12374d"/><circle cx="155" cy="106" r="2.5" fill="#fff"/><path d="M60 102q13-9 25 0" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" opacity=".5"/><circle cx="61" cy="63" r="12" fill="#fff" opacity=".82"/><circle cx="85" cy="42" r="7" fill="#fff" opacity=".65"/>`
  };
  return `<g transform="translate(785 208) scale(.86)">${art[theme]}</g>`;
}
function utangReminderSvg(tx:Tx, businessName:string, theme:ReminderTheme='classic', combinedUtangs:TxRecord[]|null=null){
  const palettes:Record<ReminderTheme,string[]>={classic:['#effaf3','#d9f3e3','#075b39','#102b20','#80d8a5','#8bd9a9','#a7ecc0','#bcefd0','#d7f4e2','#e4f6eb','#0e9f5f','#087a48','#244536'],holiday:['#fff5f2','#f8dfda','#a51d2d','#5f1423','#ed9a8d','#f4b2a4','#ffd1c9','#ffe0d8','#ffe9e3','#fff0eb','#bd2438','#a51d2d','#622630'],love:['#fff4f8','#f8dce8','#a21c57','#5c163d','#f49ac0','#f7b4d0','#ffd1e2','#ffddeb','#ffe8f0','#ffedf4','#c12768','#a21c57','#62233f'],sunshine:['#fff9e9','#ffedbd','#ba6014','#67350c','#ffca63','#ffdd87','#ffe8a5','#fff0c6','#fff2d6','#fff5df','#e58a18','#a95b10','#63411d'],ocean:['#eff8ff','#d9edfa','#075b83','#12374d','#80c9e8','#9ddbf0','#b4e8f6','#c9effa','#def5fc','#e8f7fd','#087eaa','#086b91','#244553']};
  const themeColors=palettes[theme], colors=['#effaf3','#d9f3e3','#075b39','#102b20','#80d8a5','#8bd9a9','#a7ecc0','#bcefd0','#d7f4e2','#e4f6eb','#0e9f5f','#087a48','#244536'];
  const name=isRealName(tx.customerName,tx.phone)?(tx.customerName||'').trim():'there';
  const entries=combinedUtangs || [];
  const total=entries.length?entries.reduce((sum,r)=>sum+utangRemaining(r.value)+(r.value.fee||0),0):utangRemaining(tx)+(tx.fee||0);
  const cardHeight=entries.length?Math.max(536, 355+entries.length*40):536;
  const canvasHeight=entries.length?Math.max(1350, 520+cardHeight+145):1350;
  const rows=entries.length?entries.map((r,i)=>{const v=r.value;const label=`${dateLabel(v.date)} • ${v.type==='E-Load'?(v.eloadKind==='promo'?`E-Load • ${v.promoName||'Promo'}`:`${v.network} E-Load`):v.type}`; return `<text x="120" y="${835+i*40}" fill="#17251c" font-family="Arial,sans-serif" font-size="23" font-weight="700">${xmlText(label)}</text><text x="930" y="${835+i*40}" text-anchor="end" fill="#17251c" font-family="Arial,sans-serif" font-size="24" font-weight="700">${xmlText(peso(utangRemaining(v)+(v.fee||0)))}</text>`;}).join('')+`<text x="120" y="${855+entries.length*40}" fill="#17251c" font-family="Arial,sans-serif" font-size="26" font-weight="800">Total due • all unpaid utang</text><text x="930" y="${855+entries.length*40}" text-anchor="end" fill="#17251c" font-family="Arial,sans-serif" font-size="28" font-weight="800">${xmlText(peso(total))}</text>`:`<text x="120" y="842" fill="#66776d" font-family="Arial,sans-serif" font-size="25">Amount</text><text x="930" y="842" text-anchor="end" fill="#17251c" font-family="Arial,sans-serif" font-size="27" font-weight="700">${xmlText(peso(tx.amount))}</text><text x="120" y="886" fill="#66776d" font-family="Arial,sans-serif" font-size="25">Fee</text><text x="930" y="886" text-anchor="end" fill="#17251c" font-family="Arial,sans-serif" font-size="27" font-weight="700">${xmlText(peso(tx.fee||0))}</text><text x="120" y="940" fill="#17251c" font-family="Arial,sans-serif" font-size="26" font-weight="800">Total</text><text x="930" y="940" text-anchor="end" fill="#17251c" font-family="Arial,sans-serif" font-size="28" font-weight="800">${xmlText(peso(tx.amount+(tx.fee||0)))}</text><text x="120" y="980" fill="#66776d" font-family="Arial,sans-serif" font-size="24">Paid so far</text><text x="930" y="980" text-anchor="end" fill="#087a48" font-family="Arial,sans-serif" font-size="26" font-weight="700">${xmlText(peso(tx.paidAmount||0))}</text><text x="120" y="1020" fill="#66776d" font-family="Arial,sans-serif" font-size="23">Utang date • ${xmlText(dateLabel(tx.date))} • ${xmlText(tx.type==='E-Load'?(tx.eloadKind==='promo'?(tx.promoName||'Promo E-Load'):tx.network+' E-Load'):tx.type)}</text>`;
  const footerY=520+cardHeight+45;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="${canvasHeight}" viewBox="0 0 1080 ${canvasHeight}"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#effaf3"/><stop offset="1" stop-color="#d9f3e3"/></linearGradient><linearGradient id="hero" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#075b39"/><stop offset="1" stop-color="#102b20"/></linearGradient><filter id="shadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="18" stdDeviation="20" flood-color="#15472e" flood-opacity=".14"/></filter></defs><rect width="1080" height="${canvasHeight}" rx="54" fill="url(#bg)"/><circle cx="1000" cy="290" r="190" fill="#80d8a5" opacity=".2"/><circle cx="107" cy="1215" r="175" fill="#8bd9a9" opacity=".2"/><path d="M0 0h1080v370c-170 73-332 93-540 93S170 443 0 370V0Z" fill="url(#hero)"/><text x="84" y="104" fill="#bcefd0" font-family="Arial,sans-serif" font-size="25" font-weight="700" letter-spacing="4">A KIND NOTE FROM</text><text x="84" y="154" fill="#fff" font-family="Arial,sans-serif" font-size="32" font-weight="800">${xmlText(businessName.trim()||'Your local store')}</text><text x="84" y="252" fill="#fff" font-family="Arial,sans-serif" font-size="55" font-weight="800">A friendly reminder</text><text x="84" y="316" fill="#d7f4e2" font-family="Arial,sans-serif" font-size="29">Hi ${xmlText(name)}, here is your</text><text x="84" y="359" fill="#d7f4e2" font-family="Arial,sans-serif" font-size="29">${entries.length?'combined unpaid balance.':'remaining balance reminder.'}</text>${clayReminderArt(theme)}<g filter="url(#shadow)"><rect x="64" y="520" width="952" height="${cardHeight}" rx="42" fill="#fff"/><text x="120" y="605" fill="#66776d" font-family="Arial,sans-serif" font-size="25" font-weight="700" letter-spacing="2">BALANCE TO SETTLE</text><text x="120" y="750" fill="#17251c" font-family="Arial,sans-serif" font-size="108" font-weight="800">${xmlText(peso(total))}</text><rect x="120" y="800" width="840" height="2" fill="#e5eee8"/>${rows}</g><g transform="translate(91 ${footerY})"><circle cx="30" cy="28" r="25" fill="#0e9f5f"/><path d="m18 28 8 8 16-18" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><text x="76" y="23" fill="#244536" font-family="Arial,sans-serif" font-size="28" font-weight="700">Please settle when convenient, or message me</text><text x="76" y="63" fill="#244536" font-family="Arial,sans-serif" font-size="28" font-weight="700">if you need to discuss. Thank you!</text></g><text x="540" y="${canvasHeight-30}" text-anchor="middle" fill="#66776d" font-family="Arial,sans-serif" font-size="20">A friendly payment reminder • Please reach out if anything looks incorrect</text></svg>`;
  return colors.reduce((out,color,index)=>out.split(color).join(themeColors[index]),svg);
}
const utangReminderMessage = (tx:Tx,businessName:string,combined:TxRecord[]|null=null)=>{ const name=isRealName(tx.customerName,tx.phone)?(tx.customerName||'').trim():'there'; const due=tx.promiseDate?` The promised date is ${fullDate(tx.promiseDate)}.`:''; const total=combined?combined.reduce((a,r)=>a+utangRemaining(r.value)+(r.value.fee||0),0):utangRemaining(tx)+(tx.fee||0); return `Hi ${name}, this is a friendly reminder from ${businessName||'your local store'} about ${combined?`the total of ${combined.length} unpaid transactions`: 'your remaining balance'}: ${peso(total)}.${due} Please settle it when convenient, or message me if you need to discuss. Thank you!`; };
const parseCustomerQuery = (q:string)=>{ const digits=digitsOnly(q); let phone=''; let name=''; if(digits.length>=11){ phone=digits.slice(-11); name=q.replace(/[0-9]/g,'').replace(/[•\-–—]/g,' ').replace(/\s+/g,' ').trim(); } else if(digits.length>0){ phone=digits; name=q.replace(/[0-9]/g,'').replace(/[•\-–—]/g,' ').replace(/\s+/g,' ').trim(); } else { name=q.trim(); } return {name, phone}; };
const daysAgoLabel = (dateKey:string)=>{ if(!dateKey) return ''; const [y,m,d]=dateKey.split('-').map(Number); const dt=new Date(y,m-1,d); const now=new Date(); now.setHours(0,0,0,0); const diff=Math.round((now.getTime()-dt.getTime())/86400000); if(diff===0) return 'today'; if(diff===1) return 'yesterday'; if(diff<7) return `${diff} days ago`; if(diff<30) return `${Math.floor(diff/7)} wk ago`; return dt.toLocaleDateString('en-PH',{month:'short', day:'numeric'}); };
const csvCell = (v:any)=> `"${String(v ?? '').replace(/"/g,'""')}"`;
function downloadCSV(filename:string, rows:string[][]){ const csv = rows.map(r=>r.map(csvCell).join(',')).join('\n'); const blob = new Blob([csv], {type:'text/csv'}); const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url), 800); }

const STORAGE_PREFIX = 'eics.records.';
function readStoredRecords(collection:string):any[]{
  try { const value=localStorage.getItem(`${STORAGE_PREFIX}${collection}`); return value ? JSON.parse(value) : []; }
  catch { return []; }
}
function writeStoredRecords(collection:string, records:any[]){
  try { localStorage.setItem(`${STORAGE_PREFIX}${collection}`, JSON.stringify(records)); }
  catch { throw new Error('Could not save records in this browser. Check available storage and try again.'); }
}
let activeUser: FirebaseUser | null = null;
let localPreviewMode = false;
function previewRecords(action:string,args:any){
  const collectionName=args?.collection;
  if(!collectionName) throw new Error('A record collection is required.');
  const key=`eics.preview.${collectionName}`;
  let rows:any[]=[];
  try{ rows=JSON.parse(localStorage.getItem(key)||'[]'); if(!Array.isArray(rows)) rows=[]; }catch{}
  if(action==='records.list') return {records:rows.slice(0,args.limit||rows.length)};
  if(action==='records.create'){
    if(args.id && rows.some(row=>row.id===args.id)) return {...rows.find(row=>row.id===args.id),skipped:true};
    const row={id:args.id||uid(),value:args.value}; rows.unshift(row); localStorage.setItem(key,JSON.stringify(rows)); return {...row,skipped:false};
  }
  if(action==='records.replace'){
    const idx=rows.findIndex(row=>row.id===args.id); if(idx<0) throw new Error('Record not found.');
    rows[idx]={id:args.id,value:args.value}; localStorage.setItem(key,JSON.stringify(rows)); return rows[idx];
  }
  if(action==='records.delete'){ rows=rows.filter(row=>row.id!==args.id); localStorage.setItem(key,JSON.stringify(rows)); return {id:args.id}; }
  throw new Error(`Unsupported action: ${action}`);
}
async function api(action:string, args:any){
  if(localPreviewMode) return previewRecords(action,args);
  if (!activeUser) throw new Error('Sign in with Google to access your synced records.');
  return firestoreRecords(action, args, activeUser);
}

function applyTransaction(w:Wallets, tx:Tx, sign=1):Wallets{
  let cash = w.cash; let maribank = w.maribank;
  if(tx.type==='E-Load'){ maribank -= sign * (tx.amount-eLoadDiscount(tx)); cash += sign * ((tx.selling || tx.amount) + (tx.fee || 0)); }
  else if(tx.type==='Cash In'){ maribank -= sign * tx.amount; cash += sign * (tx.amount + (tx.fee || 0)); }
  else if(tx.type==='Cash Out'){ maribank += sign * (tx.amount + (tx.fee || 0)); cash += sign * (-tx.amount); }
  else if(tx.type==='Top-Up'){ cash -= sign * (tx.amount + (tx.fee || 0)); maribank += sign * tx.amount; }
  return { cash: round2(cash), maribank: round2(maribank) };
}
function reverseTransaction(w:Wallets, tx:Tx):Wallets{ return applyTransaction(w, tx, -1); }
function transactionWalletEffect(tx:Tx):Tx|null{
  if(tx.utang && tx.utangStatus==='unpaid'){
    const paid=Math.min(tx.amount, Math.max(0,tx.paidAmount||0));
    return paid>0 ? txPortion(tx,paid) : null;
  }
  return tx;
}
function updateWalletsForEdit(wallets:Wallets, oldTx:Tx, newTx:Tx):Wallets{
  let next={...wallets};
  const oldEffect=transactionWalletEffect(oldTx); if(oldEffect) next=reverseTransaction(next,oldEffect);
  const newEffect=transactionWalletEffect(newTx); if(newEffect) next=applyTransaction(next,newEffect,1);
  return next;
}
const walletDefs:{key:keyof Wallets; label:string; color:string; hint:string}[]=[
  {key:'maribank', label:'Main Wallet', color:'#0e2a47', hint:'Main wallet — load, Cash In & Cash Out'},
  {key:'cash', label:'Cash on Hand', color:'#0e9f5f', hint:'Bills & coins in the till'},
];
function normalizeTx(v:any):Tx|null{
  if(!v || !v.type) return null;
  let type = v.type as string;
  if(type==='Transfer' || type==='Adjustment') type='Top-Up';
  if(!['E-Load','Cash In','Cash Out','Top-Up'].includes(type)) return null;
  const provider = type==='Top-Up' ? 'External Provider' : 'Main Wallet';
  const network = type==='Top-Up' ? 'External Provider' : type==='E-Load' ? (v.network||'Globe') : 'Main Wallet';
  return {...v, type:type as TxType, provider, network};
}
function normalizeCustomer(v:any):Customer|null{
  if(!v || (!v.name && !v.phone)) return null;
  const phone=digitsOnly(String(v.phone||''));
  const rawName=String(v.name||'').trim();
  const name=isRealName(rawName, phone) ? rawName : '';
  return { name, phone, notes:String(v.notes||''), createdAt: typeof v.createdAt==='number'?v.createdAt:Date.now(), totalTransactions: typeof v.totalTransactions==='number'?v.totalTransactions:0, totalAmount: typeof v.totalAmount==='number'?v.totalAmount:0, sample: !!v.sample };
}
const seedCustomers:Customer[]=[
  {name:'Juan Dela Cruz', phone:'09171234567', notes:'suki, kapitbahay', createdAt:Date.now()-86400000*3, totalTransactions:0, totalAmount:0, sample:true},
  {name:'Maria Santos', phone:'09081234567', notes:'suki, tindahan', createdAt:Date.now()-86400000*2, totalTransactions:0, totalAmount:0, sample:true},
  {name:'Pedro Reyes', phone:'09191234567', notes:'kapitbahay', createdAt:Date.now()-86400000, totalTransactions:0, totalAmount:0, sample:true},
];
function Kbd({children}:{children:React.ReactNode}){ return <kbd className="kbd">{children}</kbd>; }
function getFocusableElements(root:HTMLElement):HTMLElement[]{
  return Array.from(root.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter(el=>!el.hasAttribute('disabled') && el.getClientRects().length>0 && getComputedStyle(el).visibility!=='hidden');
}
function handleModalArrowKeys(e:React.KeyboardEvent, container:HTMLElement):boolean{
  if(!e.key.startsWith('Arrow')) return false;
  const target=e.target as HTMLElement;
  const isText=target.tagName==='INPUT'||target.tagName==='TEXTAREA'||target.tagName==='SELECT';
  if(isText) return false;
  const group=target.closest('[data-arrow-group]') as HTMLElement|null;
  const all=getFocusableElements(container);
  if(e.key==='ArrowLeft'||e.key==='ArrowRight'){
    if(!group) return false;
    const cands=getFocusableElements(group);
    const idx=cands.indexOf(target);
    if(idx===-1) return false;
    e.preventDefault(); e.stopPropagation();
    const next=e.key==='ArrowRight'?(idx+1)%cands.length:(idx-1+cands.length)%cands.length;
    cands[next].focus();
    return true;
  }
  if(e.key==='ArrowUp'||e.key==='ArrowDown'){
    if(group){
      const cands=getFocusableElements(group);
      const indices=cands.map(c=>all.indexOf(c)).filter(i=>i>=0);
      if(!indices.length) return false;
      const min=Math.min(...indices), max=Math.max(...indices);
      e.preventDefault(); e.stopPropagation();
      if(e.key==='ArrowDown'){ if(max+1<all.length) all[max+1].focus(); else all[0].focus(); }
      else { if(min-1>=0) all[min-1].focus(); else all[all.length-1].focus(); }
      return true;
    }
    const idx=all.indexOf(target);
    if(idx===-1) return false;
    e.preventDefault(); e.stopPropagation();
    const next=e.key==='ArrowDown'?Math.min(all.length-1, idx+1):Math.max(0, idx-1);
    all[next].focus();
    return true;
  }
  return false;
}

function Dashboard(){
  const [tab,setTab]=useState<'home'|'transactions'|'customers'|'wallets'|'report'|'settings'|'utang'>('home');
  const [records,setRecords]=useState<TxRecord[]>([]);
  const [customers,setCustomers]=useState<CustomerRecord[]>([]);
  const [meta,setMeta]=useState<Meta>(defaultMeta);
  const [metaId,setMetaId]=useState<string|null>(null);
  const [metaUpdatedAt,setMetaUpdatedAt]=useState(0);
  const [loading,setLoading]=useState(true);
  const [loadingProgress,setLoadingProgress]=useState(8);
  const [apiError,setApiError]=useState('');
  const [saving,setSaving]=useState(false);
  const [statementImportBusy,setStatementImportBusy]=useState(false);
  const [backupBusy,setBackupBusy]=useState(false);
  const statementImportRef=useRef<HTMLInputElement|null>(null);
  const backupImportRef=useRef<HTMLInputElement|null>(null);
  const [saveMsg,setSaveMsgState]=useState('');
  const [toastKind,setToastKind]=useState<'success'|'error'>('success');
  const [toastActionLabel,setToastActionLabel]=useState('');
  const toastActionRef=useRef<(()=>void)|null>(null);
  const setSaveMsg=(msg:string)=>{ if(msg) setToastKind('success'); setSaveMsgState(msg); setToastActionLabel(''); toastActionRef.current=null; };
  const showToast=(msg:string, kind:'success'|'error'='success', actionLabel='', actionFn?:()=>void)=>{ setToastKind(kind); setSaveMsgState(msg); setToastActionLabel(actionLabel); toastActionRef.current=actionFn||null; };
  const showErrorToast=(msg:string)=>showToast(msg,'error');
  useEffect(()=>{ if(!saveMsg) return; const t=setTimeout(()=>{setSaveMsgState(''); setToastActionLabel(''); toastActionRef.current=null;}, toastActionLabel?10000:3000); return ()=>clearTimeout(t); },[saveMsg, toastActionLabel]);
  useEffect(()=>{
    if(!loading) return;
    const timer=window.setInterval(()=>setLoadingProgress(p=>p>=91?91:Math.min(91,p+Math.max(1,Math.ceil((91-p)*0.12)))),100);
    return ()=>window.clearInterval(timer);
  },[loading]);
  const [showTx,setShowTx]=useState(false);
  const [showServices,setShowServices]=useState(false);
  const [servicesHighlight,setServicesHighlight]=useState(0);
  const [editing,setEditing]=useState<TxRecord|null>(null);
  const [detail,setDetail]=useState<TxRecord|null>(null);
  const [utangReminder,setUtangReminder]=useState<TxRecord|null>(null);
  const [utangReminderBusy,setUtangReminderBusy]=useState(false);
  const [utangReminderTheme,setUtangReminderTheme]=useState<ReminderTheme>('classic');
  const [utangReminderAll,setUtangReminderAll]=useState(false);
  const [showWalletAction,setShowWalletAction]=useState<keyof Wallets|null>(null);
  const [showEOD,setShowEOD]=useState(false);
  const [selectedDay,setSelectedDay]=useState(todayKey());
  const [search,setSearch]=useState('');
  const [filter,setFilter]=useState<'All'|'E-Load'|'Cash In'|'Cash Out'|'Top-Up'>('All');
  const [reportRange,setReportRange]=useState<'Today'|'Yesterday'|'This Week'|'This Month'>('Today');
  const [confirmClear,setConfirmClear]=useState(false);
  const [confirmDelete,setConfirmDelete]=useState<TxRecord|null>(null);
  const [showHelp,setShowHelp]=useState(false);
  const [shortcutsOn,setShortcutsOn]=useState(true);
  const [selectedTxId,setSelectedTxId]=useState<string|null>(null);
  const [selectedCustomerId,setSelectedCustomerId]=useState<string|null>(null);
  const txSearchRef=useRef<HTMLInputElement|null>(null);
  const customerSearchRef=useRef<HTMLInputElement|null>(null);
  const filterRef=useRef<HTMLDivElement|null>(null);
  const customerFilterRef=useRef<HTMLDivElement|null>(null);
  const selectedRowRef=useRef<HTMLDivElement|null>(null);

  // Phase 1 / 2 / 3 / 4 state
  const [dailyReports,setDailyReports]=useState<DailyReportRecord[]>([]);
  const [favorites,setFavorites]=useState<FavoriteRecord[]>([]);
  const [isOnline,setIsOnline]=useState(typeof navigator!=='undefined' ? navigator.onLine : true);
  const [pendingWrites,setPendingWrites]=useState(0);
  const [isSyncing,setIsSyncing]=useState(false);
  const [lastSyncedAt,setLastSyncedAt]=useState<number|null>(()=>{try{return Number(localStorage.getItem('eics.last-cloud-sync'))||null;}catch{return null;}});
  const [syncError,setSyncError]=useState('');
  const [syncConflicts,setSyncConflicts]=useState<SyncConflictRecord[]>([]);
  const [actualCash,setActualCash]=useState(0);
  const [tomorrowFloat,setTomorrowFloat]=useState(0);
  const [tomorrowTouched,setTomorrowTouched]=useState(false);
  const [duplicateInfo,setDuplicateInfo]=useState<{mins:number; amount:number; type:string; name:string}|null>(null);
  const [isUtang,setIsUtang]=useState(false);
  const [fPromiseDate,setFPromiseDate]=useState('');
  const [showPartial,setShowPartial]=useState(false);
  const [partialAmount,setPartialAmount]=useState(0);
  const [utangFilter,setUtangFilter]=useState<'All'|'Unpaid'|'Paid'|'Due Today'|'Overdue'|'Due This Week'>('All');
  const [reportPeriod,setReportPeriod]=useState<'Day'|'Week'|'Month'>('Day');
  const [favOpen,setFavOpen]=useState(true);
  const [recentOpen,setRecentOpen]=useState(true);
  const [utangOpen,setUtangOpen]=useState(true);
  const [dashboardSearch,setDashboardSearch]=useState('');
  const [recentIndex,setRecentIndex]=useState(0);
  const [undoInfo,setUndoInfo]=useState<{tx:Tx; walletsBefore:Wallets}|null>(null);
  const undoTimerRef=useRef<any>(null);

  const [customerSearch,setCustomerSearch]=useState('');
  const [customerSort,setCustomerSort]=useState<'Recent'|'A-Z'|'Most Frequent'>('Recent');
  const [customerDetail,setCustomerDetail]=useState<CustomerRecord|null>(null);
  const [showCustomerForm,setShowCustomerForm]=useState(false);
  const [editingCustomer,setEditingCustomer]=useState<CustomerRecord|null>(null);
  const [confirmDeleteCustomer,setConfirmDeleteCustomer]=useState<CustomerRecord|null>(null);
  const [cName,setCName]=useState('');
  const [cPhone,setCPhone]=useState('');
  const [cNotes,setCNotes]=useState('');
  const [customerMsg,setCustomerMsg]=useState('');
  const [customerNameFilter,setCustomerNameFilter]=useState<'All'|'No Name Yet'|'With Name'>('All');
  const [showNameField,setShowNameField]=useState(false);
  const [namePromptSkipped,setNamePromptSkipped]=useState(false);
  const [nameSaving,setNameSaving]=useState(false);
  const [nameMsg,setNameMsg]=useState('');
  const [addNameTarget,setAddNameTarget]=useState<{phone:string; id?:string}|null>(null);
  const [addNameValue,setAddNameValue]=useState('');
  const [addNameMsg,setAddNameMsg]=useState('');
  const [addNameSaving,setAddNameSaving]=useState(false);

  const [fType,setFType]=useState<TxType>('E-Load');
  const [fNetwork,setFNetwork]=useState('Globe');
  const [fEloadKind,setFEloadKind]=useState<'regular'|'promo'>('regular');
  const [fPromoName,setFPromoName]=useState('');
  const [fPromoDetails,setFPromoDetails]=useState('');
  const [fPromoValidity,setFPromoValidity]=useState('');
  const [fProvider,setFProvider]=useState('Main Wallet');
  const [fAmount,setFAmount]=useState(100);
  const [fCustom,setFCustom]=useState('');
  const [fFee,setFFee]=useState(3);
  const [fDiscount,setFDiscount]=useState(0);
  const [fPhone,setFPhone]=useState('');
  const [fCustomerName,setFCustomerName]=useState('');
  const [fCustomerQuery,setFCustomerQuery]=useState('');
  const [fPayment,setFPayment]=useState('Cash');
  const [fNotes,setFNotes]=useState('');
  const [fDate,setFDate]=useState(todayKey());
  const [fTime,setFTime]=useState(currentTimeLabel());
  const [walletAmt,setWalletAmt]=useState(500);
  const [walletActionCategory,setWalletActionCategory]=useState('Shopee / Online shopping');
  const [walletActionNote,setWalletActionNote]=useState('');
  const [walletAdjustments,setWalletAdjustments]=useState<WalletAdjustmentRecord[]>([]);
  const [walletMode,setWalletMode]=useState<'add'|'deduct'>('add');

  const metaRef=useRef(meta); metaRef.current=meta;
  const metaIdRef=useRef(metaId); metaIdRef.current=metaId;
  const metaUpdatedAtRef=useRef(metaUpdatedAt); metaUpdatedAtRef.current=metaUpdatedAt;

  async function reloadRecords(){
    const data:any = await api("records.list", {collection:'transactions', limit:100});
    const list:TxRecord[] = (data.records||[]).map((r:any)=>{ const norm = normalizeTx(r.value); return norm ? {id:r.id, value:norm, updatedAt:r.updatedAt} : null; }).filter(Boolean) as TxRecord[];
    list.sort((a,b)=> (b.value.date||'').localeCompare(a.value.date||'') || b.value.createdAt-a.value.createdAt);
    setRecords(list);
    const m:any = await api("records.list", {collection:'meta', limit:10});
    if(m.records?.length){
      const raw = m.records[0].value || {};
      const oldW = raw.wallets || {};
      const wallets:Wallets = { cash: typeof oldW.cash === 'number' ? round2(oldW.cash) : defaultMeta.wallets.cash, maribank: typeof oldW.maribank === 'number' ? round2(oldW.maribank) : defaultMeta.wallets.maribank };
      const palawanRaw = raw.palawanFee ?? raw.palawanTopUpFee;
      setMeta({ kind:'meta', businessName: raw.businessName === 'May E-Load & Cash In/Out' ? defaultMeta.businessName : typeof raw.businessName === 'string' && raw.businessName ? raw.businessName : defaultMeta.businessName, eloadPct: typeof raw.eloadPct === 'number' ? raw.eloadPct : defaultMeta.eloadPct, cashInPct: typeof raw.cashInPct === 'number' ? raw.cashInPct : defaultMeta.cashInPct, cashOutPct: typeof raw.cashOutPct === 'number' ? raw.cashOutPct : defaultMeta.cashOutPct, palawanFee: typeof palawanRaw === 'number' ? palawanRaw : defaultMeta.palawanFee, wallets, lastClosed: typeof raw.lastClosed === 'string' ? raw.lastClosed : '', lowThreshold: typeof raw.lowThreshold === 'number' ? raw.lowThreshold : defaultMeta.lowThreshold, startingFloat: typeof raw.startingFloat === 'number' ? raw.startingFloat : undefined, startingFloatDate: typeof raw.startingFloatDate === 'string' ? raw.startingFloatDate : undefined });
      setMetaId(m.records[0].id);
      setMetaUpdatedAt(Number(m.records[0].updatedAt||0));
    }
    const c:any = await api("records.list", {collection:'customers', limit:100});
    const clist:CustomerRecord[] = (c.records||[]).map((r:any)=>{ const norm=normalizeCustomer(r.value); return norm ? {id:r.id, value:norm, updatedAt:r.updatedAt} : null; }).filter(Boolean) as CustomerRecord[];
    clist.sort((a,b)=> b.value.createdAt-a.value.createdAt);
    setCustomers(clist);
    try{ const dr:any = await api("records.list", {collection:'daily_reports', limit:100}); const dlist:DailyReportRecord[] = (dr.records||[]).map((r:any)=>({id:r.id, value:r.value})).filter((x:any)=>x.value && x.value.date); dlist.sort((a,b)=>b.value.date.localeCompare(a.value.date)); setDailyReports(dlist); }catch{}
    try{ const fv:any = await api("records.list", {collection:'favorites', limit:100}); const flist:FavoriteRecord[] = (fv.records||[]).map((r:any)=>({id:r.id, value:r.value})).filter((x:any)=>x.value && x.value.phone); flist.sort((a,b)=>b.value.createdAt-a.value.createdAt); setFavorites(flist); }catch{}
    try{ const wa:any = await api("records.list", {collection:'wallet_adjustments', limit:200}); const wlist:WalletAdjustmentRecord[] = (wa.records||[]).map((r:any)=>({id:r.id,value:r.value})).filter((x:any)=>x.value && x.value.wallet && x.value.mode); wlist.sort((a,b)=>b.value.createdAt-a.value.createdAt); setWalletAdjustments(wlist); }catch{}
    try{const cf:any=await api('records.list',{collection:'sync_conflicts',limit:100});setSyncConflicts((cf.records||[]) as SyncConflictRecord[]);}catch{}
    return list;
  }
  async function createRow(row:Tx){
    const key = `tx-${row.date}-${row.createdAt}-${uid()}`;
    return api("records.create", {collection:'transactions', value:row, idempotency_key:key});
  }
  async function saveMeta(next:Meta){
    const clean:Meta = { kind:'meta', businessName:next.businessName, eloadPct:next.eloadPct, cashInPct:next.cashInPct, cashOutPct:next.cashOutPct, palawanFee:next.palawanFee, lastClosed:next.lastClosed, lowThreshold: typeof next.lowThreshold==='number'?next.lowThreshold:1000, startingFloat: next.startingFloat, startingFloatDate: next.startingFloatDate, wallets:{ cash: round2(next.wallets.cash), maribank: round2(next.wallets.maribank) }};
    if(metaIdRef.current){ const r:any=await api("records.replace", {collection:'meta', id:metaIdRef.current, value:clean, expectedUpdatedAt:metaUpdatedAtRef.current}); setMetaUpdatedAt(Number(r.updatedAt||metaUpdatedAtRef.current)); }
    else { const r:any = await api("records.create", {collection:'meta', value:clean, idempotency_key:`meta-${uid()}`}); setMetaId(r.id); setMetaUpdatedAt(Number(r.updatedAt||0)); }
    setMeta(clean);
  }
  async function createCustomerRow(c:Customer){
    const key=`cust-${c.phone}-${c.createdAt}-${uid()}`;
    return api("records.create", {collection:'customers', value:c, idempotency_key:key});
  }
  async function ensureCustomer(phoneRaw:string, nameRaw:string){
    const phone=digitsOnly(phoneRaw);
    if(phone.length!==11) return null;
    const hasName=isRealName(nameRaw, phone);
    const name=hasName ? (nameRaw||'').trim() : '';
    const existing = customers.find(x=>digitsOnly(x.value.phone)===phone);
    if(!existing){
      const created:any = await createCustomerRow({name, phone, notes:'', createdAt:Date.now(), totalTransactions:0, totalAmount:0});
      const norm=normalizeCustomer(created.value||{name,phone,notes:'',createdAt:Date.now(),totalTransactions:0,totalAmount:0});
      if(norm) setCustomers(prev=> prev.some(p=>p.id===created.id)?prev:[{id:created.id, value:norm}, ...prev]);
      return created;
    }
    if(hasName && name!==existing.value.name){
      const updated={...existing.value, name};
await api("records.replace", {collection:'customers', id:existing.id, value:updated, expectedUpdatedAt:existing.updatedAt});
      setCustomers(prev=>prev.map(p=>p.id===existing.id?{...p, value:updated}:p));
    }
    return existing;
  }

  useEffect(()=>{ (async()=>{
    const loadingStartedAt=Date.now();
    try{
      await reloadRecords();
      const m:any = await api("records.list", {collection:'meta', limit:10});
      if(!m.records?.length){
        const cleanMeta={...defaultMeta, wallets:{...defaultWallets}};
        if(typeof navigator==='undefined' || navigator.onLine){ try{ const r:any=await api("records.create", {collection:'meta', value:cleanMeta, idempotency_key:`meta-seed-${uid()}`}); setMetaId(r.id); setMetaUpdatedAt(Number(r.updatedAt||0)); } catch{} }
        setMeta(cleanMeta);
      }
      const c:any = await api("records.list", {collection:'customers', limit:100});
      if(!c.records?.length && (typeof navigator==='undefined' || navigator.onLine)){
        for(const s of seedCustomers){
          try{ await api("records.create", {collection:'customers', value:s, idempotency_key:`cust-seed-${s.phone}-${uid()}`}); } catch{}
        }
        await reloadRecords();
      }
    } catch(e){ setApiError('The saved records could not be loaded yet. Your entries will be kept in this view until the connection returns — please try again.'); }
    const remainingSplashTime=Math.max(0,1000-(Date.now()-loadingStartedAt));
    if(remainingSplashTime) await new Promise<void>(resolve=>window.setTimeout(resolve,remainingSplashTime));
    setLoadingProgress(100);
    await new Promise<void>(resolve=>window.setTimeout(resolve,220));
    setLoading(false);
  })(); },[]);

  useEffect(()=>subscribePendingWrites((count,error)=>{ setPendingWrites(count); setSyncError(error); }),[]);
  useEffect(()=>{
    const sync=()=>{setIsSyncing(true);void waitForCloudSync().then(async()=>{clearSyncError();setSyncError('');const stamp=Date.now();setLastSyncedAt(stamp);try{localStorage.setItem('eics.last-cloud-sync',String(stamp));}catch{} await reloadRecords();}).catch(error=>setSyncError(error instanceof Error?error.message:String(error))).finally(()=>setIsSyncing(false));};
    const onOnline=()=>{ setIsOnline(true); setApiError(''); sync(); };
    const onOffline=()=>{setIsOnline(false);setIsSyncing(false);};
    window.addEventListener('online', onOnline); window.addEventListener('offline', onOffline);
    if(typeof navigator!=='undefined' && navigator.onLine) sync();
    return ()=>{ window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  },[]);
  const txs = useMemo(()=>records.map(r=>r.value),[records]);
  const todayTxs = txs.filter(t=>t.date===todayKey());
  const dayTxs = txs.filter(t=>t.date===selectedDay);
  const sum = (arr:Tx[], fn:(t:Tx)=>number)=> arr.reduce((s,t)=>s+fn(t),0);
  const salesTypes = ['E-Load','Cash In','Cash Out'];
  const todaySales = sum(todayTxs.filter(t=>salesTypes.includes(t.type)),t=>t.amount);
  const todayProfit = sum(todayTxs,t=>txProfit(t));
  const eloadToday = todayTxs.filter(t=>t.type==='E-Load');
  const cashInToday = todayTxs.filter(t=>t.type==='Cash In');
  const cashOutToday = todayTxs.filter(t=>t.type==='Cash Out');
  const topUpToday = todayTxs.filter(t=>t.type==='Top-Up');
  const totalWallet = Object.values(meta.wallets).reduce((a,b)=>a+b,0);
  const maribankLow = meta.wallets.maribank <= (meta.lowThreshold ?? 1000);
  const weekTopUp = useMemo(()=>{ const cutoff=new Date(); cutoff.setDate(cutoff.getDate()-6); const k=`${cutoff.getFullYear()}-${String(cutoff.getMonth()+1).padStart(2,'0')}-${String(cutoff.getDate()).padStart(2,'0')}`; return sum(txs.filter(t=>t.type==='Top-Up' && t.date>=k),t=>t.amount); },[txs]);

  const customerByPhone = useMemo(()=>{ const m=new Map<string,CustomerRecord>(); customers.forEach(c=>m.set(digitsOnly(c.value.phone),c)); return m; },[customers]);
  const customerStats = useMemo(()=>{
    const m=new Map<string,{count:number; amount:number; fees:number; lastDate:string; lastTx:Tx|null}>();
    txs.forEach(t=>{
      if(!salesTypes.includes(t.type)) return;
      const phone=digitsOnly(t.phone||'');
      if(!phone) return;
      const cur=m.get(phone)||{count:0,amount:0,fees:0,lastDate:'',lastTx:null};
      cur.count+=1; cur.amount+=t.amount; cur.fees+=(t.fee||0);
      if(!cur.lastDate || t.date>=cur.lastDate){ cur.lastDate=t.date; cur.lastTx=t; }
      m.set(phone,cur);
    });
    return m;
  },[txs]);
  const recentCustomerPhones = useMemo(()=>{
    const seen:string[]=[]; const sorted=[...records].sort((a,b)=>b.value.createdAt-a.value.createdAt);
    sorted.forEach(r=>{ const p=digitsOnly(r.value.phone||''); if(p && !seen.includes(p)) seen.push(p); });
    return seen.slice(0,5);
  },[records]);
  const frequentCustomers = useMemo(()=>{ return [...customers].sort((a,b)=> (customerStats.get(digitsOnly(b.value.phone))?.count||0)-(customerStats.get(digitsOnly(a.value.phone))?.count||0)).slice(0,5); },[customers,customerStats]);
  const last7 = useMemo(()=>{ const out=[]; for(let i=6;i>=0;i--){ const d=new Date(); d.setDate(d.getDate()-i); const k=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; const arr=txs.filter(t=>t.date===k); out.push({key:k, label:d.toLocaleDateString('en-PH',{weekday:'short'}), sales: sum(arr.filter(t=>salesTypes.includes(t.type)),t=>t.amount), profit: sum(arr,t=>txProfit(t)), count:arr.filter(t=>salesTypes.includes(t.type)).length }); } return out; },[txs]);
  const maxSales = Math.max(1,...last7.map(d=>d.sales));
  const todayCashMove = useMemo(()=>{ let cash=0; todayTxs.forEach(t=>{ if(t.utang && t.utangStatus==='unpaid') return; const d=applyTransaction({cash:0, maribank:0}, t, 1); cash+=d.cash; }); walletAdjustments.forEach(a=>{if(a.value.wallet==='cash'&&a.value.date===todayKey()) cash+=a.value.mode==='add'?a.value.amount:-a.value.amount;}); return round2(cash); },[todayTxs,walletAdjustments]);
  const startingFloat = useMemo(()=>{
    if(meta.startingFloatDate===todayKey() && typeof meta.startingFloat==='number') return meta.startingFloat;
    const prev = dailyReports.filter(r=>r.value.date < todayKey()).sort((a,b)=>b.value.date.localeCompare(a.value.date))[0];
    if(prev) return prev.value.tomorrowFloat;
    return round2(meta.wallets.cash - todayCashMove);
  },[meta, dailyReports, todayCashMove]);
  const expectedCash = round2(startingFloat + todayCashMove);
  const expectedMaribank = useMemo(()=>{ let m=startingFloat; return meta.wallets.maribank; },[meta]);
  const todayReport = dailyReports.find(r=>r.value.date===todayKey());
  const dayClosed = meta.lastClosed===todayKey();
  const utangList = useMemo(()=> records.filter(r=>r.value.utang),[records]);
  const utangOutstanding = round2(sum(utangList.filter(r=>r.value.utangStatus!=='paid').map(r=>r.value), t=>utangRemaining(t)));
  const utangOverdueList = useMemo(()=> utangList.filter(r=>utangPromiseStatus(r.value)==='overdue'),[utangList]);
  const utangDueTodayList = useMemo(()=> utangList.filter(r=>utangPromiseStatus(r.value)==='due-today'),[utangList]);
  const utangOverdueCount = utangOverdueList.length;
  const utangDueTodayCount = utangDueTodayList.length;
  const utangFiltered = useMemo(()=>{ let a=[...utangList]; if(utangFilter==='Unpaid') a=a.filter(r=>r.value.utangStatus!=='paid'); if(utangFilter==='Paid') a=a.filter(r=>r.value.utangStatus==='paid'); if(utangFilter==='Due Today') a=a.filter(r=>utangPromiseStatus(r.value)==='due-today'); if(utangFilter==='Overdue') a=a.filter(r=>utangPromiseStatus(r.value)==='overdue'); if(utangFilter==='Due This Week') a=a.filter(r=> r.value.utangStatus!=='paid' && r.value.promiseDate && daysBetween(todayKey(), r.value.promiseDate)>=0 && daysBetween(todayKey(), r.value.promiseDate)<=7); const rank=(r:TxRecord)=>{ const s=utangPromiseStatus(r.value); if(s==='overdue') return 0; if(s==='due-today') return 1; if(s==='due-soon') return 2; if(s==='no-date') return 3; return 4; }; a.sort((x,y)=> rank(x)-rank(y) || (x.value.promiseDate||'9999').localeCompare(y.value.promiseDate||'9999') || y.value.date.localeCompare(x.value.date) || y.value.createdAt-x.value.createdAt); return a; },[utangList, utangFilter]);

  const filtered = useMemo(()=>{
    let arr=[...records];
    if(filter!=='All') arr=arr.filter(r=>r.value.type===filter);
    if(search.trim()){ const q=search.toLowerCase(); const qd=digitsOnly(search); arr=arr.filter(r=>{ const cust=customerByPhone.get(digitsOnly(r.value.phone||'')); const hay=(r.value.network+r.value.provider+(r.value.promoName||'')+r.value.phone+r.value.notes+r.value.type+(cust?.value.name||'')+(r.value.customerName||'')+r.value.date).toLowerCase(); return hay.includes(q) || (qd && digitsOnly(r.value.phone||'').includes(qd)) || String(r.value.amount).includes(q); }); }
    return arr;
  },[records,filter,search,customerByPhone]);
  const grouped = useMemo(()=>{ const map=new Map<string,TxRecord[]>(); filtered.forEach(r=>{ if(!map.has(r.value.date)) map.set(r.value.date,[]); map.get(r.value.date)!.push(r); }); return [...map.entries()].sort((a,b)=>b[0].localeCompare(a[0])); },[filtered]);

  const reportTxs = useMemo(()=>{
    const today=todayKey(); const y=new Date(); y.setDate(y.getDate()-1); const yKey=`${y.getFullYear()}-${String(y.getMonth()+1).padStart(2,'0')}-${String(y.getDate()).padStart(2,'0')}`;
    const inRange=(date:string,start:string)=>date>=start && date<=today;
    if(reportPeriod==='Week') return txs.filter(t=>inRange(t.date,last7[0].key));
    if(reportPeriod==='Month') return txs.filter(t=>t.date.startsWith(today.slice(0,7)) && t.date<=today);
    if(reportRange==='Today') return txs.filter(t=>t.date===today);
    if(reportRange==='Yesterday') return txs.filter(t=>t.date===yKey);
    if(reportRange==='This Week') return txs.filter(t=>inRange(t.date,last7[0].key));
    return txs.filter(t=>t.date.startsWith(today.slice(0,7)) && t.date<=today);
  },[txs,reportRange,last7,reportPeriod]);
  const reportSales = sum(reportTxs.filter(t=>t.type==='E-Load'),t=>t.amount);
  const reportCashIn = sum(reportTxs.filter(t=>t.type==='Cash In'),t=>t.amount);
  const reportCashOut = sum(reportTxs.filter(t=>t.type==='Cash Out'),t=>t.amount);
  const reportTopUp = sum(reportTxs.filter(t=>t.type==='Top-Up'),t=>t.amount);
  const reportTopUpFees = sum(reportTxs.filter(t=>t.type==='Top-Up'),t=>t.fee||0);
  const reportProfit = sum(reportTxs,t=>txProfit(t));
  const denom = useMemo(()=>{ const m=new Map<number,number>(); reportTxs.filter(t=>t.type==='E-Load').forEach(t=>m.set(t.amount,(m.get(t.amount)||0)+1)); return [...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5); },[reportTxs]);
  const todayWalletMoves = useMemo(()=>{ const m:Record<string,number>={cash:0, maribank:0}; todayTxs.forEach(t=>{ if(t.utang && t.utangStatus==='unpaid') return; const d=applyTransaction({cash:0, maribank:0}, t, 1); m.cash=round2(m.cash+d.cash); m.maribank=round2(m.maribank+d.maribank); }); walletAdjustments.forEach(a=>{if(a.value.date===todayKey()) m[a.value.wallet]=round2(m[a.value.wallet]+(a.value.mode==='add'?a.value.amount:-a.value.amount));}); return m; },[todayTxs,walletAdjustments]);
  const profitPerDay = useMemo(()=>{ const map=new Map<string,{date:string; sales:number; profit:number; count:number}>(); reportTxs.forEach(t=>{ const cur=map.get(t.date)||{date:t.date,sales:0,profit:0,count:0}; if(salesTypes.includes(t.type)){ cur.sales+=t.amount; cur.count+=1; } cur.profit+=txProfit(t); map.set(t.date,cur); }); return [...map.values()].sort((a,b)=>b.date.localeCompare(a.date)); },[reportTxs]);

  const topSuki = useMemo(()=>{
    const cutoff=last7[0]?.key||todayKey();
    const map=new Map<string,{phone:string; count:number; amount:number; name:string}>();
    txs.filter(t=>salesTypes.includes(t.type) && t.date>=cutoff).forEach(t=>{ const phone=digitsOnly(t.phone||''); if(!phone) return; const cur=map.get(phone)||{phone, count:0, amount:0, name:customerByPhone.get(phone)?.value.name||t.customerName||phone}; cur.count+=1; cur.amount+=t.amount; map.set(phone,cur); });
    return [...map.values()].sort((a,b)=>b.count-a.count||b.amount-a.amount).slice(0,3);
  },[txs,last7,customerByPhone]);
  const reportByCustomer = useMemo(()=>{
    const map=new Map<string,{phone:string; name:string; count:number; amount:number; fees:number}>();
    reportTxs.filter(t=>salesTypes.includes(t.type)).forEach(t=>{ const phone=digitsOnly(t.phone||''); if(!phone) return; const cur=map.get(phone)||{phone, name:customerByPhone.get(phone)?.value.name||t.customerName||phone, count:0, amount:0, fees:0}; cur.count+=1; cur.amount+=t.amount; cur.fees+=(t.fee||0); map.set(phone,cur); });
    return [...map.values()].sort((a,b)=>b.amount-a.amount).slice(0,5);
  },[reportTxs,customerByPhone]);
  const sortedCustomers = useMemo(()=>{
    let arr=[...customers];
    if(customerNameFilter==='No Name Yet') arr=arr.filter(c=>!isRealName(c.value.name, c.value.phone));
    if(customerNameFilter==='With Name') arr=arr.filter(c=>isRealName(c.value.name, c.value.phone));
    if(customerSearch.trim()){ const q=customerSearch.toLowerCase(); const qd=digitsOnly(customerSearch); arr=arr.filter(c=> c.value.name.toLowerCase().includes(q) || digitsOnly(c.value.phone).includes(qd) || (c.value.notes||'').toLowerCase().includes(q)); }
    if(customerSort==='A-Z') arr.sort((a,b)=>a.value.name.localeCompare(b.value.name));
    else if(customerSort==='Most Frequent') arr.sort((a,b)=> (customerStats.get(digitsOnly(b.value.phone))?.count||0)-(customerStats.get(digitsOnly(a.value.phone))?.count||0));
    else arr.sort((a,b)=> (customerStats.get(digitsOnly(b.value.phone))?.lastDate||'').localeCompare(customerStats.get(digitsOnly(a.value.phone))?.lastDate||'') || b.value.createdAt-a.value.createdAt);
    return arr;
  },[customers,customerSearch,customerSort,customerStats,customerNameFilter]);
  const dashboardRecent = useMemo(()=>{ let a=[...records].slice(0,5); if(dashboardSearch.trim()){ const q=dashboardSearch.toLowerCase(); const qd=digitsOnly(dashboardSearch); a=records.filter(r=>{ const cust=customerByPhone.get(digitsOnly(r.value.phone||'')); const hay=(r.value.network+r.value.provider+(r.value.promoName||'')+r.value.phone+r.value.notes+r.value.type+(cust?.value.name||'')+(r.value.customerName||'')+r.value.date).toLowerCase(); return hay.includes(q)|| (qd && digitsOnly(r.value.phone||'').includes(qd)) || String(r.value.amount).includes(q); }).slice(0,5); } return a; },[records,dashboardSearch,customerByPhone]);

  useEffect(()=>{ if(tab==='transactions' && filtered.length && !filtered.some(r=>r.id===selectedTxId)) setSelectedTxId(filtered[0].id); if(tab==='transactions' && !filtered.length) setSelectedTxId(null); },[filtered, tab, selectedTxId]);
  useEffect(()=>{ if(tab==='customers' && sortedCustomers.length && !sortedCustomers.some(c=>c.id===selectedCustomerId)) setSelectedCustomerId(sortedCustomers[0].id); if(tab==='customers' && !sortedCustomers.length) setSelectedCustomerId(null); },[sortedCustomers, tab, selectedCustomerId]);
  useEffect(()=>{ if(selectedTxId || selectedCustomerId){ const t=setTimeout(()=>{ selectedRowRef.current?.scrollIntoView({block:'nearest', behavior:'smooth'}); },30); return ()=>clearTimeout(t); } },[selectedTxId, selectedCustomerId]);
  useEffect(()=>{ if(detail){ setShowPartial(false); setPartialAmount(utangRemaining(detail.value)); } },[detail?.id]);

  function setCustomerFromRecord(c:CustomerRecord){
    setFPhone(c.value.phone);
    if(isRealName(c.value.name, c.value.phone)){ setFCustomerName(c.value.name); setFCustomerQuery(displayNamePhone(c.value.name, c.value.phone)); setShowNameField(false); }
    else { setFCustomerName(''); setFCustomerQuery(formatPhone(c.value.phone)); setShowNameField(true); }
    setNamePromptSkipped(false); setNameMsg('');
  }
  function handleCustomerQuery(q:string){
    setFCustomerQuery(q);
    const p=parseCustomerQuery(q);
    setFPhone(p.phone);
    setFCustomerName(isRealName(p.name, p.phone) ? p.name : '');
    if(p.phone.length===11){
      const existing=customers.find(x=>digitsOnly(x.value.phone)===p.phone);
      if(existing && isRealName(existing.value.name, existing.value.phone)){ setFCustomerName(existing.value.name); setShowNameField(false); }
      else { setShowNameField(true); }
      setNamePromptSkipped(false);
    } else { setShowNameField(false); }
    setNameMsg('');
  }
  function openAddName(phone:string){
    const rec=customers.find(x=>digitsOnly(x.value.phone)===digitsOnly(phone));
    setAddNameTarget({phone:digitsOnly(phone), id:rec?.id});
    setAddNameValue(''); setAddNameMsg(''); setAddNameSaving(false);
  }
  async function saveNameForPhone(phone:string, nameRaw:string){
    const cleanPhone=digitsOnly(phone);
    const cleanName=(nameRaw||'').trim();
    if(cleanPhone.length!==11) throw new Error('Enter an 11-digit number first.');
    if(!isRealName(cleanName, cleanPhone)) throw new Error('Enter a name — not the number again.');
    const existing=customers.find(x=>digitsOnly(x.value.phone)===cleanPhone);
    if(existing){ const updated={...existing.value, name:cleanName}; await api("records.replace", {collection:'customers', id:existing.id, value:updated, expectedUpdatedAt:existing.updatedAt}); setCustomers(prev=>prev.map(p=>p.id===existing.id?{...p, value:updated}:p)); }
    else { const created:any=await createCustomerRow({name:cleanName, phone:cleanPhone, notes:'', createdAt:Date.now(), totalTransactions:0, totalAmount:0}); const norm=normalizeCustomer(created.value||{name:cleanName, phone:cleanPhone}); if(norm) setCustomers(prev=> prev.some(p=>p.id===created.id)?prev:[{id:created.id, value:norm}, ...prev]); }
  }
  async function saveNameInForm(){
    const name=fCustomerName.trim();
    if(!isRealName(name, fPhone)){ setNameMsg('Type a name — not the number again.'); return; }
    setNameSaving(true); setNameMsg('');
    try{ await saveNameForPhone(fPhone, name); setFCustomerQuery(displayNamePhone(name, fPhone)); setShowNameField(false); setNamePromptSkipped(false); setNameMsg('Name saved.'); } catch(e){ setNameMsg(e instanceof Error?e.message:String(e)); }
    setNameSaving(false);
  }
  async function saveAddNamePopup(){
    if(!addNameTarget) return;
    if(!isRealName(addNameValue, addNameTarget.phone)){ setAddNameMsg('Type a name — not the number again.'); return; }
    setAddNameSaving(true); setAddNameMsg('');
    try{ await saveNameForPhone(addNameTarget.phone, addNameValue); await reloadRecords(); setAddNameTarget(null); setSaveMsg(`Name saved: ${displayNamePhone(addNameValue, addNameTarget.phone)}`); } catch(e){ setAddNameMsg(e instanceof Error?e.message:String(e)); }
    setAddNameSaving(false);
  }
  function openNew(type:TxType, cust?:CustomerRecord|null, preset?:{amount?:number; network?:string}){
    setEditing(null); setFType(type); setFNetwork(preset?.network || 'Globe'); setFEloadKind('regular'); setFPromoName(''); setFPromoDetails(''); setFPromoValidity(''); setFProvider(type==='Top-Up'?'External Provider':'Main Wallet'); setFAmount(preset?.amount ?? (type==='Top-Up'?1000:100)); setFDiscount(0); setFCustom(''); setFFee(type==='E-Load'?Math.round((preset?.amount ?? 100)*meta.eloadPct/100*100)/100: type==='Top-Up'?meta.palawanFee:autoFee(type,preset?.amount ?? 100));
    setShowNameField(false); setNamePromptSkipped(false); setNameMsg(''); setDuplicateInfo(null); setIsUtang(false); setFPromiseDate('');
    if(cust){ setCustomerFromRecord(cust); } else { setFPhone(''); setFCustomerName(''); setFCustomerQuery(''); }
    setFNotes(type==='Top-Up'?'Top-Up via External Provider':''); setFDate(todayKey()); setFTime(currentTimeLabel()); setFPayment('Cash'); setShowTx(true); setSaveMsg('');
  }
  function repeatTx(r:TxRecord){
    // Repeating starts one new transaction; dismiss the source sheet so the form is not hidden behind it.
    setDetail(null); setCustomerDetail(null);
    const cust = customerByPhone.get(digitsOnly(r.value.phone||''));
    setEditing(null); setFType(r.value.type); setFNetwork(r.value.network||'Globe'); setFEloadKind(r.value.eloadKind||'regular'); setFPromoName(r.value.promoName||''); setFPromoDetails(r.value.promoDetails||''); setFPromoValidity(r.value.promoValidity||''); setFProvider(r.value.provider||'Main Wallet'); setFAmount(r.value.amount); setFDiscount(eLoadDiscount(r.value)); setFCustom(''); setFFee(r.value.fee);
    if(cust) setCustomerFromRecord(cust); else { setFPhone(r.value.phone||''); setFCustomerName(r.value.customerName||''); setFCustomerQuery(displayNamePhone(r.value.customerName, r.value.phone)); }
    setIsUtang(false); setFPromiseDate(''); setDuplicateInfo(null); setFNotes(r.value.notes||''); setFDate(todayKey()); setFTime(currentTimeLabel()); setFPayment(r.value.payment||'Cash'); setShowNameField(false); setShowTx(true); showToast('A new transaction is prefilled. Review it and tap Save to record it.');
  }
  function openEdit(r:TxRecord){
    setEditing(r); const v=r.value; setFType(v.type); setFNetwork(v.network||'Globe'); setFEloadKind(v.eloadKind||'regular'); setFPromoName(v.promoName||''); setFPromoDetails(v.promoDetails||''); setFPromoValidity(v.promoValidity||''); setFProvider(v.provider||'Main Wallet'); setFAmount(v.amount); setFDiscount(eLoadDiscount(v)); setFFee(v.fee);
    const cust = customerByPhone.get(digitsOnly(v.phone||''));
    const rawName = cust?.value.name || v.customerName || '';
    const name = isRealName(rawName, v.phone) ? rawName : '';
    setFCustomerName(name); setFPhone(v.phone||''); setFCustomerQuery(displayNamePhone(name, v.phone||''));
    setShowNameField(!name && !!v.phone); setNamePromptSkipped(false); setNameMsg(''); setDuplicateInfo(null); setIsUtang(!!v.utang); setFPromiseDate(v.promiseDate||''); setShowPartial(false);
    setFNotes(v.notes||''); setFDate(v.date); setFTime(v.time||currentTimeLabel()); setFPayment(v.payment||'Cash'); setShowTx(true);
  }
  function openCustomerForm(c?:CustomerRecord|null){
    setEditingCustomer(c||null); setCName(c?c.value.name:''); setCPhone(c?c.value.phone:''); setCNotes(c?c.value.notes:''); setCustomerMsg(''); setShowCustomerForm(true);
  }
  function autoFee(type:TxType, amt:number){
    if(type==='E-Load') return Math.round(amt*meta.eloadPct/100*100)/100;
    if(type==='Cash In') return round2(amt*meta.cashInPct/100);
    if(type==='Cash Out') return round2(amt*meta.cashOutPct/100);
    if(type==='Top-Up') return meta.palawanFee;
    return 0;
  }
  function feeParts(type:TxType, amt:number){
    if(type==='Cash In') return {pct: meta.cashInPct, pctAmt: round2(amt*meta.cashInPct/100)};
    if(type==='Cash Out') return {pct: meta.cashOutPct, pctAmt: round2(amt*meta.cashOutPct/100)};
    return {pct: 0, pctAmt: 0};
  }
  function openEndDay(){
    setActualCash(round2(expectedCash)); setTomorrowFloat(round2(expectedCash)); setTomorrowTouched(false); setShowEOD(true);
  }
  async function toggleFavoriteForTx(r:TxRecord){
    const v=r.value; const existing=favorites.find(f=>digitsOnly(f.value.phone)===digitsOnly(v.phone) && f.value.amount===v.amount && f.value.type===v.type && f.value.network===v.network);
    try{
      if(existing){ await api("records.delete", {collection:'favorites', id:existing.id}); setFavorites(prev=>prev.filter(f=>f.id!==existing.id)); showToast('Removed from Favorites.'); }
      else { const fav:Favorite={phone:digitsOnly(v.phone), name:isRealName(v.customerName, v.phone)?(v.customerName||''):customerByPhone.get(digitsOnly(v.phone))?.value.name||'', type:v.type, amount:v.amount, network:v.network, createdAt:Date.now()}; const created:any=await api("records.create", {collection:'favorites', value:fav, idempotency_key:`fav-${fav.phone}-${fav.amount}-${fav.type}-${uid()}`}); setFavorites(prev=>[{id:created.id, value:fav}, ...prev]); showToast('Added to Favorites.'); }
    }catch(e){ showErrorToast(e instanceof Error?e.message:String(e)); }
  }
  async function toggleFavoriteForCustomer(c:CustomerRecord, type:TxType='E-Load', amount=100, network='Globe'){
    const existing=favorites.find(f=>digitsOnly(f.value.phone)===digitsOnly(c.value.phone) && f.value.amount===amount && f.value.type===type);
    try{
      if(existing){ await api("records.delete", {collection:'favorites', id:existing.id}); setFavorites(prev=>prev.filter(f=>f.id!==existing.id)); showToast('Removed from Favorites.'); }
      else { const fav:Favorite={phone:digitsOnly(c.value.phone), name:c.value.name, type, amount, network, createdAt:Date.now()}; const created:any=await api("records.create", {collection:'favorites', value:fav, idempotency_key:`fav-${fav.phone}-${uid()}`}); setFavorites(prev=>[{id:created.id, value:fav}, ...prev]); showToast('Added to Favorites.'); }
    }catch(e){ showErrorToast(e instanceof Error?e.message:String(e)); }
  }
  async function markUtangPaid(r:TxRecord){
    setSaving(true);
    try{
      const remaining=utangRemaining(r.value);
      const partialTx=txPortion(r.value, remaining);
      const nextWallets=applyTransaction(metaRef.current.wallets, partialTx, 1);
      const updated:Tx={...r.value, utang:true, utangStatus:'paid', paidAmount:r.value.amount};
      await api("records.replace", {collection:'transactions', id:r.id, value:updated, expectedUpdatedAt:r.updatedAt});
      await saveMeta({...metaRef.current, wallets:nextWallets});
      await reloadRecords(); setDetail(null); setShowPartial(false); showToast('Utang marked paid — wallets updated.');
    }catch(e){ showErrorToast(e instanceof Error?e.message:String(e)); }
    setSaving(false);
  }
  async function savePartialPayment(r:TxRecord){
    const remaining=utangRemaining(r.value);
    const paid=round2(partialAmount||0);
    if(!paid || paid<=0){ showErrorToast('Enter an amount greater than zero.'); return; }
    if(paid>remaining){ showErrorToast(`Partial payment cannot be more than the remaining ${peso(remaining)}.`); return; }
    setSaving(true);
    try{
      if(paid>=remaining){ await markUtangPaid(r); return; }
      const partialTx=txPortion(r.value, paid);
      const nextWallets=applyTransaction(metaRef.current.wallets, partialTx, 1);
      const updated:Tx={...r.value, utang:true, utangStatus:'unpaid', paidAmount:round2((r.value.paidAmount||0)+paid)};
      await api("records.replace", {collection:'transactions', id:r.id, value:updated, expectedUpdatedAt:r.updatedAt});
      await saveMeta({...metaRef.current, wallets:nextWallets});
      await reloadRecords(); setShowPartial(false); setPartialAmount(0); showToast(`Partial payment ${peso(paid)} saved — remaining ${peso(remaining-paid)}.`);
    }catch(e){ showErrorToast(e instanceof Error?e.message:String(e)); }
    setSaving(false);
  }
  async function saveTransaction(keepOpen=false, forceDuplicate=false){
    if(!fAmount || fAmount<=0){ showErrorToast('Enter an amount greater than zero.'); return; }
    if(fType==='E-Load' && (fDiscount<0 || fDiscount>fAmount)){ showErrorToast('Provider discount must be between ₱0 and the load amount.'); return; }
    if(fType==='E-Load' && !fNetwork){ showErrorToast('Choose a network.'); return; }
    if(fType==='E-Load' && fEloadKind==='promo' && !fPromoName.trim()){ showErrorToast('Enter the promo/package name.'); return; }
    if(fType!=='Top-Up' && digitsOnly(fPhone).length!==11){ showErrorToast('Choose or type a customer — enter an 11-digit number (09XX XXX XXXX) or pick a name.'); return; }
    if(fType==='Top-Up' && fPhone && digitsOnly(fPhone).length!==11){ showErrorToast('Customer number must be 11 digits, or leave it blank.'); return; }
    const phone=digitsOnly(fPhone);
    const existingCust=customerByPhone.get(phone);
    const custName = isRealName(fCustomerName, phone) ? fCustomerName.trim() : (existingCust && isRealName(existingCust.value.name, phone) ? existingCust.value.name : '');
    // Duplicate check within 5 minutes
    if(!forceDuplicate && !editing){
      const now=Date.now();
      const dup = records.find(r=> digitsOnly(r.value.phone)===phone && r.value.amount===fAmount && r.value.type===fType && Math.abs(now - r.value.createdAt) < 5*60*1000);
      if(dup){ const mins=Math.max(0, Math.floor((now-dup.value.createdAt)/60000)); setDuplicateInfo({mins, amount:fAmount, type:fType, name:custName||formatPhone(phone)}); return; }
    }
    const isUtangTx = isUtang && fType!=='Top-Up';
    const history = editing && editing.value.amount!==fAmount ? [...(editing.value.history||[]), {oldAmount:editing.value.amount, newAmount:fAmount, time:fTime, date:fDate}] : editing?.value.history;
    const previouslyPaid = editing?.value.utang ? Math.min(fAmount, Math.max(0,editing.value.paidAmount||0)) : 0;
    const nextPaidAmount = isUtangTx ? previouslyPaid : (editing?.value.paidAmount ?? 0);
    const tx:Tx={ type:fType, network: fType==='Top-Up' ? 'External Provider' : fType==='E-Load' ? fNetwork : 'Main Wallet', provider: fType==='Top-Up' ? 'External Provider' : 'Main Wallet', amount:fAmount, fee:fFee, selling:fType==='E-Load'?fAmount:0, discount:fType==='E-Load'?round2(fDiscount):0, eloadKind:fType==='E-Load'?fEloadKind:undefined, promoName:fType==='E-Load'&&fEloadKind==='promo'?fPromoName.trim():undefined, promoDetails:fType==='E-Load'&&fEloadKind==='promo'?fPromoDetails.trim():undefined, promoValidity:fType==='E-Load'&&fEloadKind==='promo'?fPromoValidity.trim():undefined, phone, customerName: phone?custName:'', payment:fType==='Cash Out'?'Main Wallet':'Cash', notes:fNotes, date:fDate, time:fTime, createdAt: editing?editing.value.createdAt:Date.now(), sample:editing?editing.value.sample:false, utang:isUtangTx, utangStatus: isUtangTx ? (nextPaidAmount>=fAmount && nextPaidAmount>0?'paid':'unpaid') : editing?.value.utangStatus, promiseDate: isUtangTx ? (fPromiseDate||undefined) : editing?.value.promiseDate, paidAmount: nextPaidAmount, history };
    setSaving(true); setSaveMsg('');
    try{
      if(phone) await ensureCustomer(phone, custName);
      let nextWallets={...meta.wallets};
      if(editing){
        nextWallets=updateWalletsForEdit(nextWallets, editing.value, tx);
        await api("records.replace", {collection:'transactions', id:editing.id, value:tx, expectedUpdatedAt:editing.updatedAt});
      }
      else {
        if(!isUtangTx) nextWallets=applyTransaction(nextWallets, tx, 1);
        await createRow(tx);
      }
      if(nextWallets.maribank < 0) setSaveMsg('Warning: Main Wallet balance went below ₱0. Check the amount before saving again.');
      await saveMeta({...metaRef.current, wallets:nextWallets});
      await reloadRecords();
      if(keepOpen){
        const keepType=fType;
        setEditing(null); if(keepType==='E-Load'){setFEloadKind('regular'); setFPromoName(''); setFPromoDetails(''); setFPromoValidity('');} setFAmount(keepType==='Top-Up'?1000:100); setFDiscount(0); setFCustom(''); setFFee(autoFee(keepType, keepType==='Top-Up'?1000:100)); setFNotes(keepType==='Top-Up'?'Top-Up via External Provider':''); setFDate(todayKey()); setDuplicateInfo(null); setIsUtang(false); setFPromiseDate('');
        setSaveMsg('Saved — ready for the next one. Same customer kept.');
      } else {
        setShowTx(false); setDuplicateInfo(null); setSaveMsg(editing?'Transaction updated and wallets adjusted.':'Transaction saved — wallets updated automatically.');
      }
    } catch(e){ const message=e instanceof Error?e.message:String(e); if(message.includes('changed or was removed on another device')) showToast(message,'error','Reload latest',()=>{ void reloadRecords(); setShowTx(false); }); else showErrorToast(message); }
    setSaving(false);
  }
  async function saveCustomerFromForm(){
    const phone=digitsOnly(cPhone);
    if(!cName.trim()){ setCustomerMsg('Enter the customer name.'); return; }
    if(phone.length!==11){ setCustomerMsg('Phone must be 11 digits (09XX XXX XXXX).'); return; }
    setSaving(true); setCustomerMsg('');
    try{
      if(editingCustomer){ const updated:Customer={...editingCustomer.value, name:cName.trim(), phone, notes:cNotes.trim()}; await api("records.replace", {collection:'customers', id:editingCustomer.id, value:updated, expectedUpdatedAt:editingCustomer.updatedAt}); }
      else { const dup=customers.find(c=>digitsOnly(c.value.phone)===phone); if(dup){ setCustomerMsg('That number is already saved for '+dup.value.name+'. Pick it from the list to edit it.'); setSaving(false); return; } await createCustomerRow({name:cName.trim(), phone, notes:cNotes.trim(), createdAt:Date.now(), totalTransactions:0, totalAmount:0}); }
      await reloadRecords(); setShowCustomerForm(false); setSaveMsg(editingCustomer?'Customer updated.':'Customer saved.');
    } catch(e){ setCustomerMsg(e instanceof Error?e.message:String(e)); }
    setSaving(false);
  }
  async function deleteCustomer(c:CustomerRecord){
    setSaving(true);
    try{ await api("records.delete", {collection:'customers', id:c.id, expectedUpdatedAt:c.updatedAt}); await reloadRecords(); setCustomerDetail(null); setConfirmDeleteCustomer(null); setSaveMsg('Customer deleted. Past transactions are kept and will show as Deleted Customer.'); } catch(e){ setSaveMsg(e instanceof Error?e.message:String(e)); }
    setSaving(false);
  }
  async function undoDelete(){
    if(!undoInfo) return;
    setSaving(true);
    try{
      await api("records.create", {collection:'transactions', value:undoInfo.tx, idempotency_key:`undo-${undoInfo.tx.createdAt}-${uid()}`});
      await saveMeta({...metaRef.current, wallets:undoInfo.walletsBefore});
      await reloadRecords(); setUndoInfo(null); setSaveMsg('Transaction restored.');
    }catch(e){ showErrorToast(e instanceof Error?e.message:String(e)); }
    setSaving(false);
  }
  async function deleteTransaction(r:TxRecord){
    const walletsBefore={...meta.wallets};
    setSaving(true);
    try{
      const isUnpaidUtang = !!(r.value.utang && r.value.utangStatus==='unpaid');
      const paidPortion = r.value.paidAmount||0;
      const next = isUnpaidUtang ? (paidPortion>0 ? reverseTransaction(meta.wallets, txPortion(r.value, paidPortion)) : {...meta.wallets}) : reverseTransaction(meta.wallets, r.value);
      await api("records.delete", {collection:'transactions', id:r.id, expectedUpdatedAt:r.updatedAt});
      await saveMeta({...metaRef.current, wallets:next});
      await reloadRecords(); setDetail(null); setConfirmDelete(null);
      setUndoInfo({tx:r.value, walletsBefore});
      if(undoTimerRef.current) clearTimeout(undoTimerRef.current);
      undoTimerRef.current=setTimeout(()=>setUndoInfo(null), 10000);
      showToast('Transaction deleted.', 'success', 'Undo', ()=>{ undoDelete(); });
    } catch(e){ showErrorToast(e instanceof Error?e.message:String(e)); }
    setSaving(false);
  }
  function openWalletAction(wallet:keyof Wallets, mode:'add'|'deduct'){
    setShowWalletAction(wallet); setWalletMode(mode); setWalletAmt(500);
    setWalletActionCategory(mode==='deduct'?'Shopee / Online shopping':'Balance correction');
    setWalletActionNote('');
  }
  async function doWalletAction(){
    if(!showWalletAction || !walletAmt || walletAmt<=0){ showErrorToast('Enter an amount greater than zero.'); return; }
    if(walletMode==='deduct' && walletAmt>metaRef.current.wallets[showWalletAction]){ showErrorToast('Deduction exceeds the current wallet balance.'); return; }
    if(walletMode==='deduct' && !walletActionCategory.trim() && !walletActionNote.trim()){ showErrorToast('Choose a reason or enter a note for this deduction.'); return; }
    setSaving(true);
    let adjustmentId:string|undefined;
    try{
      const adjustment:WalletAdjustment={wallet:showWalletAction,mode:walletMode,amount:round2(walletAmt),category:walletMode==='deduct'?walletActionCategory.trim():'Balance correction',note:walletActionNote.trim(),date:todayKey(),time:new Date().toLocaleTimeString('en-PH',{hour:'numeric',minute:'2-digit'}),createdAt:Date.now()};
      const created:any=await api('records.create',{collection:'wallet_adjustments',value:adjustment,idempotency_key:`wallet-${adjustment.createdAt}-${uid()}`});
      adjustmentId=created.id;
      const next={...metaRef.current,wallets:{...metaRef.current.wallets,[showWalletAction]:round2(metaRef.current.wallets[showWalletAction]+(walletMode==='add'?walletAmt:-walletAmt))}};
      try{ await saveMeta(next); }catch(e){ if(adjustmentId) await api('records.delete',{collection:'wallet_adjustments',id:adjustmentId}); throw e; }
      setWalletAdjustments(prev=>[{id:adjustmentId||uid(),value:adjustment},...prev]);
      const label=walletMode==='deduct'?`Deducted ${peso(walletAmt)} — ${adjustment.category}${adjustment.note?`: ${adjustment.note}`:''}.`:`Added ${peso(walletAmt)} to ${walletDefs.find(w=>w.key===showWalletAction)?.label}.`;
      setShowWalletAction(null); setSaveMsg(label);
    }catch(e){ showErrorToast(e instanceof Error?e.message:String(e)); }
    setSaving(false);
  }
  async function clearSample(){
    setSaving(true);
    try{
      const sample = records.filter(r=>r.value.sample);
      for(const r of sample){ await api("records.delete", {collection:'transactions', id:r.id, expectedUpdatedAt:r.updatedAt}); }
      const sampleCust = customers.filter(c=>c.value.sample);
      for(const c of sampleCust){ await api("records.delete", {collection:'customers', id:c.id, expectedUpdatedAt:c.updatedAt}); }
      await saveMeta({...metaRef.current, wallets:{...defaultWallets}});
      await reloadRecords(); setConfirmClear(false); setSaveMsg('Sample data cleared. Your starting balances were restored.');
    } catch(e){ setSaveMsg(e instanceof Error?e.message:String(e)); }
    setSaving(false);
  }
  async function endOfDay(){
    setSaving(true);
    try{
      const diff = round2(actualCash - expectedCash);
      const report:DailyReport={date:todayKey(), sales:todaySales, profit:todayProfit, count:todayTxs.length, cash:meta.wallets.cash, maribank:meta.wallets.maribank, topUp:sum(topUpToday,t=>t.amount), wallets:meta.wallets, startingFloat, actualCash, difference:diff, tomorrowFloat, createdAt:Date.now()};
      await api("records.create", {collection:'daily_reports', value:report, idempotency_key:`eod-${todayKey()}-${uid()}`});
      await saveMeta({...metaRef.current, lastClosed:todayKey(), startingFloat:tomorrowFloat, startingFloatDate:tomorrowKey()});
      await reloadRecords(); setShowEOD(false); setSaveMsg('Day closed — summary saved. Tomorrow starts with '+peso(tomorrowFloat)+' float.');
    } catch(e){ showErrorToast(e instanceof Error?e.message:String(e)); }
    setSaving(false);
  }
  function exportAllCSV(){
    const rows:string[][] = [['Date','Type','Network','Load Kind','Promo Name','Promo Inclusions','Promo Validity','Customer','Number','Amount','Fee','Profit','Notes','Status','Promise to Pay','Paid Amount','Remaining'].map(String) as any];
    records.forEach(r=>{ const v=r.value; rows.push([v.date, v.type, v.network||'', v.eloadKind||'', v.promoName||'', v.promoDetails||'', v.promoValidity||'', v.customerName||'', v.phone, String(v.amount), String(v.fee||0), String(txProfit(v)), v.notes||'', v.utang ? (v.utangStatus==='paid'?'Paid (Utang)':utangPromiseLabel(v)) : 'Paid', v.promiseDate||'', String(v.paidAmount||0), String(v.utang?utangRemaining(v):0)]); });
    walletAdjustments.forEach(a=>{const v=a.value; rows.push([v.date,v.mode==='deduct'?'Wallet Deduction':'Wallet Addition',v.wallet,'','','','','','',String(v.mode==='deduct'?-v.amount:v.amount),'','',`${v.category}${v.note?` — ${v.note}`:''}`,'Recorded','','','']);});
    downloadCSV('eload-records.csv', rows as any);
    showToast('CSV exported.');
  }
  async function importStatementSales(file:File){
    setStatementImportBusy(true);
    try{
      const parsed=JSON.parse(await file.text());
      if(!Array.isArray(parsed) || !parsed.length) throw new Error('Import file must contain a non-empty array of transactions.');
      const rows=parsed.map(item=>{
        if(!item || typeof item.id!=='string' || !item.id.startsWith('mari-oct-2026-') || !item.value || item.value.type!=='E-Load' || !['Globe','Smart','DITO'].includes(item.value.network) || !/^2026-10-\d{2}$/.test(item.value.date) || !(Number(item.value.amount)>0)) throw new Error('This file contains a row that is not a valid October 2026 E-Load sale. Nothing was imported.');
        return item;
      });
      let imported=0, skipped=0;
      for(const item of rows){
        const result:any=await api('records.create',{collection:'transactions',id:item.id,value:item.value});
        if(result.skipped) skipped++; else imported++;
      }
      await reloadRecords();
      showToast(`Imported ${imported} customer sales${skipped?` • ${skipped} already existed`:''}. Historical import did not change current wallet balances.`);
    }catch(e){ showErrorToast(e instanceof Error?e.message:'Could not import these statement sales.'); }
    finally{ setStatementImportBusy(false); if(statementImportRef.current) statementImportRef.current.value=''; }
  }
  async function reminderPngBlob(tx:Tx):Promise<Blob>{
    const svgBlob=new Blob([utangReminderSvg(tx,meta.businessName,utangReminderTheme,utangReminderAll ? records.filter(r=>r.value.utang && r.value.utangStatus!=='paid' && digitsOnly(r.value.phone||'')===digitsOnly(tx.phone||'')) : null)],{type:'image/svg+xml;charset=utf-8'});
    const url=URL.createObjectURL(svgBlob);
    try{
      const image=new Image();
      await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve(); image.onerror=()=>reject(new Error('Could not render the reminder image.')); image.src=url;});
      const canvas=document.createElement('canvas'); canvas.width=1080; canvas.height=1350;
      const context=canvas.getContext('2d'); if(!context) throw new Error('Image export is not available in this browser.');
      context.drawImage(image,0,0,canvas.width,canvas.height);
      return await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Could not create PNG image.')),'image/png'));
    }finally{ URL.revokeObjectURL(url); }
  }
  function downloadReminderBlob(blob:Blob,tx:Tx){
    const url=URL.createObjectURL(blob); const link=document.createElement('a'); link.href=url; link.download=`utang-reminder-${tx.date}.png`; document.body.appendChild(link); link.click(); link.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function downloadUtangReminder(){
    if(!utangReminder) return; setUtangReminderBusy(true);
    try{ downloadReminderBlob(await reminderPngBlob(utangReminder.value),utangReminder.value); showToast('Reminder image downloaded.'); }
    catch(e){ showErrorToast(e instanceof Error?e.message:'Could not download reminder image.'); }
    finally{ setUtangReminderBusy(false); }
  }
  async function shareUtangReminder(){
    if(!utangReminder) return; setUtangReminderBusy(true);
    try{
      const tx=utangReminder.value; const blob=await reminderPngBlob(tx); const file=new File([blob],`utang-reminder-${tx.date}.png`,{type:'image/png'});
      if(navigator.share && (!navigator.canShare || navigator.canShare({files:[file]}))){ await navigator.share({files:[file],title:'Friendly payment reminder',text:'A friendly payment reminder'}); }
      else { downloadReminderBlob(blob,tx); showToast('Image downloaded. Open it and share through your preferred app.'); }
    }catch(e){ if(!(e instanceof DOMException && e.name==='AbortError')) showErrorToast(e instanceof Error?e.message:'Could not share reminder image.'); }
    finally{ setUtangReminderBusy(false); }
  }
  async function copyUtangReminderText(){
    if(!utangReminder) return;
    try{ await navigator.clipboard.writeText(utangReminderMessage(utangReminder.value,meta.businessName,utangReminderAll ? records.filter(r=>r.value.utang && r.value.utangStatus!=='paid' && digitsOnly(r.value.phone||'')===digitsOnly(utangReminder.value.phone||'')) : null)); showToast('Friendly reminder text copied.'); }
    catch{ showErrorToast('Could not copy text. Your browser may need clipboard permission.'); }
  }
  function exportBackup(){
    const backup={app:'eload-tracker',formatVersion:1,exportedAt:new Date().toISOString(),settings:meta,collections:{transactions:records,customers,daily_reports:dailyReports,favorites,wallet_adjustments:walletAdjustments}};
    const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob); const link=document.createElement('a'); link.href=url; link.download=`eload-tracker-backup-${todayKey()}.json`; document.body.appendChild(link); link.click(); link.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
    showToast('Backup downloaded. Keep it somewhere safe.');
  }
  async function importBackup(file:File){
    setBackupBusy(true);
    try{
      if(!navigator.onLine) throw new Error('Connect to the internet before restoring a backup so existing records can be checked safely.');
      if(file.size>25*1024*1024) throw new Error('Backup file is larger than 25 MB.');
      const backup=JSON.parse(await file.text());
      if(backup?.app!=='eload-tracker'||backup?.formatVersion!==1||!backup.collections||typeof backup.collections!=='object') throw new Error('This is not a supported E-LOAD Tracker backup.');
      const names=['transactions','customers','daily_reports','favorites','wallet_adjustments'];
      for(const name of names){ const rows=backup.collections[name]??[]; if(!Array.isArray(rows)||rows.some((row:any)=>!row||typeof row.id!=='string'||!row.value||typeof row.value!=='object')) throw new Error(`Backup has invalid ${name} data.`); }
      if(!window.confirm('Restore this backup? Existing records with matching IDs will be kept; missing records will be added. Business settings and wallet balances will be replaced from the backup.')) return;
      let added=0,skipped=0;
      for(const name of names){ for(const row of backup.collections[name]){ const result:any=await api('records.create',{collection:name,id:row.id,value:row.value}); if(result.skipped) skipped++; else added++; } }
      if(backup.settings&&typeof backup.settings==='object') await saveMeta({...defaultMeta,...backup.settings,kind:'meta'});
      await reloadRecords();
      showToast(`Backup restored: ${added} records added${skipped?`, ${skipped} existing kept`:''}.`);
    }catch(error){ showErrorToast(error instanceof Error?error.message:'Could not restore this backup.'); }
    finally{setBackupBusy(false); if(backupImportRef.current) backupImportRef.current.value='';}
  }
  async function resolveSyncConflict(conflict:SyncConflictRecord,choice:'use_remote'|'keep_local'){
    try{await api('sync.conflicts.resolve',{id:conflict.id,choice});await reloadRecords();showToast(choice==='keep_local'?'Your offline version was applied.':'The cloud version was kept.');}
    catch(error){showErrorToast(error instanceof Error?error.message:'Could not resolve this sync conflict.');}
  }
  async function copyCustomerStatement(customer:CustomerRecord){
    const phone=digitsOnly(customer.value.phone);
    const customerTxs=records.filter(r=>digitsOnly(r.value.phone||'')===phone).sort((a,b)=>a.value.date.localeCompare(b.value.date)||a.value.createdAt-b.value.createdAt);
    const lines=customerTxs.map(r=>{const t=r.value; const kind=t.type==='E-Load'?`E-Load ${t.network}${t.eloadKind==='promo'?` · ${t.promoName||'Promo'}`:''}`:t.type; const status=t.utang?(t.utangStatus==='paid'?'Utang paid':`Utang unpaid · remaining ${peso(utangRemaining(t))}`):'Paid'; return `${dateLabel(t.date)} ${t.time} — ${kind} · Amount ${peso(t.amount)} · Fee ${peso(t.fee||0)} · ${status}`;});
    const totalAmount=customerTxs.reduce((sum,r)=>sum+r.value.amount,0), totalFees=customerTxs.reduce((sum,r)=>sum+(r.value.fee||0),0), outstanding=customerTxs.reduce((sum,r)=>sum+(r.value.utang&&r.value.utangStatus!=='paid'?utangRemaining(r.value):0),0);
    const text=`${meta.businessName} — Customer statement\n${displayNameOnly(customer.value.name,customer.value.phone)} · ${formatPhone(customer.value.phone)}\n${lines.join('\n')||'No transactions recorded.'}\n\nTotal amount ${peso(totalAmount)} · Fees ${peso(totalFees)} · Outstanding Utang ${peso(outstanding)}`;
    try{await navigator.clipboard.writeText(text);showToast('Customer statement copied. Paste it into a message to share.');}catch{showErrorToast('Could not copy the statement. Your browser may need clipboard permission.');}
  }
  function exportDailyCSV(){
    const rows:any[]=[['Date','Type','Customer','Number','Amount','Fee','Notes','Status']];
    dayTxs.forEach(t=>{ rows.push([t.date, t.type, t.customerName||'', t.phone, String(t.amount), String(t.fee||0), t.notes||'', t.utang ? (t.utangStatus==='paid'?'Paid (Utang)':'Unpaid (Utang)') : 'Paid']); });
    rows.push(['', 'Total Sales', '', '', String(sum(dayTxs.filter(t=>salesTypes.includes(t.type)),t=>t.amount)), '', '', '']);
    rows.push(['', 'Total Profit', '', '', String(sum(dayTxs,t=>txProfit(t))), '', '', '']);
    downloadCSV(`daily-report-${selectedDay}.csv`, rows);
    showToast('Daily report exported.');
  }

  const saveTxRef=useRef(saveTransaction); saveTxRef.current=saveTransaction;
  const saveCustRef=useRef(saveCustomerFromForm); saveCustRef.current=saveCustomerFromForm;
  const openNewRef=useRef(openNew); openNewRef.current=openNew;
  const openEditRef=useRef(openEdit); openEditRef.current=openEdit;
  const openCustomerFormRef=useRef(openCustomerForm); openCustomerFormRef.current=openCustomerForm;

  useEffect(()=>{
    const onKeyDown = (e:KeyboardEvent)=>{
      if(e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const active = document.activeElement as HTMLElement | null;
      const isTyping = !!(active && (active.tagName==='INPUT' || active.tagName==='TEXTAREA' || active.tagName==='SELECT' || active.isContentEditable));
      const isCustomerInput = !!(active && active.getAttribute && active.getAttribute('data-customer-input')==='true');
      const isTextTyping = !!(active && ((active.tagName==='TEXTAREA') || (active.tagName==='INPUT' && (active as HTMLInputElement).type==='text') || active.tagName==='SELECT' || active.isContentEditable));
      const isButton = !!(active && active.tagName==='BUTTON');
      const anySheet = showTx || detail || customerDetail || showCustomerForm || showWalletAction || showEOD || addNameTarget || showHelp || showServices;
      const key = e.key;
      const lower = key.toLowerCase();
      if(showHelp){
        if(key==='Escape' || key==='?' || lower==='h'){ e.preventDefault(); setShowHelp(false); }
        return;
      }
      if(key==='?' || lower==='h'){
        if(isTextTyping || isCustomerInput) return;
        e.preventDefault(); setShowHelp(true); return;
      }
      if(!shortcutsOn && key!=='Escape') return;
      if(key==='Escape'){
        const toastEl=(document.activeElement as HTMLElement|null)?.closest('[data-toast]');
        if(toastEl){ e.preventDefault(); setSaveMsg(''); return; }
        if(showServices){ setShowServices(false); setTab('home'); return; }
        if(confirmDelete) setConfirmDelete(null);
        else if(confirmDeleteCustomer) setConfirmDeleteCustomer(null);
        else if(confirmClear) setConfirmClear(false);
        else if(addNameTarget) setAddNameTarget(null);
        else if(showTx) setShowTx(false);
        else if(detail) setDetail(null);
        else if(customerDetail) setCustomerDetail(null);
        else if(showCustomerForm) setShowCustomerForm(false);
        else if(showWalletAction) setShowWalletAction(null);
        else if(showEOD) setShowEOD(false);
        else if(tab!=='home'){ setTab('home'); setSaveMsg(''); }
        return;
      }
      if((e.ctrlKey || e.metaKey) && key==='Enter' && showTx){ e.preventDefault(); saveTxRef.current(true); return; }
      if((e.ctrlKey || e.metaKey) && key==='Enter' && showCustomerForm){ e.preventDefault(); saveCustRef.current(); return; }
      if(showTx){
        if(key==='Enter' && !isButton){ e.preventDefault(); saveTxRef.current(false); return; }
        const amountMap:Record<string,number>={'a':20,'s':50,'d':100,'f':200,'g':500};
        if(amountMap[lower] && !isCustomerInput && !isTextTyping && !e.ctrlKey){
          e.preventDefault();
          const amt=amountMap[lower];
          setFAmount(amt); setFCustom(''); setFFee(autoFee(fType, amt));
          setSaveMsg(`Amount set to ${peso(amt)} — press Enter to save.`);
          return;
        }
        return;
      }
      if(showCustomerForm){
        if(key==='Enter' && !isButton){ e.preventDefault(); saveCustRef.current(); return; }
        return;
      }
      if(addNameTarget){
        if(key==='Enter' && !isButton){ e.preventDefault(); saveAddNamePopup(); }
        return;
      }
      if(detail){
        if(key==='Enter' && !isButton && !isTyping){ e.preventDefault(); const r=detail; setDetail(null); openEditRef.current(r); return; }
        if(key==='Enter' && isTyping){ return; }
        if(lower==='e' && !isTyping){ e.preventDefault(); const r=detail; setDetail(null); openEditRef.current(r); return; }
        if((key==='Delete' || key==='Backspace') && !isTyping){ e.preventDefault(); setConfirmDelete(detail); return; }
        return;
      }
      if(customerDetail){
        if(key==='Enter' && !isButton){ e.preventDefault(); const c=customerDetail; setCustomerDetail(null); openCustomerFormRef.current(c); return; }
        if(lower==='e' && !isTyping){ e.preventDefault(); const c=customerDetail; setCustomerDetail(null); openCustomerFormRef.current(c); return; }
        if((key==='Delete' || key==='Backspace') && !isTyping){ e.preventDefault(); setConfirmDeleteCustomer(customerDetail); return; }
        return;
      }
      if(showWalletAction || showEOD){ return; }
      if(showServices){ return; }
      // Dashboard recent list: Enter repeats focused recent row, arrows move within it
      const inRecent = !!(active && active.closest && active.closest('[data-recent-list]'));
      if(tab==='home' && inRecent){
        if(key==='ArrowDown' || lower==='j'){ e.preventDefault(); setRecentIndex(i=>Math.min(dashboardRecent.length-1, i+1)); return; }
        if(key==='ArrowUp' || lower==='k'){ e.preventDefault(); setRecentIndex(i=>Math.max(0, i-1)); return; }
        if(key==='Enter'){ e.preventDefault(); const r=dashboardRecent[recentIndex] || dashboardRecent[0]; if(r) repeatTx(r); return; }
      }
      if(tab==='home' && key==='Enter'){
        e.preventDefault(); e.stopPropagation();
        setServicesHighlight(0); setShowServices(true); return;
      }
      // Dashboard Enter ALWAYS opens Services, regardless of focus / typing
      if(tab==='home' && key==='Enter' && !anySheet){
        e.preventDefault(); e.stopPropagation();
        setServicesHighlight(0); setShowServices(true); return;
      }
      if(isTyping) return;
      if(key==='/'){
        e.preventDefault();
        if(tab==='customers'){ customerSearchRef.current?.focus(); }
        else if(tab==='transactions'){ txSearchRef.current?.focus(); }
        else { setTab('transactions'); setTimeout(()=>txSearchRef.current?.focus(), 60); }
        return;
      }
      // Phase 3 quick keys C / X on Dashboard only
      if(tab==='home' && !anySheet && lower==='c'){ e.preventDefault(); openEndDay(); return; }
      if(tab==='home' && !anySheet && lower==='x'){ e.preventDefault(); openEndDay(); return; }
      const navMap:Record<string, typeof tab> = {d:'home', t:'transactions', u:'customers', w:'wallets', r:'report', s:'settings'};
      if(navMap[lower]){ e.preventDefault(); setTab(navMap[lower]); setSaveMsg(''); return; }
      // Utang nav: G for Utang (no conflict)
      if(lower==='g'){ e.preventDefault(); setTab('utang'); setSaveMsg(''); return; }
      const quickMap:Record<string,TxType> = {'1':'E-Load','2':'Cash In','3':'Cash Out','4':'Top-Up'};
      if(quickMap[key]){ e.preventDefault(); openNewRef.current(quickMap[key]); return; }
      if(lower==='f'){
        e.preventDefault();
        if(tab==='transactions'){ const el=filterRef.current?.querySelector<HTMLElement>('button'); el?.focus(); }
        else if(tab==='customers'){ const el=customerFilterRef.current?.querySelector<HTMLElement>('button'); el?.focus(); }
        else { setTab('transactions'); setTimeout(()=>filterRef.current?.querySelector<HTMLElement>('button')?.focus(), 60); }
        return;
      }
      if(lower==='n'){
        e.preventDefault();
        if(tab==='customers') openCustomerFormRef.current(null); else openNewRef.current('E-Load');
        return;
      }
      if(tab==='transactions'){
        if(key==='ArrowDown' || lower==='j'){ e.preventDefault(); if(!filtered.length) return; const idx=filtered.findIndex(r=>r.id===selectedTxId); const next=filtered[Math.min(filtered.length-1, idx<0?0:idx+1)]; setSelectedTxId(next.id); return; }
        if(key==='ArrowUp' || lower==='k'){ e.preventDefault(); if(!filtered.length) return; const idx=filtered.findIndex(r=>r.id===selectedTxId); const next=filtered[Math.max(0, idx<=0?0:idx-1)]; setSelectedTxId(next.id); return; }
        if(key==='Enter'){ e.preventDefault(); const sel=filtered.find(r=>r.id===selectedTxId) || filtered[0]; if(sel){ setSelectedTxId(sel.id); setDetail(sel); } return; }
        if(lower==='e'){ e.preventDefault(); const sel=filtered.find(r=>r.id===selectedTxId) || filtered[0]; if(sel) openEditRef.current(sel); return; }
        if(key==='Delete' || key==='Backspace'){ e.preventDefault(); const sel=filtered.find(r=>r.id===selectedTxId) || filtered[0]; if(sel){ setDetail(sel); setConfirmDelete(sel); } return; }
        return;
      }
      if(tab==='customers'){
        if(key==='ArrowDown' || lower==='j'){ e.preventDefault(); if(!sortedCustomers.length) return; const idx=sortedCustomers.findIndex(c=>c.id===selectedCustomerId); const next=sortedCustomers[Math.min(sortedCustomers.length-1, idx<0?0:idx+1)]; setSelectedCustomerId(next.id); return; }
        if(key==='ArrowUp' || lower==='k'){ e.preventDefault(); if(!sortedCustomers.length) return; const idx=sortedCustomers.findIndex(c=>c.id===selectedCustomerId); const next=sortedCustomers[Math.max(0, idx<=0?0:idx-1)]; setSelectedCustomerId(next.id); return; }
        if(key==='Enter'){ e.preventDefault(); const sel=sortedCustomers.find(c=>c.id===selectedCustomerId) || sortedCustomers[0]; if(sel){ setSelectedCustomerId(sel.id); setCustomerDetail(sel); } return; }
        if(lower==='e'){ e.preventDefault(); const sel=sortedCustomers.find(c=>c.id===selectedCustomerId) || sortedCustomers[0]; if(sel) openCustomerFormRef.current(sel); return; }
        if(key==='Delete' || key==='Backspace'){ e.preventDefault(); const sel=sortedCustomers.find(c=>c.id===selectedCustomerId) || sortedCustomers[0]; if(sel){ setCustomerDetail(sel); setConfirmDeleteCustomer(sel); } return; }
        return;
      }
      if(tab==='home'){
        if(key==='ArrowDown' || lower==='j'){ e.preventDefault(); const idx=last7.findIndex(d=>d.key===selectedDay); if(idx<last7.length-1) setSelectedDay(last7[idx+1].key); return; }
        if(key==='ArrowUp' || lower==='k'){ e.preventDefault(); const idx=last7.findIndex(d=>d.key===selectedDay); if(idx>0) setSelectedDay(last7[idx-1].key); return; }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return ()=> window.removeEventListener('keydown', onKeyDown);
  }, [showTx, detail, customerDetail, showCustomerForm, showWalletAction, showEOD, addNameTarget, confirmDelete, confirmDeleteCustomer, confirmClear, showHelp, shortcutsOn, tab, filtered, sortedCustomers, selectedTxId, selectedCustomerId, fType, fAmount, last7, selectedDay, meta, showServices, dashboardRecent, recentIndex, expectedCash, startingFloat]);

  const reminderPreview = useMemo(()=>utangReminder ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(utangReminderSvg(utangReminder.value,meta.businessName,utangReminderTheme,utangReminderAll ? records.filter(r=>r.value.utang && r.value.utangStatus!=='paid' && digitsOnly(r.value.phone||'')===digitsOnly(utangReminder.value.phone||'')) : null))}` : '',[utangReminder,meta.businessName,records,utangReminderTheme]);

  if(loading) return <main className="min-h-screen grid place-items-center bg-[var(--bg)] px-5 py-10" role="status" aria-live="polite" aria-label={`Loading E-LOAD Tracker, ${loadingProgress}%`}>
    <section className="w-full max-w-sm rounded-[28px] border border-[var(--line)] bg-[var(--surface)] p-7 sm:p-8 text-center shadow-[0_18px_50px_rgba(23,37,28,.09)]">
      <div className="relative mx-auto h-[76px] w-[76px]"><img src={`${import.meta.env.BASE_URL}icons/eload-tracker-192.png?v=3`} alt="" aria-hidden="true" className="h-full w-full rounded-[25px] object-cover shadow-[0_10px_24px_rgba(14,42,71,.2)]"/><span className="absolute -right-1 -top-1 h-4 w-4 rounded-full border-[3px] border-[var(--surface)] bg-[var(--green)] animate-pulse"/></div>
      <p className="mt-5 text-[11px] font-black uppercase tracking-[.18em] text-[var(--muted)]">E-LOAD Tracker</p>
      <h1 className="mt-1 font-display text-2xl font-extrabold">Loading your tindahan…</h1>
      <p className="mt-2 text-sm font-semibold text-[var(--muted)]">Preparing your dashboard and saved records.</p>
      <div className="mt-7 flex items-center justify-between text-xs font-black"><span className="text-[var(--muted)]">Getting things ready</span><span className="tabular-nums text-[var(--green)]">{loadingProgress}%</span></div>
      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-[var(--surface2)]" role="progressbar" aria-label="Loading progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={loadingProgress}><div className="h-full rounded-full bg-[var(--green)] transition-[width] duration-200 ease-out" style={{width:`${loadingProgress}%`}}/></div>
    </section>
  </main>;

  const tabs:{id:typeof tab; label:string; icon:any; key:string}[]=[{id:'home',label:'Dashboard',icon:Home,key:'D'},{id:'transactions',label:'Transactions',icon:ArrowLeftRight,key:'T'},{id:'customers',label:'Customers',icon:Users,key:'U'},{id:'utang',label:'Utang',icon:HandCoins,key:'G'},{id:'wallets',label:'Wallets',icon:Wallet,key:'W'},{id:'report',label:'Report',icon:BarChart3,key:'R'},{id:'settings',label:'Settings',icon:SettingsIcon,key:'S'}];
  const amountShortcuts:{amt:number; key:string}[]=[{amt:20,key:'A'},{amt:50,key:'S'},{amt:100,key:'D'},{amt:200,key:'F'},{amt:500,key:'G'}];
  const diff = round2(actualCash - expectedCash);
  const diffLabel = diff===0 ? 'Exact' : diff<0 ? `Short ${peso(Math.abs(diff))}` : `Over ${peso(diff)}`;
  const diffColor = diff===0 ? 'var(--green)' : diff<0 ? 'var(--red)' : '#2563eb';
  return (
    <div data-safe-area-inset-root style={{boxSizing:'border-box', paddingTop:'var(--safe-area-inset-top)'}} className="min-h-screen bg-[var(--bg)] text-[var(--ink)] overflow-x-clip">
      {saveMsg && <div className="toast-wrap fixed left-0 right-0 z-[70] pointer-events-none px-3 flex justify-center" style={{top:'calc(var(--safe-area-inset-top) + 12px)'}}><div data-toast role="status" aria-live="polite" onKeyDown={(e)=>{ if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); setSaveMsg(''); } }} className="pointer-events-auto flex w-full max-w-[560px] items-center gap-2.5 rounded-full bg-white px-3 py-2.5 shadow-[0_10px_30px_rgba(0,0,0,0.16)] border border-[var(--line)]"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full" style={{background: toastKind==='error' ? '#fef2f2' : '#e6f7ee'}}>{toastKind==='error' ? <AlertTriangle size={18} className="text-[var(--red)]"/> : <CheckCircle2 size={18} className="text-[var(--green)]"/>}</span><p className="min-w-0 flex-1 text-[13px] sm:text-sm font-bold leading-snug break-words">{saveMsg}</p>{toastActionLabel && <button type="button" onClick={()=>{ const fn=toastActionRef.current; setSaveMsg(''); if(fn) fn(); }} className="shrink-0 min-h-[32px] px-3 rounded-full bg-[var(--ink)] text-white text-xs font-black flex items-center gap-1"><Undo2 size={14}/> {toastActionLabel}</button>}<button type="button" onClick={()=>setSaveMsg('')} aria-label="Dismiss notification" className="grid h-7 w-7 shrink-0 place-items-center rounded-full hover:bg-[var(--surface2)]"><X size={16}/></button></div></div>}
      <aside className="desktop-sidebar" aria-label="Desktop navigation">
        <div className="flex items-center gap-2"><img src={`${import.meta.env.BASE_URL}icons/eload-tracker-192.png?v=3`} alt="" aria-hidden="true" className="w-10 h-10 rounded-xl shrink-0 object-cover shadow-sm"/><div className="min-w-0"><p className="font-display font-extrabold leading-tight truncate" style={{fontSize:17}}>E-LOAD Tracker</p><p className="text-[11px] font-black tracking-[0.12em] uppercase text-[var(--muted)]">Loads • Cash • Tracking</p></div></div>
        <nav className="flex flex-col gap-1" aria-label="Sidebar navigation">
          {tabs.map(t=>{ const Icon=t.icon; const active=tab===t.id; return <button key={t.id} onClick={()=>{setTab(t.id); setSaveMsg('');}} className={`sidebar-nav-btn ${active?'active':''}`}><Icon size={18}/>{t.label}{t.id==='utang' && utangOutstanding>0 && <span className="ml-auto text-[11px] font-black bg-[#ede9fe] text-[#6d28d9] px-2 py-0.5 rounded-full">{peso(utangOutstanding)}</span>}</button> })}
        </nav>
        <div className="mt-auto flex flex-col gap-2">
          <div className="relative isolate overflow-hidden rounded-2xl bg-[var(--surface2)] p-3"><svg aria-hidden="true" className="pointer-events-none absolute -right-1 bottom-0 z-0 h-[68px] w-[68px] opacity-70" viewBox="0 0 80 80" fill="none"><defs><linearGradient id="sidebarClay" x1="17" y1="20" x2="62" y2="68" gradientUnits="userSpaceOnUse"><stop stopColor="#c7f4d9"/><stop offset="1" stopColor="#42c783"/></linearGradient><filter id="sidebarClayShadow" x="4" y="5" width="72" height="72" filterUnits="userSpaceOnUse"><feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#087a48" floodOpacity=".22"/></filter></defs><g filter="url(#sidebarClayShadow)"><ellipse cx="38" cy="56" rx="25" ry="10" fill="#26a966"/><path d="M13 45v11c0 6 11 11 25 11s25-5 25-11V45" fill="url(#sidebarClay)"/><ellipse cx="38" cy="45" rx="25" ry="10" fill="#e3f8eb"/><ellipse cx="38" cy="45" rx="16" ry="6" stroke="#70cc96" strokeWidth="2"/><ellipse cx="48" cy="31" rx="19" ry="8" fill="#36b777"/><path d="M29 23v8c0 5 9 8 19 8s19-3 19-8v-8" fill="#9ce7b9"/><ellipse cx="48" cy="23" rx="19" ry="8" fill="#effcf3"/></g></svg><div className="relative z-10"><p className="label">Main Wallet</p><p className="font-display font-extrabold text-xl text-[#0e2a47]">{peso(meta.wallets.maribank)}</p><p className="text-xs font-bold text-[var(--muted)]">Cash {peso(meta.wallets.cash)}</p></div></div>
          <button onClick={openEndDay} className="big-btn bg-[var(--ink)] text-white w-full text-sm">End Day</button>
          <button onClick={()=>setShowHelp(true)} className="big-btn border border-[var(--line)] w-full text-sm" aria-label="Help">? Keyboard Shortcuts</button>
        </div>
      </aside>
      <div className="app-main-wrap"><div className="app-main max-w-[1024px] mx-auto px-3 sm:px-5 pb-28 md:pb-10">
        <header data-safe-area-sticky-top style={{top:'var(--safe-area-inset-top)'}} className="sticky z-30 -mx-3 sm:-mx-5 px-3 sm:px-5 pt-3 pb-3 bg-[var(--bg)]/95 backdrop-blur">
          <div className="mobile-header-row flex flex-col sm:flex-row items-start sm:justify-between gap-3">
            <div className="mobile-header-brand min-w-0 w-full sm:w-auto">
              <div className="flex items-center gap-2 flex-wrap"><img src={`${import.meta.env.BASE_URL}icons/eload-tracker-192.png?v=3`} alt="" aria-hidden="true" className="w-9 h-9 rounded-xl shrink-0 object-cover shadow-sm"/><p className="text-[11px] font-black tracking-[0.14em] uppercase text-[var(--muted)]">E-LOAD Tracker • Main App • Sari-Sari</p>{!isOnline ? <span className="text-[10px] font-black bg-[#fef2f2] text-[var(--red)] px-2 py-1 rounded-full flex items-center gap-1" title="Changes are stored locally and sync when online. If two devices edit the same record while offline, review both copies after reconnecting; online edits are checked for conflicts."><WifiOff size={12}/> Offline{pendingWrites>0?` • ${pendingWrites} queued`:''}</span> : isSyncing||pendingWrites>0 ? <span className="text-[10px] font-black bg-[#fffbeb] text-[#92400e] px-2 py-1 rounded-full">{pendingWrites>0?`Syncing ${pendingWrites} change${pendingWrites===1?'':'s'}…`:'Checking sync…'}</span> : <span className="text-[10px] font-black bg-[#e8f8ef] text-[#087a48] px-2 py-1 rounded-full" title={lastSyncedAt?`Last cloud sync: ${new Date(lastSyncedAt).toLocaleString()}`:'No confirmed sync time on this device yet.'}>Synced{lastSyncedAt?` • ${new Date(lastSyncedAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}`:''}</span>}</div>
              <h1 className="business-title font-display font-extrabold leading-[1.05] mt-1">{meta.businessName}</h1>
              <p className="text-sm text-[var(--muted)] font-semibold flex items-center gap-1 flex-wrap break-words" style={{overflowWrap:'anywhere', wordBreak:'break-word'}}><CalendarDays size={14} className="shrink-0"/>{fullDate(todayKey())}</p>
            </div>
            <div className="mobile-header-wallet shrink-0 text-left sm:text-right w-full sm:w-auto">
              <svg aria-hidden="true" className="mobile-wallet-art pointer-events-none absolute -right-1 bottom-0 z-0 h-[68px] w-[68px] opacity-40" viewBox="0 0 80 80" fill="none"><defs><linearGradient id="headerClay" x1="17" y1="20" x2="62" y2="68" gradientUnits="userSpaceOnUse"><stop stopColor="#c7f4d9"/><stop offset="1" stopColor="#42c783"/></linearGradient><filter id="headerClayShadow" x="4" y="5" width="72" height="72" filterUnits="userSpaceOnUse"><feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#087a48" floodOpacity=".22"/></filter></defs><g filter="url(#headerClayShadow)"><ellipse cx="38" cy="56" rx="25" ry="10" fill="#26a966"/><path d="M13 45v11c0 6 11 11 25 11s25-5 25-11V45" fill="url(#headerClay)"/><ellipse cx="38" cy="45" rx="25" ry="10" fill="#e3f8eb"/><ellipse cx="38" cy="45" rx="16" ry="6" stroke="#70cc96" strokeWidth="2"/><ellipse cx="48" cy="31" rx="19" ry="8" fill="#36b777"/><path d="M29 23v8c0 5 9 8 19 8s19-3 19-8v-8" fill="#9ce7b9"/><ellipse cx="48" cy="23" rx="19" ry="8" fill="#effcf3"/></g></svg>
              <p className="label">Main Wallet</p>
              <p className="font-display font-extrabold text-[22px] sm:text-[26px] text-[#0e2a47]">{peso(meta.wallets.maribank)}</p>
              <p className="text-xs font-bold text-[var(--muted)]">Cash on hand {peso(meta.wallets.cash)}{utangOutstanding>0 ? ` • Utang outstanding ${peso(utangOutstanding)}` : ''}</p>
              <div className="flex gap-1.5 justify-start sm:justify-end mt-1 flex-wrap">
                <button onClick={()=>setShowHelp(true)} className="min-h-[36px] w-9 rounded-full bg-[var(--surface)] border border-[var(--line)] grid place-items-center font-black text-sm" aria-label="Help">?</button>
                <button onClick={openEndDay} className="min-h-[36px] bg-white border border-[var(--line)] text-xs font-black px-3 py-2 rounded-full">End Day</button>
                <button onClick={()=>openNew('E-Load')} className="min-h-[36px] bg-[var(--ink)] text-white text-xs font-black px-3 py-2 rounded-full">+ Quick Sale</button>
              </div>
            </div>
          </div>
          <nav className="top-nav mt-3 flex gap-1.5 overflow-x-auto no-scrollbar" aria-label="Main navigation">
            {tabs.map(t=>{ const Icon=t.icon; const active=tab===t.id; return <button key={t.id} onClick={()=>{setTab(t.id); setSaveMsg('');}} className={`flex items-center gap-1.5 px-3.5 py-2.5 rounded-full font-extrabold text-[13px] sm:text-sm whitespace-nowrap min-h-[44px] ${active?'bg-[var(--ink)] text-white':'bg-[var(--surface)] border border-[var(--line)] text-[var(--muted)]'}`}><Icon size={16}/>{t.label}</button> })}
          </nav>
        </header>

        {apiError && <div className="card p-3 mb-3 flex gap-2 bg-[#fff7ed]"><AlertTriangle className="text-[var(--orange)] shrink-0" size={20}/><p className="text-sm font-bold">{apiError}</p></div>}
        {syncError && <div role="alert" className="card p-3 mb-3 flex gap-2 bg-[#fff7ed]"><AlertTriangle className="text-[var(--orange)] shrink-0" size={20}/><p className="text-sm font-bold">A queued change could not sync: {syncError}. Keep this device’s data and contact support before clearing site storage.</p></div>}
        {syncConflicts.length>0 && <section role="alert" className="card p-4 mb-3 border-2 border-amber-300 bg-[#fffbeb]"><h2 className="font-display font-bold text-lg">Review offline edits ({syncConflicts.length})</h2><p className="text-sm font-semibold mt-1">These records changed on another device before your offline edits synced. Choose which version to keep; the other copy will not be applied. For wallet/settings conflicts, compare both balances and reconcile transactions after choosing.</p><div className="mt-2 space-y-2">{syncConflicts.map(conflict=>{const remote=conflict.value.remoteValue;const local=conflict.value.value;const describe=(value:any)=>value?.wallets?`Main wallet ${peso(value.wallets.maribank||0)} · Cash ${peso(value.wallets.cash||0)}`:value?`${value.type||value.kind||'Record'}${value.date?` • ${value.date}`:''}${typeof value.amount==='number'?` • ${peso(value.amount)}`:''}`:'Record was deleted';return <div key={conflict.id} className="rounded-xl border border-amber-200 bg-white p-3"><p className="font-black text-sm">{conflict.value.collection} · {conflict.value.recordId}</p><p className="text-xs font-semibold text-[var(--muted)] mt-1">Cloud: {describe(remote)}{conflict.value.action==='delete'?' · your offline change was a delete':` · Your offline version: ${describe(local)}`}</p><div className="flex flex-wrap gap-2 mt-2"><button onClick={()=>void resolveSyncConflict(conflict,'use_remote')} className="min-h-[40px] rounded-xl border border-[var(--line)] px-3 text-xs font-black">Keep cloud version</button><button onClick={()=>void resolveSyncConflict(conflict,'keep_local')} className="min-h-[40px] rounded-xl bg-[var(--ink)] px-3 text-xs font-black text-white">Apply my offline change</button></div></div>})}</div></section>}
        {maribankLow && <div className="card p-4 mb-3 flex gap-3 items-start" style={{borderColor:'#fbbf24', background:'#fffbeb'}}><AlertTriangle className="text-[var(--amber)] shrink-0 mt-0.5" size={22}/><div className="flex-1"><p className="font-display font-bold">Main Wallet balance low — {peso(meta.wallets.maribank)}</p><p className="text-sm font-semibold text-[var(--muted)]">Need to top-up via External Provider before the next rush.</p></div><button onClick={()=>openNew('Top-Up')} className="shrink-0 min-h-[44px] px-4 rounded-xl bg-[#00a651] text-white font-black text-sm">Top-Up via External Provider</button></div>}
        {tab==='home' && (
          <main>
            {dayClosed && todayReport && <section className="card p-4 mb-3" style={{borderColor:'#0e9f5f', background:'#e8f8ef'}}><div className="flex justify-between items-start gap-2"><div><p className="text-xs font-black tracking-wide uppercase text-[#007a3d]">Day Closed • {dateLabel(todayKey())}</p><p className="font-display font-bold text-lg mt-1">Closed with {peso(todayReport.value.actualCash)} counted • {todayReport.value.difference===0?'Exact':todayReport.value.difference<0?`Short ${peso(Math.abs(todayReport.value.difference))}`:`Over ${peso(todayReport.value.difference)}`}</p><p className="text-sm font-semibold text-[var(--muted)]">Sales {peso(todayReport.value.sales)} • Profit {peso(todayReport.value.profit)} • Tomorrow float {peso(todayReport.value.tomorrowFloat)}</p></div><button onClick={()=>setTab('report')} className="text-sm font-black text-[var(--green)] shrink-0">View report →</button></div></section>}
            {utangOutstanding>0 && <section className="utang-overview card p-4 mb-3"><div className="flex justify-between items-start gap-2 flex-wrap"><div><p className="label">Utang Outstanding</p><p className="font-display font-extrabold text-2xl">{peso(utangOutstanding)}</p><p className="text-xs font-bold text-[var(--muted)]">{utangList.filter(r=>r.value.utangStatus!=='paid').length} unpaid • Due Today: {utangDueTodayCount} • Overdue: {utangOverdueCount}</p></div><button onClick={()=>setTab('utang')} className="min-h-[44px] px-4 rounded-xl bg-[#7c3aed] text-white font-black text-sm shrink-0">View Utang →</button></div><div className="flex flex-wrap gap-2 mt-3">{utangOverdueCount>0 && <button onClick={()=>{setUtangFilter('Overdue'); setTab('utang');}} className="min-h-[40px] px-3 rounded-full bg-[#fef2f2] border border-red-200 text-[var(--red)] text-xs font-black">{utangOverdueCount} overdue — follow up →</button>}{utangDueTodayCount>0 && <button onClick={()=>{setUtangFilter('Due Today'); setTab('utang');}} className="min-h-[40px] px-3 rounded-full bg-[#fffbeb] border border-amber-200 text-[#92400e] text-xs font-black">Due Today: {utangDueTodayCount} →</button>}{utangDueTodayCount===0 && utangOverdueCount===0 && <span className="text-xs font-bold text-[var(--muted)]">No utang due today. Promise dates are tracked in the Utang tab.</span>}</div>{utangDueTodayList.slice(0,3).map(r=>{ const cust=customerByPhone.get(digitsOnly(r.value.phone||'')); return <button key={r.id} onClick={()=>{setUtangFilter('Due Today'); setTab('utang');}} className="w-full flex justify-between gap-2 mt-2 rounded-xl bg-[var(--surface2)] px-3 py-2 text-left"><span className="font-extrabold text-sm truncate">Due Today: {displayNameOnly(cust?.value.name||r.value.customerName, r.value.phone)}</span><span className="font-black text-sm shrink-0">{peso(utangRemaining(r.value))}</span></button> })}</section>}
            <div className="dashboard-grid"><div className="dash-col dash-col-left">
            <div className="dash-summary-grid grid grid-cols-2 gap-3">
              <div className="card p-4 border-2" style={{borderColor:'#0e2a47'}}><p className="label">Main Wallet Balance</p><p className="font-display font-extrabold mt-1 text-[#0e2a47]" style={{fontSize:'clamp(26px,4vw,34px)'}}>{peso(meta.wallets.maribank)}</p><p className="text-xs font-bold text-[var(--muted)]">Main wallet for all sales</p>{maribankLow && <p className="text-[11px] font-black text-[#92400e] bg-[#fffbeb] px-2 py-1 rounded-full mt-2 inline-block">Main Wallet low - top up soon</p>}</div>
              <div className="card p-4"><p className="label">Cash on Hand</p><p className="font-display font-extrabold mt-1" style={{fontSize:'clamp(26px,4vw,34px)'}}>{peso(meta.wallets.cash)}</p><p className="text-xs font-bold text-[var(--muted)]">Ready for cash out • Float {peso(startingFloat)}</p></div>
              <div className="card p-4"><p className="label">Today&apos;s Profit</p><p className="font-display font-extrabold mt-1 text-[var(--green)]" style={{fontSize:'clamp(26px,4vw,34px)'}}>{peso(todayProfit)}</p><p className="text-xs font-bold text-[var(--muted)]">After External Provider top-up fees</p></div>
              <div className="card p-4"><p className="label">Today&apos;s Sales</p><p className="font-display font-extrabold mt-1" style={{fontSize:'clamp(26px,4vw,34px)'}}>{peso(todaySales)}</p><p className="text-xs font-bold text-[var(--muted)]">{todayTxs.filter(t=>salesTypes.includes(t.type)).length} transactions today</p></div>
            </div>
            <div className="card relative isolate overflow-hidden p-4 mt-3 flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between" style={{background:'#e8f8ef'}}>
              <svg aria-hidden="true" className="eload-topup-art pointer-events-none absolute -right-2 -top-5 z-0 h-40 w-40 opacity-40 sm:right-4 sm:top-1 sm:h-36 sm:w-36" viewBox="0 0 180 180" fill="none">
                <defs>
                  <linearGradient id="clayPhone" x1="68" y1="20" x2="132" y2="150" gradientUnits="userSpaceOnUse"><stop stopColor="#fff"/><stop offset="1" stopColor="#c4f3d9"/></linearGradient>
                  <linearGradient id="clayCoin" x1="36" y1="113" x2="112" y2="166" gradientUnits="userSpaceOnUse"><stop stopColor="#a8edc5"/><stop offset="1" stopColor="#4bc889"/></linearGradient>
                  <filter id="clayShadow" x="8" y="8" width="164" height="172" colorInterpolationFilters="sRGB" filterUnits="userSpaceOnUse"><feDropShadow dx="0" dy="7" stdDeviation="6" floodColor="#087a48" floodOpacity=".2"/></filter>
                </defs>
                <g filter="url(#clayShadow)">
                  <ellipse cx="71" cy="145" rx="39" ry="15" fill="#35b977"/><path d="M32 132v13c0 8 17 15 39 15s39-7 39-15v-13" fill="url(#clayCoin)"/><ellipse cx="71" cy="132" rx="39" ry="15" fill="#c7f4d9"/><ellipse cx="71" cy="132" rx="26" ry="9" stroke="#67ce96" strokeWidth="3"/>
                  <ellipse cx="113" cy="151" rx="28" ry="11" fill="#2bad6a"/><path d="M85 140v11c0 6 13 11 28 11s28-5 28-11v-11" fill="#75d9a1"/><ellipse cx="113" cy="140" rx="28" ry="11" fill="#c4f3d9"/>
                  <g transform="rotate(10 101 74)"><rect x="67" y="22" width="62" height="105" rx="18" fill="url(#clayPhone)" stroke="#fff" strokeWidth="4"/><rect x="74" y="37" width="48" height="70" rx="11" fill="#e3f8eb"/><rect x="88" y="29" width="20" height="3" rx="1.5" fill="#8bcda7"/><circle cx="98" cy="116" r="4" fill="#70bd8d"/><circle cx="98" cy="70" r="18" fill="#05a85b"/><path d="m90 70 6 6 11-13" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/></g>
                </g>
              </svg>
              <div className="relative z-10 min-w-0"><p className="font-display font-bold text-lg text-[#007a3d]">External Provider top-ups this week: {peso(weekTopUp)}</p><p className="text-sm font-semibold text-[var(--muted)]">External Provider is only a top-up source — not a customer wallet.</p></div>
              <button onClick={()=>openNew('Top-Up')} className="big-btn relative z-10 bg-[#00a651] text-white px-5"><RefreshCw size={18}/> Top-Up via External Provider</button>
            </div>
            <section className="card p-4 sm:p-5 mt-3">
              <h2 className="font-display font-bold text-xl">Wallets + Float</h2>
              <p className="text-sm font-semibold text-[var(--muted)]">Starting float today: <b className="text-[var(--ink)]">{peso(startingFloat)}</b> • Expected cash {peso(expectedCash)}</p>
              {maribankLow && <p className="text-[11px] font-black text-[#92400e] bg-[#fffbeb] border border-[#fbbf24] px-2.5 py-1.5 rounded-full mt-2 inline-block">Main Wallet low - top up soon</p>}
              <div className="space-y-2.5 mt-3">{walletDefs.map(w=><button key={w.key} onClick={()=>setTab('wallets')} className="w-full flex justify-between items-center p-3 rounded-2xl bg-[var(--surface2)] text-left"><span><span className="block font-extrabold text-sm">{w.label}</span><span className="text-xs font-bold text-[var(--muted)]">{todayWalletMoves[w.key]?`${todayWalletMoves[w.key]>0?'+':''}${peso(todayWalletMoves[w.key])} today`:'No movement today'}</span></span><span className="font-display font-extrabold" style={{color:w.color}}>{peso(meta.wallets[w.key])}</span></button>)}</div>
              <button onClick={()=>openNew('Top-Up')} className="w-full flex justify-between items-center p-3 rounded-2xl text-left mt-2.5" style={{background:'#e8f8ef'}}><span><span className="block font-extrabold text-sm text-[#007a3d]">External Provider — Top-Up Source Only</span><span className="text-xs font-bold text-[var(--muted)]">Not a customer wallet • {peso(weekTopUp)} topped up this week</span></span><span className="font-display font-extrabold text-[#00a651]">Top-Up →</span></button>
              <p className="text-xs font-bold text-[var(--muted)] mt-3">Total across Main Wallet + Cash: <b className="text-[var(--ink)]">{peso(totalWallet)}</b></p>
            </section>
            </div><div className="dash-col dash-col-middle">

            <section className="card p-4 sm:p-5 mt-3">
              <button onClick={()=>setFavOpen(v=>!v)} className="w-full flex justify-between items-center text-left"><span><span className="font-display font-bold text-xl flex items-center gap-2"><Star size={20} className="text-[var(--amber)]"/> Favorites — one-tap repeat</span><span className="block text-sm text-[var(--muted)] font-semibold">Tap a chip to pre-fill a sale for that customer.</span></span><ChevronDown size={20} className={`shrink-0 transition-transform ${favOpen?'rotate-180':''}`}/></button>
              {favOpen && (favorites.length===0 ? <p className="text-sm font-bold text-[var(--muted)] mt-3">No favorites yet. Open a transaction and tap the star to save it here.</p> : <div className="favorites-scroll flex flex-wrap gap-2 mt-3">{favorites.slice(0,5).map(f=>{ const cust=customerByPhone.get(digitsOnly(f.value.phone)); return <button key={f.id} onClick={()=>openNew(f.value.type, cust||null, {amount:f.value.amount, network:f.value.network})} className="min-h-[44px] px-3.5 rounded-full bg-[var(--green-soft)] border border-[var(--line)] font-black text-[13px] text-left">{displayNameOnly(f.value.name, f.value.phone)} - {peso(f.value.amount)} {f.value.type==='E-Load'?f.value.network:f.value.type}</button> })}</div>)}
            </section>

            <section className="card p-4 sm:p-5 mt-3">
              <div className="flex justify-between items-start gap-2"><div><h2 className="font-display font-bold text-xl flex items-center gap-2"><Crown size={20} className="text-[var(--amber)]"/> Top Suki this week</h2><p className="text-sm text-[var(--muted)] font-semibold">Your most frequent customers — tap to transact again fast.</p></div><button onClick={()=>setTab('customers')} className="text-sm font-black text-[var(--green)] shrink-0">All customers →</button></div>
              {topSuki.length===0 ? <p className="text-sm font-bold text-[var(--muted)] mt-3">No customer transactions this week yet. Save a sale with a name or number and your suki will appear here.</p> : <div className="top-suki-grid mt-3">{topSuki.map((s,i)=>{ const rec=customerByPhone.get(s.phone); return <div key={s.phone} className="top-suki-card rounded-2xl bg-[var(--surface2)] p-3"><div className="flex items-center gap-2"><span className="w-11 h-11 rounded-full bg-[#0e2a47] text-white grid place-items-center font-black shrink-0">{displayInitials(s.name, s.phone)}</span><div className="min-w-0"><p className="font-extrabold truncate">#{i+1} {displayNameOnly(s.name, s.phone)}</p><p className="text-xs font-bold text-[var(--muted)]">{isRealName(s.name, s.phone) ? `${formatPhone(s.phone)} • ` : ''}{s.count} transactions • {peso(s.amount)}</p></div></div><div className="top-suki-actions grid grid-cols-3 gap-1.5 mt-3"><button onClick={()=>openNew('E-Load', rec||null)} className="min-h-[40px] rounded-lg bg-[var(--green)] text-white text-[11px] font-black">E-Load</button><button onClick={()=>openNew('Cash In', rec||null)} className="min-h-[40px] rounded-lg bg-[#2563eb] text-white text-[11px] font-black">Cash In</button><button onClick={()=>openNew('Cash Out', rec||null)} className="min-h-[40px] rounded-lg bg-[var(--purple)] text-white text-[11px] font-black">Cash Out</button></div></div> })}</div>}
            </section>

            <section className="card p-4 sm:p-5 mt-3">
              <h2 className="font-display font-bold text-xl">Today&apos;s breakdown — all via Main Wallet</h2>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
                <div className="rounded-2xl bg-[var(--surface2)] p-4"><div className="flex items-center gap-2 text-[var(--blue)] font-black text-sm"><Zap size={18}/> E-Load Sales</div><p className="font-display font-extrabold text-2xl mt-2">{eloadToday.length} sales • {peso(sum(eloadToday,t=>t.amount))}</p><p className="text-sm font-bold text-[var(--green)]">Profit {peso(sum(eloadToday,t=>txProfit(t)))}</p></div>
                <div className="rounded-2xl bg-[var(--surface2)] p-4"><div className="flex items-center gap-2 text-[#2563eb] font-black text-sm"><ArrowDownToLine size={18}/> Cash In</div><p className="font-display font-extrabold text-2xl mt-2">{cashInToday.length} • {peso(sum(cashInToday,t=>t.amount))}</p><p className="text-sm font-bold text-[var(--green)]">Fees {peso(sum(cashInToday,t=>t.fee))}</p></div>
                <div className="rounded-2xl bg-[var(--surface2)] p-4"><div className="flex items-center gap-2 text-[var(--purple)] font-black text-sm"><ArrowUpFromLine size={18}/> Cash Out</div><p className="font-display font-extrabold text-2xl mt-2">{cashOutToday.length} • {peso(sum(cashOutToday,t=>t.amount))}</p><p className="text-sm font-bold text-[var(--green)]">Fees {peso(sum(cashOutToday,t=>t.fee))}</p></div>
                <div className="rounded-2xl p-4" style={{background:'#e8f8ef'}}><div className="flex items-center gap-2 text-[#007a3d] font-black text-sm"><RefreshCw size={18}/> External Provider Top-Ups</div><p className="font-display font-extrabold text-2xl mt-2">{topUpToday.length} • {peso(sum(topUpToday,t=>t.amount))}</p><p className="text-sm font-bold text-[var(--muted)]">Fees paid {peso(sum(topUpToday,t=>t.fee))}</p></div>
              </div>
              <div className="quick-actions-grid grid grid-cols-2 gap-2 mt-3">
                <button onClick={()=>openNew('E-Load')} aria-label="E-Load Sale" className="big-btn bg-[var(--green)] text-white"><Smartphone size={20}/> E-Load Sale</button>
                <button onClick={()=>openNew('Cash In')} aria-label="Cash In" className="big-btn bg-[#2563eb] text-white"><ArrowDownToLine size={20}/> Cash In</button>
                <button onClick={()=>openNew('Cash Out')} aria-label="Cash Out" className="big-btn bg-[var(--purple)] text-white"><ArrowUpFromLine size={20}/> Cash Out</button>
                <button onClick={()=>openNew('Top-Up')} aria-label="Top-Up via External Provider" className="big-btn bg-[#00a651] text-white ring-2 ring-[#00a651] ring-offset-2 ring-offset-[var(--surface)]"><RefreshCw size={20}/> Top-Up via External Provider</button>
              </div>
            </section>

            </div><div className="dash-col dash-col-right">
            <div className="grid gap-3 mt-3">
              <section className="card p-4 sm:p-5">
                <div className="flex justify-between items-start gap-2"><div><h2 className="font-display font-bold text-xl">Last 7 days</h2><p className="text-sm text-[var(--muted)] font-semibold">Tap a bar to see that day&apos;s detail.</p></div><span className="text-xs font-black bg-[var(--green-soft)] text-[var(--green)] px-2.5 py-1.5 rounded-full">Sales vs Profit</span></div>
                <div className="flex items-end justify-between gap-2 sm:gap-3 h-[170px] mt-4 pt-2">
                  {last7.map(d=>{ const active=selectedDay===d.key; return <button key={d.key} onClick={()=>setSelectedDay(d.key)} className={`flex-1 flex flex-col items-center justify-end gap-1 min-w-0 rounded-xl p-1 ${active?'bg-[var(--green-soft)]':''}`} aria-label={`Show ${dateLabel(d.key)} sales ${peso(d.sales)}`}>
                    <span className="text-[11px] font-black text-[var(--green)]">{d.profit>0?peso(d.profit):''}</span>
                    <div className="w-full max-w-[44px] rounded-t-lg bg-[var(--green)]" style={{height:Math.max(8, d.sales/maxSales*110)}} />
                    <span className="text-[11px] font-black">{d.label}</span><span className="text-[10px] font-bold text-[var(--muted)]">{d.count} tx</span>
                  </button> })}
                </div>
                <div className="mt-4 rounded-2xl bg-[var(--surface2)] p-3 flex flex-wrap justify-between gap-2"><div><p className="label">Selected: {dateLabel(selectedDay)}</p><p className="font-display font-bold text-lg">{peso(sum(dayTxs.filter(t=>salesTypes.includes(t.type)),t=>t.amount))} sales • {peso(sum(dayTxs,t=>txProfit(t)))} profit • {dayTxs.filter(t=>salesTypes.includes(t.type)).length} transactions</p></div><button onClick={()=>{setTab('transactions'); setFilter('All');}} className="font-black text-[var(--green)] text-sm flex items-center gap-1">View day <ChevronRight size={16}/></button></div>
              </section>
            </div>

            <section className="card p-4 sm:p-5 mt-3">
              <button onClick={()=>setRecentOpen(v=>!v)} className="w-full flex justify-between items-center text-left"><span><span className="font-display font-bold text-xl">Recent transactions</span><span className="block text-sm font-semibold text-[var(--muted)]">Arrow Up/Down + Enter repeats • or tap Repeat</span></span><ChevronDown size={20} className={`shrink-0 transition-transform ${recentOpen?'rotate-180':''}`}/></button>
              {recentOpen && <><div className="relative mt-3"><Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted)]" size={18}/><input value={dashboardSearch} onChange={e=>setDashboardSearch(e.target.value)} placeholder="Search everything — name, number, amount, date, notes…" className="field pl-10" aria-label="Search everything on Dashboard"/></div>
              <div data-recent-list className="divide-y divide-[var(--line)] mt-1">{dashboardRecent.map((r,i)=><div key={r.id} className={i===recentIndex?'ring-2 ring-inset ring-[var(--green)] rounded-xl':''}><TxRow r={r} customers={customerByPhone} selected={i===recentIndex} onClick={()=>{setRecentIndex(i); setDetail(r);}} onAddName={(p)=>openAddName(p)} onRepeat={()=>repeatTx(r)} onToggleFavorite={()=>toggleFavoriteForTx(r)} isFavorite={favorites.some(f=>digitsOnly(f.value.phone)===digitsOnly(r.value.phone) && f.value.amount===r.value.amount && f.value.type===r.value.type)} /></div>)}{dashboardRecent.length===0 && <p className="py-6 text-center font-bold text-[var(--muted)]">No transactions yet. Tap + E-Load Sale to add your first one.</p>}</div></>}
            </section>
            <section className="card p-4 sm:p-5 mt-3" style={{background:'#e8f8ef'}}><h2 className="font-display font-bold text-xl text-[#007a3d]">End Day Summary</h2><p className="text-sm font-semibold text-[var(--muted)]">Expected cash {peso(expectedCash)} • Float tomorrow {peso(tomorrowFloat || expectedCash)} • Profit today {peso(todayProfit)}</p><p className="text-sm font-bold mt-1">Due Today: {utangDueTodayCount} • Overdue: {utangOverdueCount} • Outstanding {peso(utangOutstanding)}</p><button onClick={openEndDay} className="big-btn bg-[var(--ink)] text-white w-full mt-3">End Day — Cash Count + Float</button></section>
            </div></div>
          </main>
        )}

        {tab==='transactions' && (
          <main>
            <div className="card p-4">
              <div className="relative"><Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted)]" size={18}/><input ref={txSearchRef} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search customer name, Main Wallet, External Provider, phone, note, amount…" className="field pl-10" aria-label="Search transactions"/></div>
              <div ref={filterRef} className="flex gap-2 mt-3 overflow-x-auto no-scrollbar">{(['All','E-Load','Cash In','Cash Out','Top-Up'] as const).map(f=><button key={f} onClick={()=>setFilter(f)} onKeyDown={(e)=>{ if(e.key==='ArrowRight'||e.key==='ArrowLeft'){ e.preventDefault(); const opts:(typeof filter)[]=['All','E-Load','Cash In','Cash Out','Top-Up']; const i=opts.indexOf(filter); const n=e.key==='ArrowRight'?(i+1)%opts.length:(i-1+opts.length)%opts.length; setFilter(opts[n]); } }} className={`chip shrink-0 ${filter===f?'active':''}`}>{f==='Top-Up'?'Top-Up via External Provider':f}</button>)}</div>
            </div>
            {undoInfo && <div className="card p-3 mt-3 flex justify-between items-center gap-2 bg-[var(--surface)]"><p className="text-sm font-bold">Transaction deleted — wallets reversed.</p><button onClick={undoDelete} className="min-h-[40px] px-4 rounded-xl bg-[var(--ink)] text-white font-black text-sm flex items-center gap-1.5"><Undo2 size={16}/> Undo</button></div>}
            <div className="mt-3">
              {filtered.length===0 ? <div className="card p-10 text-center"><p className="font-display font-bold text-xl">No transactions found</p><p className="text-sm font-semibold text-[var(--muted)] mt-1">Try a different search or filter, or add a new transaction.</p><button onClick={()=>openNew('E-Load')} className="big-btn bg-[var(--green)] text-white px-5 mt-4 mx-auto">+ Add Transaction</button></div> : <div className="tx-table-wrap"><table className="tx-table"><thead><tr><th>Date</th><th>Customer</th><th>Type</th><th style={{textAlign:'right'}}>Amount</th><th style={{textAlign:'right'}}>Fee</th><th style={{textAlign:'right'}}>Profit</th><th>Status</th><th style={{textAlign:'right'}}>Actions</th></tr></thead><tbody>{filtered.map(r=>{ const v=r.value; const cust=customerByPhone.get(digitsOnly(v.phone||'')); const hasName=cust ? isRealName(cust.value.name, v.phone) : isRealName(v.customerName, v.phone); const isFav=favorites.some(f=>digitsOnly(f.value.phone)===digitsOnly(v.phone) && f.value.amount===v.amount && f.value.type===v.type); const typeBg=v.type==='E-Load'?'#e0f2fe':v.type==='Cash In'?'#dbeafe':v.type==='Cash Out'?'#ede9fe':'#e8f8ef'; const typeColor=v.type==='E-Load'?'#0369a1':v.type==='Cash In'?'#1d4ed8':v.type==='Cash Out'?'#6d28d9':'#007a3d'; return <tr key={r.id} onClick={()=>{setSelectedTxId(r.id); setDetail(r);}} className={r.id===selectedTxId?'selected':''} style={r.id===selectedTxId?{background:'var(--green-soft)', boxShadow:'inset 0 0 0 2px var(--green)'}:undefined}><td data-label="date"><span className="font-extrabold">{v.date===todayKey()?'Today':dateLabel(v.date)}</span><span className="block text-xs text-[var(--muted)] font-bold">{v.time}</span></td><td data-label="customer"><span className="block truncate">{v.type==='Top-Up' ? (hasName?displayNamePhone(cust?.value.name||v.customerName, v.phone): v.phone?formatPhone(v.phone):'External Provider → Main Wallet') : hasName?displayNamePhone(cust?.value.name||v.customerName, v.phone): v.phone?formatPhone(v.phone):'No customer'}</span><span className="block text-xs text-[var(--muted)] truncate">{v.notes||v.payment}</span></td><td data-label="type"><span className="tx-type-pill" style={{background:typeBg,color:typeColor}}>{v.type==='Top-Up'?'Top-Up • External Provider':v.type==='E-Load'?`E-Load • ${v.network}`:`${v.type} • Main Wallet`}</span></td><td data-label="amount" style={{textAlign:'right'}}><span className="font-display font-extrabold">{peso(v.amount)}</span></td><td data-label="fee" style={{textAlign:'right'}}>{peso(v.fee||0)}</td><td data-label="profit" style={{textAlign:'right'}}><span className="text-[var(--green)] font-black">{txProfit(v)<0?'−'+peso(Math.abs(txProfit(v))):'+'+peso(txProfit(v))}</span></td><td data-label="status">{v.utang ? <span className="tx-status-pill" style={{background:v.utangStatus==='paid'?'var(--green-soft)':'#fef3c7', color:v.utangStatus==='paid'?'var(--green)':'#92400e'}}>{v.utangStatus==='paid'?'Utang Paid':`${utangPromiseLabel(v)} • ${peso(utangRemaining(v))}`}</span> : <span className="tx-status-pill" style={{background:'var(--green-soft)', color:'var(--green)'}}>Paid</span>}</td><td data-label="actions"><span className="tx-row-actions"><button type="button" className="tx-mini-btn" onClick={(e)=>{e.stopPropagation(); toggleFavoriteForTx(r);}} aria-label={isFav?'Remove from favorites':'Add to favorites'}><Star size={13} fill={isFav?'currentColor':'none'}/> {isFav?'Favorited':'Favorite'}</button><button type="button" className="tx-mini-btn" onClick={(e)=>{e.stopPropagation(); repeatTx(r);}}>Repeat</button>{!hasName && v.phone && <button type="button" className="tx-mini-btn" onClick={(e)=>{e.stopPropagation(); openAddName(v.phone);}}>+ Add Name</button>}</span></td></tr> })}</tbody></table></div>}
            </div>
            <div className="card p-4 mt-3 flex flex-wrap justify-between gap-2"><span className="font-bold">Showing {filtered.length} transactions</span><span className="font-black">Daily total (today): <span className="text-[var(--green)]">{peso(todaySales)} sales • {peso(todayProfit)} profit</span></span></div>
          </main>
        )}

        {tab==='customers' && (
          <main>
            <div className="card p-4">
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1"><Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted)]" size={18}/><input ref={customerSearchRef} value={customerSearch} onChange={e=>setCustomerSearch(e.target.value)} placeholder="Search by name or phone number…" className="field pl-10" aria-label="Search customers"/></div>
                <button onClick={()=>openCustomerForm(null)} className="big-btn bg-[var(--green)] text-white px-5 shrink-0"><UserPlus size={19}/> Add Customer</button>
              </div>
              <div ref={customerFilterRef} className="flex gap-2 mt-3 overflow-x-auto no-scrollbar">{(['Recent','A-Z','Most Frequent'] as const).map(s=><button key={s} onClick={()=>setCustomerSort(s)} className={`chip shrink-0 ${customerSort===s?'active':''}`}>{s==='Recent'?'Recent':s==='A-Z'?'A–Z':'Most Frequent'}</button>)}<span className="text-xs font-bold text-[var(--muted)] self-center ml-1">{sortedCustomers.length} customers • {customers.length} saved</span></div>
              <div className="flex gap-2 mt-2 overflow-x-auto no-scrollbar">{(['All','No Name Yet','With Name'] as const).map(s=><button key={s} onClick={()=>setCustomerNameFilter(s)} className={`chip shrink-0 ${customerNameFilter===s?'active':''}`}>{s}</button>)}</div>
            </div>
            <div className="mt-3 space-y-2">
              {sortedCustomers.map(c=>{ const st=customerStats.get(digitsOnly(c.value.phone))||{count:0,amount:0,fees:0,lastDate:'',lastTx:null}; const suki=st.count>=5; const hasName=isRealName(c.value.name, c.value.phone); const sel=c.id===selectedCustomerId; const isFav=favorites.some(f=>digitsOnly(f.value.phone)===digitsOnly(c.value.phone)); return <div key={c.id} ref={sel?selectedRowRef as any:undefined} onClick={()=>{setSelectedCustomerId(c.id); setCustomerDetail(c);}} className={`card w-full p-4 flex items-center gap-3 text-left cursor-pointer ${sel?'ring-2 ring-[var(--green)] bg-[var(--green-soft)]':'hover:bg-[var(--surface2)]'}`} role="button" tabIndex={0} onKeyDown={(e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); setCustomerDetail(c); } }}>
                <span className="w-12 h-12 rounded-full bg-[#0e2a47] text-white grid place-items-center font-black shrink-0 text-[15px]">{displayInitials(c.value.name, c.value.phone)}</span>
                <span className="flex-1 min-w-0"><span className="flex items-center gap-2 flex-wrap"><span className="font-extrabold truncate">{displayNameOnly(c.value.name, c.value.phone)}</span>{suki && <span className="text-[10px] font-black bg-[#fef3c7] text-[#92400e] px-2 py-0.5 rounded-full flex items-center gap-1"><Crown size={11}/> Suki</span>}</span>{!hasName && <span className="text-[10px] font-black bg-[#fff7ed] text-[#ea580c] px-2 py-0.5 rounded-full">No name yet</span>}<span className="block text-sm font-bold text-[var(--muted)]">{hasName ? formatPhone(c.value.phone) : ''}{c.value.notes?`${hasName?' • ':''}${c.value.notes}`:''}</span><span className="block text-xs font-bold text-[var(--muted)]">{st.count>0?`Last: ${dateLabel(st.lastDate)} • ${st.lastTx?`${peso(st.lastTx.amount)} ${st.lastTx.type}`:''} • ${daysAgoLabel(st.lastDate)}`:'No transactions yet'}</span></span>
                <button type="button" aria-label={isFav?'Remove from favorites':'Add to favorites'} onClick={(e)=>{e.stopPropagation(); toggleFavoriteForCustomer(c);}} className={`shrink-0 min-h-[40px] w-10 grid place-items-center rounded-full ${isFav?'bg-[#fef3c7] text-[#92400e]':'bg-[var(--surface2)] text-[var(--muted)]'}`}><Star size={18} fill={isFav?'currentColor':'none'}/></button>
                {!hasName && <button type="button" onClick={(e)=>{e.stopPropagation(); openAddName(c.value.phone);}} className="shrink-0 min-h-[40px] px-3 rounded-full bg-[#fff7ed] border border-[#fdba74] text-[#ea580c] text-xs font-black">+ Add Name</button>}
                <span className="text-right shrink-0"><span className="block font-display font-extrabold">{st.count} tx</span><span className="block text-xs font-black text-[var(--green)]">{peso(st.amount)} total</span></span>
                <ChevronRight size={18} className="text-[var(--muted)] shrink-0"/>
              </div> })}
              {sortedCustomers.length===0 && <div className="card p-10 text-center"><Users size={36} className="mx-auto text-[var(--muted)]"/><p className="font-display font-bold text-xl mt-2">No customers found</p><p className="text-sm font-semibold text-[var(--muted)] mt-1">Add a customer, or type a name + number in any sale form — it saves automatically.</p><button onClick={()=>openCustomerForm(null)} className="big-btn bg-[var(--green)] text-white px-5 mt-4 mx-auto"><UserPlus size={19}/> Add Customer</button></div>}
            </div>
            <p className="text-xs font-bold text-[var(--muted)] mt-3 text-center">Deleting a customer keeps past transactions. They will show as “Deleted Customer”.</p>
          </main>
        )}

        {tab==='utang' && (
          <main>
            <section className="card p-4 sm:p-5">
              <div className="flex justify-between items-start gap-2"><div><h2 className="font-display font-bold text-xl flex items-center gap-2"><HandCoins size={22}/> Utang / Pay Later</h2><p className="text-sm font-semibold text-[var(--muted)]">Unpaid sales don&apos;t move wallets until marked paid.</p></div><span className="text-sm font-black bg-[#ede9fe] text-[#6d28d9] px-3 py-1.5 rounded-full shrink-0">Outstanding {peso(utangOutstanding)}</span></div>
              <div className="flex gap-2 mt-3 overflow-x-auto no-scrollbar">{(['All','Unpaid','Paid','Due Today','Overdue','Due This Week'] as const).map(s=><button key={s} onClick={()=>setUtangFilter(s)} className={`chip shrink-0 ${utangFilter===s?'active':''}`}>{s}</button>)}</div>
              <div className="grid grid-cols-3 gap-2 mt-3"><Stat label="Unpaid" v={peso(utangOutstanding)}/><Stat label="Due Today" v={String(utangDueTodayCount)}/><Stat label="Overdue" v={String(utangOverdueCount)}/></div>
              <p className="text-xs font-bold text-[var(--muted)] mt-2">Sorted: Overdue first, then Due Today, then Due Soonest, then No date. Paid total: {peso(sum(utangList.filter(r=>r.value.utangStatus==='paid').map(r=>r.value),t=>t.amount))}</p>
            </section>
            <div className="mt-3 space-y-2">
              {utangFiltered.map(r=>{ const cust=customerByPhone.get(digitsOnly(r.value.phone||'')); const paid=r.value.utangStatus==='paid'; const pStatus=utangPromiseStatus(r.value); const pillClass = pStatus==='paid'?'bg-[var(--green-soft)] text-[var(--green)]': pStatus==='overdue'?'bg-[#fef2f2] text-[var(--red)]': pStatus==='due-today'?'bg-[#fffbeb] text-[#92400e]': pStatus==='due-soon'?'bg-[#eff6ff] text-[#1d4ed8]':'bg-[var(--surface2)] text-[var(--muted)]'; return <div key={r.id} className="card p-4"><div className="flex items-center gap-3"><span className="w-11 h-11 rounded-full bg-[#0e2a47] text-white grid place-items-center font-black shrink-0 text-[13px]">{displayInitials(cust?.value.name||r.value.customerName, r.value.phone)}</span><span className="flex-1 min-w-0"><span className="block font-extrabold truncate">{displayNameOnly(cust?.value.name||r.value.customerName, r.value.phone)}</span><span className="block text-xs font-bold text-[var(--muted)]">{r.value.type} • Borrowed {dateLabel(r.value.date)} • {formatPhone(r.value.phone)}</span><span className="block text-xs font-bold text-[var(--muted)]">Promise to Pay: {utangPromiseDateLabel(r.value)}{!paid && (r.value.paidAmount||0)>0 ? ` • Paid ${peso(r.value.paidAmount||0)} • Remaining ${peso(utangRemaining(r.value))}` : ''}</span></span><span className={`text-[10px] font-black px-2.5 py-1 rounded-full shrink-0 ${pillClass}`}>{utangPromiseLabel(r.value)}</span><span className="font-display font-extrabold shrink-0">{peso(paid?r.value.amount:utangRemaining(r.value))}</span></div><div className="flex gap-2 mt-3 flex-wrap">{!paid && <><button onClick={()=>{setDetail(r); setShowPartial(false);}} className="min-h-[40px] px-3 rounded-xl border border-[var(--line)] font-black text-xs">View / Partial</button><button onClick={()=>{const rr=r; setDetail(null); openEdit(rr);}} className="min-h-[40px] px-3 rounded-xl border border-[var(--line)] font-black text-xs">Edit Promise Date</button><button onClick={()=>markUtangPaid(r)} disabled={saving} className="min-h-[40px] px-3 rounded-xl bg-[var(--green)] text-white font-black text-xs">Mark Paid</button></>}{paid && <button onClick={()=>setDetail(r)} className="min-h-[40px] px-3 rounded-xl border border-[var(--line)] font-black text-xs">View</button>}</div></div> })}
              {utangFiltered.length===0 && <div className="card p-10 text-center"><HandCoins size={36} className="mx-auto text-[var(--muted)]"/><p className="font-display font-bold text-xl mt-2">No utang here</p><p className="text-sm font-semibold text-[var(--muted)] mt-1">Turn on “Utang / Pay Later” when saving a sale to add it here.</p><button onClick={()=>openNew('E-Load')} className="big-btn bg-[var(--green)] text-white px-5 mt-4 mx-auto">+ New Sale</button></div>}
            </div>
          </main>
        )}

        {tab==='wallets' && (
          <main>
            <div className="grid sm:grid-cols-2 gap-3">
              {walletDefs.map(w=> <article key={w.key} className="card p-4 sm:p-5"><div className="flex justify-between items-start"><div><p className="font-display font-bold text-lg">{w.label}</p><p className="text-xs font-bold text-[var(--muted)]">{w.hint}</p></div><span className="w-10 h-10 rounded-xl grid place-items-center text-white shrink-0" style={{background:w.color}}><Wallet size={20}/></span></div><p className="font-display font-extrabold mt-4" style={{fontSize:'clamp(28px,4vw,36px)'}}>{peso(meta.wallets[w.key])}</p><p className="text-sm font-bold">Today: <span className={todayWalletMoves[w.key]>=0?'text-[var(--green)]':'text-[var(--red)]'}>{todayWalletMoves[w.key]?`${todayWalletMoves[w.key]>0?'+':''}${peso(todayWalletMoves[w.key])}`:'₱0.00'}</span></p>{w.key==='maribank' && maribankLow && <p className="text-xs font-black text-[#b45309] bg-[#fffbeb] rounded-lg px-2 py-1.5 mt-2">⚠ Main Wallet low - top up soon (threshold {peso(meta.lowThreshold)})</p>}<div className="grid grid-cols-2 gap-2 mt-4"><button onClick={()=>openWalletAction(w.key,'add')} className="min-h-[44px] rounded-xl bg-[var(--green-soft)] text-[var(--green)] font-black text-xs">+ Add Funds</button><button onClick={()=>openWalletAction(w.key,'deduct')} className="min-h-[44px] rounded-xl bg-[var(--surface2)] border border-[var(--line)] font-black text-xs">− Deduct</button></div>{w.key==='maribank' && <button onClick={()=>openNew('Top-Up')} className="big-btn bg-[#00a651] text-white w-full mt-2 text-sm"><RefreshCw size={18}/> Top-Up via External Provider</button>}</article>)}
            </div>
            <section className="card p-4 sm:p-5 mt-3"><div className="flex items-center justify-between gap-2"><div><h2 className="font-display font-bold text-xl">Wallet Activity</h2><p className="text-sm font-semibold text-[var(--muted)]">Manual additions, deductions, and shop spending; these are not sales or profit.</p></div><span className="rounded-full bg-[var(--surface2)] px-3 py-1 text-xs font-black">{walletAdjustments.length} entries</span></div><div className="mt-3 divide-y divide-[var(--line)]">{walletAdjustments.slice(0,12).map(a=>{const v=a.value;const sign=v.mode==='add'?'+':'−';return <div key={a.id} className="flex items-center gap-3 py-3"><span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${v.mode==='add'?'bg-[var(--green-soft)] text-[var(--green)]':'bg-[#fff7ed] text-[#c2410c]'}`}><Wallet size={18}/></span><div className="min-w-0 flex-1"><p className="truncate font-extrabold">{v.mode==='deduct'?v.category:'Funds added'}{v.note?` · ${v.note}`:''}</p><p className="text-xs font-bold text-[var(--muted)]">{walletDefs.find(w=>w.key===v.wallet)?.label} · {dateLabel(v.date)} · {v.time}</p></div><span className={`shrink-0 font-display font-extrabold ${v.mode==='add'?'text-[var(--green)]':'text-[#c2410c]'}`}>{sign}{peso(v.amount)}</span></div>})}{walletAdjustments.length===0&&<p className="py-4 text-sm font-semibold text-[var(--muted)]">No manual wallet activity yet. Use Deduct to log Shopee orders or store purchases.</p>}</div></section>
            <div className="card p-5 mt-3 flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between" style={{borderColor:'#00a651', background:'#e8f8ef'}}><div><h2 className="font-display font-bold text-xl text-[#007a3d]">External Provider — Top-Up History</h2><p className="text-sm font-semibold text-[var(--muted)]">External Provider is NOT a customer wallet. Use it only to move Cash on Hand → Main Wallet. Top-ups this week: <b>{peso(weekTopUp)}</b></p></div><button onClick={()=>openNew('Top-Up')} className="big-btn bg-[#00a651] text-white px-5"><RefreshCw size={20}/> Top-Up via External Provider</button></div>
          </main>
        )}

        {tab==='report' && (
          <main>
            <div className="flex flex-wrap gap-2 items-center"><div className="flex gap-2">{(['Day','Week','Month'] as const).map(p=><button key={p} onClick={()=>setReportPeriod(p)} className={`chip ${reportPeriod===p?'active':''}`}>{p}</button>)}</div><button onClick={exportAllCSV} className="min-h-[40px] px-3 rounded-full bg-[var(--ink)] text-white text-xs font-black flex items-center gap-1.5"><FileDown size={16}/> Export CSV</button><button onClick={exportDailyCSV} className="min-h-[40px] px-3 rounded-full border border-[var(--line)] text-xs font-black flex items-center gap-1.5"><Download size={16}/> Export Daily Report</button></div>
            <div data-arrow-group="report-range" onKeyDown={(e)=>handleModalArrowKeys(e, e.currentTarget)} className="flex flex-wrap gap-2 mt-2">{(['Today','Yesterday','This Week','This Month'] as const).map(r=><button key={r} onClick={()=>setReportRange(r)} className={`chip ${reportRange===r?'active':''}`}>{r}</button>)}</div>
            <div className="report-stats grid grid-cols-2 gap-3 mt-3">
              <div className="card p-4"><p className="label">Transactions</p><p className="font-display font-extrabold text-3xl">{reportTxs.filter(t=>salesTypes.includes(t.type)).length}</p></div>
              <div className="card p-4"><p className="label">Gross Sales</p><p className="font-display font-extrabold text-3xl">{peso(reportSales+reportCashIn+reportCashOut)}</p></div>
              <div className="card p-4"><p className="label">Fees / Profit</p><p className="font-display font-extrabold text-3xl text-[var(--green)]">{peso(reportProfit)}</p></div>
              <div className="card p-4" style={{background:'#e8f8ef'}}><p className="label">External Provider Top-Ups</p><p className="font-display font-extrabold text-3xl text-[#007a3d]">{peso(reportTopUp)}</p><p className="text-xs font-bold text-[var(--muted)]">Fees paid {peso(reportTopUpFees)}</p></div>
            </div>
            <div className="report-grid mt-3">
            <section className="card p-4 sm:p-5 mt-3">
              <h2 className="font-display font-bold text-xl">Profit per day — {reportPeriod}</h2>
              <div className="mt-2 divide-y divide-[var(--line)]">{profitPerDay.length===0 && <p className="text-sm font-bold text-[var(--muted)] py-2">No sales in this period yet.</p>}{profitPerDay.map(d=><div key={d.date} className="py-2.5 flex justify-between gap-2 font-bold"><span>{d.date===todayKey()?'Today':dateLabel(d.date)} <span className="text-[var(--muted)] text-xs">• {d.count} tx</span></span><span className="text-right">{peso(d.sales)} sales • <span className="text-[var(--green)]">{peso(d.profit)} profit</span></span></div>)}</div>
              <p className="text-sm font-black mt-3">Total profit {peso(sum(profitPerDay.map(d=>({} as Tx)),()=>0) || reportProfit)} • Total sales {peso(reportSales+reportCashIn+reportCashOut)} • Count {reportTxs.filter(t=>salesTypes.includes(t.type)).length}</p>
            </section>
            <section className="card p-4 sm:p-5 mt-3">
              <h2 className="font-display font-bold text-xl">Breakdown — all via Main Wallet</h2>
              {[['E-Load',reportSales,'var(--blue)'],['Cash In',reportCashIn,'#2563eb'],['Cash Out',reportCashOut,'var(--purple)']].map(([label,val,color]:any)=>{ const total=Math.max(1,reportSales+reportCashIn+reportCashOut); return <div key={label} className="mt-4"><div className="flex justify-between font-extrabold text-sm"><span>{label} • Main Wallet</span><span>{peso(val)} • {Math.round(val/total*100)}%</span></div><div className="h-3 rounded-full bg-[var(--surface2)] overflow-hidden mt-1.5"><div className="h-full rounded-full" style={{width:`${val/total*100}%`, background:color}}/></div></div> })}
              <div className="mt-4"><div className="flex justify-between font-extrabold text-sm"><span>External Provider Top-Ups (not sales)</span><span>{peso(reportTopUp)} • fees {peso(reportTopUpFees)}</span></div><div className="h-3 rounded-full bg-[var(--surface2)] overflow-hidden mt-1.5"><div className="h-full rounded-full" style={{width:`${Math.min(100, reportTopUp/Math.max(1,reportSales+reportCashIn+reportCashOut+reportTopUp)*100)}%`, background:'#00a651'}}/></div></div>
              <h3 className="font-display font-bold text-lg mt-6">Best-selling load denominations</h3>
              <div className="mt-2 divide-y divide-[var(--line)]">{denom.length===0 && <p className="text-sm font-bold text-[var(--muted)] py-2">No e-load sales in this period yet.</p>}{denom.map(([amt,count],i)=><div key={amt} className="py-2.5 flex justify-between font-bold"><span><b className="mr-2">#{i+1}</b> {peso(amt)} load</span><span>{count} sale{count>1?'s':''}</span></div>)}</div>
              <h3 className="font-display font-bold text-lg mt-6 flex items-center gap-2"><Users size={19}/> Breakdown by customer</h3>
              <div className="mt-2 divide-y divide-[var(--line)]">{reportByCustomer.length===0 && <p className="text-sm font-bold text-[var(--muted)] py-2">No customer sales in this period yet.</p>}{reportByCustomer.map((c,i)=>{ const max=Math.max(1,...reportByCustomer.map(x=>x.amount)); return <button key={c.phone} onClick={()=>{ const rec=customerByPhone.get(c.phone); if(rec) setCustomerDetail(rec); }} className="w-full py-3 text-left"><div className="flex justify-between gap-2 font-bold"><span className="flex items-center gap-2 min-w-0"><span className="w-8 h-8 rounded-full bg-[#0e2a47] text-white grid place-items-center text-[11px] font-black shrink-0">{displayInitials(c.name, c.phone)}</span><span className="truncate">#{i+1} {displayNameOnly(c.name, c.phone)}{isRealName(c.name, c.phone) && <span className="text-[var(--muted)] text-xs"> • {formatPhone(c.phone)}</span>}</span></span><span className="shrink-0">{peso(c.amount)} • {c.count} tx</span></div><div className="h-2.5 rounded-full bg-[var(--surface2)] overflow-hidden mt-2"><div className="h-full rounded-full bg-[var(--green)]" style={{width:`${c.amount/max*100}%`}}/></div><p className="text-xs font-bold text-[var(--muted)] mt-1">Fees paid {peso(c.fees)}</p></button> })}</div>
            </section>
            </div>
            <section className="card p-4 sm:p-5 mt-3">
              <h2 className="font-display font-bold text-xl">Closed days</h2>
              {dailyReports.length===0 ? <p className="text-sm font-bold text-[var(--muted)] mt-2">No closed days yet. Use End Day to archive a day.</p> : <div className="divide-y divide-[var(--line)] mt-1">{dailyReports.map(r=><div key={r.id} className="py-3 flex justify-between gap-2"><span><span className="block font-extrabold">{fullDate(r.value.date)}</span><span className="block text-xs font-bold text-[var(--muted)]">Float {peso(r.value.startingFloat)} • Counted {peso(r.value.actualCash)} • {r.value.difference===0?'Exact':r.value.difference<0?`Short ${peso(Math.abs(r.value.difference))}`:`Over ${peso(r.value.difference)}`} • Tomorrow {peso(r.value.tomorrowFloat)}</span></span><span className="text-right shrink-0"><span className="block font-extrabold">{peso(r.value.sales)} sales</span><span className="block text-xs font-black text-[var(--green)]">{peso(r.value.profit)} profit</span></span></div>)}</div>}
            </section>
            <div className="card p-5 mt-3 flex flex-col sm:flex-row gap-3 justify-between items-start sm:items-center"><div><h2 className="font-display font-bold text-xl">End of day</h2><p className="text-sm font-semibold text-[var(--muted)]">{meta.lastClosed===todayKey()?'Today is already closed and archived.':'Review today, then archive the summary.'}</p></div><button onClick={openEndDay} className="big-btn bg-[var(--ink)] text-white px-5"><Download size={18}/> End of Day Summary</button></div>
          </main>
        )}

        {tab==='settings' && (
          <main className="space-y-3">
            <section className="card p-4 sm:p-5">
              <h2 className="font-display font-bold text-xl flex items-center gap-2"><SettingsIcon size={20}/> Business settings</h2>
              <p className="text-sm font-semibold text-[var(--muted)] mt-1">Main app: Main Wallet. External Provider is only a top-up source.</p>
              <label className="label block mt-4">Business name</label><input value={meta.businessName} onChange={e=>setMeta({...meta,businessName:e.target.value})} className="field mt-1"/>
              <div className="grid sm:grid-cols-2 gap-3 mt-3">
                <div><label className="label">E-Load Profit % (added to customer total)</label><input type="number" step="0.1" value={meta.eloadPct} onChange={e=>setMeta({...meta,eloadPct:Number(e.target.value)})} className="field mt-1"/></div>
                <div><label className="label">Cash In - % Fee (Added on Top)</label><input type="number" step="0.1" value={meta.cashInPct} onChange={e=>setMeta({...meta,cashInPct:Number(e.target.value)})} className="field mt-1"/></div>
                <div><label className="label">Cash Out - % Fee (Added on Top)</label><input type="number" step="0.1" value={meta.cashOutPct} onChange={e=>setMeta({...meta,cashOutPct:Number(e.target.value)})} className="field mt-1"/></div>
                <div><label className="label">External Provider Top-Up Fee (Flat ₱)</label><input type="number" value={meta.palawanFee} onChange={e=>setMeta({...meta,palawanFee:Number(e.target.value)})} className="field mt-1"/></div>
                <div><label className="label">Low Balance threshold — Main Wallet (₱)</label><input type="number" value={meta.lowThreshold} onChange={e=>setMeta({...meta,lowThreshold:Number(e.target.value)})} className="field mt-1"/></div>
                <div className="flex items-end"><p className="text-xs font-bold text-[var(--muted)]">When Main Wallet is at or below this amount, a subtle amber “Main Wallet low - top up soon” pill shows. No popup.</p></div>
              </div>
              <p className="text-sm font-semibold text-[var(--muted)] mt-3">Fee = Amount × % ÷ 100. E-Load customers pay the load amount plus its profit/fee; Cash In/Out fees are added on top. Example: Cash In ₱500 at 2% = ₱10 fee, so the customer pays ₱510.</p>
              <button disabled={saving} onClick={async()=>{ setSaving(true); try{ await saveMeta(meta); setSaveMsg('Settings saved.'); } catch(e){ setSaveMsg(e instanceof Error?e.message:String(e)); } setSaving(false); }} className="big-btn bg-[var(--green)] text-white px-6 mt-4 w-full sm:w-auto">{saving?'Saving…':'Save Settings'}</button>
              <button onClick={exportAllCSV} className="big-btn border-2 border-[var(--line)] px-5 mt-3 w-full sm:w-auto"><FileDown size={18}/> Export CSV — All Transactions</button>
              <input ref={statementImportRef} type="file" accept="application/json,.json" className="hidden" aria-label="Choose statement sales JSON file" onChange={e=>{const file=e.target.files?.[0]; if(file) void importStatementSales(file);}} />
              <button type="button" disabled={statementImportBusy||saving} onClick={()=>statementImportRef.current?.click()} className="big-btn border-2 border-[var(--line)] px-5 mt-3 w-full sm:w-auto"><Download size={18}/>{statementImportBusy?'Importing statement sales…':'Import statement sales JSON'}</button>
              <p className="text-xs font-bold text-[var(--muted)] mt-2">Imports past E-Load records to transaction history. Existing wallet balances are preserved; repeat imports skip already-imported rows.</p>
              <div className="mt-5 border-t border-[var(--line)] pt-4"><h3 className="font-display font-bold text-lg">Full backup</h3><p className="text-sm font-semibold text-[var(--muted)] mt-1">Back up transactions, customers, reports, favorites, wallet adjustments, and settings to a JSON file.</p><button type="button" onClick={exportBackup} className="big-btn border-2 border-[var(--line)] px-5 mt-3 w-full sm:w-auto"><FileDown size={18}/>Download full backup</button><input ref={backupImportRef} type="file" accept="application/json,.json" className="hidden" aria-label="Choose E-LOAD Tracker backup" onChange={e=>{const file=e.target.files?.[0];if(file) void importBackup(file);}}/><button type="button" disabled={backupBusy||saving} onClick={()=>backupImportRef.current?.click()} className="big-btn border-2 border-[var(--line)] px-5 mt-3 ml-0 sm:ml-2 w-full sm:w-auto"><Download size={18}/>{backupBusy?'Restoring backup…':'Restore backup'}</button><p className="text-xs font-bold text-[var(--muted)] mt-2">Restore merges missing record IDs and keeps matching existing records. It replaces settings and wallet balances after confirmation. Restore requires internet access.</p></div>
            </section>
            <section className="card p-4 sm:p-5">
              <h2 className="font-display font-bold text-xl">Sample data</h2><p className="text-sm font-semibold text-[var(--muted)] mt-1">If older sample transactions are still in your ledger, clear them to start with a clean ledger.</p>
              {!confirmClear ? <button onClick={()=>setConfirmClear(true)} className="big-btn border-2 border-[var(--line)] px-5 mt-3"><Trash2 size={18}/> Clear Sample Data</button> : <div className="mt-3 flex flex-wrap gap-2 items-center"><span className="font-bold text-sm">Clear all sample transactions &amp; sample customers?</span><button onClick={clearSample} disabled={saving} className="min-h-[44px] px-4 rounded-xl bg-[var(--red)] text-white font-black text-sm">Yes, clear sample</button><button onClick={()=>setConfirmClear(false)} className="min-h-[44px] px-4 rounded-xl border border-[var(--line)] font-black text-sm">Keep them</button></div>}
              <p className="text-xs font-bold text-[var(--muted)] mt-3">Storage note: the app keeps up to 1,000 saved records. If you reach that limit, delete older transactions in the Transactions tab.</p>
            </section>
          </main>
        )}
      </div></div>

      <nav className="mobile-bottom-nav fixed bottom-0 inset-x-0 z-30 md:hidden bg-[var(--surface)] border-t border-[var(--line)] px-1 py-2 grid grid-cols-7 gap-0.5" aria-label="Mobile navigation">
        {tabs.map(t=>{ const Icon=t.icon; return <button key={t.id} onClick={()=>setTab(t.id)} className={`flex flex-col items-center gap-0.5 py-1.5 rounded-xl min-h-[52px] text-[10px] font-black ${tab===t.id?'text-[var(--green)] bg-[var(--green-soft)]':'text-[var(--muted)]'}`}><Icon size={20}/>{t.label}</button> })}
      </nav>
      <button onClick={()=>openNew('E-Load')} className={`fab-desktop ${tab==='home'?'fab-dashboard':''} fixed bottom-[84px] md:bottom-6 right-4 md:right-8 z-30 w-[60px] h-[60px] rounded-full bg-[var(--green)] text-white grid place-items-center shadow-xl`} aria-label="Add transaction — shortcut 1"><Plus size={30}/></button>

      {showServices && <ServicesModal highlight={servicesHighlight} onHighlight={setServicesHighlight} onClose={()=>setShowServices(false)} onSelect={(t)=>{ setShowServices(false); openNew(t); }} />}

      {showTx && <Sheet onClose={()=>setShowTx(false)} title={editing?'Edit transaction': fType==='Top-Up'?'Top-Up via External Provider':'Add transaction'}>
        <div data-arrow-group="transaction-type" className="flex flex-wrap gap-2">{(['E-Load','Cash In','Cash Out','Top-Up'] as const).map(t=> <button key={t} onClick={()=>{setFType(t); if(t!=='E-Load') setFDiscount(0); if(t==='Top-Up'){setFAmount(1000); setFFee(meta.palawanFee); setFNotes('Top-Up via External Provider');} else if(t==='E-Load'){setFAmount(100); setFFee(autoFee(t,100));} else {setFAmount(100); setFFee(autoFee(t,100));}}} className={`flex-1 min-h-[48px] rounded-xl font-black text-[13px] px-2 ${fType===t? t==='Top-Up'?'bg-[#00a651] text-white':'bg-[var(--ink)] text-white':'bg-[var(--surface2)] border border-[var(--line)]'}`}>{t==='Top-Up'?'Top-Up via External Provider':t}</button>)}</div>
        {fType==='Top-Up' && <div className="rounded-2xl p-3 mt-3 font-bold text-sm" style={{background:'#e8f8ef', color:'#007a3d'}}>Top-Up via External Provider — Cash on Hand → Main Wallet. External Provider is only a top-up source, not a customer wallet.</div>}
        <CustomerSuggest query={fCustomerQuery} onQuery={handleCustomerQuery} customers={customers} stats={customerStats} recentPhones={recentCustomerPhones} frequent={frequentCustomers} label={fType==='Top-Up'?'Customer (optional) — name or number':'Customer — type name or number'} required={fType!=='Top-Up'} onPick={(c)=>setCustomerFromRecord(c)} onSaveNew={async(parsed)=>{ const realName=isRealName(parsed.name, parsed.phone)?parsed.name:''; const created:any=await createCustomerRow({name:realName, phone:parsed.phone, notes:'', createdAt:Date.now(), totalTransactions:0, totalAmount:0}); await reloadRecords(); const rec=customers.find(x=>x.id===created.id) || {id:created.id, value:{name:realName, phone:parsed.phone, notes:'', createdAt:Date.now(), totalTransactions:0, totalAmount:0}}; setCustomerFromRecord(rec as CustomerRecord); }} />
        {showNameField && !namePromptSkipped && digitsOnly(fPhone).length===11 && <div className="rounded-2xl border border-[#fdba74] bg-[#fff7ed] p-3 mt-3">
          <p className="font-extrabold text-sm text-[#9a3412]">New number! Add a name so it&apos;s easier next time:</p>
          <p className="text-xs font-bold text-[var(--muted)] mt-0.5">{formatPhone(fPhone)}</p>
          <label className="label block mt-3">Customer Name (optional)</label>
          <input value={fCustomerName} onChange={e=>setFCustomerName(e.target.value)} placeholder="e.g. Juan, Maria, Suki" className="field mt-1" aria-label="Customer Name (optional)" />
          {nameMsg && <p className="text-sm font-bold text-[var(--green)] mt-2">{nameMsg}</p>}
          <div className="flex gap-2 mt-3"><button disabled={nameSaving || !fCustomerName.trim()} onClick={saveNameInForm} className="min-h-[44px] px-4 rounded-xl bg-[#ea580c] text-white font-black text-sm flex-1">{nameSaving?'Saving…':'Save Name'}</button><button onClick={()=>{ setNamePromptSkipped(true); setNameMsg(''); }} className="min-h-[44px] px-4 rounded-xl border border-[var(--line)] bg-white font-black text-sm">Skip for now</button></div>
        </div>}
        {!showNameField && !namePromptSkipped && digitsOnly(fPhone).length===11 && (()=>{ const ex=customerByPhone.get(digitsOnly(fPhone)); return ex && !isRealName(ex.value.name, ex.value.phone) ? <button onClick={()=>setShowNameField(true)} className="mt-2 min-h-[40px] px-3 rounded-full bg-[#fff7ed] border border-[#fdba74] text-[#ea580c] text-xs font-black">+ Add Name</button> : null; })()}
        {fType!=='Top-Up' && <label className="flex items-center gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface2)] p-3 mt-4 cursor-pointer"><input type="checkbox" checked={isUtang} onChange={e=>setIsUtang(e.target.checked)} className="w-5 h-5 accent-[#7c3aed]"/><span><span className="block font-extrabold text-sm">Utang / Pay Later</span><span className="block text-xs font-bold text-[var(--muted)]">Save as unpaid. Wallets update only when marked paid.</span></span></label>}
        {isUtang && fType!=='Top-Up' && <div className="rounded-2xl border border-[#ddd6fe] bg-[#f5f3ff] p-3 mt-3"><p className="label">Promise to pay:</p><div data-arrow-group="promise-date" className="flex flex-wrap gap-2 mt-2"><button type="button" onClick={()=>setFPromiseDate(addDaysKey(todayKey(),1))} className={`chip ${fPromiseDate===addDaysKey(todayKey(),1)?'active':''}`}>Tomorrow</button><button type="button" onClick={()=>setFPromiseDate(addDaysKey(todayKey(),3))} className={`chip ${fPromiseDate===addDaysKey(todayKey(),3)?'active':''}`}>In 3 days</button><button type="button" onClick={()=>setFPromiseDate(addDaysKey(todayKey(),7))} className={`chip ${fPromiseDate===addDaysKey(todayKey(),7)?'active':''}`}>Next Week (7 days)</button><button type="button" onClick={()=>setFPromiseDate('')} className={`chip ${!fPromiseDate?'active':''}`}>No date yet</button></div><label className="label block mt-3">Pick Date</label><input type="date" value={fPromiseDate} onChange={e=>setFPromiseDate(e.target.value)} className="field mt-1" aria-label="Promise to pay date"/><p className="text-xs font-bold text-[var(--muted)] mt-1.5">{fPromiseDate ? `Promised: ${fullDate(fPromiseDate)} — “Sabi bukas daw” / “Next week daw” can go in Notes below.` : 'Default: No date yet. Pick one in 1 tap above.'}</p></div>}
        {duplicateInfo && <div className="rounded-2xl border border-[#fdba74] bg-[#fff7ed] p-3 mt-3"><p className="font-extrabold text-sm text-[#9a3412]">You already saved {peso(duplicateInfo.amount)} {duplicateInfo.type} to {duplicateInfo.name} {duplicateInfo.mins===0?'just now':`${duplicateInfo.mins} min${duplicateInfo.mins>1?'s':''} ago`} — save again?</p><div className="flex gap-2 mt-3"><button onClick={()=>{ setDuplicateInfo(null); saveTransaction(false, true); }} className="min-h-[44px] px-4 rounded-xl bg-[#ea580c] text-white font-black text-sm flex-1">Save Again</button><button onClick={()=>setDuplicateInfo(null)} className="min-h-[44px] px-4 rounded-xl border border-[var(--line)] bg-white font-black text-sm">Cancel</button></div></div>}
        {fType==='E-Load' ? <>
          <label className="label block mt-4">Network</label><div data-arrow-group="network" className="flex flex-wrap gap-2 mt-1.5">{['Globe','Smart','TNT','DITO'].map(n=><button key={n} onClick={()=>setFNetwork(n)} className={`chip ${fNetwork===n?'active':''}`}>{n}</button>)}</div>
          <div className="flex flex-wrap gap-2 mt-4" role="group" aria-label="Load product type"><button type="button" onClick={()=>setFEloadKind('regular')} className={`chip ${fEloadKind==='regular'?'active':''}`}>Regular Load</button><button type="button" onClick={()=>setFEloadKind('promo')} className={`chip ${fEloadKind==='promo'?'active':''}`}>Promo / Bundle</button></div>
          <p className="text-xs font-bold text-[var(--muted)] mt-1.5">{fEloadKind==='regular'?'Flexible prepaid credit.':'Direct package applied to the customer’s number. Enter the exact offer shown in your load channel.'} Via Main Wallet.</p>
          {fEloadKind==='promo' && <div className="grid grid-cols-1 gap-3 mt-3 sm:grid-cols-2"><div className="sm:col-span-2"><label className="label">Choose a suggested {fNetwork} promo</label><select value={promoOffers.find(o=>o.network===fNetwork && o.name===fPromoName && o.amount===fAmount)?.id||''} onChange={e=>{const offer=promoOffers.find(o=>o.id===e.target.value); if(offer){setFPromoName(offer.name);setFPromoDetails(offer.details);setFPromoValidity(offer.validity);setFAmount(offer.amount);setFCustom('');setFFee(autoFee('E-Load',offer.amount));}}} className="field mt-1" aria-label="Suggested promo list"><option value="">Choose a promo or enter your own below</option>{promoOffers.filter(o=>o.network===fNetwork).map(o=><option key={o.id} value={o.id}>{o.name} — ₱{o.amount} / {o.validity}</option>)}</select><p className="text-xs font-bold text-[var(--muted)] mt-1">Examples from provider listings. Confirm availability and inclusions in your retailer menu before selling; offers can change.</p></div><div className="sm:col-span-2"><label className="label">Promo / package name</label><input value={fPromoName} onChange={e=>setFPromoName(e.target.value)} placeholder="Choose above or type a custom offer" className="field mt-1" aria-label="Promo or package name"/></div><div><label className="label">Inclusions (optional)</label><input value={fPromoDetails} onChange={e=>setFPromoDetails(e.target.value)} placeholder="e.g. data, calls, texts" className="field mt-1" aria-label="Promo inclusions"/></div><div><label className="label">Validity (optional)</label><input value={fPromoValidity} onChange={e=>setFPromoValidity(e.target.value)} placeholder="e.g. 7 days, no expiry" className="field mt-1" aria-label="Promo validity"/></div></div>}
          <label className="label block mt-4">{fEloadKind==='promo'?'Promo price':'Load amount'}</label><div data-arrow-group="eload-amount" className="flex flex-wrap gap-2 mt-1.5">{[10,20,50,100,200,500,1000].map(a=>{ return <button key={a} onClick={()=>{setFAmount(a); setFCustom(''); setFFee(autoFee('E-Load',a));}} className={`chip ${fAmount===a && !fCustom?'active':''}`}>₱{a}</button> })}<input value={fCustom} onChange={e=>{setFCustom(e.target.value); const v=Number(e.target.value); if(v>0){setFAmount(v); setFFee(autoFee('E-Load',v));}}} placeholder="Custom" inputMode="decimal" className="chip w-[96px] outline-none" aria-label="Custom load amount"/></div>
          <label className="label block mt-3">Provider discount (₱, optional)</label><input type="number" min="0" max={fAmount} step="0.01" value={fDiscount} onChange={e=>setFDiscount(Number(e.target.value)||0)} className="field mt-1" inputMode="decimal" aria-label="Provider discount amount"/><p className="text-xs font-bold text-[var(--muted)] mt-1">Enter ₱5 for a ₱100 load bought for ₱95. Your profit includes the discount plus the customer fee.</p>
          <div className="grid grid-cols-2 gap-3 mt-3"><div><label className="label">Customer pays (load + fee)</label><input value={peso(fAmount+fFee)} readOnly className="field mt-1 bg-[var(--surface2)]"/></div><div><label className="label">Profit</label><input type="number" value={fFee} onChange={e=>setFFee(Number(e.target.value))} className="field mt-1"/></div></div>
          <div className="rounded-2xl bg-[var(--green-soft)] p-3 mt-3 font-bold text-sm">{isUtang?'Utang — wallets will not move until marked paid.':'Main Wallet −'+peso(fAmount-fDiscount)+' • Cash on Hand +'+peso(fAmount+fFee)+' • Profit '+peso(fFee+fDiscount)}</div>
        </> : fType==='Top-Up' ? <>
          <label className="label block mt-4">Top-up amount → Main Wallet</label><input type="number" value={fAmount} onChange={e=>{const v=Number(e.target.value); setFAmount(v); setFFee(autoFee('Top-Up',v));}} className="field mt-1" inputMode="decimal"/>
          <div data-arrow-group="topup-amount" className="flex flex-wrap gap-2 mt-2">{amountShortcuts.map(s=><button key={s.amt} type="button" onClick={()=>{setFAmount(s.amt); setFFee(autoFee('Top-Up',s.amt));}} className="chip">₱{s.amt}</button>)}<button type="button" onClick={()=>{setFAmount(1000); setFFee(autoFee('Top-Up',1000));}} className="chip">₱1000</button></div>
          <label className="label block mt-3">External Provider fee (editable)</label><input type="number" value={fFee} onChange={e=>setFFee(Number(e.target.value))} className="field mt-1"/>
          <div className="rounded-2xl p-3 mt-3 font-bold text-sm" style={{background:'#e8f8ef'}}>Cash on Hand −{peso(fAmount+fFee)} (amount + External Provider fee) • Main Wallet +{peso(fAmount)}</div>
        </> : <>
          <label className="label block mt-4">Provider</label><div className="flex gap-2 mt-1.5"><button className="chip active">Main Wallet</button><span className="text-xs font-bold text-[var(--muted)] self-center">Only Main Wallet is used for Cash In / Cash Out.</span></div>
          <label className="label block mt-4">Amount</label><input type="number" value={fAmount} onChange={e=>{const v=Number(e.target.value); setFAmount(v); setFFee(autoFee(fType,v));}} className="field mt-1" inputMode="decimal"/>
          <div data-arrow-group="cash-amount" className="flex flex-wrap gap-2 mt-2">{amountShortcuts.map(s=><button key={s.amt} type="button" onClick={()=>{setFAmount(s.amt); setFFee(autoFee(fType,s.amt));}} className="chip">₱{s.amt}</button>)}<button type="button" onClick={()=>{setFAmount(1000); setFFee(autoFee(fType,1000));}} className="chip">₱1000</button></div>
          <label className="label block mt-3">Service fee (editable)</label><input type="number" value={fFee} onChange={e=>setFFee(Number(e.target.value))} className="field mt-1"/>
          <div className="rounded-2xl bg-[var(--green-soft)] p-3 mt-3 font-bold text-sm space-y-1">
            <p className="text-xs font-black tracking-wide uppercase text-[var(--muted)]">Fee: {feeParts(fType,fAmount).pct}% of {peso(fAmount)} = {peso(fFee)}</p>
            {fType==='Cash In' ? <>
              <p>What customer wants: <b>{peso(fAmount)}</b> in their Main Wallet.</p>
              <p>What customer pays total: <b>{peso(fAmount+fFee)} cash</b> ({peso(fAmount)} + {peso(fFee)} fee)</p>
              <p>You send {peso(fAmount)} <span className="text-[var(--green)] bg-white px-1.5 py-0.5 rounded">FULL</span> via Main Wallet • You keep {peso(fFee)} fee</p>
              <p className="text-xs text-[var(--muted)]">Balance: Cash +{peso(fAmount+fFee)} • Main Wallet −{peso(fAmount)}</p>
            </> : <>
              <p>What customer wants: <b>{peso(fAmount)} cash</b>.</p>
              <p>What customer pays total: <b>{peso(fAmount+fFee)} via Main Wallet</b> ({peso(fAmount)} + {peso(fFee)} fee)</p>
              <p>You give {peso(fAmount)} <span className="text-[var(--green)] bg-white px-1.5 py-0.5 rounded">FULL</span> cash • You keep {peso(fFee)} fee</p>
              <p className="text-xs text-[var(--muted)]">Balance: Main Wallet +{peso(fAmount+fFee)} • Cash −{peso(fAmount)}</p>
            </>}
            {isUtang && <p className="text-[#6d28d9]">Utang — wallets will not move until marked paid.</p>}
          </div>
        </>}
        <label className="label block mt-4">Notes</label><input value={fNotes} onChange={e=>setFNotes(e.target.value)} placeholder="Optional note…" className="field mt-1"/>
        <div className="grid grid-cols-2 gap-3 mt-3"><div><label className="label">Date</label><input type="date" value={fDate} onChange={e=>setFDate(e.target.value)} className="field mt-1"/></div><div><label className="label">Time</label><input value={fTime} onChange={e=>setFTime(e.target.value)} className="field mt-1"/></div></div>

        <div className="sheet-save-bar grid grid-cols-2 gap-2 mt-5"><button disabled={saving} onClick={()=>saveTransaction(false)} className="big-btn bg-[var(--green)] text-white" style={fType==='Top-Up'?{background:'#00a651'}:undefined}>{saving?'Saving…':editing?'Save Changes': fType==='Top-Up'?'Save Top-Up via External Provider':'Save Transaction'}</button><button disabled={saving} onClick={()=>saveTransaction(true)} className="big-btn border-2 border-[var(--line)]">Save &amp; Add Another</button></div>
        <button onClick={()=>setShowTx(false)} className="big-btn border border-[var(--line)] w-full mt-2">Cancel</button>
        <p className="text-xs font-bold text-[var(--muted)] text-center mt-2">Main Wallet and Cash on Hand update automatically. New name + number saves as a customer automatically.</p>
      </Sheet>}

      {detail && <Sheet onClose={()=>setDetail(null)} title="Transaction detail">
        <div className="rounded-2xl bg-[var(--surface2)] p-4"><p className="font-display font-extrabold text-3xl">{peso(detail.value.amount)}</p><p className="font-bold text-[var(--muted)]">{detail.value.type==='Top-Up'?'Top-Up via External Provider':detail.value.type} • {detail.value.type==='Top-Up'?'External Provider → Main Wallet':`${detail.value.network} • via Main Wallet`} • {dateLabel(detail.value.date)} at {detail.value.time}</p><p className="font-black text-[var(--green)] mt-1">{detail.value.type==='Top-Up' ? `External Provider fee: ${peso(detail.value.fee||0)}` : detail.value.type==='E-Load' ? `Customer fee ${peso(detail.value.fee||0)} + provider discount ${peso(eLoadDiscount(detail.value))} = ${peso(txProfit(detail.value))} total profit` : `Fee / profit: ${peso(detail.value.fee||0)}`}</p>{detail.value.utang && <><p className="font-black text-[13px] mt-1"><span className={`px-2 py-1 rounded-full ${detail.value.utangStatus==='paid'?'bg-[var(--green-soft)] text-[var(--green)]': utangPromiseStatus(detail.value)==='overdue'?'bg-[#fef2f2] text-[var(--red)]': utangPromiseStatus(detail.value)==='due-today'?'bg-[#fffbeb] text-[#92400e]':'bg-[#fef3c7] text-[#92400e]'}`}>Utang — {utangPromiseLabel(detail.value)}</span></p><p className="text-sm font-bold mt-2">Promise to Pay: {utangPromiseDateLabel(detail.value)}{detail.value.promiseDate ? ` • ${fullDate(detail.value.promiseDate)}` : ''}</p>{detail.value.utangStatus!=='paid' && <p className="text-sm font-bold">Total {peso(detail.value.amount)} • Paid {peso(detail.value.paidAmount||0)} • Remaining {peso(utangRemaining(detail.value))}</p>}</>}{detail.value.history && detail.value.history.length>0 && <div className="mt-3 rounded-xl bg-white p-3 border border-[var(--line)]"><p className="text-xs font-black uppercase tracking-wide text-[var(--muted)]">Edit history</p>{detail.value.history.map((h,i)=><p key={i} className="text-sm font-bold mt-1">Edited: {peso(h.oldAmount)} → {peso(h.newAmount)}, {h.date} {h.time}</p>)}</div>}</div>
        {(() => { const cust = customerByPhone.get(digitsOnly(detail.value.phone||'')); const showDeleted = !cust && isRealName(detail.value.customerName, detail.value.phone) && !!detail.value.phone; const hasName = cust ? isRealName(cust.value.name, detail.value.phone) : isRealName(detail.value.customerName, detail.value.phone); return <div className="rounded-2xl border border-[var(--line)] p-3 mt-3 flex items-center gap-3"><span className="w-11 h-11 rounded-full bg-[#0e2a47] text-white grid place-items-center font-black shrink-0">{showDeleted?initials('Deleted Customer'):displayInitials(cust?.value.name || detail.value.customerName, detail.value.phone)}</span><div className="flex-1 min-w-0"><p className="font-extrabold truncate">{showDeleted?'Deleted Customer': displayNameOnly(cust?.value.name || detail.value.customerName, detail.value.phone) || 'No customer'}</p><p className="text-xs font-bold text-[var(--muted)]">{hasName && detail.value.phone?formatPhone(detail.value.phone):''}{cust?.value.notes?`${hasName?' • ':''}${cust.value.notes}`:''}</p></div>{!hasName && !showDeleted && detail.value.phone && <button onClick={()=>openAddName(detail.value.phone)} className="min-h-[40px] px-3 rounded-full bg-[#fff7ed] border border-[#fdba74] text-[#ea580c] font-black text-xs shrink-0">+ Add Name</button>}{cust && <button onClick={()=>{ setDetail(null); setCustomerDetail(cust); }} className="min-h-[44px] px-3 rounded-xl bg-[var(--ink)] text-white font-black text-xs shrink-0">View Customer</button>}</div> })()}
        <dl className="mt-4 space-y-2 text-sm font-bold"><Row k="Provider" v={detail.value.type==='Top-Up'?'External Provider (top-up source)':'Main Wallet (main app)'}/><Row k="Payment" v={detail.value.payment}/><Row k="Phone" v={detail.value.phone?formatPhone(detail.value.phone):'—'}/><Row k="Notes" v={detail.value.notes||'—'}/>{detail.value.utang && <><Row k="Promise to Pay" v={detail.value.promiseDate ? fullDate(detail.value.promiseDate) : 'No date yet'}/><Row k="Utang Status" v={`${utangPromiseLabel(detail.value)} • Paid ${peso(detail.value.paidAmount||0)} • Remaining ${peso(utangRemaining(detail.value))}`}/></>}<Row k="Customer pays" v={detail.value.type==='E-Load'?`${peso(detail.value.selling||detail.value.amount)} + ${peso(detail.value.fee||0)} fee = ${peso((detail.value.selling||detail.value.amount)+(detail.value.fee||0))}`: detail.value.type==='Top-Up'? peso(detail.value.amount+detail.value.fee): detail.value.type==='Cash In'?`${peso(detail.value.amount+detail.value.fee)} cash (${peso(detail.value.amount)} + ${peso(detail.value.fee||0)} fee) — you send ${peso(detail.value.amount)} FULL via Main Wallet`: detail.value.type==='Cash Out'?`${peso(detail.value.amount+detail.value.fee)} via Main Wallet (${peso(detail.value.amount)} + ${peso(detail.value.fee||0)} fee) — you give ${peso(detail.value.amount)} FULL cash`:'—'}/><Row k="What you give in full" v={detail.value.type==='Cash In'||detail.value.type==='Cash Out'?`${peso(detail.value.amount)} FULL`:'—'}/>{detail.value.type==='E-Load' && <><Row k="Provider discount" v={peso(eLoadDiscount(detail.value))}/><Row k="Actual wallet cost" v={peso(detail.value.amount-eLoadDiscount(detail.value))}/><Row k="Total profit" v={peso(txProfit(detail.value))}/></>}<Row k="Fee / profit" v={detail.value.type==='Cash In'||detail.value.type==='Cash Out'?peso(detail.value.fee||0):'—'}/></dl>
        <div className="flex gap-2 mt-4 flex-wrap"><button onClick={()=>toggleFavoriteForTx(detail)} className="min-h-[44px] px-3 rounded-xl border border-[var(--line)] font-black text-sm flex items-center gap-1.5"><Star size={16} fill={favorites.some(f=>digitsOnly(f.value.phone)===digitsOnly(detail.value.phone) && f.value.amount===detail.value.amount && f.value.type===detail.value.type)?'currentColor':'none'}/> {favorites.some(f=>digitsOnly(f.value.phone)===digitsOnly(detail.value.phone) && f.value.amount===detail.value.amount && f.value.type===detail.value.type)?'Favorited':'Add to Favorites'}</button><button onClick={()=>repeatTx(detail)} className="min-h-[44px] px-3 rounded-xl border border-[var(--line)] font-black text-sm">Repeat</button>{detail.value.utang && detail.value.utangStatus!=='paid' && <button onClick={()=>{setUtangReminderAll(false); setUtangReminder(detail); setDetail(null);}} className="min-h-[44px] px-3 rounded-xl bg-[#e8f8ef] text-[#087a48] font-black text-sm flex items-center gap-1.5"><Share2 size={16}/> Share reminder</button>}{detail.value.utang && detail.value.utangStatus!=='paid' && <button onClick={()=>markUtangPaid(detail)} className="min-h-[44px] px-3 rounded-xl bg-[var(--green)] text-white font-black text-sm">Mark Paid</button>}</div>
        {detail.value.utang && detail.value.utangStatus!=='paid' && <div className="rounded-2xl border border-[var(--line)] p-3 mt-4"><p className="font-extrabold text-sm">Partial Payment — “tomorrow partial”</p><p className="text-xs font-bold text-[var(--muted)] mt-0.5">Remaining {peso(utangRemaining(detail.value))} • Promise date stays unless you Edit it.</p>{!showPartial ? <button onClick={()=>{setPartialAmount(utangRemaining(detail.value)); setShowPartial(true);}} className="min-h-[44px] px-4 rounded-xl bg-[#7c3aed] text-white font-black text-sm mt-3">Partial Payment</button> : <div onKeyDown={(e)=>{ if(e.key==='Enter' && !((e.target as HTMLElement).tagName==='BUTTON')){ e.preventDefault(); savePartialPayment(detail); } }}><label className="label block mt-3">Amount paid now</label><input type="number" value={partialAmount} onChange={e=>setPartialAmount(Number(e.target.value))} className="field mt-1" inputMode="decimal" aria-label="Amount paid now"/><p className="text-sm font-bold mt-2">Remaining after this payment: {peso(Math.max(0, round2(utangRemaining(detail.value)-(partialAmount||0))))}</p><div className="flex gap-2 mt-3 flex-wrap"><button disabled={saving} onClick={()=>savePartialPayment(detail)} className="min-h-[44px] px-4 rounded-xl bg-[var(--green)] text-white font-black text-sm flex-1">{saving?'Saving…':'Save Partial Payment'}</button><button onClick={()=>markUtangPaid(detail)} disabled={saving} className="min-h-[44px] px-4 rounded-xl border border-[var(--line)] font-black text-sm">Mark Paid Fully</button><button onClick={()=>setShowPartial(false)} className="min-h-[44px] px-4 rounded-xl border border-[var(--line)] font-black text-sm">Cancel</button></div></div>}</div>}
        <div className="grid grid-cols-2 gap-2 mt-3"><button onClick={()=>{const r=detail; setDetail(null); openEdit(r);}} className="big-btn bg-[var(--ink)] text-white"><Pencil size={18}/> Edit</button><button onClick={()=>setConfirmDelete(detail)} className="big-btn border-2 border-red-200 text-[var(--red)]"><Trash2 size={18}/> Delete</button></div>
        {confirmDelete && <div className="mt-4 rounded-2xl border border-red-200 p-3"><p className="font-bold text-sm">Delete this transaction? Wallets will be reversed.</p><div className="flex gap-2 mt-2"><button onClick={()=>deleteTransaction(confirmDelete)} className="min-h-[44px] px-4 rounded-xl bg-[var(--red)] text-white font-black text-sm">Yes, delete</button><button onClick={()=>setConfirmDelete(null)} className="min-h-[44px] px-4 rounded-xl border border-[var(--line)] font-black text-sm">Cancel</button></div></div>}
      </Sheet>}

      {utangReminder && <Sheet onClose={()=>setUtangReminder(null)} title={utangReminderAll?"Share all unpaid utang":"Share payment reminder"}>
        <p className="text-sm font-semibold text-[var(--muted)]">Preview the friendly reminder image before sharing. Individual reminders show only that utang; combined reminders list each unpaid utang with its date and transaction or promo type.</p>
        <label className="label mt-4 block">Reminder theme<select value={utangReminderTheme} onChange={e=>setUtangReminderTheme(e.target.value as ReminderTheme)} className="field mt-1">{Object.entries(reminderThemeNames).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
        <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface2)] p-2"><img src={reminderPreview} alt="Preview of the utang payment reminder image" className="mx-auto max-h-[52vh] w-full rounded-xl object-contain"/></div>
        <div className="grid grid-cols-2 gap-2 mt-4"><button type="button" disabled={utangReminderBusy} onClick={shareUtangReminder} className="big-btn bg-[var(--green)] text-white"><Share2 size={18}/>{utangReminderBusy?'Preparing…':utangReminderAll?'Share combined image':'Share image'}</button><button type="button" disabled={utangReminderBusy} onClick={downloadUtangReminder} className="big-btn border-2 border-[var(--line)]"><Download size={18}/>Download PNG</button></div>
        <button type="button" onClick={copyUtangReminderText} className="big-btn border border-[var(--line)] w-full mt-2"><Copy size={17}/>Copy reminder text</button>
      </Sheet>}

      {customerDetail && <Sheet onClose={()=>setCustomerDetail(null)} title="Customer detail">
        {(()=>{ const c=customerDetail; const st=customerStats.get(digitsOnly(c.value.phone))||{count:0,amount:0,fees:0,lastDate:'',lastTx:null}; const custTxs=records.filter(r=>digitsOnly(r.value.phone)===digitsOnly(c.value.phone) && salesTypes.includes(r.value.type)); const customerUtangs=records.filter(r=>r.value.utang && r.value.utangStatus!=='paid' && digitsOnly(r.value.phone)===digitsOnly(c.value.phone)); return <div>
          <div className="flex items-center gap-3"><span className="w-14 h-14 rounded-full bg-[#0e2a47] text-white grid place-items-center font-black text-lg shrink-0">{displayInitials(c.value.name, c.value.phone)}</span><div className="min-w-0 flex-1"><p className="font-display font-extrabold text-2xl truncate">{displayNameOnly(c.value.name, c.value.phone)} {st.count>=5 && <span className="text-[11px] font-black bg-[#fef3c7] text-[#92400e] px-2 py-1 rounded-full align-middle">Suki</span>}</p><p className="font-bold text-[var(--muted)]">{isRealName(c.value.name, c.value.phone) ? formatPhone(c.value.phone) : 'No name yet'}</p><p className="text-sm font-bold text-[var(--muted)]">{c.value.notes||'No notes'}</p></div>{!isRealName(c.value.name, c.value.phone) && <button onClick={()=>openAddName(c.value.phone)} className="min-h-[44px] px-3 rounded-full bg-[#fff7ed] border border-[#fdba74] text-[#ea580c] font-black text-xs shrink-0">+ Add Name</button>}</div>
          <div className="grid grid-cols-3 gap-2 mt-4"><Stat label="Transactions" v={String(st.count)}/><Stat label="Total spent" v={peso(st.amount)}/><Stat label="Total fees paid" v={peso(st.fees)}/></div>
          <p className="text-sm font-bold text-[var(--muted)] mt-3">{st.count>0?`Last transaction: ${dateLabel(st.lastDate)} • ${daysAgoLabel(st.lastDate)}`:'No transactions yet.'}</p>
          <div className="grid grid-cols-3 gap-2 mt-3"><button onClick={()=>{const cc=c; setCustomerDetail(null); openNew('E-Load', cc);}} className="min-h-[48px] rounded-xl bg-[var(--green)] text-white font-black text-xs">New E-Load</button><button onClick={()=>{const cc=c; setCustomerDetail(null); openNew('Cash In', cc);}} className="min-h-[48px] rounded-xl bg-[#2563eb] text-white font-black text-xs">New Cash In</button><button onClick={()=>{const cc=c; setCustomerDetail(null); openNew('Cash Out', cc);}} className="min-h-[48px] rounded-xl bg-[var(--purple)] text-white font-black text-xs">New Cash Out</button></div>
          {customerUtangs.length>0 && <button type="button" onClick={()=>{setUtangReminderAll(true);setUtangReminderTheme('classic');setUtangReminder(customerUtangs[0]);setCustomerDetail(null);}} className="big-btn mt-3 w-full bg-[#e8f8ef] text-[#087a48] border border-[#b9e8ca]"><Share2 size={18}/>Share reminder for all unpaid Utang ({customerUtangs.length})</button>}
          <button type="button" onClick={()=>void copyCustomerStatement(c)} className="big-btn mt-3 w-full border border-[var(--line)]"><Share2 size={17}/>Copy customer transaction statement</button>
          <h3 className="font-display font-bold text-lg mt-5">All transactions</h3>
          <div className="divide-y divide-[var(--line)] mt-1">{custTxs.map(r=><TxRow key={r.id} r={r} customers={customerByPhone} onClick={()=>{ setCustomerDetail(null); setDetail(r); }} onAddName={(p)=>openAddName(p)} onRepeat={()=>{ setCustomerDetail(null); repeatTx(r); }} onToggleFavorite={()=>toggleFavoriteForTx(r)} isFavorite={favorites.some(f=>digitsOnly(f.value.phone)===digitsOnly(r.value.phone) && f.value.amount===r.value.amount && f.value.type===r.value.type)} />)}{custTxs.length===0 && <p className="py-4 text-sm font-bold text-[var(--muted)]">No E-Load / Cash In / Cash Out yet for this customer.</p>}</div>
          <div className="grid grid-cols-2 gap-2 mt-5"><button onClick={()=>{const cc=c; setCustomerDetail(null); openCustomerForm(cc);}} className="big-btn bg-[var(--ink)] text-white"><Pencil size={18}/> Edit</button><button onClick={()=>setConfirmDeleteCustomer(c)} className="big-btn border-2 border-red-200 text-[var(--red)]"><Trash2 size={18}/> Delete</button></div>
          {confirmDeleteCustomer && <div className="mt-4 rounded-2xl border border-red-200 p-3"><p className="font-bold text-sm">Delete {confirmDeleteCustomer.value.name}? Past transactions will stay and show as Deleted Customer.</p><div className="flex gap-2 mt-2"><button onClick={()=>deleteCustomer(confirmDeleteCustomer)} className="min-h-[44px] px-4 rounded-xl bg-[var(--red)] text-white font-black text-sm">Yes, delete</button><button onClick={()=>setConfirmDeleteCustomer(null)} className="min-h-[44px] px-4 rounded-xl border border-[var(--line)] font-black text-sm">Cancel</button></div></div>}
        </div> })()}
      </Sheet>}

      {showCustomerForm && <Sheet onClose={()=>setShowCustomerForm(false)} title={editingCustomer?'Edit customer':'Add customer'}>
        <label className="label block">Name *</label><input value={cName} onChange={e=>setCName(e.target.value)} placeholder="Juan Dela Cruz" className="field mt-1" autoFocus/>
        <label className="label block mt-4">Phone number * — 11 digits</label><input value={formatPhone(cPhone)} onChange={e=>setCPhone(digitsOnly(e.target.value).slice(0,11))} placeholder="09XX XXX XXXX" inputMode="tel" className="field mt-1"/>
        <p className="text-xs font-bold text-[var(--muted)] mt-1">Auto-formats as 09XX XXX XXXX.</p>
        <label className="label block mt-4">Notes (optional)</label><input value={cNotes} onChange={e=>setCNotes(e.target.value)} placeholder="suki, kapitbahay, tindahan" className="field mt-1"/>
        {customerMsg && <p className="text-sm font-bold text-[var(--red)] mt-3">{customerMsg}</p>}
        <button disabled={saving} onClick={saveCustomerFromForm} className="big-btn bg-[var(--green)] text-white w-full mt-5">{saving?'Saving…':editingCustomer?'Save Changes':'Save Customer'}</button>
        <button onClick={()=>setShowCustomerForm(false)} className="big-btn border border-[var(--line)] w-full mt-2">Cancel</button>
      </Sheet>}

      {showWalletAction && <Sheet onClose={()=>setShowWalletAction(null)} title={`${walletMode==='add'?'Add funds':'Deduct funds'} — ${walletDefs.find(w=>w.key===showWalletAction)?.label}`}>
        <p className="font-bold text-sm text-[var(--muted)]">Current balance: {peso(meta.wallets[showWalletAction])}</p>
        <label className="label block mt-3">Amount</label><input type="number" min="0.01" step="0.01" value={walletAmt} onChange={e=>setWalletAmt(Number(e.target.value))} className="field mt-1" inputMode="decimal"/>
        {walletMode==='deduct' ? <><label className="label block mt-3">Reason / category</label><select value={walletActionCategory} onChange={e=>setWalletActionCategory(e.target.value)} className="field mt-1"><option>Shopee / Online shopping</option><option>Store purchase</option><option>Personal use</option><option>Other</option></select><label className="label block mt-3">Details (optional)</label><input value={walletActionNote} onChange={e=>setWalletActionNote(e.target.value)} placeholder="e.g. Shopee order, supplies from a nearby store" className="field mt-1"/><p className="text-xs font-bold text-[var(--muted)] mt-2">This records a wallet expense, not a sale or profit. The deduction will appear in Wallet Activity.</p></> : <><label className="label block mt-3">Details (optional)</label><input value={walletActionNote} onChange={e=>setWalletActionNote(e.target.value)} placeholder="Reason for balance correction" className="field mt-1"/><p className="text-xs font-bold text-[var(--muted)] mt-2">This records a balance correction; it is separate from sales and External Provider top-ups.</p></>}
        <button disabled={saving} onClick={doWalletAction} className="big-btn bg-[var(--green)] text-white w-full mt-5">{saving?'Saving…':walletMode==='add'?`Add ${peso(walletAmt)}`:`Deduct ${peso(walletAmt)}`}</button>
        <button onClick={()=>setShowWalletAction(null)} className="big-btn border border-[var(--line)] w-full mt-2">Cancel</button>
      </Sheet>}

      {showEOD && <Sheet onClose={()=>setShowEOD(false)} title="End of Day — Close Day">
        <p className="font-bold text-[var(--muted)]">{fullDate(todayKey())} • All via Main Wallet</p>
        <div className="grid grid-cols-2 gap-3 mt-3"><Stat label="Date" v={dateLabel(todayKey())}/><Stat label="Starting Float" v={peso(startingFloat)}/><Stat label="Total E-Load" v={peso(sum(eloadToday,t=>t.amount))}/><Stat label="Total Cash In" v={peso(sum(cashInToday,t=>t.amount))}/><Stat label="Total Cash Out" v={peso(sum(cashOutToday,t=>t.amount))}/><Stat label="Total Top-Up" v={peso(sum(topUpToday,t=>t.amount))}/><Stat label="Total Profit / Fees" v={peso(todayProfit)}/><Stat label="Expected Cash on Hand" v={peso(expectedCash)}/><Stat label="Expected Main Wallet" v={peso(meta.wallets.maribank)}/><Stat label="Transactions" v={String(todayTxs.filter(t=>salesTypes.includes(t.type)).length)}/></div>
        {maribankLow && <p className="text-xs font-black text-[#92400e] bg-[#fffbeb] border border-[#fbbf24] px-2.5 py-2 rounded-xl mt-3">Main Wallet low - top up soon (threshold {peso(meta.lowThreshold)})</p>}
        <div className="rounded-2xl bg-[var(--surface2)] p-3 mt-3 text-sm font-bold space-y-1"><p>E-Load: {eloadToday.length} • {peso(sum(eloadToday,t=>t.amount))}</p><p>Cash In: {cashInToday.length} • {peso(sum(cashInToday,t=>t.amount))} • fees {peso(sum(cashInToday,t=>t.fee))}</p><p>Cash Out: {cashOutToday.length} • {peso(sum(cashOutToday,t=>t.amount))} • fees {peso(sum(cashOutToday,t=>t.fee))}</p><p>External Provider Top-Ups: {topUpToday.length} • {peso(sum(topUpToday,t=>t.amount))} • fees {peso(sum(topUpToday,t=>t.fee))}</p></div>
        <label className="label block mt-4">Cash Count — Actual Cash Counted</label><input type="number" value={actualCash} onChange={e=>{ const v=Number(e.target.value); setActualCash(v); if(!tomorrowTouched) setTomorrowFloat(v); }} className="field mt-1" inputMode="decimal"/>
        <div className="rounded-2xl p-3 mt-3 font-bold text-sm" style={{background:'#f7faf7'}}><p>Expected: {peso(expectedCash)} • Counted: {peso(actualCash)}</p><p style={{color:diffColor}}>Difference: {diffLabel}</p></div>
        <section className="mt-3 rounded-2xl border border-[var(--line)] p-3"><h3 className="font-display font-bold">Reconcile today&apos;s transactions</h3><p className="text-xs font-semibold text-[var(--muted)] mt-1">Unpaid Utang is excluded from cash received. Check each entry against your receipts and cash drawer.</p><div className="mt-2 max-h-56 overflow-y-auto divide-y divide-[var(--line)]">{todayTxs.slice().sort((a,b)=>a.time.localeCompare(b.time)).map((t,i)=><div key={`${t.createdAt}-${i}`} className="py-2 flex justify-between gap-3 text-sm"><span className="min-w-0"><b className="block truncate">{t.type==='E-Load'?`${t.network} E-Load`:t.type} • {t.time}</b><span className="block text-xs text-[var(--muted)] truncate">{t.customerName||t.phone||t.notes||'No customer'}{t.utang&&t.utangStatus!=='paid'?' • UNPAID UTANG — not counted':''}</span></span><span className="shrink-0 text-right font-black">{peso(t.amount)}<span className="block text-xs text-[var(--muted)]">Fee {peso(t.fee||0)}</span></span></div>)}{todayTxs.length===0&&<p className="py-3 text-sm font-semibold text-[var(--muted)]">No transactions recorded today.</p>}</div></section>
        <label className="label block mt-4">Float Tracker — Tomorrow&apos;s Starting Float</label><input type="number" value={tomorrowFloat} onChange={e=>{ setTomorrowFloat(Number(e.target.value)); setTomorrowTouched(true); }} className="field mt-1" inputMode="decimal"/>
        <p className="text-xs font-bold text-[var(--muted)] mt-1">Defaults to Actual Cash Counted. Tomorrow starts fresh with this float.</p>
        <button disabled={saving} onClick={endOfDay} className="big-btn bg-[var(--ink)] text-white w-full mt-5">{saving?'Archiving…':'Close Day & Save Report'}</button>
        <button onClick={()=>setShowEOD(false)} className="big-btn border border-[var(--line)] w-full mt-2">Cancel</button>
      </Sheet>}

      {addNameTarget && <Sheet onClose={()=>setAddNameTarget(null)} title="Add Name">
        <p className="font-bold text-sm text-[var(--muted)]">For number <b className="text-[var(--ink)]">{formatPhone(addNameTarget.phone)}</b></p>
        <label className="label block mt-4">Customer Name</label>
        <input value={addNameValue} onChange={e=>setAddNameValue(e.target.value)} placeholder="e.g. Juan, Maria, Suki" className="field mt-1" autoFocus aria-label="Customer Name" />
        {addNameMsg && <p className="text-sm font-bold text-[var(--red)] mt-2">{addNameMsg}</p>}
        <button disabled={addNameSaving || !addNameValue.trim()} onClick={saveAddNamePopup} className="big-btn bg-[#ea580c] text-white w-full mt-5">{addNameSaving?'Saving…':'Save Name'}</button>
        <button onClick={()=>setAddNameTarget(null)} className="big-btn border border-[var(--line)] w-full mt-2">Cancel</button>
      </Sheet>}

      {showHelp && <Sheet onClose={()=>setShowHelp(false)} title="Keyboard Shortcuts">
        <p className="text-sm font-bold text-[var(--muted)]">Cash-register mode — work without the mouse. Shortcuts pause while you type in a field. Press <Kbd>?</Kbd> to close.</p>
        <div className="grid sm:grid-cols-2 gap-3 mt-4">
          <div className="rounded-2xl bg-[var(--surface2)] p-3"><h3 className="font-display font-bold">Navigation</h3><ul className="text-sm font-bold space-y-1.5 mt-2"><li><Kbd>D</Kbd> Dashboard</li><li><Kbd>T</Kbd> Transactions</li><li><Kbd>U</Kbd> Customers (Users)</li><li><Kbd>G</Kbd> Utang</li><li><Kbd>W</Kbd> Wallets</li><li><Kbd>R</Kbd> Report</li><li><Kbd>S</Kbd> Settings</li><li><Kbd>/</Kbd> Focus search</li><li><Kbd>Esc</Kbd> Close / back to Dashboard</li><li><Kbd>?</Kbd> / <Kbd>H</Kbd> This help</li></ul></div>
          <div className="rounded-2xl bg-[var(--surface2)] p-3"><h3 className="font-display font-bold">Quick Actions</h3><ul className="text-sm font-bold space-y-1.5 mt-2"><li><Kbd>1</Kbd> E-Load Sale</li><li><Kbd>2</Kbd> Cash In</li><li><Kbd>3</Kbd> Cash Out</li><li><Kbd>4</Kbd> Top-Up via External Provider</li><li><Kbd>N</Kbd> New (E-Load / New Customer)</li><li><Kbd>C</Kbd> Cash Count / End Day (Dashboard only)</li><li><Kbd>X</Kbd> Close Day (Dashboard only)</li></ul></div>
          <div className="rounded-2xl bg-[var(--surface2)] p-3"><h3 className="font-display font-bold">Forms</h3><ul className="text-sm font-bold space-y-1.5 mt-2"><li><Kbd>Tab</Kbd> Customer → Amount → Fee → Notes → Save</li><li><Kbd>Enter</Kbd> Save</li><li><Kbd>Ctrl</Kbd>+<Kbd>Enter</Kbd> Save &amp; Add Another (same customer)</li><li><Kbd>Esc</Kbd> Cancel</li><li><Kbd>↑</Kbd><Kbd>↓</Kbd> Move in customer suggestions</li><li><Kbd>Enter</Kbd> Pick highlighted customer</li><li><Kbd>A</Kbd> ₱20 · <Kbd>S</Kbd> ₱50 · <Kbd>D</Kbd> ₱100 · <Kbd>F</Kbd> ₱200 · <Kbd>G</Kbd> ₱500 (form open, not typing a name)</li></ul></div>
          <div className="rounded-2xl bg-[var(--surface2)] p-3"><h3 className="font-display font-bold">Lists</h3><ul className="text-sm font-bold space-y-1.5 mt-2"><li><Kbd>↑</Kbd><Kbd>↓</Kbd> or <Kbd>J</Kbd><Kbd>K</Kbd> Move selection</li><li><Kbd>Enter</Kbd> Open selected</li><li><Kbd>E</Kbd> Edit selected</li><li><Kbd>Del</Kbd> / <Kbd>Backspace</Kbd> Delete (with confirm)</li><li><Kbd>F</Kbd> Focus filters, then <Kbd>←</Kbd><Kbd>→</Kbd> to move, <Kbd>Enter</Kbd> to apply</li><li>On Dashboard recent list: <Kbd>↑</Kbd><Kbd>↓</Kbd> + <Kbd>Enter</Kbd> repeats that transaction</li><li>Favorites: tap a chip to pre-fill the sale form</li></ul></div>
        </div>
        <button onClick={()=>setShowHelp(false)} className="big-btn bg-[var(--ink)] text-white w-full mt-4">Close <Kbd>?</Kbd></button>
        <button onClick={()=>setShortcutsOn(v=>!v)} className="big-btn border border-[var(--line)] w-full mt-2">Shortcuts are {shortcutsOn?'ON':'OFF'} — tap to {shortcutsOn?'turn off':'turn on'}</button>
      </Sheet>}
    </div>
  );
}

function CustomerSuggest({query, onQuery, customers, stats, recentPhones, frequent, label, required, onPick, onSaveNew}:{query:string; onQuery:(q:string)=>void; customers:CustomerRecord[]; stats:Map<string,{count:number;amount:number;fees:number;lastDate:string;lastTx:Tx|null}>; recentPhones:string[]; frequent:CustomerRecord[]; label:string; required:boolean; onPick:(c:CustomerRecord)=>void; onSaveNew:(p:{name:string;phone:string})=>Promise<void>}){
  const [focused,setFocused]=useState(false);
  const [savingNew,setSavingNew]=useState(false);
  const [highlight,setHighlight]=useState(0);
  const q=query.trim(); const qd=digitsOnly(query);
  const matches = q ? customers.filter(c=> c.value.name.toLowerCase().includes(q.toLowerCase()) || (qd && digitsOnly(c.value.phone).includes(qd))).slice(0,5) : [];
  const recent = recentPhones.map(p=>customers.find(c=>digitsOnly(c.value.phone)===p)).filter(Boolean) as CustomerRecord[];
  const showRecent = focused && !q && recent.length>0;
  const showFrequent = focused && !q && frequent.length>0;
  const parsed=parseCustomerQuery(query);
  const exactMatch = customers.some(c=> digitsOnly(c.value.phone)===parsed.phone && parsed.phone.length===11 && c.value.name.toLowerCase()===parsed.name.toLowerCase());
  const canSaveNew = q.length>=2 && parsed.phone.length===11 && !exactMatch && !customers.some(c=>digitsOnly(c.value.phone)===parsed.phone);
  const dropdownItems:CustomerRecord[] = matches.length>0 ? matches : showRecent ? recent.slice(0,5) : showFrequent ? frequent.slice(0,5) : [];
  const showDropdown = focused && (matches.length>0 || showRecent || showFrequent || canSaveNew);
  useEffect(()=>{ setHighlight(0); },[query, matches.length]);
  const pickHighlighted = ()=>{ const item=dropdownItems[highlight]; if(item){ onPick(item); setFocused(false); return true; } return false; };
  return <div data-arrow-group="customer" className="mt-4">
    <label className="label block">{label}{required?' *':''}</label>
    <div className="relative mt-1"><Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted)]" size={18}/><input data-customer-input="true" value={query} onChange={e=>onQuery(e.target.value)} onFocus={()=>setFocused(true)} onBlur={()=>{ setTimeout(()=>setFocused(false),180); }} onKeyDown={(e)=>{ if(e.key==='ArrowDown' && showDropdown){ e.preventDefault(); e.stopPropagation(); setHighlight(h=>Math.min(dropdownItems.length-1, h+1)); } else if(e.key==='ArrowUp' && showDropdown){ e.preventDefault(); e.stopPropagation(); setHighlight(h=>Math.max(0, h-1)); } else if(e.key==='Enter' && showDropdown && dropdownItems.length){ e.preventDefault(); e.stopPropagation(); pickHighlighted(); } else if(e.key==='Escape' && showDropdown){ e.preventDefault(); e.stopPropagation(); setFocused(false); (e.target as HTMLElement).blur(); } }} placeholder="Type name or number — e.g. Juan or 0917…" className="field pl-10" inputMode="text" autoComplete="off" aria-label={label}/></div>
    <p className="text-xs font-bold text-[var(--muted)] mt-1">Type 1 letter or digit to see matches. Pick one to fill name + number.</p>
    {showDropdown && <div className="mt-2 rounded-2xl border border-[var(--line)] bg-[var(--surface)] overflow-hidden shadow-lg max-h-[300px] overflow-y-auto">
      {matches.length>0 && <div><p className="label px-3 pt-3">Matches</p>{matches.map((c,idx)=>{ const st=stats.get(digitsOnly(c.value.phone)); const hl=idx===highlight; return <button key={c.id} type="button" onMouseEnter={()=>setHighlight(idx)} onMouseDown={(e)=>{e.preventDefault(); onPick(c); setFocused(false);}} className={`w-full flex items-center gap-3 px-3 py-3 text-left min-h-[60px] ${hl?'bg-[var(--green-soft)] ring-2 ring-inset ring-[var(--green)]':'hover:bg-[var(--surface2)]'}`}><span className="w-11 h-11 rounded-full bg-[#0e2a47] text-white grid place-items-center font-black shrink-0 text-[13px]">{displayInitials(c.value.name, c.value.phone)}</span><span className="flex-1 min-w-0"><span className="block font-extrabold truncate">{displayNamePhone(c.value.name, c.value.phone)}</span><span className="block text-xs font-bold text-[var(--muted)]">{st?.lastTx?`Last: ${peso(st.lastTx.amount)} ${st.lastTx.type} ${daysAgoLabel(st.lastDate)}`:''}</span></span><ChevronRight size={16} className="text-[var(--muted)] shrink-0"/></button> })}</div>}
      {showRecent && <div><p className="label px-3 pt-3">Recent</p>{recent.slice(0,5).map((c,idx)=>{ const st=stats.get(digitsOnly(c.value.phone)); const hl=idx===highlight; return <button key={c.id} type="button" onMouseEnter={()=>setHighlight(idx)} onMouseDown={(e)=>{e.preventDefault(); onPick(c); setFocused(false);}} className={`w-full flex items-center gap-3 px-3 py-3 text-left min-h-[60px] ${hl?'bg-[var(--green-soft)] ring-2 ring-inset ring-[var(--green)]':'hover:bg-[var(--surface2)]'}`}><span className="w-11 h-11 rounded-full bg-[#0e2a47] text-white grid place-items-center font-black shrink-0 text-[13px]">{displayInitials(c.value.name, c.value.phone)}</span><span className="flex-1 min-w-0"><span className="block font-extrabold truncate">{displayNamePhone(c.value.name, c.value.phone)}</span><span className="block text-xs font-bold text-[var(--muted)]">{st?.lastTx?`Last: ${peso(st.lastTx.amount)} ${st.lastTx.type} ${daysAgoLabel(st.lastDate)}`:''}</span></span><ChevronRight size={16} className="text-[var(--muted)] shrink-0"/></button> })}</div>}
      {showFrequent && <div><p className="label px-3 pt-3">Frequent</p>{frequent.slice(0,5).map((c,idx)=>{ const st=stats.get(digitsOnly(c.value.phone)); const hl=idx===highlight; return <button key={c.id} type="button" onMouseEnter={()=>setHighlight(idx)} onMouseDown={(e)=>{e.preventDefault(); onPick(c); setFocused(false);}} className={`w-full flex items-center gap-3 px-3 py-3 text-left min-h-[60px] ${hl?'bg-[var(--green-soft)] ring-2 ring-inset ring-[var(--green)]':'hover:bg-[var(--surface2)]'}`}><span className="w-11 h-11 rounded-full bg-[var(--green)] text-white grid place-items-center font-black shrink-0 text-[13px]">{displayInitials(c.value.name, c.value.phone)}</span><span className="flex-1 min-w-0"><span className="block font-extrabold truncate">{displayNamePhone(c.value.name, c.value.phone)}</span><span className="block text-xs font-bold text-[var(--muted)]">{st?.count||0} transactions</span></span><ChevronRight size={16} className="text-[var(--muted)] shrink-0"/></button> })}</div>}
      {canSaveNew && <button type="button" disabled={savingNew} onMouseDown={async(e)=>{e.preventDefault(); setSavingNew(true); try{ await onSaveNew(parsed); } finally{ setSavingNew(false); setFocused(false); }}} className="w-full flex items-center gap-2 px-3 py-3.5 text-left bg-[var(--green-soft)] font-black text-[var(--green)] text-sm min-h-[56px]"><UserPlus size={19} className="shrink-0"/> {savingNew?'Saving…':`+ Save "${displayNamePhone(parsed.name, parsed.phone)}" as new customer`}</button>}
      {!canSaveNew && q && matches.length===0 && <p className="px-3 py-3 text-sm font-bold text-[var(--muted)]">No saved customer matches. Type a full 11-digit number + name to save as new, or finish typing and save — it will auto-save with the transaction.</p>}
    </div>}
  </div>;
}

function TxRow({r,customers,onClick,onAddName,selected,selectedRef,onRepeat,onToggleFavorite,isFavorite}:{r:TxRecord; customers:Map<string,CustomerRecord>; onClick:()=>void; onAddName?:(phone:string)=>void; selected?:boolean; selectedRef?:React.RefObject<HTMLDivElement>; onRepeat?:()=>void; onToggleFavorite?:()=>void; isFavorite?:boolean}){
  const v=r.value; const icon = v.type==='E-Load'?<Smartphone size={19}/>: v.type==='Cash In'?<ArrowDownToLine size={19}/>: v.type==='Cash Out'?<ArrowUpFromLine size={19}/>:<RefreshCw size={19}/>;
  const bg = v.type==='E-Load'?'#e0f2fe': v.type==='Cash In'?'#dbeafe': v.type==='Cash Out'?'#ede9fe':'#e8f8ef';
  const color = v.type==='E-Load'?'#0369a1': v.type==='Cash In'?'#1d4ed8': v.type==='Cash Out'?'#6d28d9':'#007a3d';
  const cust=customers.get(digitsOnly(v.phone||''));
  const deleted=!cust && isRealName(v.customerName, v.phone) && !!v.phone;
  const hasName = cust ? isRealName(cust.value.name, v.phone) : isRealName(v.customerName, v.phone);
  const label = v.type==='Top-Up' ? 'Top-Up via External Provider' : v.type==='E-Load' ? `E-Load • ${v.network}` : `${v.type} • Main Wallet`;
  const customerLine = v.type==='Top-Up' ? (hasName ? displayNamePhone(cust?.value.name || v.customerName, v.phone) : v.phone?formatPhone(v.phone):'External Provider → Main Wallet') : deleted ? `Deleted Customer • ${formatPhone(v.phone)}` : hasName ? displayNamePhone(cust?.value.name || v.customerName, v.phone) : v.phone ? formatPhone(v.phone) : 'No customer';
  return <div ref={selectedRef as any} onClick={onClick} className={`dashboard-tx-row w-full flex items-center gap-2 sm:gap-3 px-4 py-3.5 text-left min-h-[64px] cursor-pointer ${selected?'bg-[var(--green-soft)] ring-2 ring-inset ring-[var(--green)]':'hover:bg-[var(--surface2)]'}`} role="button" tabIndex={0} onKeyDown={(e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); onClick(); } }}>
    <span className="w-11 h-11 rounded-xl grid place-items-center shrink-0" style={{background:bg,color}}>{icon}</span>
    <span className="flex-1 min-w-0"><span className="block font-extrabold truncate">{label}{v.utang ? <span className={`ml-2 text-[10px] px-2 py-0.5 rounded-full ${v.utangStatus==='paid'?'bg-[var(--green-soft)] text-[var(--green)]':'bg-[#fef3c7] text-[#92400e]'}`}>{v.utangStatus==='paid'?'Utang Paid':'Utang Unpaid'}</span> : null}</span><span className="block text-xs font-bold text-[var(--muted)] truncate">{customerLine}</span><span className="block text-xs font-bold text-[var(--muted)] truncate">{v.notes||v.payment} • {v.time}</span></span>
    {onToggleFavorite && <button type="button" aria-label={isFavorite?'Remove from favorites':'Add to favorites'} onClick={(e)=>{e.stopPropagation(); onToggleFavorite();}} className={`shrink-0 min-h-[36px] w-9 grid place-items-center rounded-full ${isFavorite?'bg-[#fef3c7] text-[#92400e]':'text-[var(--muted)] hover:bg-[var(--surface2)]'}`}><Star size={16} fill={isFavorite?'currentColor':'none'}/></button>}
    {onRepeat && <button type="button" onClick={(e)=>{e.stopPropagation(); onRepeat();}} className="shrink-0 min-h-[36px] px-2.5 rounded-full bg-[var(--surface2)] border border-[var(--line)] text-[11px] font-black">Repeat</button>}
    {!hasName && v.phone && onAddName && <button type="button" onClick={(e)=>{e.stopPropagation(); onAddName(v.phone);}} className="shrink-0 min-h-[36px] px-2.5 rounded-full bg-[#fff7ed] border border-[#fdba74] text-[#ea580c] text-[11px] font-black">+ Add Name</button>}
    <span className="text-right shrink-0"><span className="block font-display font-extrabold">{peso(v.amount)}</span><span className="block text-xs font-black text-[var(--green)]">{v.type==='Top-Up'?`−${peso(v.fee||0)} fee`:`+${peso(v.fee||0)} fee`}</span></span>
    <ChevronRight size={16} className="text-[var(--muted)] shrink-0"/>
  </div>;
}
function Row({k,v}:{k:string;v:string}){ return <div className="flex justify-between gap-3"><dt className="text-[var(--muted)]">{k}</dt><dd className="text-right break-words">{v}</dd></div>; }
function Stat({label,v}:{label:string;v:string}){ return <div className="rounded-2xl bg-[var(--surface2)] p-3"><p className="label">{label}</p><p className="font-display font-extrabold text-xl mt-1">{v}</p></div>; }
function Sheet({children,onClose,title}:{children:React.ReactNode; onClose:()=>void; title:string}){
  const ref=useRef<HTMLDivElement|null>(null);
  const openerRef=useRef<HTMLElement|null>(null);
  useEffect(()=>{
    openerRef.current=document.activeElement as HTMLElement|null;
    const container=ref.current; if(!container) return;
    const prevOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    const t=setTimeout(()=>{
      const focusables=getFocusableElements(container);
      if(!focusables.length) return;
      const firstField=focusables.find(el=>(el.tagName==='INPUT'||el.tagName==='TEXTAREA'||el.tagName==='SELECT'));
      const firstNonClose=focusables.find(el=>el.getAttribute('aria-label')!=='Close');
      (firstField||firstNonClose||focusables[0]).focus();
    },30);
    return ()=>{ clearTimeout(t); document.body.style.overflow=prevOverflow; const opener=openerRef.current; if(opener && document.body.contains(opener)) opener.focus(); };
  },[]);
  const onKeyDown=(e:React.KeyboardEvent)=>{
    const container=ref.current; if(!container) return;
    if(e.key==='Tab'){
      const focusables=getFocusableElements(container);
      if(!focusables.length){ e.preventDefault(); return; }
      const first=focusables[0], last=focusables[focusables.length-1];
      const active=document.activeElement as HTMLElement|null;
      if(e.shiftKey && (active===first || !container.contains(active))){ e.preventDefault(); last.focus(); }
      else if(!e.shiftKey && active===last){ e.preventDefault(); first.focus(); }
      else if(active && !container.contains(active)){ e.preventDefault(); first.focus(); }
      return;
    }
    handleModalArrowKeys(e, container);
  };
  return <div ref={ref} onKeyDown={onKeyDown} className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
    <div className="sheet-panel w-full max-w-[560px] max-h-[92vh] overflow-y-auto bg-[var(--surface)] rounded-t-[24px] sm:rounded-[24px] p-5 pb-8 shadow-2xl">
      <div className="flex justify-between items-center gap-3"><h2 className="font-display font-bold text-[22px]">{title}</h2><button onClick={onClose} className="w-10 h-10 grid place-items-center rounded-full bg-[var(--surface2)]" aria-label="Close"><X size={20}/></button></div>
      <div className="sheet-body mt-4">{children}</div>
    </div>
  </div>;
}
function ServicesModal({highlight,onHighlight,onClose,onSelect}:{highlight:number; onHighlight:(i:number)=>void; onClose:()=>void; onSelect:(t:TxType)=>void}){
  const ref=useRef<HTMLDivElement|null>(null);
  const openerRef=useRef<HTMLElement|null>(null);
  const services:{type:TxType; label:string; icon:any; className:string; style?:React.CSSProperties}[]=[
    {type:'E-Load', label:'E-Load Sale', icon:Smartphone, className:'bg-[var(--green)] text-white'},
    {type:'Cash In', label:'Cash In', icon:ArrowDownToLine, className:'bg-[#2563eb] text-white'},
    {type:'Cash Out', label:'Cash Out', icon:ArrowUpFromLine, className:'bg-[var(--purple)] text-white'},
    {type:'Top-Up', label:'Top-Up via External Provider', icon:RefreshCw, className:'bg-white text-[#007a3d] border-2 border-[#00a651]', style:{background:'#e8f8ef'}},
  ];
  useEffect(()=>{
    openerRef.current=document.activeElement as HTMLElement|null;
    const container=ref.current; if(!container) return;
    const prevOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    const t=setTimeout(()=>{
      const btns=container.querySelectorAll<HTMLElement>('[data-service-index]');
      const first=btns[highlight]||btns[0];
      if(first) first.focus();
    },30);
    return ()=>{ clearTimeout(t); document.body.style.overflow=prevOverflow; const opener=openerRef.current; if(opener && document.body.contains(opener)) opener.focus(); };
  },[]);
  const focusService=(idx:number)=>{
    const container=ref.current; if(!container) return;
    const btns=container.querySelectorAll<HTMLElement>('[data-service-index]');
    const el=btns[idx]; if(el) el.focus();
  };
  const onKeyDown=(e:React.KeyboardEvent)=>{
    const container=ref.current; if(!container) return;
    if(e.key==='Tab'){
      const focusables=getFocusableElements(container);
      if(!focusables.length){ e.preventDefault(); return; }
      const first=focusables[0], last=focusables[focusables.length-1];
      const active=document.activeElement as HTMLElement|null;
      if(e.shiftKey && (active===first || !container.contains(active))){ e.preventDefault(); last.focus(); }
      else if(!e.shiftKey && active===last){ e.preventDefault(); first.focus(); }
      else if(active && !container.contains(active)){ e.preventDefault(); first.focus(); }
      return;
    }
    if(e.key==='ArrowLeft'||e.key==='ArrowRight'||e.key==='ArrowUp'||e.key==='ArrowDown'){
      e.preventDefault(); e.stopPropagation();
      const next=(e.key==='ArrowLeft'||e.key==='ArrowRight') ? (highlight ^ 1) : (highlight ^ 2);
      onHighlight(next); focusService(next); return;
    }
    if(e.key==='1'||e.key==='2'||e.key==='3'||e.key==='4'){
      e.preventDefault(); e.stopPropagation();
      onSelect(services[Number(e.key)-1].type); return;
    }
    if(e.key==='Enter' || e.key===' ' || e.key==='Spacebar'){
      const target=e.target as HTMLElement;
      const idxAttr=target.closest('[data-service-index]')?.getAttribute('data-service-index');
      if(idxAttr!==null && idxAttr!==undefined){
        e.preventDefault(); e.stopPropagation();
        onSelect(services[Number(idxAttr)].type);
      }
      return;
    }
  };
  return <div ref={ref} onKeyDown={onKeyDown} className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Choose Service">
    <div className="sheet-panel services-panel w-full max-w-[560px] max-h-[92vh] overflow-y-auto bg-[var(--surface)] rounded-t-[24px] sm:rounded-[24px] p-5 pb-8 shadow-2xl">
      <div className="flex justify-between items-center gap-3"><h2 className="font-display font-bold text-[22px]">Choose Service</h2><button onClick={onClose} className="w-10 h-10 grid place-items-center rounded-full bg-[var(--surface2)]" aria-label="Close"><X size={20}/></button></div>
      <p className="text-sm font-bold text-[var(--muted)] mt-2">Pick a service to start a transaction.</p>
      <div className="services-grid grid grid-cols-2 gap-3 mt-4">
        {services.map((s,i)=>{ const Icon=s.icon; const active=highlight===i; return <button key={s.type} type="button" data-service-index={i} onClick={()=>onSelect(s.type)} onFocus={()=>onHighlight(i)} onMouseEnter={()=>onHighlight(i)} className={`big-btn min-h-[96px] sm:min-h-[108px] px-3 text-center flex-col gap-2 text-[15px] sm:text-base leading-tight ${s.className} ${active?'ring-4 ring-[var(--ink)] ring-offset-2 ring-offset-[var(--surface)] scale-[1.02]':''}`} style={s.style}><Icon size={26}/>{s.label}</button>; })}
      </div>
      <button onClick={onClose} className="big-btn border border-[var(--line)] w-full mt-4">Cancel</button>
    </div>
  </div>;
}


export default function App(){
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState('');
  const [previewMode, setPreviewMode] = useState(false);
  useEffect(() => observeAuth(auth, u => { if(!localPreviewMode){ activeUser = u; setUser(u); } setAuthReady(true); }), []);
  const handleSignIn = async () => { setSigningIn(true); setAuthError(''); try { await signInWithGoogle(); } catch (e) { setAuthError(e instanceof Error ? e.message : 'Google sign-in failed. Please try again.'); } finally { setSigningIn(false); } };
  const enterLocalPreview = () => { localPreviewMode=true; activeUser=null; setPreviewMode(true); setUser({uid:'local-preview',displayName:'Local Preview',email:null} as FirebaseUser); };
  const handleSignOut = async () => { if(previewMode){ localPreviewMode=false; setPreviewMode(false); setUser(null); return; } await logOut(); };
  if (!authReady) return <div className="min-h-screen grid place-items-center bg-[#f5f8f6] text-[#163b2a]"><LoaderCircle className="animate-spin" size={30}/><span className="sr-only">Checking sign-in…</span></div>;
  if (!user) return <div className="min-h-screen bg-[#f5f8f6] text-[#163b2a] flex items-center justify-center p-5"><section className="w-full max-w-md rounded-[28px] bg-white shadow-xl border border-[#e1ebe5] p-7 sm:p-9 text-center"><div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-[#e9f7ef] text-[#16834c]"><Smartphone size={28}/></div><p className="text-xs font-black uppercase tracking-[.18em] text-[#16834c]">E-Load Tracker</p><h1 className="mt-2 font-display text-3xl font-extrabold">Your store, in sync.</h1><p className="mt-3 text-sm leading-6 text-slate-600">Sign in with Google to securely access your dashboard and sync your store records across devices.</p><button type="button" onClick={handleSignIn} disabled={signingIn} className="mt-7 flex min-h-12 w-full items-center justify-center gap-3 rounded-xl bg-[#163b2a] px-5 font-bold text-white disabled:opacity-60">{signingIn?<LoaderCircle className="animate-spin" size={20}/>:<span className="grid h-6 w-6 place-items-center rounded-full bg-white text-sm font-black text-[#4285F4]">G</span>}{signingIn?'Connecting…':'Continue with Google'}</button>{authError&&<p role="alert" className="mt-4 text-sm font-semibold text-red-600">{authError}</p>}{import.meta.env.DEV && <><div className="my-5 flex items-center gap-3 text-xs font-bold text-slate-400"><span className="h-px flex-1 bg-slate-200"/>PREVIEW ONLY<span className="h-px flex-1 bg-slate-200"/></div><button type="button" onClick={enterLocalPreview} className="flex min-h-12 w-full items-center justify-center rounded-xl border-2 border-[#16834c] px-5 font-extrabold text-[#16834c] hover:bg-[#effaf3]">Preview without signing in</button><p className="mt-2 text-xs font-semibold text-slate-500">Preview data stays in this browser and is not synced to your Google account.</p></>}<p className="mt-6 text-xs text-slate-500">Your data is stored privately in your Google-account workspace.</p></section></div>;
  return <><div className="account-session-bar">{previewMode&&<span className="mr-auto rounded-full bg-amber-100 px-3 py-1 text-xs font-black text-amber-900">Preview mode · local data only</span>}<span className="account-session-name">{user.displayName || user.email}</span><button onClick={handleSignOut} aria-label={previewMode?'Exit preview':'Sign out'} title={previewMode?'Exit preview':'Sign out'} className="account-session-signout"><LogOut size={17}/><span>{previewMode?'Exit preview':'Sign out'}</span></button></div><Dashboard/></>;
}
