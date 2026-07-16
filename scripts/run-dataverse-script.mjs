import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [script, ...args] = process.argv.slice(2);
if (!script) throw new Error('Informe o script PowerShell a executar.');

function loadLocalEnvironment() {
  const path = resolve('.env.local');
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function hasArgument(name) {
  return args.some((argument) => argument.toLowerCase() === name.toLowerCase());
}

function appendOptionalArgument(commandArgs, name, value) {
  if (value?.trim() && !hasArgument(name)) commandArgs.push(name, value.trim());
}

loadLocalEnvironment();
const environmentUrl = process.env.DATAVERSE_ENVIRONMENT_URL?.trim();
if (!environmentUrl) {
  throw new Error(
    'Defina DATAVERSE_ENVIRONMENT_URL no ambiente ou em .env.local. Exemplo: https://suaorg.crm2.dynamics.com/',
  );
}
const commandArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-EnvironmentUrl', environmentUrl, ...args];
const scriptName = script.toLowerCase().replaceAll('\\', '/').split('/').at(-1);
const solutionAwareScripts = new Set([
  'deploy-webresource.ps1',
  'provision-dataverse.ps1',
  'provision-flow.ps1',
  'provision-security.ps1',
  'repair-encoding.ps1',
]);
if (scriptName && solutionAwareScripts.has(scriptName)) {
  appendOptionalArgument(commandArgs, '-SolutionUniqueName', process.env.DATAVERSE_SOLUTION_UNIQUE_NAME);
}
if (scriptName === 'deploy-webresource.ps1') {
  appendOptionalArgument(commandArgs, '-WebResourceName', process.env.DATAVERSE_WEBRESOURCE_NAME);
}
if (scriptName === 'provision-flow.ps1') {
  appendOptionalArgument(
    commandArgs,
    '-DataverseConnectionReferenceLogicalName',
    process.env.DATAVERSE_CONNECTION_REFERENCE_LOGICAL_NAME,
  );
  appendOptionalArgument(
    commandArgs,
    '-OutlookConnectionReferenceLogicalName',
    process.env.OUTLOOK_CONNECTION_REFERENCE_LOGICAL_NAME,
  );
}
const result = spawnSync('powershell', commandArgs, { stdio: 'inherit', shell: false });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
