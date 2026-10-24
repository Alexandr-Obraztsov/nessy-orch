/**
 * Дерево оркестраторов (дизайн AgentPort §8): агенты + их субагенты с рантаймом, моделью,
 * статусом и заполнением контекста. Чистые функции — тестируются без HTTP.
 */
import type { AgentView } from '../../../shared/types'
import { agentCell, bold, contextCell, dim, runtimeModelCell } from './format'

export interface TreeNode {
	agent: AgentView
	children: TreeNode[]
}

/** Построить лес из агентов: top-level — агенты с родителем среди `roots` (или чей родитель — не агент этого списка). */
export function buildForest(agents: readonly AgentView[], roots: readonly string[] = ['you'], archivedIds?: ReadonlySet<string>): TreeNode[] {
	const nodes = new Map<string, TreeNode>()
	for (const a of agents) nodes.set(a.id, { agent: a, children: [] })
	const rootSet = new Set(roots)
	const top: TreeNode[] = []
	for (const a of agents) {
		const node = nodes.get(a.id)
		if (!node) continue
		// субагент висит под своим родителем, если тот в списке и не top-level; иначе — корень леса
		if (a.parent && !rootSet.has(a.parent) && nodes.has(a.parent)) {
			nodes.get(a.parent)?.children.push(node)
		} else if (a.parent && !rootSet.has(a.parent) && archivedIds?.has(a.parent)) {
			// родитель в архиве и не показан (ls без --all) — не показываем агента корнем-сиротой, а скрываем всю ветку
			continue
		} else {
			top.push(node)
		}
	}
	return top
}

const G = '├─ '
const L = '└─ '
const V = '│  '
const S = '   '

function line(agent: AgentView): string {
	return `${agentCell(agent)} ${runtimeModelCell(agent)} ${contextCell(agent)}`
}

/** Отрисовать лес строками с деревом-символами; `rootLabel` — заголовок для корневого узла. */
export function renderTree(forest: readonly TreeNode[], rootLabel: string): string {
	if (!forest.length) return dim('активных агентов нет. Создайте: nessy-orch spawn --session <id> "поручение"')
	const out: string[] = [bold(rootLabel)]
	const walk = (nodes: readonly TreeNode[], prefix: string): void => {
		nodes.forEach((n, i) => {
			const last = i === nodes.length - 1
			const branch = last ? L : G
			out.push(prefix + branch + line(n.agent))
			if (n.children.length) walk(n.children, prefix + (last ? S : V))
		})
	}
	walk(forest, '')
	return out.join('\n')
}
