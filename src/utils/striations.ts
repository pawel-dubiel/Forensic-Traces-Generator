export interface StriationConfig {
  widthMm: number;
  pitchMm: number;
  amplitudeMm: number;
  irregularity: number;
  wear: number;
  random: () => number;
}

export interface StriationProfile {
  widthMm: number;
  values: Float32Array;
}

const assertPositiveFinite = (value: number, label: string) => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number`);
  }
};

const assertNonNegativeFinite = (value: number, label: string) => {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number`);
  }
};

const assertRange = (value: number, label: string, min: number, max: number) => {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be between ${min} and ${max}`);
  }
};

export const createStriationProfile = (config: StriationConfig): StriationProfile => {
  if (!config || typeof config !== 'object') {
    throw new Error('Striation config is required');
  }

  assertPositiveFinite(config.widthMm, 'widthMm');
  assertPositiveFinite(config.pitchMm, 'pitchMm');
  assertNonNegativeFinite(config.amplitudeMm, 'amplitudeMm');
  assertRange(config.irregularity, 'irregularity', 0, 1);
  assertRange(config.wear, 'wear', 0, 1);
  if (typeof config.random !== 'function') {
    throw new Error('random must be a function');
  }

  const samples = Math.max(32, Math.ceil(config.widthMm * 32));
  const values = new Float32Array(samples);
  const cycles = Math.max(1, config.widthMm / config.pitchMm);
  const phase = config.random() * Math.PI * 2;
  const wearScale = 0.6 + config.wear;

  for (let i = 0; i < samples; i++) {
    const x = i / (samples - 1);
    let value = Math.sin(x * cycles * Math.PI * 2 + phase);
    value += Math.sin(x * cycles * Math.PI * 4 + phase * 1.7) * 0.35 * config.irregularity;
    value += (config.random() - 0.5) * 2 * config.irregularity * 0.3;
    value += (config.random() - 0.5) * 2 * config.wear * 0.2;

    if (config.random() < config.wear * 0.08) {
      value -= (0.5 + config.random()) * config.wear * 1.2;
    }

    values[i] = value * config.amplitudeMm * wearScale;
  }

  return { widthMm: config.widthMm, values };
};

export const getStriationOffset = (profile: StriationProfile, positionMm: number): number => {
  if (!profile || !(profile.values instanceof Float32Array)) {
    throw new Error('Striation profile is required');
  }
  assertPositiveFinite(profile.widthMm, 'profile.widthMm');
  if (!Number.isFinite(positionMm)) {
    throw new Error('positionMm must be a finite number');
  }

  const clamped = Math.min(profile.widthMm, Math.max(0, positionMm));
  const maxIndex = profile.values.length - 1;
  if (maxIndex <= 0) {
    throw new Error('Striation profile must contain at least two samples');
  }

  const t = (clamped / profile.widthMm) * maxIndex;
  const idx = Math.floor(t);
  const next = Math.min(maxIndex, idx + 1);
  const frac = t - idx;
  const v0 = profile.values[idx];
  const v1 = profile.values[next];

  return v0 + (v1 - v0) * frac;
};
