import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function parseShowEmuList(output) {
  const probes = [];
  for (const line of output.split(/\r?\n/u)) {
    const match = line.match(
      /J-Link\[(\d+)\]:\s*Connection:\s*([^,]+),\s*Serial\s+number:\s*[^,]+,\s*ProductName:\s*(.+)$/iu,
    );
    if (!match) continue;
    probes.push({
      index: Number.parseInt(match[1], 10),
      connection: match[2].trim(),
      productName: match[3].trim(),
    });
  }
  return probes;
}

export function checkJLinkEnvironment(options = {}) {
  const platform = options.platform ?? process.platform;
  const commanderPath = options.commanderPath ?? resolveCommanderPath(platform, process.env);
  const exists = options.existsSync ?? existsSync;
  const readFile = options.readFileSync ?? readFileSync;
  const processNames = options.processNames ?? [];
  const runCommander = options.runCommander ?? runShowEmuList;
  const targetAccess = options.targetAccess;
  const runTargetAccess = options.runTargetAccess ?? runTargetAccessCheck;
  const runtimeMetadata = options.runtimeMetadata;
  const artifactStats = options.artifactStats;
  const messages = [];
  let ok = true;

  if (commanderPath === undefined || !exists(commanderPath)) {
    return {
      ok: false,
      messages: [
        'J-Link Commander executable was not found.',
        'Install the full SEGGER J-Link package or set LINKTERM_JLINK_COMMANDER to an absolute JLink executable path.',
      ],
    };
  }
  messages.push(`J-Link Commander: ${commanderPath}`);

  const staleProcesses = processNames.filter((name) => /^JLink(?:GUIServer)?$/iu.test(name));
  if (staleProcesses.length > 0) {
    ok = false;
    messages.push(`Found stale J-Link process(es): ${staleProcesses.join(', ')}`);
    if (platform === 'win32') {
      messages.push("Close J-Link tools or run: Get-Process JLink,JLinkGUIServer -ErrorAction SilentlyContinue | Stop-Process -Force");
    } else {
      messages.push('Close J-Link tools or run: pkill -f "JLink|JLinkGUIServer"');
    }
  }

  const staleRuntimeArtifacts = staleRuntimeArtifactMessages(runtimeMetadata, artifactStats);
  if (staleRuntimeArtifacts.length > 0) {
    ok = false;
    messages.push('LinkTerm MCP runtime is older than compiled J-Link artifacts.');
    messages.push(...staleRuntimeArtifacts);
    messages.push('Restart LinkTerm before flash/verify/debug operations so MCP tools run the current J-Link code.');
  }

  const result = runCommander(commanderPath);
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  if (result.exitCode !== 0) {
    ok = false;
    messages.push('J-Link Commander ShowEmuList failed.');
    messages.push('Check the SEGGER installation, USB driver access, and whether another process owns the probe.');
    return { ok, messages };
  }

  const probes = parseShowEmuList(output);
  messages.push(`${probes.length} J-Link probe(s) visible.`);
  if (probes.length === 0) {
    ok = false;
    messages.push('No probes were reported by ShowEmuList; check USB cable, Windows driver, and probe power.');
  }
  for (const probe of probes) {
    messages.push(`- [${probe.index}] ${probe.productName} via ${probe.connection}`);
  }
  if (targetAccess !== undefined) {
    if (targetAccess.targetNormalization !== undefined) {
      messages.push(
        `Normalized J-Link target ${targetAccess.targetNormalization.originalTarget} -> ${targetAccess.targetNormalization.normalizedTarget}.`,
      );
    }
    messages.push(...firmwareSanityMessages(targetAccess.firmware));
    if (!commanderSupportsTarget(commanderPath, targetAccess.target, { existsSync: exists, readFileSync: readFile })) {
      messages.push(
        `SEGGER J-Link target ${targetAccess.target} is not listed in the local XML device database fragments for this J-Link installation.`,
      );
      const suggestedTarget = suggestStm32SeggerTargetName(targetAccess.target);
      if (suggestedTarget !== undefined) {
        ok = false;
        messages.push(
          `The target looks like a full STM32 order code; SEGGER device names usually omit the package suffix. Try ${suggestedTarget}.`,
        );
        messages.push(
          'Skipping Commander target access because this target would open the J-Link Device Selection dialog and block automation.',
        );
        messages.push(
          'Update SEGGER J-Link/device packs, or change .linkterm/control-profile.json jlink.target to an exact supported SEGGER device name before target access or flashing.',
        );
        return { ok, messages };
      }
      messages.push(
        'Continuing with a read-only Commander target-access probe because SEGGER may still provide the target through built-in device definitions.',
      );
    }
    const targetResult = runTargetAccess(commanderPath, targetAccess);
    const targetRawOutput = `${targetResult.stdout ?? ''}\n${targetResult.stderr ?? ''}`;
    const targetOutput = sanitizeOutputPreview(targetRawOutput);
    if (targetResult.timedOut === true) {
      ok = false;
      messages.push(`Target access check timed out after ${targetAccess.timeoutMs}ms.`);
      messages.push('Probe USB detection succeeded, but target MCU access did not complete.');
      messages.push(targetAccessRemediationMessage());
      messages.push(...targetAccessRetryMessages(targetAccess));
      if (targetOutput !== '') messages.push(`Target access output preview: ${targetOutput}`);
    } else if (targetResult.exitCode !== 0 || targetAccessOutputFailed(targetOutput)) {
      ok = false;
      if (jlinkUnknownDeviceOutputFailed(targetOutput)) {
        messages.push(`J-Link Commander reported unknown target ${targetAccess.target}.`);
        messages.push(
          'This matches the J-Link Device Selection dialog; Commander may block waiting for a manual device choice and flash loaders will not be trustworthy.',
        );
        messages.push(
          'Update SEGGER J-Link/device packs, or change .linkterm/control-profile.json jlink.target to an exact supported SEGGER device name before target access or flashing.',
        );
      } else if (jlinkUsbTransportOutputFailed(targetOutput)) {
        messages.push('J-Link probe USB transport failed after enumeration.');
        messages.push(jlinkUsbTransportRemediationMessage());
      } else {
        messages.push('Target access check failed.');
        messages.push(targetAccessRemediationMessage());
      }
      if (targetOutput !== '') messages.push(`Target access output preview: ${targetOutput}`);
    } else {
      const flashHeaderMessages = targetFlashHeaderMessages(targetAccess, targetRawOutput);
      if (flashHeaderMessages.some((message) => message.startsWith('Target flash header mismatch'))) {
        ok = false;
      }
      messages.push(`Target access check completed for ${targetAccess.target} at ${formatAddress(targetAccess.address)}.`);
      messages.push(...flashHeaderMessages);
      if (targetOutput !== '') messages.push(`Target access output preview: ${targetOutput}`);
    }
  } else {
    messages.push('This doctor did not connect to the target MCU; pass --target or --project-root <workspace> to check target access.');
  }
  return { ok, messages };
}

