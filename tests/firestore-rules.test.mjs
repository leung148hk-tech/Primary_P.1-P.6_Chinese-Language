import fs from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';

const rules = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const testEnv = await initializeTestEnvironment({ projectId: 'chinese-training-security-tests', firestore: { rules } });

function profile(username, role = 'student') {
  return {
    schemaVersion: 2,
    role,
    username,
    displayName: `${username} 同學`,
    createdAt: '2026-08-27T00:00:00.000Z',
    updatedAt: '2026-08-27T00:00:00.000Z',
    progress: {
      version: 1,
      raw: {},
      totalExp: 0,
      badges: 0,
      cats: { word: 0, sent: 0, rhet: 0, para: 0, read: 0, listen: 0, culture: 0, write: 0 },
      lastUpdated: '2026-08-27T00:00:00.000Z'
    }
  };
}

await testEnv.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore();
  await setDoc(doc(db, 'users', 'alice-uid'), profile('alice'));
  await setDoc(doc(db, 'users', 'bob-uid'), profile('bob'));
  await setDoc(doc(db, 'users', 'admin-uid'), profile('admin', 'admin'));
  await setDoc(doc(db, 'artifacts', 'chinese-training-platform', 'public', 'data', 'students', 'legacy-student'), { password: 'legacy-value' });
});

const unauthenticated = testEnv.unauthenticatedContext().firestore();
const alice = testEnv.authenticatedContext('alice-uid').firestore();
const bob = testEnv.authenticatedContext('bob-uid').firestore();
const admin = testEnv.authenticatedContext('admin-uid').firestore();

await assertFails(getDoc(doc(unauthenticated, 'users', 'alice-uid')));
await assertFails(getDocs(collection(unauthenticated, 'users')));
await assertFails(getDoc(doc(unauthenticated, 'artifacts', 'chinese-training-platform', 'public', 'data', 'students', 'legacy-student')));

await assertSucceeds(getDoc(doc(alice, 'users', 'alice-uid')));
await assertFails(getDoc(doc(alice, 'users', 'bob-uid')));
await assertFails(getDocs(collection(alice, 'users')));
await assertFails(updateDoc(doc(alice, 'users', 'bob-uid'), { updatedAt: '2026-08-27T01:00:00.000Z' }));
await assertFails(updateDoc(doc(alice, 'users', 'alice-uid'), { role: 'admin' }));
await assertFails(deleteDoc(doc(alice, 'users', 'alice-uid')));
await assertFails(setDoc(doc(alice, 'artifacts', 'chinese-training-platform', 'public', 'data', 'students', 'anything'), { totalExp: 999 }));

await assertSucceeds(updateDoc(doc(alice, 'users', 'alice-uid'), {
  updatedAt: '2026-08-27T01:00:00.000Z',
  progress: {
    ...profile('alice').progress,
    totalExp: 10,
    cats: { word: 10, sent: 0, rhet: 0, para: 0, read: 0, listen: 0, culture: 0, write: 0 },
    lastUpdated: '2026-08-27T01:00:00.000Z'
  }
}));

const newStudent = testEnv.authenticatedContext('new-student-uid').firestore();
await assertSucceeds(setDoc(doc(newStudent, 'users', 'new-student-uid'), profile('newstudent')));
await assertFails(setDoc(doc(newStudent, 'users', 'another-uid'), profile('imposter')));
await assertFails(setDoc(doc(newStudent, 'users', 'new-student-uid'), profile('newstudent', 'admin')));
const reservedAdmin = testEnv.authenticatedContext('reserved-admin-uid').firestore();
await assertFails(setDoc(doc(reservedAdmin, 'users', 'reserved-admin-uid'), profile('admin')));

await assertSucceeds(getDoc(doc(admin, 'users', 'alice-uid')));
await assertSucceeds(getDocs(collection(admin, 'users')));
await assertFails(updateDoc(doc(admin, 'users', 'alice-uid'), { updatedAt: '2026-08-27T01:00:00.000Z' }));
await assertFails(deleteDoc(doc(admin, 'users', 'alice-uid')));

await testEnv.cleanup();
console.log('Firestore rules tests passed: public/legacy denied; students are UID-isolated; admin read access is role-gated; browser deletion is denied.');
