import SwiftUI
import AppKit
import NessyKit

// Блоки вокруг центрального терминала: агенты и терминал проекта. Блок — плитка одного ровного цвета; стоит в левой или правой колонке
// (колонки идут на всю высоту окна) либо в нижней полосе под центральным терминалом (нижние углы за колонками). Положение каждой плитки
// считает одна чистая функция (`dockGeometry`), поэтому плитки не пересоздаются при переносе: их вид, терминал и жест живут дальше.

/// Где стоит плитка: сторона, номер среди соседей и рамка в координатах окна.
struct DockPlace {
	var side: DockSide
	var index: Int
	var count: Int
	var frame: CGRect
}

struct DockGeometry {
	var places: [DockBlock: DockPlace] = [:]
	/// сколько места колонки и полоса отнимают у центрального терминала (0 — блоков нет или панели скрыты)
	var leftSlot: CGFloat = 0, rightSlot: CGFloat = 0, bottomSlot: CGFloat = 0
	/// полосы захвата размера: ширина колонок, высота блоков в колонке, высота нижней полосы
	var columnEdges: [(side: DockSide, rect: CGRect)] = []
	var gaps: [(side: DockSide, rect: CGRect, shellIsUpper: Bool, total: CGFloat)] = []
	var bottomEdge: CGRect?
}

extension AppModel {
	static let dockMargin = SessionWindowModel.panelMargin

	func dockGeometry() -> DockGeometry {
		var g = DockGeometry()
		let W = windowSize.width, H = windowSize.height, m = Self.dockMargin
		guard W > 0, H > 0 else { return g }
		let lists: [DockSide: [DockBlock]] = [.left: blocks(on: .left), .right: blocks(on: .right), .bottom: blocks(on: .bottom)]
		let wl = width(of: .left), wr = width(of: .right)
		let total = max(H - 2 * m, 0)
		let minH = Self.shellHeightMin

		func column(_ side: DockSide, x: CGFloat, w: CGFloat) {
			let list = lists[side] ?? []
			guard !list.isEmpty else { return }
			let shellH = min(max(shellHeight, minH), max(total - 160 - m, minH))
			var y = m
			for (i, b) in list.enumerated() {
				let h = list.count == 1 ? total : (b == .shell ? shellH : max(total - shellH - m, 0))
				g.places[b] = DockPlace(side: side, index: i, count: list.count, frame: CGRect(x: x, y: y, width: w, height: h))
				y += h + m
			}
			g.columnEdges.append((side, CGRect(x: side == .left ? x + w - 5 : x - 5, y: m, width: 10, height: total)))
			if list.count == 2 {
				let upper = g.places[list[0]]!.frame
				g.gaps.append((side, CGRect(x: x, y: upper.maxY, width: w, height: m), list[0] == .shell, total))
			}
		}
		column(.left, x: m, w: wl)
		column(.right, x: W - m - wr, w: wr)

		let bottomH = min(max(bottomHeight, minH), max(H * 0.6, minH))
		if let list = lists[.bottom], !list.isEmpty {
			let x0 = (lists[.left]?.isEmpty ?? true) ? m : m + wl + m
			let x1 = (lists[.right]?.isEmpty ?? true) ? W - m : W - m - wr - m
			let n = CGFloat(list.count)
			let w = max((x1 - x0 - (n - 1) * m) / n, 0)
			for (i, b) in list.enumerated() {
				g.places[b] = DockPlace(side: .bottom, index: i, count: list.count, frame: CGRect(x: x0 + CGFloat(i) * (w + m), y: H - m - bottomH, width: w, height: bottomH))
			}
			g.bottomEdge = CGRect(x: x0, y: H - m - bottomH - 5, width: max(x1 - x0, 0), height: 10)
		}
		if showAgents {
			g.leftSlot = (lists[.left]?.isEmpty ?? true) ? 0 : wl + 1.5 * m
			g.rightSlot = (lists[.right]?.isEmpty ?? true) ? 0 : wr + 1.5 * m
			g.bottomSlot = (lists[.bottom]?.isEmpty ?? true) ? 0 : bottomH + 1.5 * m
		}
		return g
	}
}

