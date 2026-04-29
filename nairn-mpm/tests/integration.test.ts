import test from 'node:test';
import assert from 'node:assert/strict';
import { loadExecutableConfig, validateExecutableConfig } from '../src/executables.js';

test('external executable validation is gated by environment variables', async t => {
  if (!process.env.NAIRN_MPM_BIN || !process.env.EXTRACT_MPM_BIN) {
    t.skip('NAIRN_MPM_BIN and EXTRACT_MPM_BIN are not configured');
    return;
  }

  const config = loadExecutableConfig();
  await validateExecutableConfig(config);
  assert.ok(config.nairnMpmBin);
  assert.ok(config.extractMpmBin);
});

test('missing executable environment variables fail fast', () => {
  const originalNairn = process.env.NAIRN_MPM_BIN;
  const originalExtract = process.env.EXTRACT_MPM_BIN;
  delete process.env.NAIRN_MPM_BIN;
  delete process.env.EXTRACT_MPM_BIN;

  try {
    assert.throws(() => loadExecutableConfig(), /NAIRN_MPM_BIN/);
  } finally {
    if (originalNairn !== undefined) process.env.NAIRN_MPM_BIN = originalNairn;
    if (originalExtract !== undefined) process.env.EXTRACT_MPM_BIN = originalExtract;
  }
});
