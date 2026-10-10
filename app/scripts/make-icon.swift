// Рисует иконку приложения (терракотовая «плитка» со звездой-астериском и бликом) и складывает iconset.
import AppKit

func render(_ px: Int) -> Data {
	let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
	NSGraphicsContext.saveGraphicsState()
	NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
	let s = CGFloat(px)
	let rect = NSRect(x: s * 0.06, y: s * 0.06, width: s * 0.88, height: s * 0.88)
	let path = NSBezierPath(roundedRect: rect, xRadius: s * 0.2, yRadius: s * 0.2)
	NSGraphicsContext.current?.saveGraphicsState()
	let shadow = NSShadow(); shadow.shadowColor = NSColor.black.withAlphaComponent(0.35); shadow.shadowBlurRadius = s * 0.03; shadow.shadowOffset = NSSize(width: 0, height: -s * 0.015)
	shadow.set()
	NSColor(red: 0.85, green: 0.47, blue: 0.34, alpha: 1).setFill(); path.fill()
	NSGraphicsContext.current?.restoreGraphicsState()
	NSGradient(colors: [NSColor(red: 0.93, green: 0.58, blue: 0.43, alpha: 1), NSColor(red: 0.78, green: 0.38, blue: 0.26, alpha: 1)])!.draw(in: path, angle: -90)
	// блик
	let gloss = NSBezierPath(roundedRect: NSRect(x: rect.minX + s * 0.02, y: rect.midY, width: rect.width - s * 0.04, height: rect.height / 2 - s * 0.02), xRadius: s * 0.18, yRadius: s * 0.18)
	NSGradient(colors: [NSColor.white.withAlphaComponent(0.28), NSColor.white.withAlphaComponent(0.02)])!.draw(in: gloss, angle: -90)
	// астериск из шести лучей
	NSColor.white.setStroke()
	let c = NSPoint(x: s / 2, y: s / 2)
	for i in 0..<3 {
		let a = CGFloat(i) * .pi / 3 + .pi / 2
		let p = NSBezierPath()
		p.lineWidth = s * 0.075; p.lineCapStyle = .round
		p.move(to: NSPoint(x: c.x + cos(a) * s * 0.24, y: c.y + sin(a) * s * 0.24))
		p.line(to: NSPoint(x: c.x - cos(a) * s * 0.24, y: c.y - sin(a) * s * 0.24))
		p.stroke()
	}
	NSGraphicsContext.restoreGraphicsState()
	return rep.representation(using: .png, properties: [:])!
}

let out = CommandLine.arguments[1]
try? FileManager.default.createDirectory(atPath: out, withIntermediateDirectories: true)
for (base, px) in [(16, 16), (32, 32), (128, 128), (256, 256), (512, 512)] {
	try render(px).write(to: URL(fileURLWithPath: "\(out)/icon_\(base)x\(base).png"))
	try render(px * 2).write(to: URL(fileURLWithPath: "\(out)/icon_\(base)x\(base)@2x.png"))
}
