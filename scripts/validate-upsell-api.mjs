import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
const files = ['app/services/upsells.server.ts', 'app/services/post-upsells.server.ts', 'app/routes/app.upsells.tsx'];
let failed = false;
for (const file of files) {
  for (const [index, match] of [...readFileSync(file, 'utf8').matchAll(/`#graphql([\s\S]*?)`/g)].entries()) {
    const result = spawnSync(process.execPath, [join(homedir(), '.agents/skills/shopify-admin/scripts/validate.mjs'), '--code', match[1], '--version', '2026-07', '--artifact-id', `${file}-${index}`, '--revision', '1', '--model', 'gpt-6', '--client-name', 'codex', '--client-version', 'desktop', '--user-prompt-base64', 'U8OtLCBwcmUtY29tcHJhIHkgcG9zdC1jb21wcmE='], { encoding: 'utf8', env: { ...process.env, OPT_OUT_INSTRUMENTATION: 'true' } });
    console.log(file, index, result.stdout, result.stderr);
    if (result.status !== 0) failed = true;
  }
}
process.exitCode = failed ? 1 : 0;
