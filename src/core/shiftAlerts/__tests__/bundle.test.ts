import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// The deployed edge functions are the app's own engine bundled: they must always match the source they are built from.
for (const name of ['shift-alerts', 'sd-plan-approve', 'request-gate']) {
  describe(`${name} edge function`, () => {
    it('index.ts is up to date (run npm run functions:build after changing src/core, src/data or main.ts)', async () => {
      const script = pathToFileURL(resolve(process.cwd(), 'scripts/build-shift-alerts.mjs')).href;
      const { bundle } = (await import(/* @vite-ignore */ script)) as { bundle: (name: string) => Promise<string> };
      const committed = readFileSync(resolve(process.cwd(), `supabase/functions/${name}/index.ts`), 'utf8');
      expect(committed === (await bundle(name))).toBe(true);
    });
    it('the server bundle carries no browser-only code', () => {
      const text = readFileSync(resolve(process.cwd(), `supabase/functions/${name}/index.ts`), 'utf8');
      expect(text).not.toMatch(/import\.meta\.env|localStorage|document\./);
    });
  });
}
