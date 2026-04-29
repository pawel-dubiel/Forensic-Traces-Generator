import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';

export interface ExecutableConfig {
  nairnMpmBin: string;
  extractMpmBin: string;
}

const requireEnvPath = (name: string) => {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`${name} is required and must point to an executable file`);
  }
  return value;
};

export const loadExecutableConfig = (): ExecutableConfig => ({
  nairnMpmBin: requireEnvPath('NAIRN_MPM_BIN'),
  extractMpmBin: requireEnvPath('EXTRACT_MPM_BIN')
});

export const validateExecutableFile = async (path: string, label: string) => {
  let fileStat;
  try {
    fileStat = await stat(path);
  } catch (error) {
    throw new Error(`${label} executable does not exist at ${path}: ${(error as Error).message}`);
  }

  if (!fileStat.isFile()) {
    throw new Error(`${label} executable path is not a file: ${path}`);
  }

  try {
    await access(path, constants.X_OK);
  } catch (error) {
    throw new Error(`${label} executable is not executable at ${path}: ${(error as Error).message}`);
  }
};

export const validateExecutableConfig = async (config: ExecutableConfig) => {
  await validateExecutableFile(config.nairnMpmBin, 'NAIRN_MPM_BIN');
  await validateExecutableFile(config.extractMpmBin, 'EXTRACT_MPM_BIN');
};
