import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  AgentIntegrationTarget,
  AgentIntegrationTokenEnvWriter,
} from '@linkterm/runtime/core/agent-integrations/index';

const execFileAsync = promisify(execFile);

export function renderCodexTokenEnvScript(input: { envVar: string; token: string }): string {
  const escaped = input.token.replace(/`/gu, '``').replace(/"/gu, '`"');
  return `$env:${input.envVar} = "${escaped}"\n`;
}

export function renderWslCodexTokenEnvInstallScript(input: {
  envVar: string;
  token: string;
}): string {
  const exportLine = `export ${input.envVar}=${shellSingleQuote(input.token)}`;
  return [
    'set -eu',
    'mkdir -p "$HOME/.config/linkterm"',
    `printf '%s\\n' ${shellSingleQuote(exportLine)} > "$HOME/.config/linkterm/mcp-env.sh"`,
    'chmod 600 "$HOME/.config/linkterm/mcp-env.sh" 2>/dev/null || true',
    'touch "$HOME/.profile"',
    'if ! grep -Fq "# LinkTerm MCP token env" "$HOME/.profile"; then',
    '  {',
    '    printf "\\n# LinkTerm MCP token env\\n"',
    '    printf "if [ -f \\"$HOME/.config/linkterm/mcp-env.sh\\" ]; then\\n"',
    '    printf "  . \\"$HOME/.config/linkterm/mcp-env.sh\\"\\n"',
    '    printf "fi\\n"',
    '  } >> "$HOME/.profile"',
    'fi',
    '',
  ].join('\n');
}

export function createCodexTokenEnvWriter(): AgentIntegrationTokenEnvWriter {
  return {
    writeTokenEnv: async (target, input) => {
      if (target.platform === 'wsl') {
        await writeWslTokenEnv(target, input);
        return {
          changed: true,
          restartRequired: true,
          message: `Restart WSL Codex or source ~/.config/linkterm/mcp-env.sh so ${input.envVar} is available.`,
        };
      }
      await execFileAsync('setx.exe', [input.envVar, input.token], {
        windowsHide: true,
        timeout: 5000,
      });
      process.env[input.envVar] = input.token;
      return {
        changed: true,
        restartRequired: true,
        message: `Restart Codex so ${input.envVar} is available.`,
      };
    },
  };
}

async function writeWslTokenEnv(
  target: AgentIntegrationTarget,
  input: { envVar: string; token: string },
): Promise<void> {
  const script = renderWslCodexTokenEnvInstallScript(input);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      'wsl.exe',
      [
        '-d',
        requireWslDistroName(target),
        '-e',
        '/bin/sh',
        '-lc',
        'cat > /tmp/linkterm-codex-token-env.sh && /bin/sh /tmp/linkterm-codex-token-env.sh',
      ],
      {
        stdio: ['pipe', 'ignore', 'pipe'],
        windowsHide: true,
      },
    );
    let stderr = '';
    child.stderr.setEncoding('utf-8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`wsl.exe exited with code ${code}: ${stderr.trim()}`));
    });
    child.stdin.end(script, 'utf-8');
  });
}

function requireWslDistroName(target: AgentIntegrationTarget): string {
  const parts = target.id.split(':');
  const distroName = parts[2];
  if (target.platform !== 'wsl' || !distroName) {
    throw new Error(`Agent integration target is not a WSL target: ${target.id}`);
  }
  return distroName;
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/gu, `'\\''`)}'`;
}
