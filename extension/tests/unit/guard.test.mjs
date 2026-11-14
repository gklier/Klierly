import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyUrl, evaluateGuard, restrictedPageReason } from '../../src/guard.js';
import { cleanText, cleanTitle, limitText, formatCount } from '../../src/clean.js';
import { normalizeServerUrl, safeHttpUrl } from '../../src/api.js';

const quizSignals = { questionGroups: 5, answerInputs: 20, quizForm: true, submitButtons: ['Submit Quiz'], startButton: false, timerText: true, runningTimer: true, proctoring: [] };
const none = { questionGroups: 0, answerInputs: 0, quizForm: false, submitButtons: [], startButton: false, timerText: false, runningTimer: false, proctoring: [] };

test('blocks active assessments by address', () => {
  for (const url of ['https://lms.example.edu/courses/1/quizzes/7/take', 'https://lms.example.edu/courses/1/quizzes/7/take?preview=1', 'https://lms.example.edu/mod/quiz/attempt.php?attempt=55', 'https://x.example.edu/assignments/3/submissions/take',
    'https://lms.example.edu/lockdown/start', 'https://app.honorlock.com/session/1', 'https://proctoru.example.com/exam']) {
    const v = evaluateGuard({ url, domSignals: none });
    assert.equal(v.blocked, true, url);
    assert.equal(v.kind, 'assessment');
    assert.ok(v.reasons.length > 0);
  }
});

test('blocks active assessments by page structure even on an innocent address', () => {
  const v = evaluateGuard({ url: 'https://lms.example.edu/courses/1/pages/week-3', title: 'Week 3', domSignals: quizSignals });
  assert.equal(v.blocked, true);
  assert.ok(v.reasons.some((r) => /quiz form/.test(r)));
  assert.equal(evaluateGuard({ url: 'https://a.example/p', domSignals: { ...none, submitButtons: ['Submit Exam'] } }).blocked, true);
  assert.equal(evaluateGuard({ url: 'https://a.example/p', domSignals: { ...none, runningTimer: true } }).blocked, true);
  assert.equal(evaluateGuard({ url: 'https://a.example/p', title: 'Respondus LockDown Browser', domSignals: none }).blocked, true);
  assert.equal(evaluateGuard({ url: 'https://a.example/p', text: 'Time Remaining: 12:44', domSignals: none }).blocked, true);
});

test('blocks grades and people pages as private, not as assessments', () => {
  for (const url of ['https://lms.example.edu/courses/1/grades', 'https://lms.example.edu/courses/1/gradebook/', 'https://lms.example.edu/courses/1/users', 'https://lms.example.edu/courses/1/people/42']) {
    const v = evaluateGuard({ url, domSignals: none });
    assert.equal(v.blocked, true, url);
    assert.equal(v.kind, 'private');
  }
});

test('does not block ordinary study pages', () => {
  const ok = [
    { url: 'https://lms.example.edu/courses/1/pages/syllabus', title: 'Syllabus', text: 'Exam 1 is on December 4 and covers Modules 1-3. Submit quiz 2 by Friday. Exams use Respondus LockDown Browser.' },
    { url: 'https://lms.example.edu/courses/1/modules/items/9', title: 'Module 2: Multiple Regression', text: 'A p-value is the probability of a result at least as extreme...' },
    { url: 'https://lms.example.edu/courses/1/files/folder/attempted-solutions', title: 'Notes' },
    { url: 'https://docs.example.org/upgrades/guide', title: 'Upgrades' },
    { url: 'https://lms.example.edu/courses/1/pages/time-series', text: 'How much time is left in the series? Forecast the remaining periods.' },
  ];
  for (const page of ok) assert.equal(evaluateGuard({ ...page, domSignals: none }).blocked, false, page.url);
});

