import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateAge, generateRandomProfile } from '../shared/profile-generator.js';

test('generateRandomProfile returns adult profile fields with consistent age and birthday', () => {
  const referenceDate = new Date('2026-04-13T00:00:00Z');
  const randomValues = [0.1, 0.2, 0.3];
  let randomIndex = 0;
  const profile = generateRandomProfile({
    referenceDate,
    random: () => {
      const value = randomValues[randomIndex] ?? 0.4;
      randomIndex += 1;
      return value;
    },
  });

  assert.match(profile.firstName, /^[A-Z][a-z]+$/);
  assert.match(profile.lastName, /^[A-Z][a-z]+$/);
  assert.equal(profile.fullName, `${profile.firstName} ${profile.lastName}`);
  assert.match(profile.birthday, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(profile.age, /^\d+$/);
  assert.equal(String(calculateAge(referenceDate, profile.birthday)), profile.age);
  assert.equal(Number(profile.age) >= 21, true);
  assert.equal(Number(profile.age) <= 34, true);
});

test('calculateAge respects birthdays not yet reached in current year', () => {
  assert.equal(
    calculateAge(new Date('2026-04-13T00:00:00Z'), '2000-04-14'),
    25,
  );
  assert.equal(
    calculateAge(new Date('2026-04-13T00:00:00Z'), '2000-04-13'),
    26,
  );
});
