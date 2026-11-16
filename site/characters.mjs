export const characters = [
  { id: 'alex', name: 'Alex', label: 'アレックス', aliases: ['Alex', 'アレックス', 'アレクス', 'あれっくす'], locale: 'en-US', language: 'American English', voiceSlot: 0, outfit: '#a04b36', hair: '#452f2b' },
  { id: 'maya', name: 'Maya', label: 'マヤ', aliases: ['Maya', 'マヤ', 'まや'], locale: 'en-US', language: 'American English', voiceSlot: 1, outfit: '#376d77', hair: '#362727' },
];

export const defaultCharacter = characters[0];
export const findCharacter = (id) => characters.find((character) => character.id === id);
