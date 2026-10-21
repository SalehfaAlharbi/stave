import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { currentLineIndex, LEAD_SECONDS, lrcStamp, stampLine } from '../src/lyrics-time.js';

const lines = [1, 3.5, 6, 7.25].map((time) => ({ time }));

describe('currentLineIndex', () => {
  test('is -1 before the first line, then the last line that has started', () => {
    assert.equal(currentLineIndex(lines, 0), -1);
    assert.equal(currentLineIndex(lines, 1 - LEAD_SECONDS), 0, 'a quarter second early');
    assert.equal(currentLineIndex(lines, 3.4), 1);
    assert.equal(currentLineIndex(lines, 6.5), 2);
    assert.equal(currentLineIndex(lines, 500), 3);
    assert.equal(currentLineIndex([], 10), -1);
  });
});

describe('lrcStamp', () => {
  test('formats minutes, seconds and hundredths', () => {
    assert.equal(lrcStamp(0), '[00:00.00]');
    assert.equal(lrcStamp(83.456), '[01:23.46]');
    assert.equal(lrcStamp(59.999), '[01:00.00]', 'rounding carries into the minutes');
    assert.equal(lrcStamp(-2), '[00:00.00]');
  });
});

describe('stampLine', () => {
  test('stamps the line under the caret and moves to the next line', () => {
    const text = 'first line\nsecond line\nthird line';
    const once = stampLine(text, 0, 12.5);
    assert.equal(once.text, '[00:12.50] first line\nsecond line\nthird line');
    const twice = stampLine(once.text, once.caret, 15);
    assert.equal(twice.text, '[00:12.50] first line\n[00:15.00] second line\nthird line');
    assert.equal(twice.text.slice(twice.caret), 'third line');
  });

  test('replaces a stamp that is already there, and works on the last line', () => {
    const text = 'a\n[00:01.00] b';
    const result = stampLine(text, text.length, 2);
    assert.equal(result.text, 'a\n[00:02.00] b');
    assert.equal(result.caret, result.text.length);
  });
});
