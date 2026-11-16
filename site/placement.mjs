// This scene fixes the referents and their English audio examples.
export const examples = Object.freeze({ water: 'water', cup: 'cup', place: 'here' });

export function createPlacement() {
  const agreed = {};
  const attempts = [];
  const sharedExamples = new Set();
  const independentUses = [];
  let pending;
  let request;

  return {
    agreed,
    attempts,
    sharedExamples,
    independentUses,
    get pending() { return pending; },
    get request() { return request; },
    hear(target, expression, exampleRequested) {
      const text = expression.trim().slice(0, 80);
      if (!Object.hasOwn(examples, target) || !text) return;
      const known = agreed[target] === text
        || (sharedExamples.has(target) && examples[target].toLowerCase() === text.toLowerCase());
      pending = { target, text, exampleRequested, known };
    },
    propose(expression) {
      const text = expression.trim().slice(0, 160);
      if (!agreed.water || !agreed.cup || !agreed.place || !text) return;
      const key = text.normalize('NFKC').toLowerCase();
      const includes = word => key.includes(word.normalize('NFKC').toLowerCase());
      if (!['water', 'place'].every(target => includes(agreed[target])
        || (sharedExamples.has(target) && includes(examples[target])))) return;
      pending = { target: 'request', text };
    },
    answer(yes) {
      if (!pending) return;
      const { target, text, exampleRequested, known } = pending;
      pending = undefined;
      if (!yes) return;
      if (target === 'request') request = text;
      else if (known && !exampleRequested) independentUses.push({ target, text });
      else {
        if (agreed[target] !== text && target !== 'cup') request = undefined;
        agreed[target] = text;
        if (exampleRequested) sharedExamples.add(target);
      }
    },
    perform(object, location, action, hinted) {
      if (!request) return;
      const result = { object: object === 'water', location: location === 'place', action: action === 'place', hinted };
      attempts.push(result);
      return result;
    },
  };
}
