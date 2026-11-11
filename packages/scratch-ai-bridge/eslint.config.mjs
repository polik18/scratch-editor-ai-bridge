import { eslintConfigScratch } from 'eslint-config-scratch'
import { globalIgnores } from 'eslint/config'
import globals from 'globals'

export default eslintConfigScratch.defineConfig(
  eslintConfigScratch.recommended,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['*.ts', '*.mjs', 'bin/*.mjs', 'scripts/**/*.mjs', 'examples/**/*.mjs'],
    languageOptions: {
      globals: globals.node,
    },
  },
  globalIgnores([
    '*.md',
    'audit-dist/**',
    'coverage/**',
    'dist/**',
    'docs/**',
    'node_modules/**',
    'output/**',
    'research/**',
    'src/core/validator/generated/*.mjs',
  ]),
)