/// Слой плиток поверх окна: каждая плитка стоит по своей рамке; полосы захвата размеров — рядом.
struct DockLayer: View {
	@Environment(AppModel.self) private var model

	var body: some View {
		let g = model.dockGeometry()
		let shape = RoundedRectangle(cornerRadius: DS.Metrics.panelRadius, style: .continuous)
		ZStack(alignment: .topLeading) {
			ForEach([DockBlock.agents, .shell], id: \.rawValue) { b in
				if let p = g.places[b] {
					let dragged = model.draggingBlock == b
					DockTile(block: b, place: p, shape: shape)
						.frame(width: p.frame.width, height: p.frame.height)
						.offset(x: p.frame.minX, y: p.frame.minY)
						// остальные плитки плавно перестраиваются, переносимая встаёт в своё место сразу
						.animation(dragged ? nil : dsAnimation(DS.Motion.panel), value: p.frame)
						.zIndex(dragged ? 10 : 0)
				}
			}
			if model.draggingBlock == nil {
				ForEach(Array(g.columnEdges.enumerated()), id: \.offset) { _, e in WidthHandle(side: e.side).frame(width: e.rect.width, height: e.rect.height).offset(x: e.rect.minX, y: e.rect.minY) }
				ForEach(Array(g.gaps.enumerated()), id: \.offset) { _, e in
					SplitGrip(shellIsUpper: e.shellIsUpper, total: e.total).frame(width: e.rect.width, height: e.rect.height).offset(x: e.rect.minX, y: e.rect.minY)
				}
				if let r = g.bottomEdge { HeightHandle().frame(width: r.width, height: r.height).offset(x: r.minX, y: r.minY) }
			}
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
		.opacity(model.showAgents ? 1 : 0)
		.allowsHitTesting(model.showAgents)
		.accessibilityHidden(!model.showAgents)
	}
}

/// Плитка: содержимое блока, рамка и перенос за шапку (верхние 34 pt). Пока её тащат, на её месте по раскладке стоит синяя зона — столько
/// блок и займёт при отпускании, — а сама плитка едет за указателем.
private struct DockTile: View {
	@Environment(AppModel.self) private var model
	var block: DockBlock
	var place: DockPlace
	var shape: RoundedRectangle
	@State private var dragging = false

	var body: some View {
		let f = place.frame
		let isDragged = model.draggingBlock == block
		// слева кнопки окна (светофор) попадают в верхний блок, и он делает отступ содержимому
		let topInset: CGFloat = place.side == .left && place.index == 0 && !model.isFullScreen ? 28 : 0
		let off = isDragged ? CGSize(width: model.dragPointer.x - model.dragGrab.x - f.minX, height: model.dragPointer.y - model.dragGrab.y - f.minY) : .zero
		ZStack(alignment: .topLeading) {
			if isDragged {
				shape.fill(DS.Palette.accent.opacity(0.10))
					.overlay(shape.strokeBorder(DS.Palette.accent.opacity(0.7), style: StrokeStyle(lineWidth: 2, dash: [6, 5])))
			}
			content
				.padding(.top, topInset)
				.frame(width: f.width, height: f.height, alignment: .top)
				.clipShape(shape)
				.background(DS.Palette.panelSurface, in: shape)
				.overlay(shape.strokeBorder(DS.Palette.separator, lineWidth: DS.Metrics.hairline))
				.shadow(color: .black.opacity(isDragged ? 0.35 : 0), radius: 16, y: 6)
				.opacity(isDragged ? 0.92 : 1)
				.offset(off)
				.simultaneousGesture(DragGesture(minimumDistance: 8, coordinateSpace: .global)
					.onChanged { g in
						if !dragging {
							guard g.startLocation.y - f.minY < 34 + topInset else { return }
							dragging = true
							model.dragGrab = CGPoint(x: g.startLocation.x - f.minX, y: g.startLocation.y - f.minY)
						}
						model.dragMoved(block, pointer: g.location)
					}
					.onEnded { _ in
						guard dragging else { return }
						dragging = false
						model.dropBlock()
					})
		}
	}

