const assertFiniteInteger = (value: number, label: string) => {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer`);
  }
};

export const createSeededRandom = (seed: number) => {
  assertFiniteInteger(seed, 'seed');
  let state = seed >>> 0;

  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

export const deriveSeed = (seed: number, salt: number) => {
  assertFiniteInteger(seed, 'seed');
  assertFiniteInteger(salt, 'salt');
  return (seed ^ (salt * 0x9e3779b9)) >>> 0;
};
