// ESLint 10 flat config, recreating the intent of the previous .eslintrc
// (eslint 7 + @typescript-eslint 4 "recommended" + prettier).
// Note: the old config did not extend eslint:recommended, so core js rules
// are not enabled here either (beyond those set explicitly below).
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
    {
        // __tests__ / __mocks__ are being rewritten concurrently; exclude them from lint for now.
        ignores: [
            'src/**/__tests__/**',
            'src/**/__mocks__/**',
            'dist/**',
            'build/**',
            'node_modules/**',
            'www/**',
            'docs/**',
            'examples/**'
        ]
    },
    ...tseslint.configs.recommended,
    {
        languageOptions: {
            parserOptions: {
                project: './tsconfig.json',
                tsconfigRootDir: import.meta.dirname
            }
        },
        linterOptions: {
            // Some files carry eslint-disable directives for rules that are now off
            // (e.g. no-explicit-any); don't warn about them since src is frozen in phase 1.
            reportUnusedDisableDirectives: 'off'
        },
        rules: {
            'no-console': ['error', {allow: ['warn', 'error']}],
            '@typescript-eslint/explicit-member-accessibility': ['error', {accessibility: 'no-public'}],
            '@typescript-eslint/explicit-function-return-type': 'off',
            '@typescript-eslint/no-use-before-define': 'off',
            '@typescript-eslint/no-unused-vars': 'off',

            // The old @typescript-eslint 4 "recommended" preset only warned on `any`;
            // keep it off so the 2022-era codebase lints clean.
            '@typescript-eslint/no-explicit-any': 'off',

            // The codebase uses empty marker interfaces; allow them as the old preset did.
            '@typescript-eslint/no-empty-object-type': ['error', {allowInterfaces: 'always'}],

            // New-in-v8 strictness that the 2022-era code predates.
            // TODO: re-enable these once src is modernized in later phases.
            '@typescript-eslint/no-this-alias': 'off',
            '@typescript-eslint/no-unsafe-function-type': 'off',
            '@typescript-eslint/no-unused-expressions': 'off',
            // TODO: list-style-type.ts has intentionally aliased enum values (CJK variants);
            // re-evaluate when that enum is reworked.
            '@typescript-eslint/no-duplicate-enum-values': 'off'
        }
    },
    // Note: eslint-plugin-prettier is not installed (only eslint-config-prettier),
    // so formatting is enforced via `prettier --check`/`npm run format`, not a lint rule.
    prettier
);