	@ViewBuilder private var content: some View {
		switch block {
		case .agents: AgentsPanel().id(model.activeKey)
		case .shell: if let win = model.activeWindow { ShellBlock(win: win) }
		}
	}
}

/// Захват ширины колонки у внутреннего края: курсор «↔»; двойной щелчок — обычная ширина.
private struct WidthHandle: View {
	@Environment(AppModel.self) private var model
	var side: DockSide
	@State private var start: CGFloat?

	var body: some View {
		Color.clear.contentShape(Rectangle())
			.onHover { h in if h { NSCursor.resizeLeftRight.push() } else { NSCursor.pop() } }
			.gesture(DragGesture(minimumDistance: 1, coordinateSpace: .global)
				.onChanged { g in
					if start == nil { start = model.width(of: side) }
					let r = DS.Metrics.sidePanelWidth
					let dx = side == .right ? -g.translation.width : g.translation.width
					model.setWidth(min(max((start ?? r.ideal) + dx, r.min), r.max), of: side)
				}
				.onEnded { _ in start = nil })
			.onTapGesture(count: 2) { model.setWidth(DS.Metrics.sidePanelWidth.ideal, of: side) }
			.help("Потяните, чтобы изменить ширину; двойной щелчок — по умолчанию")
	}
}

/// Захват высоты нижней полосы по верхнему краю.
private struct HeightHandle: View {
	@Environment(AppModel.self) private var model
	@State private var start: CGFloat?

	var body: some View {
		Color.clear.contentShape(Rectangle())
			.onHover { h in if h { NSCursor.resizeUpDown.push() } else { NSCursor.pop() } }
			.gesture(DragGesture(minimumDistance: 1, coordinateSpace: .global)
				.onChanged { g in
					if start == nil { start = model.bottomHeight }
					model.bottomHeight = min(max((start ?? 220) - g.translation.height, AppModel.shellHeightMin), max(model.windowSize.height * 0.6, AppModel.shellHeightMin))
				}
				.onEnded { _ in start = nil })
			.onTapGesture(count: 2) { model.bottomHeight = 220 }
			.help("Потяните, чтобы изменить высоту; двойной щелчок — по умолчанию")
	}
}

/// Тянучка между двумя блоками колонки: простая тонкая плашка по центру зазора. Появляется (и работает) только после долгого удержания курсора.
private struct SplitGrip: View {
	@Environment(AppModel.self) private var model
	var shellIsUpper: Bool
	var total: CGFloat
	@State private var hover = false
	@State private var visible = false
	@State private var start: CGFloat?
	private let m = SessionWindowModel.panelMargin

	var body: some View {
		Color.clear.contentShape(Rectangle())
			.overlay { Capsule().fill(DS.Palette.textTertiary).frame(width: 36, height: 4).opacity(visible ? 0.9 : 0) }
			.onHover { h in
				hover = h
				if h {
					DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) {
						guard hover, !visible else { return }
						withAnimation(.easeOut(duration: 0.15)) { visible = true }
						NSCursor.resizeUpDown.push()
					}
				} else if visible {
					NSCursor.pop()
					withAnimation(.easeOut(duration: 0.12)) { visible = false }
				}
			}
			.gesture(DragGesture(minimumDistance: 1, coordinateSpace: .global)
				.onChanged { g in
					guard visible else { return }
					if start == nil { start = model.shellHeight }
					let dy = shellIsUpper ? g.translation.height : -g.translation.height
					model.shellHeight = min(max((start ?? 240) + dy, AppModel.shellHeightMin), max(total - 160 - m, AppModel.shellHeightMin))
				}
				.onEnded { _ in start = nil })
			.onTapGesture(count: 2) { if visible { model.shellHeight = 240 } }
			.help("Потяните, чтобы изменить высоту блоков; двойной щелчок — по умолчанию")
	}
}
