#!/usr/bin/env node
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { loadExecutableConfig, validateExecutableConfig } from './executables.js';
import { normalizeExtractedFile } from './extract.js';
import { loadScenario } from './scenario.js';
import { generateInputFiles, runNairnMpm, scenarioRunDir } from './runner.js';

const usage = () => {
  console.error(`Usage:
  node dist/src/cli.js validate-scenario <scenario.json>
  node dist/src/cli.js generate-input <scenario.json> [--run-root <dir>]
  node dist/src/cli.js run-scenario <scenario.json> [--run-root <dir>]
  node dist/src/cli.js extract-results <scenario.json> <extracted.txt|extracted.xml> [--result <result.json>]
  node dist/src/cli.js summarize-result <result.json>`);
};

const readOption = (args: string[], name: string, fallback?: string) => {
  const index = args.indexOf(name);
  if (index < 0) {
    return fallback;
  }
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }
  return value;
};

const run = async () => {
  const [, , command, ...args] = process.argv;

  if (!command) {
    usage();
    process.exitCode = 1;
    return;
  }

  if (command === 'validate-scenario') {
    const scenarioPath = args[0];
    if (!scenarioPath) throw new Error('validate-scenario requires <scenario.json>');
    const scenario = await loadScenario(scenarioPath);
    console.log(JSON.stringify({ ok: true, id: scenario.id, tool: scenario.tool.type, material: scenario.target.material }, null, 2));
    return;
  }

  if (command === 'generate-input') {
    const scenarioPath = args[0];
    if (!scenarioPath) throw new Error('generate-input requires <scenario.json>');
    const runRoot = readOption(args, '--run-root', 'runs');
    const scenario = await loadScenario(scenarioPath);
    const generated = await generateInputFiles(scenario, runRoot);
    console.log(JSON.stringify({ inputPath: generated.inputPath, runDir: generated.runDir }, null, 2));
    return;
  }

  if (command === 'run-scenario') {
    const scenarioPath = args[0];
    if (!scenarioPath) throw new Error('run-scenario requires <scenario.json>');
    const runRoot = readOption(args, '--run-root', 'runs');
    const scenario = await loadScenario(scenarioPath);
    const executables = loadExecutableConfig();
    await validateExecutableConfig(executables);
    const result = await runNairnMpm(scenario, executables, runRoot);
    console.log(JSON.stringify({ inputPath: result.inputPath, runDir: result.runDir, command: result.command }, null, 2));
    return;
  }

  if (command === 'extract-results') {
    const scenarioPath = args[0];
    const extractedPath = args[1];
    if (!scenarioPath || !extractedPath) {
      throw new Error('extract-results requires <scenario.json> and <extracted.txt|extracted.xml>');
    }
    const scenario = await loadScenario(scenarioPath);
    const resultPath = resolve(readOption(args, '--result', join(scenarioRunDir(scenario), 'result.json'))!);
    await mkdir(dirname(resultPath), { recursive: true });
    const result = await normalizeExtractedFile(scenario, extractedPath, resultPath);
    console.log(JSON.stringify({ resultPath, particleCount: result.particleSummary.particleCount }, null, 2));
    return;
  }

  if (command === 'summarize-result') {
    const resultPath = args[0];
    if (!resultPath) throw new Error('summarize-result requires <result.json>');
    const raw = await readFile(resultPath, 'utf8');
    const result = JSON.parse(raw) as {
      metadata: { scenarioId: string; outputName: string };
      particleSummary: { particleCount: number; bounds: unknown; maxDisplacement: number | null; maxDamage: number | null };
      diagnostics: { warnings: string[] };
    };
    console.log(JSON.stringify({
      scenarioId: result.metadata.scenarioId,
      outputName: result.metadata.outputName,
      particleCount: result.particleSummary.particleCount,
      bounds: result.particleSummary.bounds,
      maxDisplacement: result.particleSummary.maxDisplacement,
      maxDamage: result.particleSummary.maxDamage,
      warnings: result.diagnostics.warnings
    }, null, 2));
    return;
  }

  usage();
  throw new Error(`Unknown command "${command}"`);
};

run().catch(error => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
