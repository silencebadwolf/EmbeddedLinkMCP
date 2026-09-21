import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const uiRoot = new URL('../packages/ui/', import.meta.url);
const styles = new URL('dist/styles/', uiRoot);
mkdirSync(styles, { recursive: true });
copyFileSync(new URL('src/styles/global.css', uiRoot), new URL('global.css', styles));
writeFileSync(new URL('dist/styles.d.ts', uiRoot), 'export {};\n');
process.stdout.write(`UI styles copied to ${fileURLToPath(styles)}\n`);
