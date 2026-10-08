/**
 * Визуальные параметры рёбер: толщина по числу сообщений, «тепло» по свежести.
 */
import type { EdgeDatum } from '../model/types'

/** Толщина comm-ребра: логарифм от числа сообщений. */
export function edgeWidth(count: number): number {
	return 1 + Math.min(3.2, Math.log2(count + 1) * 0.7)
}

/** «Тепло» 0..1: затухает за ~минуту после последнего сообщения. */
export function edgeHeat(e: EdgeDatum, now: number): number {
	if (e.kind !== 'comm') return 0
	return Math.exp(-Math.max(0, now - e.lastTs) / 40_000)
}
