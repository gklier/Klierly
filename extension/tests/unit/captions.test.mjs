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

import { normalizeTranscript, ttmlToVtt } from '../../src/captions.js';

test('transcripts are recognised by what they are, and unknown formats are refused', () => {
  assert.deepEqual(normalizeTranscript('﻿WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHello.\n'), { format: 'vtt', text: 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHello.' });
  assert.equal(normalizeTranscript('1\n00:00:01,000 --> 00:00:03,000\nHello.\n').format, 'srt');
  assert.deepEqual(normalizeTranscript('This is a plain transcript.\nIt has no timestamps.'), { format: 'text', text: 'This is a plain transcript.\nIt has no timestamps.' });
  assert.equal(normalizeTranscript('{"captions":[{"t":1,"text":"x"}]}').format, 'unrecognised');
  assert.equal(normalizeTranscript('<html><body>Sign in</body></html>').format, 'unrecognised'); // a login page is not a transcript
  assert.equal(normalizeTranscript('   ').format, 'empty');
});

test('timed-text XML becomes WebVTT with entities decoded', () => {
  const xml = '<?xml version="1.0"?><tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="00:00:01.500" end="00:00:04.000">The t&amp;p ratio<br/>is the estimate over its standard error.</p><p begin="4.0s" dur="2s">Next <span>line</span></p><p begin="x" end="y">ignored</p></div></body></tt>';
  const vtt = ttmlToVtt(xml);
  assert.equal(vtt, 'WEBVTT\n\n00:00:01.500 --> 00:00:04.000\nThe t&p ratio is the estimate over its standard error.\n\n00:00:04.000 --> 00:00:06.000\nNext line\n');
  assert.equal(normalizeTranscript(xml).format, 'vtt');
  assert.equal(ttmlToVtt('<tt><body></body></tt>'), '');
});

test('Mediasite results become files, and every reason for skipping is reported', () => {
  const notes = [];
  const files = captionFiles([
    { frame: 'https://m.example.edu/Mediasite/Play/abc', title: 'Player', media: 0, notes: ['This lecture has no transcript or captions published in Mediasite.'], items: [] },
    { frame: 'https://m.example.edu/Mediasite/Play/def', title: 'Player', media: 0, items: [{ kind: 'mediasite', title: 'Module 21 lecture', raw: 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nWilcoxon rank sum.\n' }] },
    { frame: 'https://m.example.edu/Mediasite/Play/ghi', title: 'Player', media: 0, items: [{ kind: 'mediasite', title: 'x', raw: '{"nope":1}' }] },
  ], 'Fallback title', notes);
  assert.equal(files.length, 1);
  assert.deepEqual([files[0].title, files[0].filename, files[0].mime, files[0].cues, files[0].source], ['Module 21 lecture — transcript', 'mediasite-1.vtt', 'text/vtt', 1, 'mediasite']);
  assert.equal(files[0].preview, 'Wilcoxon rank sum.');
  assert.equal(notes.length, 2);
  assert.match(notes[0], /no transcript or captions published/);
  assert.match(notes[1], /format Klierly does not recognise/);
});
