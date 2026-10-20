import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { classifyFormat, guessFromFilename } from '../src/library/metadata.js';

describe('guessFromFilename', () => {
  const cases = [
    ['Daft Punk - Get Lucky.mp3', { artist: 'Daft Punk', title: 'Get Lucky' }],
    ['07. Daft Punk - Get Lucky (feat. Pharrell).flac', { artist: 'Daft Punk', title: 'Get Lucky (feat. Pharrell)' }],
    ['03 - Intro.mp3', { artist: null, title: 'Intro' }],
    ['some_song_name.m4a', { artist: null, title: 'some song name' }],
    ['99 Problems.mp3', { artist: null, title: '99 Problems' }], // a number that is part of the title stays
    ['C:\\Users\\me\\Music\\Artist - Song.mp3', { artist: 'Artist', title: 'Song' }], // old browsers send full paths
    ['', { artist: null, title: null }],
  ];
  for (const [name, expected] of cases) {
    test(JSON.stringify(name), () => assert.deepEqual(guessFromFilename(name), expected));
  }
});

describe('classifyFormat', () => {
  test('accepts formats browsers can play', () => {
    assert.equal(classifyFormat({ container: 'MPEG', codec: 'MPEG 1 Layer 3' }).mime, 'audio/mpeg');
    assert.equal(classifyFormat({ container: 'FLAC', codec: 'FLAC' }).mime, 'audio/flac');
    assert.equal(classifyFormat({ container: 'M4A/isom/iso2', codec: 'MPEG-4/AAC' }).ext, 'm4a');
    assert.equal(classifyFormat({ container: 'Ogg', codec: 'Opus' }).ext, 'opus');
    assert.equal(classifyFormat({ container: 'Ogg', codec: 'Vorbis I' }).ext, 'ogg');
    assert.equal(classifyFormat({ container: 'WAVE', codec: 'PCM' }).mime, 'audio/wav');
    assert.equal(classifyFormat({ container: 'ADTS/MPEG-4', codec: 'AAC' }).mime, 'audio/aac');
  });

  test('rejects formats browsers cannot play', () => {
    assert.equal(classifyFormat({ container: 'M4A/isom', codec: 'ALAC' }), null);
    assert.equal(classifyFormat({ container: 'ASF/audio', codec: 'Windows Media Audio 9' }), null);
    assert.equal(classifyFormat({ container: 'WAVE', codec: 'ADPCM' }), null);
    assert.equal(classifyFormat({ container: 'MPEG', codec: 'MPEG 1 Layer 2' }), null);
    assert.equal(classifyFormat({}), null);
  });
});
