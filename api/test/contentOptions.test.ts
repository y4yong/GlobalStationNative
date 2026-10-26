import assert from 'node:assert/strict';
import test from 'node:test';
import { contentGenreSchema } from '../src/contentOptions.js';

test('normalizes multiple selected genres for storage', () => {
  assert.equal(contentGenreSchema.parse(['Drama', 'Romance']), 'Drama, Romance');
});

test('preserves existing single and comma-separated genre values', () => {
  assert.equal(contentGenreSchema.parse('Drama'), 'Drama');
  assert.equal(contentGenreSchema.parse('Drama, Romance'), 'Drama, Romance');
});

test('rejects empty, invalid, and duplicate genre selections', () => {
  assert.throws(() => contentGenreSchema.parse([]));
  assert.throws(() => contentGenreSchema.parse(['Drama', 'Unknown']));
  assert.throws(() => contentGenreSchema.parse(['Drama', 'Drama']));
});
