import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js';
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  query,
  setDoc,
  startAfter
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';

/*
 * 安全遷移設計：
 * 1. Firebase Authentication 是唯一的密碼驗證來源。
 * 2. /users/{Firebase Auth UID} 是唯一的正式學生資料位置。
 * 3. 管理員權限必須由 Firestore Security Rules 的 role 欄位強制執行，
 *    此檔案的角色判斷只影響介面，不是授權控制。
 */
const firebaseConfig = {
  apiKey: 'AIzaSyC_MSMghlz2zo3vMwbbHCGU3acFD6KMyo8',
  authDomain: 'chinese-training-platform.firebaseapp.com',
  projectId: 'chinese-training-platform',
  storageBucket: 'chinese-training-platform.firebasestorage.app',
  messagingSenderId: '231283500811',
  appId: '1:231283500811:web:8e85c0ad813f1631f9a40e'
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const ADMIN_USERNAME = 'admin';
const ADMIN_EMAIL = 'admin@chinese-training-platform.invalid';
const STUDENT_EMAIL_DOMAIN = 'students.chinese-training-platform.invalid';
const PROFILE_MARKER_KEY = '__secure_profile_uid';
const PROFILE_NAME_KEY = '__active_realname';
const REMEMBERED_USERNAME_KEY = '__remembered_username';
const SYNC_FINGERPRINT_PREFIX = '__secure_progress_fingerprint_';
const SYNC_DELAY_MS = 45000;
const CLOUD_SYNC_TIMEOUT_MS = 3000;
const MAX_PROGRESS_KEYS = 120;
const MAX_PROGRESS_VALUE_LENGTH = 16000;
const MAX_PROGRESS_BYTES = 300000;

let currentAuthUser = null;
let currentProfile = null;
let syncTimer = null;
let teacherCursor = null;
let teacherHasMore = true;
window.allStudentsCache = [];

const expKeys = [
  'userExp', 'stdExp', 'advExp',
  'sentBasicExp', 'sentStandardExp', 'sentAdvExp', 'sentAdvExp_v2',
  'rhetBasicExp', 'rhetStdExp', 'rhetAdvExp',
  'paraBasicExp', 'paraStdExp', 'paraAdvExp',
  'readBasicExp', 'readStandardExp', 'readAdvExp',
  'listenBasicExp', 'listenStandardExp', 'listenAdvExp',
  'cultureBasicExp', 'cultureStandardExp', 'cultureAdvancedExp',
  'writeBasicExp_v2', 'writeStdExp_v6', 'writeStdExp_v9', 'writeAdvExp_v2',
  'loginBonusExp'
];

const catMap = { 1: 'word', 2: 'sent', 3: 'rhet', 4: 'para', 5: 'read', 6: 'listen', 7: 'culture', 8: 'write' };
const pagesMap = {
  t_word_1: 'word_basic.html', t_word_2: 'word_standard.html', t_word_3: 'word_advanced.html',
  t_sent_1: 'sentence_basic.html', t_sent_2: 'sentence_standard.html', t_sent_3: 'sentence_advanced.html',
  t_rhet_1: 'rhetoric_basic.html', t_rhet_2: 'rhetoric_standard.html', t_rhet_3: 'rhetoric_advanced.html',
  t_para_1: 'paragraph_basic.html', t_para_2: 'paragraph_standard.html', t_para_3: 'paragraph_advanced.html',
  t_read_1: 'read_basic.html', t_read_2: 'read_standard.html', t_read_3: 'read_advanced.html',
  t_listen_1: 'listen_basic.html', t_listen_2: 'listen_standard.html', t_listen_3: 'listen_advanced.html',
  t_culture_1: 'culture_basic.html', t_culture_2: 'culture_standard.html', t_culture_3: 'culture_advanced.html',
  t_write_1: 'write_basic.html', t_write_2: 'write_standard.html', t_write_3: 'write_advanced.html'
};

/* 只同步維持關卡進度所需的鍵；教學提示、診斷、瀏覽器設定與任何未知鍵一律留在本機。 */
const progressKeys = new Set([
  ...expKeys,
  'lastLoginDate',
  'questProgress', 'stdQuestProgress', 'advQuestProgress', 'wordBasicChapterOpenState', 'wordBasicLastQuestionIdx',
  'sentBasicProgress', 'sentStdProgress', 'sentAdvProgress', 'sentBasicChapterOpenState', 'sentBasicLastQuestionIdx',
  'rhetBasicProgress', 'rhetStdProgress', 'rhetAdvProgress',
  'paraBasicProgress', 'paraAdvProgress', 'paraBasicIncompleteOnly', 'paraBasicLastQuestionIdx', 'sandboxCompleted', 'sandboxAdvCompleted',
  'readBasicProgress', 'readStandardProgress', 'readAdvProgress', 'readBasicChapterOpenState', 'readBasicLastPassageIdx',
  'listenBasicProgress', 'listenStandardProgress', 'listenAdvProgress', 'listenBasicIncompleteOnly', 'listenBasicLastTaskIdx',
  'speakBasicProgress', 'speakStandardProgress', 'speakAdvProgress', 'speakBasicIncompleteOnly', 'speakBasicLastTaskIdx',
  'poemBasicProgress', 'poemStandardProgress', 'poemAdvProgress', 'cultureBasicProgress', 'cultureStandardProgress', 'cultureAdvProgress',
  'seqBasicProgress', 'fwBasicProgress', 'exBasicProgress', 'fwStdProgress_v9', 'exStdProgress_v9', 'trStdProgress_v9',
  'writeAdvProgress_v11'
]);

function hideLoader() {
  document.getElementById('global-loader')?.classList.add('hidden');
}

function showLoader(text) {
  const textNode = document.getElementById('loader-text');
  if (textNode) textNode.textContent = text;
  document.getElementById('global-loader')?.classList.remove('hidden');
}

function showAuthError(message) {
  const box = document.getElementById('auth-error-box');
  const text = document.getElementById('auth-error-text');
  if (text) text.textContent = message;
  box?.classList.remove('hidden');
}

function hideAuthError() {
  document.getElementById('auth-error-box')?.classList.add('hidden');
}

function usernameToEmail(username) {
  const normalized = String(username || '').trim().toLowerCase();
  return normalized === ADMIN_USERNAME
    ? ADMIN_EMAIL
    : `${normalized}@${STUDENT_EMAIL_DOMAIN}`;
}

function validateUsername(value) {
  const username = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,15}$/.test(username)) return null;
  return username;
}

