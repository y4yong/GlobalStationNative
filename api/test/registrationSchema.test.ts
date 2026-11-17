import assert from 'node:assert/strict';
import test from 'node:test';
import { registerRequestSchema } from '../src/auth.js';

const account = {
  name: 'Cineva Viewer',
  email: 'viewer@example.com',
  password: 'secure-password',
};

test('allows sign-up without optional ad personalization', () => {
  const result = registerRequestSchema.parse(account);
  assert.equal(result.adPersonalizationEnabled, false);
  assert.equal(result.adAgeRange, null);
  assert.equal(result.adGender, null);
});

test('accepts opted-in age and gender preferences at sign-up', () => {
  const result = registerRequestSchema.parse({
    ...account,
    adPersonalizationEnabled: true,
    adAgeRange: '25-34',
    adGender: 'PREFER_NOT_TO_SAY',
  });
  assert.equal(result.adPersonalizationEnabled, true);
  assert.equal(result.adAgeRange, '25-34');
  assert.equal(result.adGender, 'PREFER_NOT_TO_SAY');
});

test('requires both age and gender choices when personalization is enabled', () => {
  assert.equal(registerRequestSchema.safeParse({
    ...account,
    adPersonalizationEnabled: true,
    adAgeRange: '25-34',
  }).success, false);
  assert.equal(registerRequestSchema.safeParse({
    ...account,
    adPersonalizationEnabled: true,
    adGender: 'WOMAN',
  }).success, false);
});
