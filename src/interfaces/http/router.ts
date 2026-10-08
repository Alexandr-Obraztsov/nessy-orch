/** Простой маршрутизатор: шаблоны вида `/agents/:ref/send`. */
import type { Route, RouteHandler } from './server.types'

export interface RouteMatch {
	handler: RouteHandler
	params: Record<string, string>
}

export class Router {
	private readonly routes: Route[] = []

	add(method: string, pattern: string, handler: RouteHandler): this {
		this.routes.push({ method, segments: pattern.split('/').filter(Boolean), handler })
		return this
	}

	/** Первые сегменты всех маршрутов (для отличия API от статики UI). */
	roots(): Set<string> {
		return new Set(this.routes.map(r => r.segments[0] ?? ''))
	}

	match(method: string, seg: readonly string[]): RouteMatch | null {
		for (const r of this.routes) {
			if (r.method !== method || r.segments.length !== seg.length) continue
			const params: Record<string, string> = {}
			let ok = true
			for (let i = 0; i < seg.length; i++) {
				const pat = r.segments[i] as string
				const val = seg[i] as string
				if (pat.startsWith(':')) params[pat.slice(1)] = val
				else if (pat !== val) {
					ok = false
					break
				}
			}
			if (ok) return { handler: r.handler, params }
		}
		return null
	}
}