function userDocRef(uid = currentAuthUser?.uid) {
  return uid ? doc(db, 'users', uid) : null;
}

function isStudentProfile() {
  return Boolean(currentAuthUser && currentProfile?.role === 'student');
}

function isAdminProfile() {
  return Boolean(currentAuthUser && currentProfile?.role === 'admin');
}

function progressKeyAllowed(key) {
  return progressKeys.has(key) || /^t_(word|sent|rhet|para|read|listen|culture|write)_[1-3]$/.test(key);
}

function cleanRawProgress(input) {
  const clean = {};
  let byteCount = 0;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return clean;
  for (const [key, value] of Object.entries(input)) {
    if (!progressKeyAllowed(key) || typeof value !== 'string' || value.length > MAX_PROGRESS_VALUE_LENGTH) continue;
    const bytes = new TextEncoder().encode(`${key}:${value}`).length;
    if (Object.keys(clean).length >= MAX_PROGRESS_KEYS || byteCount + bytes > MAX_PROGRESS_BYTES) break;
    clean[key] = value;
    byteCount += bytes;
  }
  return clean;
}

function collectLocalProgress() {
  const raw = {};
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key && progressKeyAllowed(key)) raw[key] = localStorage.getItem(key);
  }
  return cleanRawProgress(raw);
}

function replaceLocalProgress(raw) {
  for (let i = localStorage.length - 1; i >= 0; i -= 1) {
    const key = localStorage.key(i);
    if (key && progressKeyAllowed(key)) localStorage.removeItem(key);
  }
  for (const [key, value] of Object.entries(cleanRawProgress(raw))) localStorage.setItem(key, value);
}

function totalForKeys(raw, keys) {
  return keys.reduce((total, key) => {
    const value = Number.parseInt(raw[key] || '0', 10);
    return total + (Number.isFinite(value) && value > 0 ? Math.min(value, 100000) : 0);
  }, 0);
}

function buildProgress(raw = collectLocalProgress()) {
  const cats = {
    word: totalForKeys(raw, ['userExp', 'stdExp', 'advExp']),
    sent: totalForKeys(raw, ['sentBasicExp', 'sentStandardExp', 'sentAdvExp', 'sentAdvExp_v2']),
    rhet: totalForKeys(raw, ['rhetBasicExp', 'rhetStdExp', 'rhetAdvExp']),
    para: totalForKeys(raw, ['paraBasicExp', 'paraStdExp', 'paraAdvExp']),
    read: totalForKeys(raw, ['readBasicExp', 'readStandardExp', 'readAdvExp']),
    listen: totalForKeys(raw, ['listenBasicExp', 'listenStandardExp', 'listenAdvExp']),
    culture: totalForKeys(raw, ['cultureBasicExp', 'cultureStandardExp', 'cultureAdvancedExp']),
    write: totalForKeys(raw, ['writeBasicExp_v2', 'writeStdExp_v6', 'writeStdExp_v9', 'writeAdvExp_v2'])
  };
  let badges = 0;
  for (let i = 1; i <= 8; i += 1) {
    for (let j = 1; j <= 3; j += 1) {
      if (raw[`t_${catMap[i]}_${j}`] === 'true') badges += 1;
    }
  }
  return {
    version: 1,
    raw: cleanRawProgress(raw),
    totalExp: Math.min(totalForKeys(raw, expKeys), 1000000),
    badges,
    cats,
    lastUpdated: new Date().toISOString()
  };
}

