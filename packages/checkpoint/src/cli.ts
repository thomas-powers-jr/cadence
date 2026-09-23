import { readFileSync } from 'node:fs';
import { validate } from './validate.js';

function main(argv: string[]): void {
  const [command, filePath] = argv;

  if (command !== 'validate' || !filePath) {
    process.stderr.write('Usage: checkpoint validate <path>\n');
    process.exit(2);
  }

  let content: Buffer;
  try {
    content = readFileSync(filePath);
  } catch (err) {
    process.stderr.write(`Cannot read ${filePath}: ${(err as Error).message}\n`);
    process.exit(2);
  }

  const result = validate(content);

  if (result.ok) {
    process.exit(0);
  }

  for (const diag of result.diagnostics) {
    const loc = diag.line ? `:${diag.line}` : '';
    const section = diag.section ? ` [${diag.section}]` : '';
    process.stderr.write(`${diag.code}${section}${loc}: ${diag.message}\n`);
  }
  process.exit(2);
}

main(process.argv.slice(2));
