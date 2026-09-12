import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const sourceRoots = [join(root, 'src'), join(root, 'test')];
const identityVendorPatterns = [
  /auth0/i,
  /clerk/i,
  /firebase\/auth/i,
  /cognito/i,
];

async function collectTypescriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTypescriptFiles(path)));
    } else if (entry.isFile() && extname(entry.name) === '.ts') {
      files.push(path);
    }
  }
  return files;
}

const violations = [];
for (const sourceRoot of sourceRoots) {
  for (const file of await collectTypescriptFiles(sourceRoot)) {
    const text = await readFile(file, 'utf8');
    const path = relative(root, file);
    const lines = text.split('\n');

    lines.forEach((line, index) => {
      if (/\s+$/.test(line)) {
        violations.push(`${path}:${index + 1}: trailing whitespace`);
      }
      if (line.includes('\t')) {
        violations.push(`${path}:${index + 1}: tab character`);
      }
    });

    if (path.startsWith(`src${process.platform === 'win32' ? '\\' : '/'}identity`)) {
      for (const pattern of identityVendorPatterns) {
        if (pattern.test(text)) {
          violations.push(`${path}: identity vendor must remain outside domain logic`);
        }
      }
    }
  }
}

if (violations.length > 0) {
  console.error(violations.join('\n'));
  process.exitCode = 1;
}
