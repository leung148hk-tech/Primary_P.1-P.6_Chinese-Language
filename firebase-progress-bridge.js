import { getApp, getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';
import { doc, getDoc, getFirestore, setDoc } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';

/* 每個題庫頁共用此橋接器。它不處理密碼、角色或授權；規則以 UID 強制限制資料存取。 */
const firebaseConfig = {
  apiKey: 'AIzaSyC_MSMghlz2zo3vMwbbHCGU3acFD6KMyo8',
  authDomain: 'chinese-training-platform.firebaseapp.com',
  projectId: 'chinese-training-platform',
  storageBucket: 'chinese-training-platform.firebasestorage.app',
  messagingSenderId: '231283500811',
  appId: '1:231283500811:web:8e85c0ad813f1631f9a40e'
};
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const OWNER_KEY = '__secure_profile_uid';
const FINGERPRINT_PREFIX = '__secure_progress_fingerprint_';
const SYNC_INTERVAL_MS = 60000;
const MAX_KEYS = 120;
const MAX_VALUE_LENGTH = 16000;
const MAX_BYTES = 300000;

const expKeys = [
  'userExp', 'stdExp', 'advExp', 'sentBasicExp', 'sentStandardExp', 'sentAdvExp', 'sentAdvExp_v2',
  'rhetBasicExp', 'rhetStdExp', 'rhetAdvExp', 'paraBasicExp', 'paraStdExp', 'paraAdvExp',
  'readBasicExp', 'readStandardExp', 'readAdvExp', 'listenBasicExp', 'listenStandardExp', 'listenAdvExp',
  'cultureBasicExp', 'cultureStandardExp', 'cultureAdvancedExp', 'writeBasicExp_v2', 'writeStdExp_v6',
  'writeStdExp_v9', 'writeAdvExp_v2', 'loginBonusExp'
];
const progressKeys = new Set([
  ...expKeys, 'lastLoginDate',
  'questProgress', 'stdQuestProgress', 'advQuestProgress', 'wordBasicChapterOpenState', 'wordBasicLastQuestionIdx',
  'sentBasicProgress', 'sentStdProgress', 'sentAdvProgress', 'sentBasicChapterOpenState', 'sentBasicLastQuestionIdx',
  'rhetBasicProgress', 'rhetStdProgress', 'rhetAdvProgress', 'paraBasicProgress', 'paraAdvProgress',
  'paraBasicIncompleteOnly', 'paraBasicLastQuestionIdx', 'sandboxCompleted', 'sandboxAdvCompleted',
  'readBasicProgress', 'readStandardProgress', 'readAdvProgress', 'readBasicChapterOpenState', 'readBasicLastPassageIdx',
  'listenBasicProgress', 'listenStandardProgress', 'listenAdvProgress', 'listenBasicIncompleteOnly', 'listenBasicLastTaskIdx',
  'speakBasicProgress', 'speakStandardProgress', 'speakAdvProgress', 'speakBasicIncompleteOnly', 'speakBasicLastTaskIdx',
  'poemBasicProgress', 'poemStandardProgress', 'poemAdvProgress', 'cultureBasicProgress', 'cultureStandardProgress',
  'cultureAdvProgress', 'seqBasicProgress', 'fwBasicProgress', 'exBasicProgress', 'fwStdProgress_v9', 'exStdProgress_v9',
  'trStdProgress_v9', 'writeAdvProgress_v11'
]);
const catKeys = {
  word: ['userExp', 'stdExp', 'advExp'],
  sent: ['sentBasicExp', 'sentStandardExp', 'sentAdvExp', 'sentAdvExp_v2'],
  rhet: ['rhetBasicExp', 'rhetStdExp', 'rhetAdvExp'],
  para: ['paraBasicExp', 'paraStdExp', 'paraAdvExp'],
  read: ['readBasicExp', 'readStandardExp', 'readAdvExp'],
  listen: ['listenBasicExp', 'listenStandardExp', 'listenAdvExp'],
  culture: ['cultureBasicExp', 'cultureStandardExp', 'cultureAdvancedExp'],
  write: ['writeBasicExp_v2', 'writeStdExp_v6', 'writeStdExp_v9', 'writeAdvExp_v2']
};

let activeUser = null;
let activeStudent = false;
let syncing = false;

function allowed(key) {
  return progressKeys.has(key) || /^t_(word|sent|rhet|para|read|listen|culture|write)_[1-3]$/.test(key);
}

function cleanRaw(input) {
  const output = {};
  let size = 0;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return output;
  for (const [key, value] of Object.entries(input)) {
    if (!allowed(key) || typeof value !== 'string' || value.length > MAX_VALUE_LENGTH) continue;
    const bytes = new TextEncoder().encode(`${key}:${value}`).length;
    if (Object.keys(output).length >= MAX_KEYS || size + bytes > MAX_BYTES) break;
    output[key] = value;
    size += bytes;
  }
  return output;
}

function collectRaw() {
  const raw = {};
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key && allowed(key)) raw[key] = localStorage.getItem(key);
  }
  return cleanRaw(raw);
}

