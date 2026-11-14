import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, externalId, matchCourse } from '../../src/lms/canvas.js';
import { detectCourse } from '../../src/lms/index.js';

test('recognises course addresses by shape, https only (localhost excepted)', () => {
  assert.deepEqual(matchCourse('https://ufl.instructure.com/courses/512345/pages/week-1?x=1'), {
    lms: 'canvas', origin: 'https://ufl.instructure.com', host: 'ufl.instructure.com', courseId: '512345',
    modulesUrl: 'https://ufl.instructure.com/courses/512345/modules', syllabusUrl: 'https://ufl.instructure.com/courses/512345/assignments/syllabus',
  });
  assert.equal(matchCourse('https://canvas.example.edu/courses/9').courseId, '9');
  assert.equal(matchCourse('http://localhost:3300/courses/77/modules').courseId, '77');
  for (const no of ['http://canvas.example.edu/courses/9', 'https://example.com/', 'https://example.com/courses', 'https://example.com/courses/abc', 'chrome://extensions', 'not a url', '']) {
    assert.equal(matchCourse(no), null, no);
  }
  assert.equal(detectCourse('https://ufl.instructure.com/courses/1').adapter.id, 'canvas');
  assert.equal(detectCourse('https://example.com/news'), null);
});

test('only pages, files and the syllabus are offered; everything else says why not', () => {
  const item = (type, extra = {}) => ({ id: '1', title: 't', type, url: 'https://c.example/courses/1/modules/items/1', locked: false, ...extra });
  assert.equal(classify(item('page')).importable, true);
  assert.equal(classify(item('file')).importable, true);
  assert.equal(classify(item('syllabus')).importable, true);
  assert.match(classify(item('quiz')).reason, /never imported/);
  assert.match(classify(item('assignment')).reason, /Graded work/);
  assert.match(classify(item('discussion')).reason, /other students/);
  assert.match(classify(item('link')).reason, /External website/);
  assert.match(classify(item('tool')).reason, /cannot be read/);
  assert.match(classify(item('other')).reason, /Unrecognised/);
  for (const type of ['quiz', 'assignment', 'discussion', 'link', 'tool', 'other']) assert.equal(classify(item(type)).importable, false, type);
  assert.match(classify(item('page', { locked: true })).reason, /Locked/); // a lock wins over the type
  assert.equal(classify(item('quiz', { locked: true })).importable, false);
  assert.match(classify(item('page', { url: null })).reason, /no link/);
});

test('resource ids are stable, scoped to site and course, and safe to send', () => {
  const course = matchCourse('https://ufl.instructure.com/courses/512345');
  const id = externalId(course, { id: '987', type: 'page' });
  assert.equal(id, 'canvas:ufl.instructure.com:512345:page:987');
  assert.equal(externalId(course, { id: '987', type: 'page' }), id);
  assert.notEqual(externalId(matchCourse('https://ufl.instructure.com/courses/2'), { id: '987', type: 'page' }), id);
  assert.match(externalId(course, { id: 'a b/../<x>', type: 'file' }), /^[\w.:-]+$/);
  assert.ok(externalId(course, { id: 'x'.repeat(1000), type: 'file' }).length <= 300);
});
