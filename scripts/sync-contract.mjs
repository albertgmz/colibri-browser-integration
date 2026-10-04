import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
const app = process.env.COLIBRI_APP_ROOT ?? path.resolve('..', 'Colibri');
await mkdir('src/generated', { recursive: true });
await copyFile(path.join(app, 'docs/capture-policy.json'), 'docs/capture-policy.json');
await copyFile(path.join(app, 'docs/capture-catalog.ts'), 'src/generated/capture-catalog.ts');
await copyFile(path.join(app, 'docs/capture-rules.ts'), 'src/generated/capture-rules.ts');
await copyFile(path.join(app, 'src/Colibri.Core/Settings/AppSettings.cs'), 'tests/fixtures/AppSettings.cs');
for (const [source, target] of [['docs/protocol.schema.json', 'docs/protocol.schema.json'], ['docs/design-tokens.json', 'docs/design-tokens.json'], ['docs/design-tokens.css', 'assets/tokens.css']]) await copyFile(path.join(app, source), target);