function readLinkTermRuntimeMetadata(userDataDir) {
  const candidates = [];
  if (userDataDir !== undefined) {
    candidates.push(path.join(userDataDir, 'mcp-runtime.json'));
  }
  if (process.platform === 'win32' && process.env.APPDATA !== undefined) {
    candidates.push(path.join(process.env.APPDATA, 'linkterm-v2', 'mcp-runtime.json'));
  }
  for (const filePath of candidates) {
    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf-8'));
      if (typeof parsed?.startedAt === 'string') return parsed;
    } catch {
      // Missing runtime metadata is fine for a standalone J-Link environment check.
    }
  }
  return undefined;
}

function defaultRuntimeArtifactStats(repoRoot) {
  return [
    path.join(repoRoot, 'dist', 'main', 'jlink', 'segger-command-runner.js'),
    path.join(repoRoot, 'dist', 'main', 'jlink', 'jlink-adapter.js'),
    path.join(repoRoot, 'dist', 'main', 'mcp', 'surfaces', 'debug', 'tools-binary.js'),
  ].flatMap((filePath) => {
    try {
      return [{ path: filePath, mtimeMs: statSync(filePath).mtimeMs }];
    } catch {
      return [];
    }
  });
}

function staleRuntimeArtifactMessages(runtimeMetadata, artifactStats) {
  if (runtimeMetadata === undefined || !Array.isArray(artifactStats)) return [];
  const startedAtMs = Date.parse(runtimeMetadata.startedAt);
  if (Number.isNaN(startedAtMs)) return [];
  return artifactStats
    .filter((artifact) => typeof artifact?.mtimeMs === 'number' && artifact.mtimeMs > startedAtMs)
    .map((artifact) => {
      const label = path.basename(String(artifact.path));
      return `- ${label} was modified at ${new Date(artifact.mtimeMs).toISOString()} after runtime pid ${runtimeMetadata.pid ?? '<unknown>'} started at ${runtimeMetadata.startedAt}.`;
    });
}

