import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const auth = fs.readFileSync(path.join(root, 'firebase-secure-auth.js'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'firebase-progress-bridge.js'), 'utf8');
const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
const courses = fs.readdirSync(root).filter((name) => /^(word|sentence|rhetoric|paragraph|read|listen|culture|write)_(basic|standard|advanced)\.html$/.test(name));
const failures = [];

function requireCondition(condition, message) {
  if (!condition) failures.push(message);
}

requireCondition(index.includes('type="module" src="firebase-secure-auth.js"'), '首頁沒有載入 firebase-secure-auth.js。');
requireCondition(!index.includes('signInAnonymously'), '首頁仍包含匿名登入程式。');
requireCondition(!index.includes("pwdInput === '1234'"), '首頁仍包含舊管理員硬編碼密碼。');
requireCondition(!index.includes("activeProfile === 'admin'"), '首頁仍以 sessionStorage admin 值決定權限。');
requireCondition(auth.includes('signInWithEmailAndPassword'), '安全模組未使用 Firebase Email/Password 登入。');
requireCondition(auth.includes('createUserWithEmailAndPassword'), '安全模組未使用 Firebase Email/Password 註冊。');
requireCondition(auth.includes("doc(db, 'users'"), '安全模組沒有使用 UID 型 /users 路徑。');
requireCondition(!auth.includes("'artifacts', appId, 'public', 'data', 'students'"), '安全模組仍讀寫舊公開學生路徑。');
requireCondition(auth.includes('teacherHasMore') && auth.includes('limit(50)'), '教師清單未設置分頁上限。');
requireCondition(auth.includes('createElement') && !auth.includes('tbody.innerHTML +='), '教師表格未採用安全 DOM 建立方式。');
requireCondition(bridge.includes('SYNC_INTERVAL_MS = 60000'), '題庫頁沒有使用至少 60 秒的同步節流。');
requireCondition(bridge.includes("doc(db, 'users', activeUser.uid)"), '題庫頁沒有以 UID 同步。');
requireCondition(courses.length === 24, `預期 24 個題庫頁，實際為 ${courses.length}。`);
for (const course of courses) {
  const source = fs.readFileSync(path.join(root, course), 'utf8');
  requireCondition(source.includes('firebase-progress-bridge.js'), `${course} 沒有載入進度同步橋接器。`);
}
requireCondition(rules.includes('allow list: if isAdmin();'), '規則沒有將學生清單限制為管理員。');
requireCondition(rules.includes('allow delete: if false;'), '規則沒有禁止網頁客戶端刪除帳戶資料。');
requireCondition(rules.includes('match /artifacts/{appId}/public/data/students/{studentId}') && rules.includes('allow read, write: if false;'), '規則沒有封鎖舊公開學生資料路徑。');
requireCondition(rules.includes("request.resource.data.role == 'student'"), '規則沒有禁止學生在建立時指定管理員角色。');
requireCondition(rules.includes("affectedKeys().hasOnly(['progress', 'updatedAt'])"), '規則沒有將學生更新限於進度欄位。');

if (failures.length) {
  console.error('Firebase security static checks failed:');
  failures.forEach((message) => console.error(`- ${message}`));
  process.exit(1);
}
console.log(`Firebase security static checks passed for ${courses.length} course pages.`);
