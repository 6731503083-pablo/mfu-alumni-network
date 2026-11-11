import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations');
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          // Fixed test values, so the tests never read the real secrets in .dev.vars.
          bindings: {
            TEST_MIGRATIONS: migrations,
            JWT_SECRET: 'test-jwt-secret',
            WEBHOOK_SECRET: 'test-team17-webhook-secret',
            PARTNER_WEBHOOK_SECRET: 'test-partner-secret',
            EVENTS_CLUBS_WEBHOOK_SECRET: 'test-events-clubs-secret',
          },
        },
      }),
    ],
    test: { setupFiles: ['./test/apply-migrations.ts'] },
  };
});