test('quiz landing / instructions pages get a caution, not a block', () => {
  const v = evaluateGuard({ url: 'https://lms.example.edu/courses/1/quizzes/7', title: 'Quiz 3', domSignals: { ...none, startButton: true } });
  assert.equal(v.blocked, false);
  assert.ok(v.cautions.length > 0);
  const practice = evaluateGuard({ url: 'https://lms.example.edu/courses/1/pages/self-check', domSignals: { ...none, questionGroups: 1, answerInputs: 4 } });
  assert.equal(practice.blocked, false);
  const syllabusWithVendor = evaluateGuard({ url: 'https://lms.example.edu/courses/1/pages/syllabus', domSignals: { ...none, proctoring: ['Honorlock'] } });
  assert.equal(syllabusWithVendor.blocked, false);
  assert.ok(syllabusWithVendor.cautions.length > 0);
});

test('classifyUrl and restricted pages', () => {
  assert.equal(classifyUrl('not a url').assessment.length, 0);
  assert.equal(classifyUrl('https://lms.example.edu/courses/1/quizzes/7').landing, true);
  assert.match(restrictedPageReason('chrome://extensions'), /built-in browser page/);
  assert.match(restrictedPageReason('https://chromewebstore.google.com/detail/x'), /extension store/);
  assert.match(restrictedPageReason('https://lms.example.edu/files/notes.pdf'), /PDF/);
  assert.match(restrictedPageReason('file:///home/me/notes.html'), /file on your computer/);
  assert.equal(restrictedPageReason('https://lms.example.edu/courses/1/pages/a'), null);
});

test('text cleaning keeps wording and removes invisible characters', () => {
  assert.equal(cleanText('  Hello​   world \r\n\r\n\r\n\r\nNext\tline\u0007  '), 'Hello world\n\nNext line');
  assert.equal(cleanText(null), '');
  assert.equal(cleanTitle('  Module 2:\n Regression  '), 'Module 2: Regression');
  assert.deepEqual(limitText('abcdef', 4), { text: 'abcd', truncated: true });
  assert.deepEqual(limitText('abc', 4), { text: 'abc', truncated: false });
  assert.equal(limitText('ab\u{1F600}', 3).text, 'ab'); // never splits a surrogate pair
  assert.equal(formatCount(1), '1 character');
  assert.equal(formatCount(12345), '12,345 characters');
});

test('server address and link validation', () => {
  assert.deepEqual(normalizeServerUrl('http://localhost:3000/some/path'), { ok: true, url: 'http://localhost:3000' });
  assert.equal(normalizeServerUrl('https://courselab.example.edu').ok, true);
  assert.equal(normalizeServerUrl('http://courselab.example.edu').ok, false); // https required off-machine
  assert.equal(normalizeServerUrl('https://user:pw@example.edu').ok, false);
  assert.equal(normalizeServerUrl('javascript:alert(1)').ok, false);
  assert.equal(normalizeServerUrl('').ok, false);
  assert.equal(safeHttpUrl('javascript:alert(1)'), null);
  assert.equal(safeHttpUrl('https://a.example/x'), 'https://a.example/x');
});

test('shipped manifest asks for the minimum', () => {
  const m = JSON.parse(readFileSync(new URL('../../manifest.json', import.meta.url), 'utf8'));
  assert.equal(m.manifest_version, 3);
  assert.deepEqual([...m.permissions].sort(), ['activeTab', 'scripting', 'storage']);
  for (const key of ['host_permissions', 'optional_host_permissions', 'optional_permissions', 'content_scripts', 'background', 'web_accessible_resources', 'externally_connectable', 'key']) assert.equal(m[key], undefined, key);
  const shipped = ['popup.js', 'options.js', 'src/api.js', 'src/extract.js', 'src/guard.js', 'src/clean.js'].map((f) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')).join('\n');
  assert.doesNotMatch(shipped, /\beval\(|new Function|document\.cookie|chrome\.cookies|chrome\.webRequest|<all_urls>|XMLHttpRequest/);
  assert.doesNotMatch(shipped, /clx_[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{16,}/); // no embedded credentials
  assert.equal((shipped.match(/fetch\(/g) ?? []).length, 1); // one network call site, in src/api.js
});
