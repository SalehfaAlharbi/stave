import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isLrc, lrcToPlain, parseLrc, parsePlain } from '../src/lyrics/lrc.js';

describe('parseLrc', () => {
  test('reads [mm:ss.xx], [mm:ss] and [mm:ss.xxx] stamps', () => {
    assert.deepEqual(parseLrc('[00:01.50] One\n[00:03] Two\n[01:02.250] Three'), [
      { time: 1.5, text: 'One' },
      { time: 3, text: 'Two' },
      { time: 62.25, text: 'Three' },
    ]);
  });

  test('a line with several stamps repeats, and everything is sorted by time', () => {
    assert.deepEqual(parseLrc('[00:10.00][00:30.00] Chorus\n[00:20.00] Verse'), [
      { time: 10, text: 'Chorus' },
      { time: 20, text: 'Verse' },
      { time: 30, text: 'Chorus' },
    ]);
  });

  test('skips metadata tags, applies [offset], strips word stamps, keeps gaps', () => {
    const text = [
      '[ar: Someone]',
      '[ti: Something]',
      '[offset:+500]',
      '[00:02.00] <00:02.00>Word <00:02.40>by <00:02.80>word',
      '[00:05.00]',
      'an unstamped stray line',
    ].join('\r\n');
    assert.deepEqual(parseLrc(text), [
      { time: 1.5, text: 'Word by word' },
      { time: 4.5, text: '' },
    ]);
  });

  test('never goes below zero', () => {
    assert.deepEqual(parseLrc('[offset:+3000]\n[00:01.00] Early'), [{ time: 0, text: 'Early' }]);
  });
});

describe('plain lyrics', () => {
  test('keep single blank lines between verses and trim the rest', () => {
    assert.deepEqual(parsePlain('\n  One  \nTwo\n\n\n\nThree\n\n'), [
      { time: null, text: 'One' },
      { time: null, text: 'Two' },
      { time: null, text: '' },
      { time: null, text: 'Three' },
    ]);
  });

  test('isLrc tells the two apart; lrcToPlain drops the stamps', () => {
    assert.equal(isLrc('[00:01.00] synced'), true);
    assert.equal(isLrc('Just words\n[Chorus]\nmore words'), false, '[Chorus] is not a timestamp');
    assert.equal(lrcToPlain('[00:01.00] A\n[00:02.00] B'), 'A\nB');
  });
});