function currentFingerprint(raw) {
  return JSON.stringify(Object.entries(cleanRawProgress(raw)).sort(([a], [b]) => a.localeCompare(b)));
}

async function saveLocalToCloud({ force = false } = {}) {
  if (!isStudentProfile() || !navigator.onLine) {
    if (!navigator.onLine) window.StudentSyncStatus?.deferred('目前離線；進度只保存在這台裝置');
    return false;
  }
  const raw = collectLocalProgress();
  const fingerprint = currentFingerprint(raw);
  const fingerprintKey = `${SYNC_FINGERPRINT_PREFIX}${currentAuthUser.uid}`;
  if (!force && localStorage.getItem(fingerprintKey) === fingerprint) {
    window.StudentSyncStatus?.success();
    return true;
  }

  window.StudentSyncStatus?.start();
  const updatedAt = new Date().toISOString();
  try {
    await setDoc(userDocRef(), { progress: buildProgress(raw), updatedAt }, { merge: true });
    localStorage.setItem(fingerprintKey, fingerprint);
    window.StudentSyncStatus?.success();
    return true;
  } catch (error) {
    console.error('[secure progress sync]', error);
    window.StudentSyncStatus?.deferred();
    return false;
  }
}

function scheduleProgressSync() {
  if (!isStudentProfile()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { saveLocalToCloud(); }, SYNC_DELAY_MS);
}

async function syncProgressWithDeadline(activeProfile, options = {}) {
  if (!activeProfile || !isStudentProfile()) return false;
  const timeout = new Promise((resolve) => setTimeout(() => resolve(false), CLOUD_SYNC_TIMEOUT_MS));
  return Promise.race([saveLocalToCloud(options), timeout]);
}

function showLoginScreen() {
  document.getElementById('dashboard-screen')?.classList.add('hidden');
  document.getElementById('dashboard-screen')?.classList.remove('flex');
  document.getElementById('teacher-dashboard')?.classList.add('hidden');
  document.getElementById('teacher-dashboard')?.classList.remove('flex');
  document.getElementById('login-screen')?.classList.remove('hidden');
  window.switchAuthView('login');
  const remembered = localStorage.getItem(REMEMBERED_USERNAME_KEY);
  if (remembered) {
    const input = document.getElementById('login-username');
    const checkbox = document.getElementById('login-remember-me');
    if (input) input.value = remembered;
    if (checkbox) checkbox.checked = true;
  }
  hideLoader();
}

function clearAuthenticationFields() {
  ['login-password', 'register-password', 'teacher-password'].forEach((id) => {
    const input = document.getElementById(id);
    if (input) input.value = '';
  });
}

function showDashboard(profileName) {
  document.getElementById('login-screen')?.classList.add('hidden');
  document.getElementById('teacher-dashboard')?.classList.add('hidden');
  document.getElementById('teacher-dashboard')?.classList.remove('flex');
  document.getElementById('dashboard-screen')?.classList.remove('hidden');
  document.getElementById('dashboard-screen')?.classList.add('flex');
  const name = localStorage.getItem(PROFILE_NAME_KEY) || profileName || '同學';
  const label = document.getElementById('profile-display-name');
  if (label) label.textContent = name;
  updateDashboardUI();
}

function updateDashboardUI() {
  const raw = collectLocalProgress();
  const total = totalForKeys(raw, expKeys);
  const exp = document.getElementById('exp-text');
  if (exp) exp.innerHTML = `${total} <span class="text-sm text-indigo-200 font-bold">EXP</span>`;
  const level = Math.floor(total / 500) + 1;
  const levelNode = document.getElementById('user-level');
  if (levelNode) levelNode.textContent = `Lv. ${level}`;
  const titleNode = document.getElementById('user-title');
  if (titleNode) {
    titleNode.textContent = level >= 20 ? '傳說級文豪' : level >= 15 ? '語文大宗師' : level >= 10 ? '語文大師' : level >= 7 ? '語文小達人' : level >= 4 ? '語文探索者' : '語文見習生';
  }
  const progress = buildProgress(raw);
  for (let i = 1; i <= 8; i += 1) {
    for (let j = 1; j <= 3; j += 1) {
      const id = `t_${catMap[i]}_${j}`;
      const badge = document.getElementById(id);
      if (!badge) continue;
      const unlocked = raw[id] === 'true';
      badge.className = `${unlocked ? 'badge-unlocked font-black' : 'badge-locked font-bold'} w-10 h-10 md:w-12 md:h-12 rounded-xl flex items-center justify-center text-lg md:text-xl select-none`;
      badge.textContent = unlocked ? '🏅' : '🔒';
    }
  }
  const badgeCount = document.getElementById('badge-count');
  const progressText = document.getElementById('progress-text');
  const progressBar = document.getElementById('total-progress-bar');
  if (badgeCount) badgeCount.textContent = String(progress.badges);
  if (progressText) progressText.textContent = `${progress.badges} / 24`;
  if (progressBar) progressBar.style.width = `${(progress.badges / 24) * 100}%`;
}

