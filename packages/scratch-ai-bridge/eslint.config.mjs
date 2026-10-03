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
    files: ['*.ts', '*.mjs', 'scripts/*.mjs'],
    languageOptions: {
      globals: globals.node,
    },
  },
  globalIgnores(['coverage/**', 'dist/**', 'docs/**', 'node_modules/**', 'src/core/validator/generated/*.mjs']),
)