function sum(raw, keys) {
  return keys.reduce((total, key) => {
    const value = Number.parseInt(raw[key] || '0', 10);
    return total + (Number.isFinite(value) && value > 0 ? Math.min(value, 100000) : 0);
  }, 0);
}

function payload(raw) {
  const cats = Object.fromEntries(Object.entries(catKeys).map(([name, keys]) => [name, sum(raw, keys)]));
  let badges = 0;
  Object.keys(raw).forEach((key) => { if (/^t_(word|sent|rhet|para|read|listen|culture|write)_[1-3]$/.test(key) && raw[key] === 'true') badges += 1; });
  return { version: 1, raw, totalExp: Math.min(sum(raw, expKeys), 1000000), badges, cats, lastUpdated: new Date().toISOString() };
}

function fingerprint(raw) {
  return JSON.stringify(Object.entries(raw).sort(([a], [b]) => a.localeCompare(b)));
}

function replaceProgress(raw) {
  for (let i = localStorage.length - 1; i >= 0; i -= 1) {
    const key = localStorage.key(i);
    if (key && allowed(key)) localStorage.removeItem(key);
  }
  Object.entries(cleanRaw(raw)).forEach(([key, value]) => localStorage.setItem(key, value));
}

async function initialiseStudent(user) {
  const snapshot = await getDoc(doc(db, 'users', user.uid));
  const profile = snapshot.data();
  activeStudent = Boolean(snapshot.exists() && profile?.role === 'student');
  if (!activeStudent) return;
  if (localStorage.getItem(OWNER_KEY) !== user.uid) {
    replaceProgress(profile?.progress?.raw || {});
    localStorage.setItem(OWNER_KEY, user.uid);
  }
  localStorage.setItem(`${FINGERPRINT_PREFIX}${user.uid}`, fingerprint(collectRaw()));
}

async function sync(force = false) {
  if (!activeStudent || !activeUser || !navigator.onLine || syncing) return false;
  const raw = collectRaw();
  const value = fingerprint(raw);
  const key = `${FINGERPRINT_PREFIX}${activeUser.uid}`;
  if (!force && localStorage.getItem(key) === value) return true;
  syncing = true;
  try {
    await setDoc(doc(db, 'users', activeUser.uid), { progress: payload(raw), updatedAt: new Date().toISOString() }, { merge: true });
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    console.warn('[secure course progress sync]', error);
    return false;
  } finally {
    syncing = false;
  }
}

onAuthStateChanged(auth, async (user) => {
  activeUser = user;
  activeStudent = false;
  if (!user) {
    window.location.replace('index.html');
    return;
  }
  try {
    await initialiseStudent(user);
    if (!activeStudent) window.location.replace('index.html');
  } catch (error) {
    console.warn('[secure course profile]', error);
    window.location.replace('index.html');
  }
});

setInterval(() => { sync(false); }, SYNC_INTERVAL_MS);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') sync(false); });
window.addEventListener('pagehide', () => { sync(false); });
window.addEventListener('beforeunload', () => { sync(false); });
window.addEventListener('secure-progress-save', () => { sync(true); });
