import test from 'node:test';
import assert from 'node:assert/strict';
import { captionFiles, toVtt } from '../../src/captions.js';

test('cues become valid WebVTT with millisecond timestamps', () => {
  const vtt = toVtt([{ s: 0, e: 4.5, t: 'Welcome back.' }, { s: 3725.25, e: 3730, t: 'The t ratio --> estimate over standard error.' }, { s: 5, e: 5, t: 'zero length is dropped' }, { s: 6, e: 7, t: '' }]);
  assert.equal(vtt, 'WEBVTT\n\n00:00:00.000 --> 00:00:04.500\nWelcome back.\n\n01:02:05.250 --> 01:02:10.000\nThe t ratio -> estimate over standard error.\n');
});

test('tracks become .vtt files and transcript panels become .txt files', () => {
  const files = captionFiles([
    { frame: 'https://video.example.edu/embed/1', title: 'Player', media: 1, items: [{ kind: 'track', label: 'English', lang: 'en', cues: [{ s: 0, e: 2, t: 'Hello regression.' }] }] },
    { frame: 'https://lms.example.edu/courses/1/pages/a', title: 'Page', media: 0, items: [{ kind: 'panel', label: 'Transcript panel', text: 'x'.repeat(250) }] },
    null,
  ], 'Module 21 lecture');
  assert.equal(files.length, 2);
  assert.deepEqual([files[0].filename, files[0].mime, files[0].cues, files[0].title], ['captions-1.vtt', 'text/vtt', 1, 'Module 21 lecture — captions (en)']);
  assert.match(files[0].text, /^WEBVTT/);
  assert.deepEqual([files[1].filename, files[1].mime, files[1].cues], ['transcript-2.txt', 'text/plain', 0]);
  assert.deepEqual(captionFiles([{ frame: 'https://a.example/x', title: 't', media: 1, items: [] }], 'x'), []);
});