function checkDailyLogin() {
  if (!isStudentProfile()) return;
  const today = new Date().toLocaleDateString();
  if (localStorage.getItem('lastLoginDate') === today) return;
  const current = Number.parseInt(localStorage.getItem('loginBonusExp') || '0', 10) || 0;
  localStorage.setItem('loginBonusExp', String(current + 10));
  localStorage.setItem('lastLoginDate', today);
  updateDashboardUI();
  const modal = document.getElementById('daily-login-modal');
  modal?.classList.remove('hidden');
  setTimeout(() => modal?.classList.remove('opacity-0'), 10);
  scheduleProgressSync();
}

async function openAuthenticatedProfile(user) {
  currentAuthUser = user;
  const snapshot = await getDoc(userDocRef(user.uid));
  if (!snapshot.exists()) {
    currentProfile = null;
    hideLoader();
    showLoginScreen();
    showAuthError('此登入帳戶尚未完成安全資料設定。請聯絡管理員協助。');
    return;
  }
  const profile = snapshot.data();
  if (!profile || !['student', 'admin'].includes(profile.role)) {
    currentProfile = null;
    showLoginScreen();
    showAuthError('帳戶資料無效，請聯絡管理員協助。');
    return;
  }
  currentProfile = profile;
  const localOwner = localStorage.getItem(PROFILE_MARKER_KEY);
  sessionStorage.setItem('activeProfile', profile.username || (profile.role === 'admin' ? ADMIN_USERNAME : 'student'));
  localStorage.setItem(PROFILE_NAME_KEY, profile.displayName || profile.username || '同學');

  if (profile.role === 'admin') {
    hideLoader();
    window.showTeacherDashboard();
    return;
  }

  if (localOwner === user.uid) {
    await syncProgressWithDeadline(profile.username);
  } else {
    replaceLocalProgress(profile.progress?.raw || {});
    localStorage.setItem(PROFILE_MARKER_KEY, user.uid);
    localStorage.setItem(`${SYNC_FINGERPRINT_PREFIX}${user.uid}`, currentFingerprint(collectLocalProgress()));
  }
  localStorage.setItem(PROFILE_MARKER_KEY, user.uid);
  hideLoader();
  showDashboard(profile.displayName || profile.username);
  checkDailyLogin();
}

function authErrorMessage(error, action) {
  const code = error?.code || '';
  if (code.includes('weak-password')) return '密碼至少需要 6 個字元。';
  if (code.includes('email-already-in-use')) return '此登入帳號已被註冊。';
  if (code.includes('network')) return '網路連線失敗，請稍後再試。';
  return action === 'register' ? '未能建立帳戶，請檢查資料後重試。' : '帳號或密碼不正確，請再試一次。';
}

function resetProgressOnly() {
  replaceLocalProgress({});
  if (currentAuthUser) localStorage.removeItem(`${SYNC_FINGERPRINT_PREFIX}${currentAuthUser.uid}`);
}

