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

	/// Точка окна (от левого верхнего угла) лежит на шапке плитки — за неё блок переносится.
	func isDockHeader(at p: CGPoint) -> Bool {
		guard activeWindow != nil else { return false }
		return dockGeometry().places.values.contains { place in
			let inset: CGFloat = place.side == .left && place.index == 0 && !isFullScreen ? 28 : 0
			return CGRect(x: place.frame.minX, y: place.frame.minY, width: place.frame.width, height: 34 + inset).contains(p)
		}
	}

	func dockGeometry(preview: Bool = true) -> DockGeometry {
		var g = DockGeometry()
		let W = windowSize.width, H = windowSize.height, m = Self.dockMargin
		// нет открытого проекта — нет и блоков: центр занимает всё окно
		guard W > 0, H > 0, activeWindow != nil else { return g }
		let lists: [DockSide: [DockBlock]] = [.left: blocks(on: .left, preview: preview), .right: blocks(on: .right, preview: preview), .bottom: blocks(on: .bottom, preview: preview)]
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
			g.columnEdges.append((side, CGRect(x: side == .left ? x + w - 6 : x - 6, y: m, width: 12, height: total)))
			if list.count == 2 {
				let upper = g.places[list[0]]!.frame
				g.gaps.append((side, CGRect(x: x, y: upper.maxY - 3, width: w, height: m + 6), list[0] == .shell, total))
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
		do {
			g.leftSlot = (lists[.left]?.isEmpty ?? true) ? 0 : wl + 1.5 * m
			g.rightSlot = (lists[.right]?.isEmpty ?? true) ? 0 : wr + 1.5 * m
			g.bottomSlot = (lists[.bottom]?.isEmpty ?? true) ? 0 : bottomH + 1.5 * m
		}
		return g
	}
}

/// Слой плиток поверх окна: каждая плитка стоит по своей рамке; полосы захвата размеров — рядом. Пока блок переносят, раскладка не
/// меняется (терминалы не двигаются и не пересчитываются): за указателем едет лёгкая «карточка-призрак», а на месте назначения лежит
/// синяя зона точного размера. Блок занимает новое место после отпускания.
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
						// остальные плитки плавно перестраиваются, переносимая встаёт в своё место сразу (за указателем едет её копия-карточка)
						.animation(dragged ? nil : dsAnimation(DS.Motion.panel), value: p.frame)
						.zIndex(dragged ? 10 : 0)
						.transition(.opacity)
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
	}
}

/// Плитка: содержимое блока и рамка; перенос — за шапку (верхние 34 pt). Пока её несут, на её месте по раскладке стоит синяя зона — столько
/// блок и займёт при отпускании, а остальные блоки уже подстроились; сама плитка уменьшена до фиксированного размера и едет за указателем
/// (терминал внутри не пересчитывается за каждым движением).
private struct DockTile: View {
	@Environment(AppModel.self) private var model
	var block: DockBlock
	var place: DockPlace
	var shape: RoundedRectangle
	@State private var dragging = false
	/// размер блока, пока его несут
	static let carried = CGSize(width: 280, height: 200)

	var body: some View {
		let f = place.frame
		let isDragged = model.draggingBlock == block
		// слева кнопки окна (светофор) попадают в верхний блок, и он делает отступ содержимому
		let topInset: CGFloat = place.side == .left && place.index == 0 && !model.isFullScreen ? 28 : 0
		let off = isDragged ? CGSize(width: model.dragPointer.x - model.dragGrab.x - f.minX, height: model.dragPointer.y - model.dragGrab.y - f.minY) : .zero
		let size = isDragged ? CGSize(width: min(f.width, Self.carried.width), height: min(f.height, Self.carried.height)) : f.size
		ZStack(alignment: .topLeading) {
			if isDragged {
				shape.fill(DS.Palette.hover)
					.overlay(shape.strokeBorder(DS.Palette.accent, style: StrokeStyle(lineWidth: 2, dash: [6, 5])))
			}
			content
				.padding(.top, topInset)
				.frame(width: size.width, height: size.height, alignment: .top)
				.clipShape(shape)
				// терминал — другого, «консольного» цвета, чтобы было видно, что сюда можно вводить
				.background(block == .shell ? DS.Palette.terminalBackground : DS.Palette.panelSurface, in: shape)
				.overlay(shape.strokeBorder(DS.Palette.border, lineWidth: DS.Metrics.hairline))
				.shadow(color: .black.opacity(isDragged ? 0.35 : 0), radius: 16, y: 6)
				.opacity(isDragged ? 0.94 : 1)
				.offset(off)
				.animation(DS.Motion.pick(DS.Motion.layout, reduceMotion: false), value: isDragged)
				.simultaneousGesture(DragGesture(minimumDistance: 8, coordinateSpace: .global)
					.onChanged { g in
						if !dragging {
							guard g.startLocation.y - f.minY < 34 + topInset else { return }
							dragging = true
							// точка захвата переносится на уменьшенный блок пропорционально
							let w = min(f.width, Self.carried.width)
							model.dragGrab = CGPoint(x: (g.startLocation.x - f.minX) * w / max(f.width, 1), y: min(g.startLocation.y - f.minY, 17))
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

/// Захват ширины колонки у внутреннего края: курсор «↔» (pointerStyle) при подходе к краю; двойной щелчок — обычная ширина.
private struct WidthHandle: View {
	@Environment(AppModel.self) private var model
	var side: DockSide
	@State private var start: CGFloat?

	var body: some View {
		Color.clear.contentShape(Rectangle())
			.pointerStyle(.columnResize)
			.gesture(DragGesture(minimumDistance: 1, coordinateSpace: .global)
				.onChanged { g in
					if start == nil { start = model.width(of: side) }
					let dx = side == .right ? -g.translation.width : g.translation.width
					model.setWidth(max((start ?? DS.Metrics.sidePanelWidth.ideal) + dx, DS.Metrics.sidePanelWidth.min), of: side)
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
			.pointerStyle(.rowResize)
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

/// Зазор между двумя блоками колонки: курсор «↕» при подходе, тянуть можно сразу; двойной щелчок — обычная высота. Никаких полосок.
private struct SplitGrip: View {
	@Environment(AppModel.self) private var model
	var shellIsUpper: Bool
	var total: CGFloat
	@State private var start: CGFloat?
	private let m = SessionWindowModel.panelMargin

	var body: some View {
		Color.clear.contentShape(Rectangle())
			.pointerStyle(.rowResize)
			.gesture(DragGesture(minimumDistance: 1, coordinateSpace: .global)
				.onChanged { g in
					if start == nil { start = model.shellHeight }
					let dy = shellIsUpper ? g.translation.height : -g.translation.height
					model.shellHeight = min(max((start ?? 240) + dy, AppModel.shellHeightMin), max(total - 160 - m, AppModel.shellHeightMin))
				}
				.onEnded { _ in start = nil })
			.onTapGesture(count: 2) { model.shellHeight = 240 }
			.help("Потяните, чтобы изменить высоту блоков; двойной щелчок — по умолчанию")
	}
}
