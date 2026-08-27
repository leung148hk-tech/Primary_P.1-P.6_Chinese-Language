#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const htmlFiles = fs.readdirSync(root).filter(name => name.endsWith('.html')).sort();
const failures = [];
const warnings = [];

function expect(condition, message) {
  if (!condition) failures.push(message);
}

function checkInlineJavaScript(fileName, content) {
  const blocks = [...content.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  blocks.forEach((match, index) => {
    const scriptPath = path.join('/tmp', `primary-chinese-${fileName}-${index}.js`);
    fs.writeFileSync(scriptPath, match[1]);
    try {
      execFileSync('node', ['--check', scriptPath], { stdio: 'pipe' });
    } catch (error) {
      failures.push(`${fileName}: 第 ${index + 1} 段內嵌 JavaScript 語法錯誤`);
    } finally {
      try { fs.unlinkSync(scriptPath); } catch (_) {}
    }
  });
}

htmlFiles.forEach(fileName => {
  const content = fs.readFileSync(path.join(root, fileName), 'utf8');
  expect(content.includes('src="diagnostics.js"'), `${fileName}: 未載入 diagnostics.js`);
  expect(content.includes('href="mobile-accessibility.css"'), `${fileName}: 未載入 mobile-accessibility.css`);
  expect(content.includes('src="student-feedback.js"'), `${fileName}: 未載入 student-feedback.js`);
  checkInlineJavaScript(fileName, content);
});

// 聆聽基礎版保留已驗證的專屬故事播放器（VoiceManager）；其餘語音頁統一使用外部共用管理器。
for (const fileName of htmlFiles.filter(name => name !== 'index.html' && name !== 'listen_basic.html')) {
  const content = fs.readFileSync(path.join(root, fileName), 'utf8');
  expect(content.includes('src="voice-manager.js"'), `${fileName}: 未載入 voice-manager.js`);
}

const misleadingCorrectFeedbackPages = htmlFiles.filter(fileName => {
  const content = fs.readFileSync(path.join(root, fileName), 'utf8');
  return /\.option-btn\.correct\s*\{\s*background-color:\s*#fff1f2;/m.test(content);
});
expect(misleadingCorrectFeedbackPages.length === 0, `正確答案不可使用紅色回饋：${misleadingCorrectFeedbackPages.join(', ')}`);

const directUtterancePages = htmlFiles.filter(fileName => {
  const content = fs.readFileSync(path.join(root, fileName), 'utf8');
  return content.includes('new SpeechSynthesisUtterance');
});
const unapprovedDirectUtterancePages = directUtterancePages.filter(fileName => fileName !== 'listen_basic.html');
expect(unapprovedDirectUtterancePages.length === 0, `仍有未遷移的直接語音物件頁面：${unapprovedDirectUtterancePages.join(', ')}`);

const longCourseNavigationPages = [
  'read_standard.html', 'read_advanced.html',
  'listen_standard.html', 'listen_advanced.html',
  'sentence_standard.html', 'sentence_advanced.html',
  'paragraph_standard.html', 'paragraph_advanced.html',
  'write_standard.html', 'write_advanced.html'
];
longCourseNavigationPages.forEach(fileName => {
  const content = fs.readFileSync(path.join(root, fileName), 'utf8');
  expect(content.includes('src="mobile-long-course-nav.js"'), `${fileName}: 未載入 mobile-long-course-nav.js`);
});

const navigationExpectations = {
  'word_basic.html': 'continueLearning',
  'read_basic.html': 'continueReading',
  'listen_basic.html': 'continueListenLearning',
  'sentence_basic.html': 'continueSentenceLearning',
  'paragraph_basic.html': 'continueParagraphLearning',
  'write_basic.html': 'continueWriting'
};

Object.entries(navigationExpectations).forEach(([fileName, marker]) => {
  const content = fs.readFileSync(path.join(root, fileName), 'utf8');
  expect(content.includes(marker), `${fileName}: 找不到手機續學入口 ${marker}`);
});

const indexContent = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const secureAuthPath = path.join(root, 'firebase-secure-auth.js');
expect(indexContent.includes('src="student-tools.js"'), 'index.html: 未載入 student-tools.js');
expect(indexContent.includes('src="student-sync-status.js"'), 'index.html: 未載入 student-sync-status.js');
expect(indexContent.includes('src="student-dialogs.js"'), 'index.html: 未載入學生頁內對話元件');
expect(indexContent.includes('href="student-dialogs.css"'), 'index.html: 未載入學生頁內對話樣式');
expect(indexContent.includes('src="firebase-secure-auth.js"'), 'index.html: 未載入安全 Firebase 認證模組');
expect(indexContent.includes('id="student-sync-status"'), 'index.html: 缺少學生同步狀態提示');
expect(indexContent.includes('student-tools-hub') === false, 'index.html: 學生工具應由獨立模組動態建立，避免登入前顯示');
expect(fs.existsSync(secureAuthPath), '找不到 firebase-secure-auth.js');
if (fs.existsSync(secureAuthPath)) {
  const secureAuthContent = fs.readFileSync(secureAuthPath, 'utf8');
  expect(secureAuthContent.includes('StudentDialogs?.confirm'), '安全登入模組：學生登出未使用頁內確認');
  expect(secureAuthContent.includes('StudentDialogs?.notify'), '安全登入模組：學生操作未使用頁內通知');
  expect(secureAuthContent.includes('目前離線；進度只保存在這台裝置'), '安全登入模組：缺少離線本機保存提示');
  expect(secureAuthContent.includes('const CLOUD_SYNC_TIMEOUT_MS = 3000;'), '安全登入模組：缺少學生端雲端同步等待上限');
  expect(secureAuthContent.includes('syncProgressWithDeadline(currentProfile?.username'), '安全登入模組：登出、備份或關卡切換未使用具期限的同步流程');
  try { execFileSync('node', ['--check', secureAuthPath], { stdio: 'pipe' }); } catch (_) { failures.push('firebase-secure-auth.js: JavaScript 語法錯誤'); }
}

const specialFeedbackExpectations = {
  'word_standard.html': ["StudentFeedback?.wrong(btnElement, '這個字沒有錯", 'StudentFeedback?.clear(btnElement)'],
  'paragraph_basic.html': ["StudentFeedback?.wrong(tArea, '順序尚未正確"],
  'paragraph_standard.html': ["StudentFeedback?.wrong(tArea, '順序尚未正確", "StudentFeedback?.wrong(sandboxPad, '還有格式槽位未完成"],
  'paragraph_advanced.html': ["StudentFeedback?.wrong(tArea, '順序尚未正確", "StudentFeedback?.wrong(sandboxPad, '還有格式槽位未完成"],
  'write_basic.html': ['StudentFeedback?.show(`有 ${wrongIndices.length} 個位置需要調整。'],
  'write_standard.html': ['StudentFeedback?.markWrong(slotElem)', 'StudentFeedback?.show(`有 ${wrongIndices.length} 個位置需要調整。'],
  'write_advanced.html': ['StudentFeedback?.markWrong(slot)', 'StudentFeedback?.wrong(selectedButtons[0]', 'StudentFeedback?.wrong(btn, \'這個成語不太合適']
};
Object.entries(specialFeedbackExpectations).forEach(([fileName, markers]) => {
  const content = fs.readFileSync(path.join(root, fileName), 'utf8');
  markers.forEach(marker => expect(content.includes(marker), `${fileName}: 特殊題型未接入共用錯答回饋 ${marker}`));
});

const diagnosticsPath = path.join(root, 'diagnostics.js');
const studentFeedbackPath = path.join(root, 'student-feedback.js');
const studentSyncStatusPath = path.join(root, 'student-sync-status.js');
const studentDialogsPath = path.join(root, 'student-dialogs.js');
const studentDialogsCssPath = path.join(root, 'student-dialogs.css');
expect(fs.existsSync(diagnosticsPath), '找不到 diagnostics.js');
expect(fs.existsSync(studentFeedbackPath), '找不到 student-feedback.js');
if (fs.existsSync(studentFeedbackPath)) {
  const studentFeedbackContent = fs.readFileSync(studentFeedbackPath, 'utf8');
  expect(studentFeedbackContent.includes('function markWrong'), 'student-feedback.js: 缺少特殊題型錯誤槽位標記');
  expect(studentFeedbackContent.includes('function clearState'), 'student-feedback.js: 缺少特殊題型錯誤狀態清理');
}
expect(fs.existsSync(studentSyncStatusPath), '找不到 student-sync-status.js');
expect(fs.existsSync(studentDialogsPath), '找不到 student-dialogs.js');
expect(fs.existsSync(studentDialogsCssPath), '找不到 student-dialogs.css');
const accessibilityPath = path.join(root, 'mobile-accessibility.css');
expect(fs.existsSync(accessibilityPath), '找不到 mobile-accessibility.css');
if (fs.existsSync(accessibilityPath)) {
  const accessibilityContent = fs.readFileSync(accessibilityPath, 'utf8');
  expect(accessibilityContent.includes('.lvl-btn') && accessibilityContent.includes('min-width: 44px'), 'mobile-accessibility.css: 題號地圖缺少 44px 手機觸控目標');
}
const longCourseNavPath = path.join(root, 'mobile-long-course-nav.js');
expect(fs.existsSync(longCourseNavPath), '找不到 mobile-long-course-nav.js');
const studentToolsPath = path.join(root, 'student-tools.js');
expect(fs.existsSync(studentToolsPath), '找不到 student-tools.js');
if (fs.existsSync(studentToolsPath)) {
  const studentToolsContent = fs.readFileSync(studentToolsPath, 'utf8');
  expect(studentToolsContent.includes("getScopedStorageKey('studentLastCourse')"), 'student-tools.js: 最近學習紀錄未依學生帳戶隔離');
  expect(studentToolsContent.includes("getScopedStorageKey('studentProgressLastBackup')"), 'student-tools.js: 最近備份日期未依學生帳戶隔離');
  expect(!studentToolsContent.includes("localStorage.setItem('studentLastCourse'"), 'student-tools.js: 不可再寫入未分帳戶的最近學習鍵');
  expect(!studentToolsContent.includes("localStorage.setItem('studentProgressLastBackup'"), 'student-tools.js: 不可再寫入未分帳戶的最近備份鍵');
  expect(studentToolsContent.includes('window.StudentDialogs?.confirm'), 'student-tools.js: 備份還原未使用頁內確認');
}
for (const [label, scriptPath] of [
  ['diagnostics.js', diagnosticsPath],
  ['student-feedback.js', studentFeedbackPath],
  ['student-sync-status.js', studentSyncStatusPath],
  ['student-dialogs.js', studentDialogsPath]
]) {
  if (!fs.existsSync(scriptPath)) continue;
  try {
    execFileSync('node', ['--check', scriptPath], { stdio: 'pipe' });
  } catch (_) {
    failures.push(`${label}: JavaScript 語法錯誤`);
  }
}
if (fs.existsSync(studentToolsPath)) {
  try {
    execFileSync('node', ['--check', studentToolsPath], { stdio: 'pipe' });
  } catch (_) {
    failures.push('student-tools.js: JavaScript 語法錯誤');
  }
}

if (warnings.length) {
  console.log('Warnings:');
  warnings.forEach(message => console.log(`- ${message}`));
}

if (failures.length) {
  console.error('Regression checks failed:');
  failures.forEach(message => console.error(`- ${message}`));
  process.exit(1);
}

console.log(`Regression checks passed for ${htmlFiles.length} HTML pages.`);
console.log('Verified: diagnostics, accessibility, common answer-feedback coverage for options and special tasks, shared voice-manager coverage outside the specialised listening-basic player, semantic correct-answer feedback, accessible student inline dialogs, student self-service tools with per-account state isolation, offline and bounded cloud-sync status coverage, inline JavaScript syntax, and mobile navigation entry points across all levels.');