function safeText(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

window.togglePasswordVisibility = (inputId) => {
  const input = document.getElementById(inputId);
  if (input) input.type = input.type === 'password' ? 'text' : 'password';
};

window.switchAuthView = (view) => {
  hideAuthError();
  const loginTab = document.getElementById('tab-login');
  const registerTab = document.getElementById('tab-register');
  const login = document.getElementById('view-login');
  const register = document.getElementById('view-register');
  const teacher = document.getElementById('view-teacher-login');
  const tabs = document.getElementById('auth-tabs');
  if (view === 'register') {
    tabs?.classList.remove('hidden');
    loginTab?.classList.replace('auth-tab-active', 'auth-tab-inactive');
    registerTab?.classList.replace('auth-tab-inactive', 'auth-tab-active');
    login?.classList.add('hidden'); register?.classList.remove('hidden'); teacher?.classList.add('hidden');
  } else if (view === 'teacher-portal') {
    tabs?.classList.add('hidden'); login?.classList.add('hidden'); register?.classList.add('hidden'); teacher?.classList.remove('hidden');
  } else {
    tabs?.classList.remove('hidden');
    registerTab?.classList.replace('auth-tab-active', 'auth-tab-inactive');
    loginTab?.classList.replace('auth-tab-inactive', 'auth-tab-active');
    login?.classList.remove('hidden'); register?.classList.add('hidden'); teacher?.classList.add('hidden');
  }
};

async function signInFromForm(usernameInputId, passwordInputId, teacherRequested = false) {
  hideAuthError();
  const username = validateUsername(document.getElementById(usernameInputId)?.value);
  const password = document.getElementById(passwordInputId)?.value || '';
  if (!username || !password) {
    showAuthError('請輸入有效帳號及密碼。');
    return;
  }
  try {
    await signInWithEmailAndPassword(auth, usernameToEmail(username), password);
    clearAuthenticationFields();
    if (teacherRequested && username !== ADMIN_USERNAME) showAuthError('這不是管理員帳戶；已改以學生身份登入。');
  } catch (error) {
    console.error('[secure sign in]', error);
    showAuthError(authErrorMessage(error, 'login'));
  }
}

window.attemptLogin = async () => {
  const remember = document.getElementById('login-remember-me')?.checked;
  const normalized = validateUsername(document.getElementById('login-username')?.value);
  if (remember && normalized) localStorage.setItem(REMEMBERED_USERNAME_KEY, normalized);
  else localStorage.removeItem(REMEMBERED_USERNAME_KEY);
  await signInFromForm('login-username', 'login-password');
};

window.attemptTeacherLogin = async () => signInFromForm('teacher-username', 'teacher-password', true);

window.createProfile = async () => {
  hideAuthError();
  const displayName = safeText(document.getElementById('register-realname')?.value);
  const username = validateUsername(document.getElementById('register-username')?.value);
  const password = document.getElementById('register-password')?.value || '';
  if (!displayName || displayName.length > 30) return showAuthError('請填寫不超過 30 個字的顯示名稱。');
  if (!username || username === ADMIN_USERNAME) return showAuthError('帳號只能使用 1–15 個英文字母、數字、底線或連字號，且不能使用 admin。');
  if (password.length < 6) return showAuthError('密碼至少需要 6 個字元。');

  const existingRaw = collectLocalProgress();
  const existingCount = Object.keys(existingRaw).length;
  const importExistingProgress = existingCount > 0 && (window.StudentDialogs?.confirm
    ? await window.StudentDialogs.confirm({ title: '帶入這台裝置的舊進度？', message: `偵測到 ${existingCount} 項本機學習資料。請只在這是你的個人進度時選擇「帶入」；不會帶入舊密碼或任何未知資料。`, confirmLabel: '帶入進度', cancelLabel: '不帶入' })
    : confirm('偵測到本機學習進度。只有在這是你的個人進度時才選擇確定帶入；不會帶入舊密碼。'));

  const button = document.querySelector('#view-register button');
  if (button) { button.disabled = true; button.textContent = '建立安全帳戶中…'; }
  try {
    const credential = await createUserWithEmailAndPassword(auth, usernameToEmail(username), password);
    const now = new Date().toISOString();
    const profile = {
      schemaVersion: 2,
      role: 'student',
      username,
      displayName,
      createdAt: now,
      updatedAt: now,
      progress: buildProgress(importExistingProgress ? existingRaw : {})
    };
    await setDoc(userDocRef(credential.user.uid), profile);
    if (!importExistingProgress) resetProgressOnly();
    localStorage.setItem(PROFILE_MARKER_KEY, credential.user.uid);
    localStorage.setItem(`${SYNC_FINGERPRINT_PREFIX}${credential.user.uid}`, currentFingerprint(collectLocalProgress()));
    localStorage.setItem(PROFILE_NAME_KEY, displayName);
    sessionStorage.setItem('activeProfile', username);
    currentAuthUser = credential.user;
    currentProfile = profile;
    clearAuthenticationFields();
    document.getElementById('register-realname').value = '';
    document.getElementById('register-username').value = '';
    showDashboard(displayName);
    checkDailyLogin();
  } catch (error) {
    console.error('[secure registration]', error);
    showAuthError(authErrorMessage(error, 'register'));
  } finally {
    if (button) { button.disabled = false; button.textContent = '創建並登入 ✨'; }
  }
};

window.manualSyncToCloud = async () => {
  if (!isStudentProfile()) return;
  showLoader('雲端備份中…');
  const saved = await syncProgressWithDeadline(currentProfile?.username, { force: true });
  hideLoader();
  if (window.StudentDialogs?.notify) window.StudentDialogs.notify(saved ? '已同步到雲端。' : '本機進度已保留；雲端同步暫未完成。', saved ? 'success' : 'warning');
  else alert(saved ? '已同步到雲端。' : '本機進度已保留；雲端同步暫未完成。');
};

window.logoutProfile = async () => {
  const isAdmin = isAdminProfile();
  const question = isAdmin ? '確定要退出管理員後台嗎？' : '確定要安全登出嗎？';
  const approved = isAdmin ? confirm(question) : (window.StudentDialogs?.confirm ? await window.StudentDialogs.confirm({ title: '安全登出', message: question, confirmLabel: '登出', cancelLabel: '取消' }) : confirm(question));
  if (!approved) return;
  if (isStudentProfile()) {
    showLoader('儲存最新進度…');
    await syncProgressWithDeadline(currentProfile?.username, { force: true });
  }
  clearTimeout(syncTimer);
  resetProgressOnly();
  localStorage.removeItem(PROFILE_MARKER_KEY);
  localStorage.removeItem(PROFILE_NAME_KEY);
  sessionStorage.removeItem('activeProfile');
  currentProfile = null;
  await signOut(auth);
  showLoginScreen();
};

window.closeDailyLogin = () => {
  const modal = document.getElementById('daily-login-modal');
  modal?.classList.add('opacity-0');
  setTimeout(() => modal?.classList.add('hidden'), 300);
};

window.quickStart = () => {
  for (let i = 1; i <= 8; i += 1) {
    for (let j = 1; j <= 3; j += 1) {
      const id = `t_${catMap[i]}_${j}`;
      if (localStorage.getItem(id) !== 'true') return window.saveAndGo(pagesMap[id]);
    }
  }
  if (window.StudentDialogs?.notify) window.StudentDialogs.notify('你已完成全部 24 個模組！', 'success');
  else alert('你已完成全部 24 個模組！');
};

window.saveAndGo = async (url) => {
  window.StudentTools?.recordLastCourse?.(url);
  if (isStudentProfile()) await syncProgressWithDeadline(currentProfile?.username);
  window.location.href = url;
};

window.resetAllProgress = async () => {
  if (!isStudentProfile()) return;
  const message = '這項操作會覆蓋目前帳戶的雲端進度，且不能復原。';
  const approved = window.StudentDialogs?.confirm ? await window.StudentDialogs.confirm({ title: '清除所有進度？', message, confirmLabel: '清除進度', cancelLabel: '保留進度', danger: true }) : confirm(message);
  if (!approved) return;
  resetProgressOnly();
  await syncProgressWithDeadline(currentProfile?.username, { force: true });
  window.location.reload();
};

function renderClassSkillsUI(skillsSum, count) {
  const container = document.getElementById('class-skills-container');
  if (!container) return;
  const labels = { word: '字詞基礎', sent: '句子語法', rhet: '修辭標點', para: '段落實用', read: '閱讀理解', listen: '聆聽與說', culture: '文化古詩', write: '綜合寫作' };
  container.replaceChildren();
  Object.entries(labels).forEach(([key, label]) => {
    const percent = Math.min(100, Math.round(((skillsSum[key] || 0) / Math.max(count, 1)) / 450 * 100));
    const card = document.createElement('div');
    card.className = 'flex flex-col items-center p-2 md:p-3 bg-slate-50 border rounded-2xl';
    const name = document.createElement('span'); name.className = 'text-xs font-bold text-slate-500 mb-1'; name.textContent = label;
    const value = document.createElement('span'); value.className = 'text-lg md:text-xl font-black text-slate-800 mb-2'; value.textContent = `${percent}%`;
    const track = document.createElement('div'); track.className = 'w-full bg-slate-200 h-2 md:h-3 rounded-full overflow-hidden';
    const bar = document.createElement('div'); bar.className = `${percent >= 80 ? 'bg-emerald-500' : percent >= 50 ? 'bg-amber-500' : 'bg-rose-500'} h-full rounded-full`; bar.style.width = `${percent}%`;
    track.append(bar); card.append(name, value, track); container.append(card);
  });
}

function renderWarningStagesUI(passCounts, total) {
  const container = document.getElementById('warning-stages-container');
  if (!container) return;
  const labels = { t_word_1: '字詞 (補底版)', t_word_2: '字詞 (標準版)', t_word_3: '字詞 (拔尖版)', t_sent_1: '句子 (補底版)', t_sent_2: '句子 (標準版)', t_sent_3: '句子 (拔尖版)', t_rhet_1: '修辭 (補底版)', t_rhet_2: '修辭 (標準版)', t_rhet_3: '修辭 (拔尖版)', t_para_1: '段落 (補底版)', t_para_2: '段落 (標準版)', t_para_3: '段落 (拔尖版)', t_read_1: '閱讀 (補底版)', t_read_2: '閱讀 (標準版)', t_read_3: '閱讀 (拔尖版)', t_listen_1: '聆聽 (補底版)', t_listen_2: '聆聽 (標準版)', t_listen_3: '聆聽 (拔尖版)', t_culture_1: '文化 (補底版)', t_culture_2: '文化 (標準版)', t_culture_3: '文化 (拔尖版)', t_write_1: '寫作 (補底版)', t_write_2: '寫作 (標準版)', t_write_3: '寫作 (拔尖版)' };
  container.replaceChildren();
  Object.entries(labels).map(([id, name]) => ({ name, pct: Math.round(((passCounts[id] || 0) / Math.max(total, 1)) * 100) })).sort((a, b) => a.pct - b.pct).slice(0, 3).forEach((stage) => {
    const card = document.createElement('div'); card.className = 'flex flex-col gap-1 p-2 md:p-3 bg-rose-50 border border-rose-100 rounded-2xl';
    const label = document.createElement('div'); label.className = 'flex justify-between text-xs md:text-sm font-bold text-rose-900'; label.textContent = `${stage.name}　通過率 ${stage.pct}%`;
    const track = document.createElement('div'); track.className = 'w-full bg-slate-200 h-1.5 md:h-2 rounded-full overflow-hidden mt-1';
    const bar = document.createElement('div'); bar.className = 'bg-rose-500 h-full'; bar.style.width = `${stage.pct}%`;
    track.append(bar); card.append(label, track); container.append(card);
  });
}

function renderTeacherTable() {
  const tbody = document.getElementById('teacher-table-body');
  if (!tbody) return;
  tbody.replaceChildren();
  const students = window.allStudentsCache;
  const count = document.getElementById('total-students-count');
  if (count) count.textContent = `已安全載入：${students.length} 人${teacherHasMore ? '（可載入更多）' : ''}`;
  if (!students.length) {
    const row = document.createElement('tr'); const cell = document.createElement('td'); cell.colSpan = 6; cell.className = 'p-6 text-center text-slate-400 font-bold'; cell.textContent = '尚未載入學生資料。'; row.append(cell); tbody.append(row); return;
  }
  const sorted = [...students].sort((a, b) => (b.progress?.totalExp || 0) - (a.progress?.totalExp || 0));
  sorted.forEach((student, index) => {
    const row = document.createElement('tr'); row.className = 'border-b border-slate-100 hover:bg-slate-50 transition text-center';
    const values = [index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : String(index + 1), `${safeText(student.displayName, student.username)} (${safeText(student.username, '—')})`, String(student.progress?.totalExp || 0), `${student.progress?.badges || 0}/24`, student.progress?.lastUpdated ? new Date(student.progress.lastUpdated).toLocaleString('zh-HK', { hour12: false }) : '無紀錄'];
    values.forEach((value, cellIndex) => { const cell = document.createElement('td'); cell.className = `p-3 md:p-4 ${cellIndex === 1 ? 'text-left font-black text-indigo-700 text-sm md:text-base' : 'font-bold text-sm md:text-base'}`; cell.textContent = value; row.append(cell); });
    const action = document.createElement('td'); action.className = 'p-3 md:p-4';
    const detail = document.createElement('button'); detail.className = 'text-indigo-600 hover:text-white hover:bg-indigo-600 border border-indigo-600 px-2 py-1 rounded transition text-xs font-black shadow-sm'; detail.textContent = '查看詳情'; detail.addEventListener('click', () => window.drilldownStudentDetail(student.uid));
    action.append(detail); row.append(action); tbody.append(row);
  });
}

window.showTeacherDashboard = () => {
  if (!isAdminProfile()) { showLoginScreen(); showAuthError('此帳戶沒有管理員權限。'); return; }
  document.getElementById('login-screen')?.classList.add('hidden');
  document.getElementById('dashboard-screen')?.classList.add('hidden');
  const dashboard = document.getElementById('teacher-dashboard');
  dashboard?.classList.remove('hidden'); dashboard?.classList.add('flex');
  window.fetchCloudDataForTeacher(true);
};

window.fetchCloudDataForTeacher = async (reset = true) => {
  if (!isAdminProfile()) return;
  const tbody = document.getElementById('teacher-table-body');
  if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-indigo-600 font-bold">正在載入最多 50 位學生資料…</td></tr>';
  try {
    const base = collection(db, 'users');
    const request = reset || !teacherCursor ? query(base, limit(50)) : query(base, startAfter(teacherCursor), limit(50));
    const snapshot = await getDocs(request);
    teacherCursor = snapshot.docs.at(-1) || teacherCursor;
    teacherHasMore = snapshot.docs.length === 50;
    const incoming = snapshot.docs.map((item) => ({ uid: item.id, ...item.data() })).filter((item) => item.role === 'student');
    window.allStudentsCache = reset ? incoming : [...window.allStudentsCache, ...incoming];
    const skills = { word: 0, sent: 0, rhet: 0, para: 0, read: 0, listen: 0, culture: 0, write: 0 };
    const passCounts = {};
    for (let i = 1; i <= 8; i += 1) for (let j = 1; j <= 3; j += 1) passCounts[`t_${catMap[i]}_${j}`] = 0;
    window.allStudentsCache.forEach((student) => {
      Object.keys(skills).forEach((key) => { skills[key] += Number(student.progress?.cats?.[key] || 0); });
      Object.keys(passCounts).forEach((key) => { if (student.progress?.raw?.[key] === 'true') passCounts[key] += 1; });
    });
    renderTeacherTable();
    document.getElementById('analysis-section')?.classList.toggle('hidden', window.allStudentsCache.length === 0);
    renderClassSkillsUI(skills, window.allStudentsCache.length);
    renderWarningStagesUI(passCounts, window.allStudentsCache.length);
  } catch (error) {
    console.error('[teacher data]', error);
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-rose-500 font-bold">讀取失敗；請確認管理員權限及網路連線。</td></tr>';
  }
};

window.loadMoreStudents = async () => {
  if (!teacherHasMore) return;
  await window.fetchCloudDataForTeacher(false);
};

window.drilldownStudentDetail = (uid) => {
  const student = window.allStudentsCache.find((item) => item.uid === uid);
  if (!student) return;
  document.getElementById('sd-realname').textContent = safeText(student.displayName, student.username);
  document.getElementById('sd-username').textContent = safeText(student.username, '—');
  document.getElementById('sd-exp').textContent = String(student.progress?.totalExp || 0);
  const raw = cleanRawProgress(student.progress?.raw || {});
  let perfect = 0; let hint = 0; let wrong = 0;
  Object.values(raw).forEach((value) => { try { const parsed = JSON.parse(value); if (Array.isArray(parsed)) parsed.forEach((status) => { if (status === 1) perfect += 1; if (status === 2) hint += 1; if (status === -1) wrong += 1; }); } catch (_) {} });
  document.getElementById('sd-perfect-count').textContent = String(perfect);
  document.getElementById('sd-hint-count').textContent = String(hint);
  document.getElementById('sd-wrong-count').textContent = String(wrong);
  const report = document.getElementById('sd-ai-report');
  if (report) report.textContent = perfect + hint + wrong ? `已記錄 ${perfect + hint + wrong} 次有效作答；一次答對 ${Math.round((perfect / (perfect + hint + wrong)) * 100)}%。` : '該生暫未有可分析的作答紀錄。';
  const badges = document.getElementById('sd-badges-container');
  if (badges) {
    badges.replaceChildren();
    Object.keys(pagesMap).forEach((key) => { const item = document.createElement('div'); item.className = 'border rounded-xl p-2.5 text-xs font-bold'; item.textContent = `${key}: ${raw[key] === 'true' ? '已精通' : '未完成'}`; badges.append(item); });
  }
  const modal = document.getElementById('student-detail-modal'); modal?.classList.remove('hidden');
};

window.closeStudentDetailModal = () => document.getElementById('student-detail-modal')?.classList.add('hidden');

window.exportRankingToCSV = () => {
  if (!isAdminProfile() || !window.allStudentsCache.length) return;
  const header = ['姓名', '登入帳號', '總經驗值', '精通關卡數', '最後更新'];
  const rows = window.allStudentsCache.map((student) => [safeText(student.displayName, student.username), safeText(student.username, ''), student.progress?.totalExp || 0, student.progress?.badges || 0, student.progress?.lastUpdated || '']);
  const csv = `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')}`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `小學語文特訓平台_學生報表_${new Date().toISOString().slice(0, 10)}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};

window.deleteStudentData = () => alert('為保障帳戶完整性，網站不再提供瀏覽器端刪除帳戶。請由 Firebase Authentication 與 Firestore 主控台以 UID 同步完成受控刪除。');

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && isStudentProfile()) saveLocalToCloud();
});
window.addEventListener('storage', () => { if (isStudentProfile()) { updateDashboardUI(); scheduleProgressSync(); } });

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await setPersistence(auth, browserLocalPersistence);
    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        currentAuthUser = null;
        currentProfile = null;
        showLoginScreen();
        return;
      }
      try { await openAuthenticatedProfile(user); } catch (error) { console.error('[profile open]', error); showLoginScreen(); showAuthError('帳戶資料暫時無法讀取，請稍後再試。'); }
    });
  } catch (error) {
    console.error('[firebase initialisation]', error);
    showLoginScreen();
    showAuthError('安全登入服務未能啟動，請檢查網路後重試。');
  } finally {
    hideLoader();
  }
});
