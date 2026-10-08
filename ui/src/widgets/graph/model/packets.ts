/**
 * «Пакеты» сообщений: при каждом новом сообщении по ребру от отправителя к получателю
 * бежит светящаяся точка с хвостом. Рисуются напрямую в DOM (без React) из rAF-цикла.
 */
import type { Message } from '@contract'
import { type Pt, clamp, quadControl, quadPoint, quadSegment } from '../lib/geometry'
import { isCommMessage } from './edges'
import type { Packet, PacketTone, SimNode } from './types'

const NS = 'http://www.w3.org/2000/svg'
const MAX_PACKETS = 40
/** где «разбивается» недоставленный пакет */
const FAIL_AT = 0.58

export interface PacketClasses {
	packet: string
	trail: string
	glow: string
	core: string
	ripple: string
	msg: string
	reply: string
	failed: string
}

export interface PacketLayer {
	push: (m: Message) => boolean
	step: (now: number) => boolean
	clear: () => void
}

const ease = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)

function el<K extends keyof SVGElementTagNameMap>(tag: K, cls: string): SVGElementTagNameMap[K] {
	const e = document.createElementNS(NS, tag)
	e.setAttribute('class', cls)
	return e
}

/** Кривая пакета совпадает с кривой comm-ребра (концы в порядке a<b). */
function curve(from: SimNode, to: SimNode): { a: Pt; c: Pt; b: Pt; rev: boolean } {
	const rev = from.id > to.id
	const p = rev ? to : from
	const q = rev ? from : to
	const a = { x: p.x ?? 0, y: p.y ?? 0 }
	const b = { x: q.x ?? 0, y: q.y ?? 0 }
	return { a, b, c: quadControl(a, b), rev }
}

export function createPacketLayer(
	getLayer: () => SVGGElement | null,
	getNodes: () => Map<string, SimNode>,
	cls: PacketClasses,
): PacketLayer {
	let packets: Packet[] = []

	const ripple = (layer: SVGGElement, p: Pt, r: number, tone: PacketTone): void => {
		const c = el('circle', `${cls.ripple} ${cls[tone]}`)
		c.setAttribute('cx', p.x.toFixed(1))
		c.setAttribute('cy', p.y.toFixed(1))
		c.setAttribute('r', String(r))
		layer.appendChild(c)
		window.setTimeout(() => c.remove(), 900)
	}

	return {
		push(m) {
			if (!isCommMessage(m)) return false
			const layer = getLayer()
			const nodes = getNodes()
			const from = nodes.get(m.from)
			const to = nodes.get(m.to)
			if (!layer || !from || !to) return false
			if (packets.length >= MAX_PACKETS) {
				packets.shift()?.el?.remove()
			}
			const tone: PacketTone = m.failed ? 'failed' : m.kind === 'reply' ? 'reply' : 'msg'
			const dist = Math.hypot((to.x ?? 0) - (from.x ?? 0), (to.y ?? 0) - (from.y ?? 0))
			const g = el('g', `${cls.packet} ${cls[tone]}`)
			const trail = el('path', cls.trail)
			const glow = el('circle', cls.glow)
			glow.setAttribute('r', '9')
			const core = el('circle', cls.core)
			core.setAttribute('r', '3.4')
			g.append(trail, glow, core)
			layer.appendChild(g)
			packets.push({
				id: m.id,
				from: m.from,
				to: m.to,
				tone,
				start: performance.now(),
				dur: clamp(dist * 3.4, 750, 1600),
				el: g,
				trail,
			})
			return true
		},
		step(now) {
			if (!packets.length) return false
			const layer = getLayer()
			const nodes = getNodes()
			packets = packets.filter(p => {
				const from = nodes.get(p.from)
				const to = nodes.get(p.to)
				const raw = (now - p.start) / p.dur
				const end = p.tone === 'failed' ? FAIL_AT : 1
				if (!from || !to || !p.el || !layer) {
					p.el?.remove()
					return false
				}
				const { a, b, c, rev } = curve(from, to)
				const t = ease(clamp(raw, 0, 1)) * end
				const at = (x: number): number => (rev ? 1 - x : x)
				const pos = quadPoint(a, c, b, at(t))
				if (raw >= 1) {
					p.el.remove()
					ripple(layer, p.tone === 'failed' ? pos : { x: to.x ?? 0, y: to.y ?? 0 }, p.tone === 'failed' ? 4 : to.r, p.tone)
					return false
				}
				p.el.setAttribute('transform', `translate(${pos.x.toFixed(1)} ${pos.y.toFixed(1)})`)
				// хвост — отрезок кривой позади пакета, в локальных координатах пакета
				const t0 = Math.max(0, t - 0.2)
				const seg = quadSegment(
					{ x: a.x - pos.x, y: a.y - pos.y },
					{ x: c.x - pos.x, y: c.y - pos.y },
					{ x: b.x - pos.x, y: b.y - pos.y },
					at(t0),
					at(t),
					10,
				)
				p.trail?.setAttribute('d', seg)
				return true
			})
			return packets.length > 0
		},
		clear() {
			for (const p of packets) p.el?.remove()
			packets = []
		},
	}
}
