import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ExecutableConfig } from './executables.js';
import type { Scenario } from './types.js';
import { generateNairnXml, validateGeneratedXmlStructure } from './xml.js';

const execFileAsync = promisify(execFile);

export interface GeneratedInput {
  runDir: string;
  inputPath: string;
  xml: string;
}

export const scenarioRunDir = (scenario: Scenario, rootDir = 'runs') => resolve(rootDir, scenario.id);

export const generateInputFiles = async (scenario: Scenario, rootDir = 'runs'): Promise<GeneratedInput> => {
  const runDir = scenarioRunDir(scenario, rootDir);
  const archiveDir = join(runDir, 'archive');
  await mkdir(archiveDir, { recursive: true });

  const xml = generateNairnXml(scenario);
  validateGeneratedXmlStructure(xml);

  const inputPath = join(runDir, `${scenario.outputName}.fmcmd`);
  await writeFile(inputPath, xml, 'utf8');
  await writeFile(join(runDir, `${scenario.outputName}.scenario.json`), `${JSON.stringify(scenario, null, 2)}\n`, 'utf8');
  return { runDir, inputPath, xml };
};

export const runNairnMpm = async (
  scenario: Scenario,
  executables: ExecutableConfig,
  rootDir = 'runs'
) => {
  const generated = await generateInputFiles(scenario, rootDir);
  const command = [executables.nairnMpmBin, basename(generated.inputPath)];

  try {
    const result = await execFileAsync(executables.nairnMpmBin, [basename(generated.inputPath)], {
      cwd: generated.runDir,
      maxBuffer: 1024 * 1024 * 20
    });

    await writeFile(join(generated.runDir, 'solver.stdout.log'), result.stdout, 'utf8');
    await writeFile(join(generated.runDir, 'solver.stderr.log'), result.stderr, 'utf8');
    await writeFile(join(generated.runDir, 'solver.command.json'), `${JSON.stringify(command, null, 2)}\n`, 'utf8');
    return { ...generated, command, stdoutPath: join(generated.runDir, 'solver.stdout.log'), stderrPath: join(generated.runDir, 'solver.stderr.log') };
  } catch (error) {
    const execError = error as Error & { stdout?: string; stderr?: string; code?: number };
    await writeFile(join(generated.runDir, 'solver.stdout.log'), execError.stdout ?? '', 'utf8');
    await writeFile(join(generated.runDir, 'solver.stderr.log'), execError.stderr ?? execError.message, 'utf8');
    await writeFile(join(generated.runDir, 'solver.command.json'), `${JSON.stringify(command, null, 2)}\n`, 'utf8');
    throw new Error(`NairnMPM failed for scenario "${scenario.id}" with exit code ${execError.code ?? 'unknown'}; see ${generated.runDir}`);
  }
};
