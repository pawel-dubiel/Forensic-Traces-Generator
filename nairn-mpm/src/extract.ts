import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ExecutableConfig } from './executables.js';
import type { ExtractedParticle, Scenario } from './types.js';
import { normalizeParticles } from './result.js';

const execFileAsync = promisify(execFile);

const parseNumber = (value: string, label: string) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be numeric, got "${value}"`);
  }
  return parsed;
};

const attr = (source: string, name: string): string | undefined => {
  const match = new RegExp(`${name}=['"]([^'"]+)['"]`).exec(source);
  return match?.[1];
};

export const parseExtractedXmlParticles = (xml: string): ExtractedParticle[] => {
  const particles: ExtractedParticle[] = [];
  const particleRegex = /<mp\b([^>]*)>([\s\S]*?)<\/mp>/g;
  let match: RegExpExecArray | null;

  while ((match = particleRegex.exec(xml)) !== null) {
    const [, mpAttrs, body] = match;
    const pointMatch = /<pt\b([^>]*)\/>/.exec(body);
    if (!pointMatch) {
      throw new Error('ExtractMPM XML particle is missing <pt/> position');
    }
    const velMatch = /<vel\b([^>]*)\/>/.exec(body);
    const massMatch = /<mass\b([^>]*)\/>/.exec(body);

    const x = attr(pointMatch[1], 'x');
    const y = attr(pointMatch[1], 'y');
    const matl = attr(mpAttrs, 'matl');
    if (x === undefined || y === undefined || matl === undefined) {
      throw new Error('ExtractMPM XML particle must include matl, pt.x, and pt.y');
    }

    const particle: ExtractedParticle = {
      materialId: parseNumber(matl, 'matl'),
      x: parseNumber(x, 'pt.x'),
      y: parseNumber(y, 'pt.y')
    };

    const thick = attr(mpAttrs, 'thick');
    if (thick !== undefined) {
      particle.thickness = parseNumber(thick, 'thick');
    }

    if (velMatch) {
      const vx = attr(velMatch[1], 'x');
      const vy = attr(velMatch[1], 'y');
      if (vx !== undefined) particle.vx = parseNumber(vx, 'vel.x');
      if (vy !== undefined) particle.vy = parseNumber(vy, 'vel.y');
    }

    if (massMatch) {
      const mass = attr(massMatch[1], 'm');
      if (mass !== undefined) particle.mass = parseNumber(mass, 'mass.m');
    }

    particles.push(particle);
  }

  if (particles.length === 0) {
    throw new Error('No <mp> particles found in ExtractMPM XML data');
  }
  return particles;
};

export const parseExtractedTextParticles = (text: string): ExtractedParticle[] => {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  if (lines.length < 2) {
    throw new Error('ExtractMPM text data must include a header row and at least one particle row');
  }

  const header = lines[0].split(/[\t,\s]+/);
  const required = ['matl', 'x', 'y'];
  for (const key of required) {
    if (!header.includes(key)) {
      throw new Error(`ExtractMPM text header must include "${key}"`);
    }
  }

  const indexOf = (key: string) => header.indexOf(key);
  return lines.slice(1).map((line, rowIndex) => {
    const cols = line.split(/[\t,\s]+/);
    if (cols.length !== header.length) {
      throw new Error(`ExtractMPM text row ${rowIndex + 2} has ${cols.length} columns; expected ${header.length}`);
    }

    const particle: ExtractedParticle = {
      materialId: parseNumber(cols[indexOf('matl')], `row ${rowIndex + 2} matl`),
      x: parseNumber(cols[indexOf('x')], `row ${rowIndex + 2} x`),
      y: parseNumber(cols[indexOf('y')], `row ${rowIndex + 2} y`)
    };

    const optionalMap: Array<[keyof ExtractedParticle, string]> = [
      ['vx', 'vx'],
      ['vy', 'vy'],
      ['mass', 'mass'],
      ['thickness', 'thick'],
      ['displacementX', 'ux'],
      ['displacementY', 'uy'],
      ['damage', 'damage']
    ];
    for (const [property, column] of optionalMap) {
      const index = indexOf(column);
      if (index >= 0) {
        (particle[property] as number) = parseNumber(cols[index], `row ${rowIndex + 2} ${column}`);
      }
    }

    return particle;
  });
};

export const parseExtractedParticles = (contents: string): ExtractedParticle[] => {
  if (contents.includes('<PointList') || contents.includes('<mp ')) {
    return parseExtractedXmlParticles(contents);
  }
  return parseExtractedTextParticles(contents);
};

export const extractArchiveWithExtractMpm = async (
  scenario: Scenario,
  executables: ExecutableConfig,
  archivePath: string,
  runDir: string
) => {
  await mkdir(runDir, { recursive: true });
  const outputRoot = join(runDir, `${scenario.outputName}.particles`);
  const args = ['-o', outputRoot, ...scenario.solver.extractFields.flatMap(field => ['-q', field]), archivePath];
  const command = [executables.extractMpmBin, ...args];

  try {
    const result = await execFileAsync(executables.extractMpmBin, args, { maxBuffer: 1024 * 1024 * 20 });
    await writeFile(join(runDir, 'extract.stdout.log'), result.stdout, 'utf8');
    await writeFile(join(runDir, 'extract.stderr.log'), result.stderr, 'utf8');
    await writeFile(join(runDir, 'extract.command.json'), `${JSON.stringify(command, null, 2)}\n`, 'utf8');
  } catch (error) {
    const execError = error as Error & { stdout?: string; stderr?: string; code?: number };
    await writeFile(join(runDir, 'extract.stdout.log'), execError.stdout ?? '', 'utf8');
    await writeFile(join(runDir, 'extract.stderr.log'), execError.stderr ?? execError.message, 'utf8');
    await writeFile(join(runDir, 'extract.command.json'), `${JSON.stringify(command, null, 2)}\n`, 'utf8');
    throw new Error(`ExtractMPM failed for archive "${archivePath}" with exit code ${execError.code ?? 'unknown'}; see ${runDir}`);
  }

  return { command, outputRoot };
};

export const normalizeExtractedFile = async (
  scenario: Scenario,
  extractedPath: string,
  resultPath: string,
  solverInputPath?: string,
  solverCommand?: string[]
) => {
  const contents = await readFile(extractedPath, 'utf8');
  const particles = parseExtractedParticles(contents);
  const result = normalizeParticles(
    scenario,
    particles,
    {
      scenario: basename(`${scenario.outputName}.scenario.json`),
      solverInput: solverInputPath,
      extractedData: extractedPath
    },
    solverCommand
  );

  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  return result;
};
