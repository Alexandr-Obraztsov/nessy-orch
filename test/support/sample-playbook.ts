import type { PlaybookView } from '../../shared/types'

/** Эталонный плейбук для тестов домена. */
export function samplePlaybook(): PlaybookView {
	return {
		id: 'p-1',
		name: 'aff-package',
		title: 'Implement aff package',
		description: 'Use when implementing an aff package: from ticket to MR',
		taskType: 'implement-package',
		status: 'active',
		version: 1,
		cases: ['c1', 'c2', 'c3'],
		heldOut: null,
		params: [{ name: 'package', description: 'package name', source: 'ticket title' }],
		sources: ['Jira ticket'],
		files: ['src/aff/index.ts'],
		behavior: ['Ask before pushing'],
		stages: [
			{
				n: 1,
				slug: 'research',
				title: 'Research',
				role: 'code-explorer',
				where: 'repo, ticket',
				produce: 'findings',
				done: 'findings listed',
				gate: false,
				template: 'Find {package}',
			},
			{
				n: 2,
				slug: 'implement',
				title: 'Implement',
				role: null,
				where: 'repo',
				produce: 'a diff',
				done: 'tests pass',
				gate: true,
				template: 'Code with ```x``` fence',
			},
		],
		rules: [
			{
				id: 'r1',
				text: 'Run lint',
				stage: 2,
				status: 'active',
				up: 3,
				down: 1,
				evidence: [
					{ caseId: 'c1', anchor: 'n 12–15' },
					{ caseId: 'c2', anchor: 'n 3' },
				],
				against: [],
				lastAppliedAt: null,
				createdAt: '2026-10-01T00:00:00Z',
			},
			{
				id: 'r2',
				text: 'Maybe',
				stage: null,
				status: 'candidate',
				up: 2,
				down: 0,
				evidence: [{ caseId: 'c1', anchor: 'n 1' }],
				against: [],
				lastAppliedAt: null,
				createdAt: '2026-10-01T00:00:00Z',
			},
		],
		trial: null,
		createdAt: '2026-10-01T00:00:00Z',
		updatedAt: '2026-10-01T00:00:00Z',
	}
}

/** Элемент списка, который по построению теста есть (без `!`). */
export function must<T>(v: T | undefined): T {
	if (v === undefined) throw new Error('ожидался элемент образца')
	return v
}