export function main() {
  const result = checkJLinkEnvironment({
    processNames: listJLinkProcessNames(),
    targetAccess: targetAccessFromCli(process.argv.slice(2), process.cwd()),
    runtimeMetadata: readLinkTermRuntimeMetadata(),
    artifactStats: defaultRuntimeArtifactStats(process.cwd()),
  });
  for (const message of result.messages) console.log(message);
  return result.ok ? 0 : 1;
}

function resolveCommanderPath(platform, env) {
  const configured = env.LINKTERM_JLINK_COMMANDER?.trim();
  if (configured) return configured;
  if (platform !== 'win32') return '/opt/SEGGER/JLink/JLinkExe';
  const candidates = [
    'D:\\Program Files\\SEGGER\\JLink\\JLink.exe',
    'C:\\Program Files\\SEGGER\\JLink\\JLink.exe',
    'C:\\Program Files (x86)\\SEGGER\\JLink\\JLink.exe',
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[1];
}

function runShowEmuList(commanderPath) {
  const dir = mkdtempSync(path.join(tmpdir(), 'linkterm-jlink-doctor-'));
  const scriptPath = path.join(dir, 'showemulist.jlink');
  try {
    writeFileSync(scriptPath, 'ShowEmuList\nq\n', 'utf-8');
    const stdout = execFileSync(commanderPath, ['-NoGui', '1', '-CommandFile', scriptPath], {
      encoding: 'utf-8',
      windowsHide: true,
      timeout: 15_000,
    });
    return { exitCode: 0, stdout, stderr: '' };
  } catch (err) {
    return {
      exitCode: typeof err.status === 'number' ? err.status : 1,
      stdout: typeof err.stdout === 'string' ? err.stdout : '',
      stderr: typeof err.stderr === 'string' ? err.stderr : err.message,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runTargetAccessCheck(commanderPath, targetAccess) {
  const dir = mkdtempSync(path.join(tmpdir(), 'linkterm-jlink-target-doctor-'));
  const scriptPath = path.join(dir, 'target-access.jlink');
  try {
    writeFileSync(scriptPath, renderTargetAccessScript(targetAccess), 'utf-8');
    const stdout = execFileSync(
      commanderPath,
      ['-ExitOnError', '1', '-NoGui', '1', '-CommandFile', scriptPath],
      {
        encoding: 'utf-8',
        windowsHide: true,
        timeout: targetAccess.timeoutMs,
      },
    );
    return { exitCode: 0, stdout, stderr: '', timedOut: false };
  } catch (err) {
    return {
      exitCode: typeof err.status === 'number' ? err.status : 1,
      stdout: typeof err.stdout === 'string' ? err.stdout : '',
      stderr: typeof err.stderr === 'string' ? err.stderr : err.message,
      timedOut: err.signal === 'SIGTERM' || /timed out|timeout/i.test(String(err.message)),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function renderTargetAccessScript(targetAccess) {
  const target = normalizeJLinkTargetName(targetAccess.target);
  return [
    `device ${safeCommanderToken(target, 'target')}`,
    `si ${String(targetAccess.interface ?? 'swd').toUpperCase()}`,
    `speed ${targetAccess.speedKHz ?? 'auto'}`,
    'eoe 1',
    'connect',
    `mem ${formatAddress(targetAccess.address)}, ${targetAccess.length}`,
    'mem 0xe000edf0, 4',
    'q',
    '',
  ].join('\n');
}

function targetAccessOutputFailed(output) {
  return /failed\s+to\s+connect|cannot\s+connect|could\s+not\s+connect|no\s+j-link|no\s+emulators\s+found|ramcode\s+did\s+not\s+respond|script\s+processing\s+failed/i.test(output);
}

function jlinkUsbTransportOutputFailed(output) {
  return /out\s+of\s+sync|cannot\s+connect\s+to\s+j-link|failed:\s*cannot\s+connect\s+to\s+j-link/i.test(output);
}

function jlinkUnknownDeviceOutputFailed(output) {
  return /(?:selected\s+device|unknown\s+device|device\s+selection|please\s+select\s+(?:a\s+)?device|could\s+not\s+find\s+device).*?(?:unknown|not\s+found|not\s+supported)|(?:unknown|not\s+found|not\s+supported).*?(?:selected\s+device|device\s+selection|device\s+\S+)/iu.test(output);
}

function jlinkUsbTransportRemediationMessage() {
  return 'ShowEmuList saw the probe, but Commander lost the J-Link USB transport. Close owning tools, power-cycle or replug the J-Link probe, try a different USB cable/port, and check SEGGER firmware/driver before blaming target SWD.';
}

function targetAccessRemediationMessage() {
  return 'Check target power/VTref, BOOT straps, NRST/reset wiring, SWDIO/SWCLK wiring, exact SEGGER device name, debug speed, readout/write protection/RDP, and whether another tool owns the probe.';
}

function targetAccessRetryMessages(targetAccess) {
  if (String(targetAccess.speedKHz).toLowerCase() !== 'auto') return [];
  return [
    'Retry with a fixed J-Link speed if the board is powered but auto negotiation stalls:',
    `pnpm run -s doctor:jlink -- --target ${targetAccess.target} --interface ${targetAccess.interface} --address ${formatAddress(targetAccess.address)} --speed 4000 --timeout-ms ${targetAccess.timeoutMs}`,
    `pnpm run -s doctor:jlink -- --target ${targetAccess.target} --interface ${targetAccess.interface} --address ${formatAddress(targetAccess.address)} --speed 1000 --timeout-ms ${targetAccess.timeoutMs}`,
  ];
}

function commanderSupportsTarget(commanderPath, target, fs = {}) {
  const exists = fs.existsSync ?? existsSync;
  const readFile = fs.readFileSync ?? readFileSync;
  const databaseFiles = listJLinkDeviceDatabaseFiles(path.dirname(commanderPath), exists);
  const escaped = String(target).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`Name\\s*=\\s*"${escaped}"`, 'iu'),
    new RegExp(`Name\\s*=\\s*"-${escaped}"`, 'iu'),
  ];
  for (const file of databaseFiles) {
    try {
      const content = readFile(file, 'utf-8');
      if (patterns.some((pattern) => pattern.test(content))) return true;
    } catch {
      // Ignore optional SEGGER database fragments that disappear or cannot be read.
    }
  }
  return false;
}

function suggestStm32SeggerTargetName(target) {
  const text = String(target).trim().toUpperCase();
  const match = text.match(/^(STM32[A-Z0-9]+[A-Z]{2})([A-Z][0-9])(?:TR)?$/u);
  if (!match) return undefined;
  return match[1] === text ? undefined : match[1];
}

function normalizeJLinkTargetName(target) {
  const text = String(target).trim();
  return suggestStm32SeggerTargetName(text) ?? text;
}

function normalizeTargetAccess(targetAccess) {
  const originalTarget = String(targetAccess.target).trim();
  const normalizedTarget = normalizeJLinkTargetName(originalTarget);
  if (normalizedTarget === originalTarget) {
    return {
      ...targetAccess,
      target: normalizedTarget,
    };
  }
  return {
    ...targetAccess,
    target: normalizedTarget,
    targetNormalization: {
      originalTarget,
      normalizedTarget,
    },
  };
}

function listJLinkDeviceDatabaseFiles(root, exists) {
  const files = [];
  const rootDatabase = path.join(root, 'JLinkDevices.xml');
  if (exists(rootDatabase)) files.push(rootDatabase);
  return files;
}

export function targetAccessFromCli(argv, cwd) {
  const args = parseArgs(argv);
  const workspace = args['project-root'] ?? args.workspace ?? args.root;
  const profile = workspace !== undefined
    ? readTargetAccessFromWorkspace(workspace)
    : readTargetAccessFromWorkspace(cwd);
  const target = args.target ?? profile?.target;
  if (target === undefined) return undefined;
  const address = args.address !== undefined ? parseInteger(args.address, '--address') : profile?.address ?? 0x08000000;
  const length = args.length !== undefined ? parseInteger(args.length, '--length') : 64;
  const timeoutMs = args['timeout-ms'] !== undefined ? parseInteger(args['timeout-ms'], '--timeout-ms') : 15_000;
  const speedKHz = args.speed ?? profile?.speedKHz ?? 'auto';
  const interfaceName = args.interface ?? profile?.interface ?? 'swd';
  return normalizeTargetAccess({
    target,
    interface: interfaceName,
    speedKHz,
    address,
    length,
    timeoutMs,
    ...(profile?.firmware !== undefined ? { firmware: profile.firmware } : {}),
  });
}

function readTargetAccessFromWorkspace(workspace) {
  const profilePath = path.join(normalizeProjectRootPath(workspace), '.linkterm', 'control-profile.json');
  if (!existsSync(profilePath)) return undefined;
  try {
    const profile = JSON.parse(readFileSync(profilePath, 'utf-8'));
    const target = typeof profile?.jlink?.target === 'string' && profile.jlink.target.trim() !== ''
      ? profile.jlink.target.trim()
      : undefined;
    if (target === undefined) return undefined;
    const baseAddress = typeof profile?.flash?.baseAddress === 'string'
      ? parseInteger(profile.flash.baseAddress, 'profile.flash.baseAddress')
      : 0x08000000;
    return {
      target,
      interface: typeof profile?.jlink?.interface === 'string' ? profile.jlink.interface : 'swd',
      speedKHz: profile?.jlink?.speedKHz === undefined ? 'auto' : String(profile.jlink.speedKHz),
      address: baseAddress,
      firmware: readFirmwareSanity(normalizeProjectRootPath(workspace), profile?.flash?.binary, baseAddress),
    };
  } catch {
    return undefined;
  }
}

function readFirmwareSanity(workspace, binaryPath, baseAddress) {
  if (typeof binaryPath !== 'string' || binaryPath.trim() === '') return undefined;
  const resolved = path.isAbsolute(binaryPath)
    ? normalizeProjectRootPath(binaryPath)
    : path.join(workspace, binaryPath);
  if (!existsSync(resolved)) {
    return { status: 'fail', message: `Firmware profile sanity: fail; binary is missing (${path.basename(binaryPath)})` };
  }
  try {
    const binary = readFileSync(resolved);
    return {
      ...checkFirmwareVectorTable(binary, baseAddress, path.basename(binaryPath)),
      label: path.basename(binaryPath),
      headerBytes: Array.from(binary.subarray(0, Math.min(binary.byteLength, 64))),
    };
  } catch (err) {
    return {
      status: 'fail',
      message: `Firmware profile sanity: fail; cannot read ${path.basename(binaryPath)} (${err instanceof Error ? err.message : String(err)})`,
    };
  }
}

function checkFirmwareVectorTable(binary, baseAddress, label) {
  if (binary.byteLength < 8) {
    return {
      status: 'skipped',
      message: `Firmware profile sanity: skipped; ${label} is too small to contain a Cortex-M vector table (size=${binary.byteLength})`,
    };
  }
  const initialSp = binary.readUInt32LE(0);
  const resetVector = binary.readUInt32LE(4);
  const resetAddress = resetVector & ~1;
  const imageEndExclusive = baseAddress + binary.byteLength;
  const prefix = `Firmware profile sanity:`;
  const facts = `${label} size=${binary.byteLength}, base=${formatAddress(baseAddress)}, SP=${formatAddress(initialSp)}, Reset=${formatAddress(resetVector)}`;
  if ((resetVector & 1) !== 1) {
    return { status: 'skipped', message: `${prefix} skipped; ${facts}; reset vector is not a Thumb address` };
  }
  if (resetAddress < baseAddress || resetAddress >= imageEndExclusive) {
    return {
      status: 'fail',
      message: `${prefix} fail; ${facts}; reset address ${formatAddress(resetAddress)} is outside image range ${formatAddress(baseAddress)}-${formatAddress(imageEndExclusive - 1)}`,
    };
  }
  return { status: 'pass', message: `${prefix} pass; ${facts}` };
}

function firmwareSanityMessages(firmware) {
  return firmware?.message === undefined ? [] : [firmware.message];
}

function targetFlashHeaderMessages(targetAccess, output) {
  const expected = targetAccess.firmware?.headerBytes;
  if (!Array.isArray(expected) || expected.length === 0) return [];
  const observed = parseCommanderMemoryBytes(output);
  const compareLength = Math.min(expected.length, targetAccess.length ?? expected.length);
  const readBytes = [];
  for (let offset = 0; offset < compareLength; offset += 1) {
    const actual = observed.get(targetAccess.address + offset);
    if (actual === undefined) continue;
    readBytes.push(actual);
    const wanted = expected[offset];
    if (actual !== wanted) {
      const messages = [
        `Target flash header mismatch at ${formatAddress(targetAccess.address + offset)}: expected ${formatByte(wanted)}, read ${formatByte(actual)}.`,
      ];
      if (readBytes.length > 0 && readBytes.every((byte) => byte === 0xff)) {
        messages.push(
          `Target flash at ${formatAddress(targetAccess.address)} reads as erased; run a verified flash workflow before trusting boot, verify, or crash output.`,
        );
      } else {
        messages.push(
          'Target flash differs from the profile firmware header; check flash base address, exact SEGGER device name/flash loader, stale LinkTerm runtime, and re-run a verified flash workflow.',
        );
      }
      return messages;
    }
  }
  return readBytes.length === 0
    ? []
    : [`Target flash header matches profile firmware prefix (${readBytes.length} byte(s) compared).`];
}

function parseCommanderMemoryBytes(output) {
  const bytes = new Map();
  for (const line of output.split(/\r?\n/u)) {
    const match = line.match(/^([0-9a-f]{8})\s*=\s*((?:[0-9a-f]{2}(?:\s+|$))+)/iu);
    if (!match) continue;
    const address = Number.parseInt(match[1], 16);
    const values = match[2].match(/[0-9a-f]{2}/giu) ?? [];
    for (let index = 0; index < values.length; index += 1) {
      bytes.set(address + index, Number.parseInt(values[index], 16));
    }
  }
  return bytes;
}

export function normalizeProjectRootPath(projectRoot) {
  const text = String(projectRoot);
  if (/^\\\\\\\\[^\\]+\\\\/u.test(text)) {
    return text.replace(/\\\\/gu, '\\');
  }
  return text;
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      args[key] = 'true';
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

function parseInteger(value, label) {
  const text = String(value).trim();
  const parsed = /^0x[0-9a-f]+$/iu.test(text) ? Number.parseInt(text, 16) : Number.parseInt(text, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return parsed;
}

function safeCommanderToken(value, field) {
  const text = String(value).trim();
  if (text === '' || /\s|["'`,;#\r\n]/u.test(text)) {
    throw new Error(`Unsafe J-Link Commander ${field}`);
  }
  return text;
}

function formatAddress(address) {
  return `0x${address.toString(16).padStart(8, '0')}`;
}

function formatByte(byte) {
  return `0x${byte.toString(16).padStart(2, '0')}`;
}

function sanitizeOutputPreview(output) {
  return output
    .replace(/S\/N:\s*\S+/gi, 'S/N: [redacted]')
    .replace(/Serial\s+number:\s*\S+/gi, 'Serial number: [redacted]')
    .trim()
    .slice(-2000);
}

function listJLinkProcessNames() {
  if (process.platform !== 'win32') return [];
  try {
    const output = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-Command', "Get-Process JLink,JLinkGUIServer -ErrorAction SilentlyContinue | ForEach-Object { $_.ProcessName }"],
      { encoding: 'utf-8', windowsHide: true, timeout: 5_000 },
    );
    return output.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main();
}
