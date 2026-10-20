import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Queue } from '../src/queue.js';

const tracks = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));
const ids = (queue) => queue.order.map((i) => queue.tracks[i].id).join('');

// A fixed "random" source so shuffles are repeatable.
function seeded(seed = 1) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

describe('Queue', () => {
  test('plays from the chosen track and stops at the end without wrap', () => {
    const q = new Queue();
    q.load(tracks, 3);
    assert.equal(q.current.id, 'd');
    assert.equal(q.next().id, 'e');
    assert.equal(q.next(), null);
    assert.equal(q.current.id, 'e', 'stays on the last track');
  });

  test('wraps around when asked (repeat all)', () => {
    const q = new Queue();
    q.load(tracks, 4);
    assert.equal(q.next({ wrap: true }).id, 'a');
    assert.equal(q.previous({ wrap: true }).id, 'e');
    q.load(tracks, 0);
    assert.equal(q.previous(), null);
  });

  test('shuffle keeps the chosen track first and plays every track once', () => {
    const q = new Queue({ random: seeded(7) });
    q.load(tracks, 2, { shuffle: true });
    assert.equal(q.current.id, 'c');
    const played = [q.current.id];
    while (q.next()) played.push(q.current.id);
    assert.deepEqual([...played].sort(), ['a', 'b', 'c', 'd', 'e']);
    assert.notEqual(played.join(''), 'cdeab', 'actually shuffled');
  });

  test('turning shuffle off mid-queue continues in list order from the current track', () => {
    const q = new Queue({ random: seeded(3) });
    q.load(tracks, 0, { shuffle: true });
    q.next();
    const now = q.current.id;
    q.setShuffle(false);
    assert.equal(ids(q), 'abcde');
    assert.equal(q.current.id, now);
  });

  test('an empty list has no current track', () => {
    const q = new Queue();
    q.load([], 0, { shuffle: true });
    assert.equal(q.current, null);
    assert.equal(q.next({ wrap: true }), null);
  });
});
