import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const checksumFileName = 'SHA256SUMS.txt';

function resolveRepositoryPath(relativePath) {
  const resolvedPath = path.resolve(repositoryRoot, relativePath);
  const relativeToRepository = path.relative(repositoryRoot, resolvedPath);
  if (relativeToRepository.startsWith('..') || path.isAbsolute(relativeToRepository)) {
    throw new Error(`Path must stay inside the repository: ${relativePath}`);
  }
  return resolvedPath;
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory() && !entry.name.endsWith('-unpacked')) files.push(...(await listFiles(absolutePath)));
    else if (entry.isFile() && entry.name !== checksumFileName) files.push(absolutePath);
  }
  return files;
}

function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function main() {
  const directoryArgument = process.argv[2] ?? 'release';
  const targetDirectory = resolveRepositoryPath(directoryArgument);
  const files = (await listFiles(targetDirectory)).sort((left, right) => left.localeCompare(right));
  if (files.length === 0) throw new Error(`No release files found in ${targetDirectory}`);

  const lines = [];
  for (const filePath of files) {
    const relativePath = path.relative(targetDirectory, filePath).split(path.sep).join('/');
    lines.push(`${await sha256(filePath)}  ${relativePath}`);
  }

  const outputPath = path.join(targetDirectory, checksumFileName);
  await writeFile(outputPath, `${lines.join('\n')}\n`, 'utf8');
  console.log(`Wrote ${lines.length} SHA-256 checksums to ${outputPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
