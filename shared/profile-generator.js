const FIRST_NAMES = [
  'Adrian', 'Aiden', 'Archer', 'Asher', 'Caleb', 'Carter', 'Declan', 'Ethan',
  'Evan', 'Felix', 'Gavin', 'Hudson', 'Ian', 'Jasper', 'Julian', 'Leo',
  'Liam', 'Miles', 'Nolan', 'Owen', 'Roman', 'Silas', 'Theo', 'Wyatt',
];

const LAST_NAMES = [
  'Bennett', 'Brooks', 'Carter', 'Coleman', 'Foster', 'Griffin', 'Hayes', 'Hunter',
  'Jensen', 'Keller', 'Mason', 'Mercer', 'Parker', 'Quinn', 'Reed', 'Sawyer',
  'Spencer', 'Stone', 'Turner', 'Vaughn', 'Walker', 'Warren', 'Wells', 'Young',
];

function pickRandom(list, random = Math.random) {
  return list[Math.floor(random() * list.length)] || list[0];
}

function buildDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value || Date.now());
  date.setHours(0, 0, 0, 0);
  return date;
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function calculateAge(referenceDate, birthday) {
  const today = buildDate(referenceDate);
  const birthDate = buildDate(birthday);
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDelta = today.getMonth() - birthDate.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < birthDate.getDate())) {
    age -= 1;
  }
  return age;
}

export function generateRandomProfile({
  referenceDate = new Date(),
  random = Math.random,
  minAge = 21,
  maxAge = 34,
} = {}) {
  const today = buildDate(referenceDate);
  const oldestBirthDate = new Date(today.getFullYear() - maxAge, today.getMonth(), today.getDate());
  const youngestBirthDate = new Date(today.getFullYear() - minAge, today.getMonth(), today.getDate());
  const birthRangeMs = youngestBirthDate.getTime() - oldestBirthDate.getTime();
  const birthday = new Date(oldestBirthDate.getTime() + Math.floor(random() * (birthRangeMs + 1)));

  const firstName = pickRandom(FIRST_NAMES, random);
  const lastName = pickRandom(LAST_NAMES, random);
  const age = calculateAge(today, birthday);

  return {
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`,
    birthday: formatDate(birthday),
    age: String(age),
  };
}
