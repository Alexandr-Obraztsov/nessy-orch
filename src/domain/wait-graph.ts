import { AppError } from './errors'

/** Граф синхронных ожиданий (кто кого ждёт с --wait) для обнаружения взаимного ожидания. */
export class WaitGraph {
	private readonly edges = new Map<string, Set<string>>()

	add(from: string, to: string): void {
		const set = this.edges.get(from) ?? new Set<string>()
		set.add(to)
		this.edges.set(from, set)
	}

	remove(from: string, to: string): void {
		this.edges.get(from)?.delete(to)
	}

	forget(node: string): void {
		this.edges.delete(node)
	}

	/** Вернёт true, если `to` (транзитивно) уже ждёт `from`. */
	wouldDeadlock(from: string, to: string): boolean {
		const seen = new Set<string>()
		const stack = [to]
		while (stack.length) {
			const cur = stack.pop() as string
			if (cur === from) return true
			if (seen.has(cur)) continue
			seen.add(cur)
			for (const nxt of this.edges.get(cur) ?? []) stack.push(nxt)
		}
		return false
	}

	/** A ждёт B; если B (транзитивно) уже ждёт A — оба зависнут навсегда. */
	assertNoDeadlock(from: string, to: string): void {
		if (this.wouldDeadlock(from, to))
			throw new AppError(409, 'deadlock', `взаимное ожидание ${from} ↔ ${to}: используйте send без --wait`)
	}
}
