import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

// Hard constraint from the assignment: no cron of any kind. The build runs this, so it fails if cron sneaks in.
const NO_CRON = 'No cron: schedule with BullMQ delayed jobs.';

export default defineConfig(tseslint.configs.recommended, {
  files: ['src/**/*.ts', 'tests/**/*.ts'],
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'no-restricted-imports': ['error', {
      patterns: [{ group: ['*cron*', 'node-schedule', 'agenda', 'bree'], message: NO_CRON }],
    }],
    'no-restricted-syntax': ['error',
      { selector: "CallExpression[callee.name='setInterval'], CallExpression[callee.property.name='setInterval']", message: NO_CRON },
      { selector: "CallExpression[callee.property.name='upsertJobScheduler']", message: 'BullMQ job schedulers are cron-like.' },
      { selector: "Property[key.name='repeat']", message: 'BullMQ repeatable jobs are cron-like.' },
    ],
  },
});
