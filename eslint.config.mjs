// @ts-check
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import boundaries from 'eslint-plugin-boundaries'

/** allow-политика: «из слоя from можно импортировать слои types». */
const allow = types => types.map(type => ({ to: { element: { type } } }))
const policy = (fromType, allowTypes) => ({ from: { element: { type: fromType } }, allow: allow(allowTypes) })

export default tseslint.config(
	{
		ignores: ['dist/**', 'docs/**', 'app/**', 'release/**', 'node_modules/**', 'scripts/**', 'eslint.config.mjs'],
	},
	js.configs.recommended,
	...tseslint.configs.strictTypeChecked,
	{
		languageOptions: {
			parserOptions: {
				project: ['./tsconfig.json'],
				tsconfigRootDir: import.meta.dirname,
			},
		},
		plugins: {
			boundaries,
		},
		settings: {
			// зависимости направлены строго вниз (docs/standards/code-quality.md §2): domain ни от кого,
			// application ← domain+shared, infrastructure/interfaces ← application+domain+shared
			'boundaries/elements': [
				{ type: 'domain', pattern: 'src/domain/**' },
				{ type: 'application', pattern: 'src/application/**' },
				{ type: 'infrastructure', pattern: 'src/infrastructure/**' },
				{ type: 'interfaces', pattern: 'src/interfaces/**' },
				{ type: 'shared', pattern: 'shared/**' },
				{ type: 'lib', pattern: 'src/lib/**' },
				{ type: 'test', pattern: 'test/**' },
			],
		},
		rules: {
			'@typescript-eslint/no-explicit-any': 'error',
			'@typescript-eslint/no-unsafe-argument': 'error',
			'@typescript-eslint/no-unsafe-assignment': 'error',
			'@typescript-eslint/no-unsafe-call': 'error',
			'@typescript-eslint/no-unsafe-member-access': 'error',
			'@typescript-eslint/no-unsafe-return': 'error',
			'@typescript-eslint/no-unsafe-enum-comparison': 'error',
			'@typescript-eslint/ban-ts-comment': [
				'error',
				{
					'ts-ignore': true,
					'ts-nocheck': true,
					'ts-expect-error': 'allow-with-description',
				},
			],
			'@typescript-eslint/consistent-type-assertions': [
				'error',
				{ assertionStyle: 'as', objectLiteralTypeAssertions: 'never' },
			],
			'@typescript-eslint/consistent-type-imports': 'error',
			'@typescript-eslint/no-floating-promises': 'error',
			'@typescript-eslint/no-misused-promises': [
				'error',
				{ checksVoidReturn: { attributes: false } },
			],
			'@typescript-eslint/restrict-template-expressions': [
				'error',
				{ allowNumber: true, allowBoolean: true },
			],
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
			],
			'@typescript-eslint/no-non-null-assertion': 'error',
			'@typescript-eslint/unified-signatures': 'off',
			'@typescript-eslint/no-confusing-void-expression': 'off',
			'@typescript-eslint/no-dynamic-delete': 'off',
			// ---------- стандарт: лимиты, нейминги, экспорты, границы слоёв ----------
			'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
			'no-restricted-syntax': [
				'error',
				{ selector: 'ExportDefaultDeclaration', message: 'default-export запрещён: используй именованный экспорт' },
			],
			'@typescript-eslint/naming-convention': [
				'error',
				// типы, классы, интерфейсы, enum — PascalCase
				{ selector: 'typeLike', format: ['PascalCase'] },
				// переменные и функции — camelCase; константы-значения — UPPER_CASE (конфиг по умолчанию typescript-eslint)
				{ selector: ['variable', 'function'], format: ['camelCase', 'UPPER_CASE'], leadingUnderscore: 'allow' },
				// параметры — camelCase, ведущий _ для неиспользуемых
				{ selector: 'parameter', format: ['camelCase'], leadingUnderscore: 'allow' },
				// члены классов — camelCase, ведущий _ для приватных
				{ selector: 'classProperty', format: ['camelCase'], leadingUnderscore: 'allow' },
				{ selector: 'classMethod', format: ['camelCase'], leadingUnderscore: 'allow' },
				{ selector: 'accessor', format: ['camelCase'], leadingUnderscore: 'allow' },
			],
			'boundaries/dependencies': [
				'error',
				{
					default: 'disallow',
					policies: [
						policy('domain', ['domain', 'shared', 'lib']),
						policy('application', ['application', 'domain', 'shared', 'lib']),
						policy('infrastructure', ['infrastructure', 'application', 'domain', 'shared', 'lib']),
						policy('interfaces', ['interfaces', 'infrastructure', 'application', 'domain', 'shared', 'lib']),
						policy('shared', ['shared']),
						policy('lib', ['lib']),
						policy('test', ['*']),
					],
				},
			],
		},
	},
	{
		files: ['test/**/*.ts'],
		rules: {
			// describe/it из node:test возвращают промисы, которые раннер ждёт сам
			'@typescript-eslint/no-floating-promises': [
				'error',
				{ allowForKnownSafeCalls: [{ from: 'package', package: 'node:test', name: ['describe', 'it', 'test', 'before', 'after', 'beforeEach', 'afterEach'] }] },
			],
		},
	},
)