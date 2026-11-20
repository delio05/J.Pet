// OrbPet — 橙色光球桌寵
// 功能：程式繪製的粒子光球、呼吸縮放、滑鼠拖拽/甩出、重力、牆壁反彈、
//       落地擠壓回彈、滾動旋轉、拖拽時朝前進方向變形 + 灑出碎片
// 互動：看滑鼠、撫摸、撞暈、閒置自己玩、睡覺、CPU/電量反映、番茄鐘
// 右鍵選單：番茄鐘 / 系統狀態 / 重力開關 / 回到中央 / 退出

import Cocoa
import QuartzCore
import IOKit.ps

// MARK: - 參數（可依喜好調整）

enum Cfg {
    static let orbDiameter: CGFloat = 92      // 光球顯示直徑 (pt)
    static let windowSize: CGFloat = 280       // 光球視窗大小，需留空間給光暈與形變
    static let collisionScale: CGFloat = 0.42  // 碰撞半徑 = 直徑 * 此值

    static let gravity: CGFloat = 2400
    static let floorRestitution: CGFloat = 0.55
    static let wallRestitution: CGFloat = 0.7
    static let airDrag: CGFloat = 0.35
    static let floatDrag: CGFloat = 1.2
    static let groundFriction: CGFloat = 3.5
    static let maxSpeed: CGFloat = 5000

    static let dragStiffness: CGFloat = 240     // 拖拽跟隨：越小越慢、越有拖曳感
    static let dragDampingRatio: CGFloat = 0.8  // 越接近 1 越少過衝
    static let throwScale: CGFloat = 1.0        // 放開時保留多少速度（甩出力道）

    // 拖拽變形
    static let dragStretchMax: CGFloat = 0.42   // 拖拽時最大拉長 42%
    static let dragStretchSpeed: CGFloat = 1800 // 到達最大拉長的速度 (pt/s)
    static let flyStretchMax: CGFloat = 0.18    // 甩出飛行時最大拉長
    static let coreLead: CGFloat = 0.16         // 內核往前衝的偏移比例

    // 移動碎片
    static let trailMinSpeed: CGFloat = 1500    // 非拖拽時，速度超過此值才灑碎片（一般跳躍下墜不灑）

    static let spinFactor: CGFloat = 0.3         // 移動帶動的轉速（1 = 真實滾動，越小越慢）
    static let maxSpin: CGFloat = 3              // 移動帶動的最大轉速 rad/s
    static let lineWeight: CGFloat = 1.7         // 光球線條粗細倍數

    static let breathPeriod: Double = 5.5
    static let breathAmplitude: CGFloat = 0.06
    static let shellSpinPeriod: Double = 40     // 外殼自轉一圈秒數
    static let coreSpinPeriod: Double = 14      // 內核反向自轉一圈秒數
}

// MARK: - 程式繪製光球

struct RNG {
    var s: UInt64
    mutating func next() -> CGFloat {
        s = s &* 6364136223846793005 &+ 1442695040888963407
        return CGFloat(Double(s >> 11) / Double(1 << 53))
    }
    mutating func r(_ a: CGFloat, _ b: CGFloat) -> CGFloat { a + (b - a) * next() }
}

func makeContext(_ n: Int) -> CGContext {
    let ctx = CGContext(data: nil, width: n, height: n, bitsPerComponent: 8, bytesPerRow: n * 4,
                        space: CGColorSpaceCreateDeviceRGB(),
                        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.setBlendMode(.plusLighter)   // 疊加發光
    ctx.setLineCap(.round)
    return ctx
}

/// 橙 → 金 的色彩
func orbColor(_ t: CGFloat, _ alpha: CGFloat) -> CGColor {
    CGColor(red: 1, green: 0.42 + 0.4 * t, blue: 0.04 + 0.22 * t * t, alpha: alpha)
}

/// 外殼：粒子球面（邊緣更亮）、內層球、徑向光絲、傾斜光環、邊緣亮片
func drawShell(_ n: Int = 512) -> CGImage {
    let ctx = makeContext(n)
    var rng = RNG(s: 20261119)
    let c = CGFloat(n) / 2, R = CGFloat(n) * 0.44

    func sphere(count: Int, radius: CGFloat, alphaScale: CGFloat, tone: CGFloat = 1) {
        for _ in 0..<count {
            let z = rng.r(-1, 1), phi = rng.r(0, 2 * .pi)
            let rr = sqrt(1 - z * z)
            let x = rr * cos(phi), y = rr * sin(phi)
            let rim = pow(rr, 4)
            let front: CGFloat = z > 0 ? 1 : 0.5
            let alpha = (0.06 + 0.75 * rim * rng.r(0.3, 1)) * front * alphaScale
            let ang = atan2(y, x) + .pi / 2 + rng.r(-0.6, 0.6)  // 沿切線方向的短劃
            let len = rng.r(2, 11) * (0.4 + rim)
            let px = c + x * radius, py = c + y * radius
            ctx.setStrokeColor(orbColor(pow(rng.next(), 2) * tone, alpha))
            ctx.setLineWidth(Cfg.lineWeight * rng.r(0.8, 2.6))
            ctx.move(to: CGPoint(x: px - cos(ang) * len / 2, y: py - sin(ang) * len / 2))
            ctx.addLine(to: CGPoint(x: px + cos(ang) * len / 2, y: py + sin(ang) * len / 2))
            ctx.strokePath()
        }
    }

    // 淡淡的球體填充
    let fill = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(),
                          colors: [orbColor(0.2, 0.0), orbColor(0.1, 0.10), orbColor(0, 0.22), orbColor(0, 0)] as CFArray,
                          locations: [0, 0.6, 0.93, 1])!
    ctx.drawRadialGradient(fill, startCenter: CGPoint(x: c, y: c), startRadius: 0,
                           endCenter: CGPoint(x: c, y: c), endRadius: R * 1.02, options: [])

    sphere(count: 2600, radius: R, alphaScale: 1)
    sphere(count: 900, radius: R * 0.56, alphaScale: 0.68, tone: 0.7)   // 中圈：比外圈淡，色調稍深

    // 徑向光絲
    for _ in 0..<170 {
        let a = rng.r(0, 2 * .pi), r0 = R * rng.r(0.3, 0.85), l = R * rng.r(0.04, 0.22)
        ctx.setStrokeColor(orbColor(rng.next(), rng.r(0.04, 0.22)))
        ctx.setLineWidth(Cfg.lineWeight * rng.r(0.6, 1.6))
        ctx.move(to: CGPoint(x: c + cos(a) * r0, y: c + sin(a) * r0))
        ctx.addLine(to: CGPoint(x: c + cos(a) * (r0 + l), y: c + sin(a) * (r0 + l)))
        ctx.strokePath()
    }

    // 傾斜的光環弧線
    for _ in 0..<4 {
        let t = CGAffineTransform(translationX: c, y: c)
            .rotated(by: rng.r(0, .pi))
            .scaledBy(x: 1, y: rng.r(0.22, 0.6))
        let start = rng.r(0, 2 * .pi)
        let path = CGMutablePath()
        path.addArc(center: .zero, radius: R * rng.r(0.62, 0.97), startAngle: start,
                    endAngle: start + rng.r(1.4, 4.2), clockwise: false, transform: t)
        ctx.addPath(path)
        ctx.setStrokeColor(orbColor(0.8, rng.r(0.35, 0.65)))
        ctx.setLineWidth(Cfg.lineWeight * rng.r(1.2, 2.4))
        ctx.setLineDash(phase: 0, lengths: [rng.r(6, 20), rng.r(2, 8)])
        ctx.strokePath()
    }
    ctx.setLineDash(phase: 0, lengths: [])

    // 邊緣亮片
    for _ in 0..<80 {
        let a = rng.r(0, 2 * .pi), rad = R * rng.r(0.92, 1.0)
        ctx.addArc(center: CGPoint(x: c, y: c), radius: rad, startAngle: a, endAngle: a + rng.r(0.03, 0.22), clockwise: false)
        ctx.setStrokeColor(orbColor(rng.r(0.4, 1), rng.r(0.35, 0.9)))
        ctx.setLineWidth(Cfg.lineWeight * rng.r(1.2, 3.2))
        ctx.strokePath()
    }
    return ctx.makeImage()!
}

/// 內核：明亮核心 + 旋繞光絲
/// 畫小亮點（預覽用）；shift 為光暈聚集方向向量（長度 0…1）
func drawDots(_ ctx: CGContext, _ dots: [(p: CGPoint, size: CGFloat, alpha: CGFloat)], n: Int, shift: CGVector) {
    let c = CGFloat(n) / 2, R = CGFloat(n) * 0.44
    for d in dots {
        let q = gatherDot(d.p, shift)
        ctx.setFillColor(CGColor(red: 1, green: 0.9, blue: 0.6, alpha: min(1, d.alpha * q.gain)))
        let x = c + q.p.x * R, y = c + q.p.y * R, sz = d.size * 1.6
        ctx.fillEllipse(in: CGRect(x: x - sz / 2, y: y - sz / 2, width: sz, height: sz))
    }
}

/// 光暈聚集：亮點往 shift 方向偏（越外圈偏越多），朝向那側的變亮、背側變暗
func gatherDot(_ p: CGPoint, _ g: CGVector) -> (p: CGPoint, gain: CGFloat) {
    let reach = min(1, hypot(g.dx, g.dy))
    let r = hypot(p.x, p.y)
    let q = CGPoint(x: p.x + g.dx * r * Behave.dotGather, y: p.y + g.dy * r * Behave.dotGather)
    guard reach > 0.001 else { return (q, 1) }
    let align = max(0, (p.x * g.dx + p.y * g.dy) / (max(r, 0.0001) * reach))
    let gain = (0.3 + 0.7 * (align * reach + (1 - reach) * 0.6)) / 0.72
    return (q, gain)
}

/// 內核合成圖（預覽用）
func drawCore(_ n: Int = 512) -> CGImage {
    let parts = drawCoreParts(n)
    let ctx = makeContext(n)
    let r = CGRect(x: 0, y: 0, width: n, height: n)
    ctx.draw(parts.glow, in: r)
    ctx.draw(parts.base, in: r)
    for a in parts.arms { ctx.draw(a.image, in: r) }
    drawDots(ctx, parts.dots, n: n, shift: .zero)
    return ctx.makeImage()!
}

/// 內核拆成：固定的底圖（亮核、短弧、細環、亮點）+ 每條光絲各一張（可單獨朝滑鼠方向伸長）
struct CoreParts {
    let base: CGImage                                   // 固定：短弧、細環
    let glow: CGImage                                   // 可移動：亮核光暈
    let arms: [(image: CGImage, angle: CGFloat)]        // 固定：光絲
    let dots: [(p: CGPoint, size: CGFloat, alpha: CGFloat)]  // 可移動：小亮點（p 為相對中心、以 R 為單位）
}

/// 內核拆成幾層，讓「光暈聚集」效果可以只移動光暈與亮點，中心和光絲保持不動
func drawCoreParts(_ n: Int = 512) -> CoreParts {
    let ctx = makeContext(n)
    let gctx = makeContext(n)
    let c = CGFloat(n) / 2, R = CGFloat(n) * 0.44
    let cs = CGColorSpaceCreateDeviceRGB()

    let core = CGGradient(colorsSpace: cs,
                          colors: [CGColor(red: 1, green: 0.97, blue: 0.85, alpha: 1),
                                   CGColor(red: 1, green: 0.78, blue: 0.3, alpha: 0.65),
                                   CGColor(red: 1, green: 0.5, blue: 0.08, alpha: 0.18),
                                   CGColor(red: 1, green: 0.4, blue: 0, alpha: 0)] as CFArray,
                          locations: [0, 0.18, 0.5, 1])!
    gctx.drawRadialGradient(core, startCenter: CGPoint(x: c, y: c), startRadius: 0,
                            endCenter: CGPoint(x: c, y: c), endRadius: R * 0.5, options: [])

    // 旋臂：每條各佔一個扇區（整體平衡），但角度、長度、彎曲、粗細各自隨機 → 自然不死板
    var rng = RNG(s: 2026)
    let glow = CGColor(red: 1, green: 0.55, blue: 0.1, alpha: 0.9)
    ctx.setShadow(offset: .zero, blur: 10, color: glow)
    func p(_ r: CGFloat, _ a: CGFloat) -> CGPoint { CGPoint(x: c + cos(a) * r, y: c + sin(a) * r) }
    let arms = 9
    var armImages: [(image: CGImage, angle: CGFloat)] = []
    for i in 0..<arms {
        let actx = makeContext(n)
        actx.setLineCap(.round)
        actx.setShadow(offset: .zero, blur: 10, color: glow)
        let sector = 2 * CGFloat.pi / CGFloat(arms)
        let a0 = CGFloat(i) * sector + rng.r(-0.35, 0.35) * sector
        let bright = rng.next() < 0.45
        let span = rng.r(0.9, 2.1) * (rng.next() < 0.8 ? 1 : -1)   // 少數反向彎
        let r0 = R * rng.r(0.04, 0.12), r1 = R * rng.r(0.22, 0.4)
        actx.move(to: p(r0, a0))
        actx.addCurve(to: p(r1, a0 + span),
                      control1: p(R * rng.r(0.15, 0.32), a0 + span * rng.r(0.2, 0.4)),
                      control2: p(R * rng.r(0.22, 0.42), a0 + span * rng.r(0.6, 0.8)))
        actx.setStrokeColor(CGColor(red: 1, green: bright ? 0.92 : 0.76, blue: bright ? 0.6 : 0.3,
                                    alpha: bright ? rng.r(0.8, 0.95) : rng.r(0.5, 0.75)))
        actx.setLineWidth(Cfg.lineWeight * (bright ? rng.r(2.2, 3.4) : rng.r(1, 2)))
        actx.strokePath()
        armImages.append((actx.makeImage()!, a0 + span * 0.6))   // 光絲主要伸向的方向
    }
    // 幾段短光絲點綴
    for i in 0..<6 {
        let a0 = CGFloat(i) / 6 * 2 * .pi + rng.r(-0.4, 0.4)
        let r = R * rng.r(0.18, 0.36), span = rng.r(0.25, 0.6)
        ctx.addArc(center: CGPoint(x: c, y: c), radius: r, startAngle: a0, endAngle: a0 + span, clockwise: false)
        ctx.setStrokeColor(CGColor(red: 1, green: 0.85, blue: 0.45, alpha: rng.r(0.35, 0.65)))
        ctx.setLineWidth(Cfg.lineWeight * rng.r(0.8, 1.4))
        ctx.strokePath()
    }
    // 內圈細環（虛線）
    ctx.setShadow(offset: .zero, blur: 4, color: CGColor(red: 1, green: 0.55, blue: 0.1, alpha: 0.6))
    ctx.setLineDash(phase: 0, lengths: [4, 5, 10, 4, 2, 7, 14, 6])
    ctx.addArc(center: CGPoint(x: c, y: c), radius: R * 0.44, startAngle: 0, endAngle: 2 * .pi, clockwise: false)
    ctx.setStrokeColor(CGColor(red: 1, green: 0.8, blue: 0.4, alpha: 0.45))
    ctx.setLineWidth(Cfg.lineWeight * 1.2)
    ctx.strokePath()
    ctx.setLineDash(phase: 0, lengths: [])

    // 小亮點：向日葵（黃金角）排列，均勻分佈（存成資料，執行時每顆是獨立圖層）
    let golden = CGFloat.pi * (3 - sqrt(5))
    var dots: [(p: CGPoint, size: CGFloat, alpha: CGFloat)] = []
    for i in 0..<42 {
        let rr = Behave.dotSpread * sqrt((CGFloat(i) + rng.r(0.1, 0.9)) / 42)
        let a = CGFloat(i) * golden + rng.r(-0.3, 0.3)
        let near = 1 - rr / Behave.dotSpread
        dots.append((CGPoint(x: cos(a) * rr, y: sin(a) * rr), 1.4 + 1.6 * near, 0.5 + 0.4 * near))
    }
    return CoreParts(base: ctx.makeImage()!, glow: gctx.makeImage()!, arms: armImages, dots: dots)
}

/// 柔和光點（拖尾與火花用）
func makeGlowSprite(_ n: Int, colors: [CGColor], locations: [CGFloat]) -> CGImage {
    let ctx = makeContext(n)
    let g = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors as CFArray, locations: locations)!
    let c = CGPoint(x: CGFloat(n) / 2, y: CGFloat(n) / 2)
    ctx.drawRadialGradient(g, startCenter: c, startRadius: 0, endCenter: c, endRadius: CGFloat(n) / 2, options: [])
    return ctx.makeImage()!
}

func makeSpark(core: CGColor, mid: CGColor, edge: CGColor) -> CGImage {
    makeGlowSprite(24, colors: [core, mid, edge, edge.copy(alpha: 0)!], locations: [0, 0.3, 0.55, 0.75])
}

/// 細長碎片：深色描邊 + 亮芯，淺色背景上也看得清楚
func makeShard(outer: CGColor, inner: CGColor) -> CGImage {
    let ctx = makeContext(32)
    ctx.setBlendMode(.normal)
    ctx.setLineCap(.round)
    ctx.setStrokeColor(outer)
    ctx.setLineWidth(4.5)
    ctx.move(to: CGPoint(x: 10, y: 16)); ctx.addLine(to: CGPoint(x: 22, y: 16))
    ctx.strokePath()
    ctx.setStrokeColor(inner)
    ctx.setLineWidth(1.8)
    ctx.move(to: CGPoint(x: 11.5, y: 16)); ctx.addLine(to: CGPoint(x: 20.5, y: 16))
    ctx.strokePath()
    return ctx.makeImage()!
}

// MARK: - 藍色 HUD 光環

func blueColor(_ t: CGFloat, _ alpha: CGFloat) -> CGColor {
    // t: 0 深藍 → 1 亮青白
    CGColor(red: 0.1 + 0.7 * t * t, green: 0.5 + 0.48 * t, blue: 1, alpha: alpha)
}

/// 外圈：刻度、虛線環、外框與幾段粗亮弧（慢速自轉）
func drawBlueShell(_ n: Int = 512) -> CGImage {
    let ctx = makeContext(n)
    var rng = RNG(s: 77)
    let c = CGPoint(x: CGFloat(n) / 2, y: CGFloat(n) / 2), R = CGFloat(n) * 0.44
    let lw = Cfg.lineWeight

    let fill = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(),
                          colors: [blueColor(0.3, 0), blueColor(0.2, 0.06), blueColor(0.1, 0.2), blueColor(0, 0)] as CFArray,
                          locations: [0, 0.6, 0.95, 1])!
    ctx.drawRadialGradient(fill, startCenter: c, startRadius: 0, endCenter: c, endRadius: R * 1.02, options: [])

    func ring(_ r: CGFloat, _ w: CGFloat, _ col: CGColor, dash: [CGFloat] = []) {
        ctx.setLineDash(phase: 0, lengths: dash)
        ctx.addArc(center: c, radius: r, startAngle: 0, endAngle: 2 * .pi, clockwise: false)
        ctx.setStrokeColor(col); ctx.setLineWidth(w * lw); ctx.strokePath()
        ctx.setLineDash(phase: 0, lengths: [])
    }
    func arc(_ r: CGFloat, _ a0: CGFloat, _ span: CGFloat, _ w: CGFloat, _ col: CGColor) {
        ctx.addArc(center: c, radius: r, startAngle: a0, endAngle: a0 + span, clockwise: false)
        ctx.setStrokeColor(col); ctx.setLineWidth(w * lw); ctx.strokePath()
    }

    ring(R, 1.2, blueColor(0.6, 0.55))
    ring(R * 0.84, 1.4, blueColor(0.5, 0.5), dash: [3, 6])

    // 刻度：每 5 格一根長刻度
    ctx.setLineCap(.butt)
    for i in 0..<120 {
        let a = CGFloat(i) / 120 * 2 * .pi
        let long = i % 5 == 0
        let r0 = R * (long ? 0.87 : 0.9), r1 = R * 0.94
        ctx.move(to: CGPoint(x: c.x + cos(a) * r0, y: c.y + sin(a) * r0))
        ctx.addLine(to: CGPoint(x: c.x + cos(a) * r1, y: c.y + sin(a) * r1))
        ctx.setStrokeColor(blueColor(long ? 0.8 : 0.5, long ? 0.75 : 0.4))
        ctx.setLineWidth((long ? 1.6 : 1) * lw)
        ctx.strokePath()
    }
    ctx.setLineCap(.round)

    // 粗亮弧（帶光暈）
    ctx.setShadow(offset: .zero, blur: 12, color: blueColor(0.6, 0.9))
    for _ in 0..<3 {
        arc(R * 0.975, rng.r(0, 2 * .pi), rng.r(0.35, 0.9), 4, blueColor(0.85, 0.95))
    }
    for _ in 0..<4 {
        arc(R * 0.8, rng.r(0, 2 * .pi), rng.r(0.15, 0.45), 2.5, blueColor(0.7, 0.8))
    }
    return ctx.makeImage()!
}

/// 中圈：分段光條、亮弧、點狀環（反向自轉）
func drawBlueMid(_ n: Int = 512) -> CGImage {
    let ctx = makeContext(n)
    var rng = RNG(s: 909)
    let c = CGPoint(x: CGFloat(n) / 2, y: CGFloat(n) / 2), R = CGFloat(n) * 0.44
    let lw = Cfg.lineWeight

    // 分段光條：一圈小方塊，部分點亮
    ctx.setLineCap(.butt)
    let blocks = 48
    for i in 0..<blocks {
        let a0 = CGFloat(i) / CGFloat(blocks) * 2 * .pi
        let lit = rng.next() < 0.45
        ctx.addArc(center: c, radius: R * 0.7, startAngle: a0, endAngle: a0 + 2 * .pi / CGFloat(blocks) * 0.7, clockwise: false)
        ctx.setStrokeColor(blueColor(lit ? 0.75 : 0.3, lit ? 0.85 : 0.25))
        ctx.setLineWidth(6 * lw)
        ctx.strokePath()
    }
    ctx.setLineCap(.round)

    ctx.addArc(center: c, radius: R * 0.62, startAngle: 0, endAngle: 2 * .pi, clockwise: false)
    ctx.setStrokeColor(blueColor(0.5, 0.4)); ctx.setLineWidth(1 * lw); ctx.strokePath()

    // 點狀環
    for i in 0..<72 {
        let a = CGFloat(i) / 72 * 2 * .pi, s: CGFloat = 2.4 * lw
        let p = CGPoint(x: c.x + cos(a) * R * 0.56, y: c.y + sin(a) * R * 0.56)
        ctx.setFillColor(blueColor(0.7, i % 6 == 0 ? 0.9 : 0.4))
        ctx.fillEllipse(in: CGRect(x: p.x - s / 2, y: p.y - s / 2, width: s, height: s))
    }

    // 亮弧
    ctx.setShadow(offset: .zero, blur: 10, color: blueColor(0.6, 0.9))
    for _ in 0..<3 {
        let a0 = rng.r(0, 2 * .pi)
        ctx.addArc(center: c, radius: R * 0.765, startAngle: a0, endAngle: a0 + rng.r(0.4, 1.2), clockwise: false)
        ctx.setStrokeColor(blueColor(0.95, 0.95)); ctx.setLineWidth(2.5 * lw); ctx.strokePath()
    }
    return ctx.makeImage()!
}

/// 內核：青白亮核、細環、短弧與十字準星
/// 藍色內核拆三層：光暈（固定）、細環＋十字準星（跟著滑鼠）、粗亮弧（旋轉）
func drawBlueCoreParts(_ n: Int = 512) -> (glow: CGImage, base: CGImage, arcs: CGImage) {
    let gctx = makeContext(n), ctx = makeContext(n), actx = makeContext(n)
    var rng = RNG(s: 31)
    let c = CGPoint(x: CGFloat(n) / 2, y: CGFloat(n) / 2), R = CGFloat(n) * 0.44
    let lw = Cfg.lineWeight

    let core = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(),
                          colors: [CGColor(red: 0.92, green: 0.99, blue: 1, alpha: 1), blueColor(0.85, 0.6),
                                   blueColor(0.4, 0.18), blueColor(0, 0)] as CFArray,
                          locations: [0, 0.18, 0.5, 1])!
    gctx.drawRadialGradient(core, startCenter: c, startRadius: 0, endCenter: c, endRadius: R * 0.48, options: [])

    for (r, a) in [(R * 0.3, CGFloat(0.55)), (R * 0.42, CGFloat(0.35))] {
        ctx.addArc(center: c, radius: r, startAngle: 0, endAngle: 2 * .pi, clockwise: false)
        ctx.setStrokeColor(blueColor(0.7, a)); ctx.setLineWidth(1 * lw); ctx.strokePath()
    }
    actx.setLineCap(.round)
    actx.setShadow(offset: .zero, blur: 8, color: blueColor(0.6, 0.9))
    for _ in 0..<4 {
        let a0 = rng.r(0, 2 * .pi)
        actx.addArc(center: c, radius: R * rng.r(0.34, 0.38), startAngle: a0, endAngle: a0 + rng.r(0.5, 1.4), clockwise: false)
        actx.setStrokeColor(blueColor(0.95, 0.9)); actx.setLineWidth(2.2 * lw); actx.strokePath()
    }
    // 十字準星短刻度
    ctx.setShadow(offset: .zero, blur: 8, color: blueColor(0.6, 0.9))
    for k in 0..<4 {
        let a = CGFloat(k) * .pi / 2
        ctx.move(to: CGPoint(x: c.x + cos(a) * R * 0.44, y: c.y + sin(a) * R * 0.44))
        ctx.addLine(to: CGPoint(x: c.x + cos(a) * R * 0.5, y: c.y + sin(a) * R * 0.5))
        ctx.setStrokeColor(blueColor(0.9, 0.9)); ctx.setLineWidth(1.6 * lw); ctx.strokePath()
    }
    return (gctx.makeImage()!, ctx.makeImage()!, actx.makeImage()!)
}

// MARK: - 主題

enum OrbTheme: String, CaseIterable {
    case orange, blue

    var title: String { self == .orange ? "橙色光球" : "藍色光環" }

    struct Art { let shell: CGImage; let mid: CGImage?; let core: CGImage; let coreGlow: CGImage?; let coreSpinner: CGImage?; let arms: [(image: CGImage, angle: CGFloat)]; let dots: [(p: CGPoint, size: CGFloat, alpha: CGFloat)]; let spark: CGImage; let shard: CGImage }
    private static var cache: [OrbTheme: Art] = [:]

    var art: Art {
        if let a = Self.cache[self] { return a }
        let a: Art
        switch self {
        case .orange:
            let parts = drawCoreParts()
            a = Art(shell: drawShell(), mid: nil, core: parts.base, coreGlow: parts.glow, coreSpinner: nil, arms: parts.arms, dots: parts.dots,
                    spark: makeSpark(core: CGColor(red: 1, green: 0.97, blue: 0.8, alpha: 1),
                                     mid: CGColor(red: 1, green: 0.7, blue: 0.15, alpha: 1),
                                     edge: CGColor(red: 0.95, green: 0.45, blue: 0, alpha: 0.85)),
                    shard: makeShard(outer: CGColor(red: 0.95, green: 0.42, blue: 0, alpha: 1),
                                     inner: CGColor(red: 1, green: 0.93, blue: 0.6, alpha: 1)))
        case .blue:
            let bp = drawBlueCoreParts()
            a = Art(shell: drawBlueShell(), mid: drawBlueMid(), core: bp.base, coreGlow: bp.glow, coreSpinner: bp.arcs, arms: [], dots: [],
                    spark: makeSpark(core: CGColor(red: 0.9, green: 1, blue: 1, alpha: 1),
                                     mid: CGColor(red: 0.35, green: 0.85, blue: 1, alpha: 1),
                                     edge: CGColor(red: 0.05, green: 0.4, blue: 0.9, alpha: 0.85)),
                    shard: makeShard(outer: CGColor(red: 0.05, green: 0.4, blue: 0.88, alpha: 1),
                                     inner: CGColor(red: 0.75, green: 0.97, blue: 1, alpha: 1)))
        }
        Self.cache[self] = a
        return a
    }

    var glowColors: [CGColor] {
        switch self {
        case .orange: return [CGColor(red: 1, green: 0.55, blue: 0.1, alpha: 0.5),
                              CGColor(red: 1, green: 0.45, blue: 0.05, alpha: 0.16),
                              CGColor(red: 1, green: 0.4, blue: 0, alpha: 0)]
        case .blue: return [CGColor(red: 0.25, green: 0.7, blue: 1, alpha: 0.45),
                            CGColor(red: 0.1, green: 0.5, blue: 1, alpha: 0.15),
                            CGColor(red: 0.05, green: 0.4, blue: 1, alpha: 0)]
        }
    }
    /// 倒計時數字後的光暈等強調色
    var accent: CGColor {
        self == .orange ? CGColor(red: 0.78, green: 0.3, blue: 0.02, alpha: 1)
                        : CGColor(red: 0.04, green: 0.36, blue: 0.85, alpha: 1)
    }
    var timerColor: CGColor {
        self == .orange ? CGColor(red: 1, green: 0.97, blue: 0.9, alpha: 1)
                        : CGColor(red: 0.92, green: 0.98, blue: 1, alpha: 1)
    }
    /// 內核大小倍數
    var coreSize: CGFloat { 1.0 }
    /// 自轉週期（秒），負數為逆時針
    var spinPeriods: (shell: Double, mid: Double, core: Double) {
        self == .orange ? (40, 0, 0) : (60, -22, 0)   // 內核不自轉
    }

    static var saved: OrbTheme {
        get { OrbTheme(rawValue: UserDefaults.standard.string(forKey: "theme") ?? "") ?? .orange }
        set { UserDefaults.standard.set(newValue.rawValue, forKey: "theme") }
    }
}

// MARK: - 互動參數

enum Behave {
    static let gazeRange: CGFloat = 380        // 滑鼠在多遠內會被「盯著看」
    static let idleAfter: Double = 15          // 多久沒理它開始自己玩（秒）
    static let sleepAfter: Double = 90         // 多久沒理它睡著（秒）
    static let wakeDistance: CGFloat = 160     // 滑鼠靠近多少會叫醒它
    static let dizzySpeed: CGFloat = 2000      // 撞擊速度超過此值會暈
    static let dizzyDuration: Double = 2.6
    static let focusMinutes: Double = 25
    static let breakMinutes: Double = 5
    static let glowShift: CGFloat = 0          // 內核光暈往滑鼠方向偏移量（0 = 光暈固定，只有亮點聚集）
    static let dotGather: CGFloat = 0.35       // 小亮點往滑鼠方向聚集的程度
    static let dotSpread: CGFloat = 0.65       // 小亮點分佈範圍（內核半徑的比例，原本 0.42）
    static let brandText = "J.A.R.V.I.S."       // 藍色光環中央文字
    static let brandFontSize: CGFloat = 8.5
    static let innerArcPeriod: Double = 9      // 藍色內圈粗亮弧旋轉一圈秒數（負數逆時針）
    static let celebrateSeconds: Double = 6    // 計時結束雀躍多久
    // 倒計時字體："segment"（七段數碼管）/ "rounded" / "system" / "mono" / 或字體 PostScript 名稱（如 "DINAlternate-Bold"）
    static let timerFont = "segment"
    static let timerFontSize: CGFloat = 20
    static let timerColor = CGColor(red: 1, green: 0.97, blue: 0.9, alpha: 1)   // 暖白
    static let timerOutline = CGColor(red: 0.78, green: 0.3, blue: 0.02, alpha: 1) // 數字後的橙色光暈，和光球同色調
}

/// 七段數碼管：回傳 (亮的段, 全部段)。高度 h，左下為原點，略為右傾
func segmentPaths(_ text: String, height h: CGFloat) -> (lit: CGPath, all: CGPath, width: CGFloat) {
    let t = h * 0.18, w = h * 0.58, g = t * 0.18, skew: CGFloat = 0.1
    let lit = CGMutablePath(), all = CGMutablePath()
    let segs: [Character: String] = ["0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc",
                                     "5": "afgcd", "6": "afgedc", "7": "abc", "8": "abcdefg", "9": "abcdfg"]
    var x: CGFloat = 0
    func sk(_ p: CGPoint) -> CGPoint { CGPoint(x: p.x + p.y * skew, y: p.y) }
    func poly(_ pts: [CGPoint], into path: CGMutablePath) { path.addLines(between: pts.map(sk)); path.closeSubpath() }
    func hSeg(_ x0: CGFloat, _ x1: CGFloat, _ y: CGFloat) -> [CGPoint] {
        [CGPoint(x: x0, y: y), CGPoint(x: x0 + t / 2, y: y + t / 2), CGPoint(x: x1 - t / 2, y: y + t / 2),
         CGPoint(x: x1, y: y), CGPoint(x: x1 - t / 2, y: y - t / 2), CGPoint(x: x0 + t / 2, y: y - t / 2)]
    }
    func vSeg(_ xx: CGFloat, _ y0: CGFloat, _ y1: CGFloat) -> [CGPoint] {
        [CGPoint(x: xx, y: y0), CGPoint(x: xx + t / 2, y: y0 + t / 2), CGPoint(x: xx + t / 2, y: y1 - t / 2),
         CGPoint(x: xx, y: y1), CGPoint(x: xx - t / 2, y: y1 - t / 2), CGPoint(x: xx - t / 2, y: y0 + t / 2)]
    }
    for ch in text {
        if ch == ":" {
            for cy in [h * 0.3, h * 0.7] {
                poly([CGPoint(x: x + t * 0.4, y: cy - t / 2), CGPoint(x: x + t * 1.4, y: cy - t / 2),
                      CGPoint(x: x + t * 1.4, y: cy + t / 2), CGPoint(x: x + t * 0.4, y: cy + t / 2)], into: lit)
            }
            x += t * 1.8
            continue
        }
        let l = x + t / 2, r = x + w - t / 2
        let shapes: [Character: [CGPoint]] = [
            "a": hSeg(l + g, r - g, h - t / 2), "g": hSeg(l + g, r - g, h / 2), "d": hSeg(l + g, r - g, t / 2),
            "f": vSeg(l, h / 2 + g, h - t / 2 - g), "b": vSeg(r, h / 2 + g, h - t / 2 - g),
            "e": vSeg(l, t / 2 + g, h / 2 - g), "c": vSeg(r, t / 2 + g, h / 2 - g)]
        let on = segs[ch] ?? ""
        for (k, pts) in shapes {
            poly(pts, into: all)
            if on.contains(k) { poly(pts, into: lit) }
        }
        x += w + t * 0.9
    }
    return (lit, all, x - t * 0.9 + h * skew)
}

/// 倒計時字體（一律用等寬數字，跳秒時不會左右晃）
func makeTimerFont(_ key: String, size: CGFloat) -> NSFont {
    let base = NSFont.systemFont(ofSize: size, weight: .bold)
    var font: NSFont
    switch key {
    case "rounded":
        font = base.fontDescriptor.withDesign(.rounded).flatMap { NSFont(descriptor: $0, size: size) } ?? base
    case "system": font = base
    case "mono": font = NSFont.monospacedSystemFont(ofSize: size, weight: .bold)
    default: font = NSFont(name: key, size: size) ?? base
    }
    let desc = font.fontDescriptor.addingAttributes([.featureSettings: [[
        NSFontDescriptor.FeatureKey.typeIdentifier: kNumberSpacingType,
        NSFontDescriptor.FeatureKey.selectorIdentifier: kMonospacedNumbersSelector]]])
    return NSFont(descriptor: desc, size: size) ?? font
}

// MARK: - 光球視圖

/// 每顆小亮點各自的隨機個性：聚集力道、偏向角度、反應快慢、漂浮節奏
final class DotState {
    let layer: CALayer
    let p: CGPoint, alpha: CGFloat
    let pull: CGFloat        // 聚集力道倍數
    let skew: CGFloat        // 偏離滑鼠方向的角度
    let speed: CGFloat       // 跟上的快慢
    let f1: Double, f2: Double, ph1: Double, ph2: Double  // 漂浮
    var off = CGVector.zero  // 目前的聚集偏移（以 R 為單位）
    init(layer: CALayer, p: CGPoint, alpha: CGFloat) {
        self.layer = layer; self.p = p; self.alpha = alpha
        pull = .random(in: 0.3...1.8)
        skew = .random(in: -0.6...0.6)
        speed = .random(in: 2...9)
        f1 = .random(in: 0.4...1.3); f2 = .random(in: 0.4...1.3)
        ph1 = .random(in: 0...(2 * .pi)); ph2 = .random(in: 0...(2 * .pi))
    }
}

final class OrbView: NSView {
    let orbRoot = CALayer()         // 整顆光球的容器：只移動這個圖層，不移動視窗
    let bodyLayer = CALayer()       // 呼吸縮放、擠壓、方向拉長
    let glowLayer = CAGradientLayer()
    let shellLayer = CALayer()      // 外殼，慢速自轉
    let midLayer = CALayer()        // 中圈（藍色主題用）
    let heatLayer = CAGradientLayer() // CPU 忙碌時的紅色
    var armLayers: [(layer: CALayer, angle: CGFloat)] = []  // 內核光絲（固定）
    let coreGlowLayer = CALayer()   // 內核光暈：往滑鼠方向聚集
    let coreBaseLayer = CALayer()   // 內核底圖：固定
    let coreSpinLayer = CALayer()   // 內核粗亮弧：自己旋轉（藍色）
    var dotLayers: [DotState] = []  // 內核小亮點：各自隨機地往滑鼠方向聚集
    let coreLayer = CALayer()       // 內核，反向自轉、拖拽時往前衝、會看滑鼠
    let label = CATextLayer()       // 番茄鐘倒計時（光球中央）
    let segGhost = CAShapeLayer()   // 七段數碼管：未亮的段
    let segLit = CAShapeLayer()     // 七段數碼管：亮的段
    let timerGroup = CALayer()      // 倒計時容器，方便整體顯示/隱藏
    let brandLabel = CATextLayer()  // 藍色主題中央文字（不隨滑鼠移動）
    var lastTimerText = ""
    let sleepEmitter = CAEmitterLayer() // 睡覺：慢慢往上飄的小光點

    var onMouseDown: ((NSEvent) -> Void)?
    var onMouseUp: ((NSEvent) -> Void)?
    var onRightClick: ((NSEvent) -> Void)?

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.backgroundColor = .clear
        let scale = NSScreen.main?.backingScaleFactor ?? 2

        let d = Cfg.orbDiameter
        let mid = CGPoint(x: d / 2, y: d / 2)
        let s = Cfg.windowSize
        orbRoot.bounds = CGRect(x: 0, y: 0, width: s, height: s)
        layer?.addSublayer(orbRoot)
        let center = CGPoint(x: s / 2, y: s / 2)
        bodyLayer.bounds = CGRect(x: 0, y: 0, width: d, height: d)
        bodyLayer.position = center

        glowLayer.type = .radial
        glowLayer.colors = [CGColor(red: 1, green: 0.55, blue: 0.1, alpha: 0.5),
                            CGColor(red: 1, green: 0.45, blue: 0.05, alpha: 0.16),
                            CGColor(red: 1, green: 0.4, blue: 0, alpha: 0)]
        glowLayer.locations = [0, 0.45, 1]
        glowLayer.startPoint = CGPoint(x: 0.5, y: 0.5)
        glowLayer.endPoint = CGPoint(x: 1, y: 1)
        glowLayer.bounds = CGRect(x: 0, y: 0, width: d * 1.9, height: d * 1.9)
        glowLayer.position = mid

        heatLayer.type = .radial
        heatLayer.colors = [CGColor(red: 0.95, green: 0.15, blue: 0.05, alpha: 0.85),
                            CGColor(red: 0.9, green: 0.1, blue: 0.05, alpha: 0.55),
                            CGColor(red: 0.9, green: 0.1, blue: 0.05, alpha: 0)]
        heatLayer.locations = [0, 0.7, 1]
        heatLayer.startPoint = CGPoint(x: 0.5, y: 0.5)
        heatLayer.endPoint = CGPoint(x: 1, y: 1)
        heatLayer.bounds = CGRect(x: 0, y: 0, width: d * 1.02, height: d * 1.02)
        heatLayer.position = mid
        heatLayer.opacity = 0

        for l in [shellLayer, midLayer, coreLayer] {
            l.bounds = CGRect(x: 0, y: 0, width: d * 1.1, height: d * 1.1)
            l.position = mid
        }
        bodyLayer.addSublayer(glowLayer)
        bodyLayer.addSublayer(shellLayer)
        bodyLayer.addSublayer(midLayer)
        bodyLayer.addSublayer(heatLayer)
        bodyLayer.addSublayer(coreLayer)
        orbRoot.addSublayer(bodyLayer)

        // 倒計時：光球正中央，白字 + 深橙光暈確保在亮核上也看得清
        let font = makeTimerFont(Behave.timerFont, size: Behave.timerFontSize)
        let lineH = ceil(font.ascender - font.descender)
        label.font = font
        label.fontSize = Behave.timerFontSize
        label.alignmentMode = .center
        label.foregroundColor = Behave.timerColor
        label.contentsScale = scale
        label.bounds = CGRect(x: 0, y: 0, width: d * 1.2, height: lineH)
        label.position = center
        label.shadowColor = Behave.timerOutline
        label.shadowOpacity = 0.95
        label.shadowRadius = 2.5
        label.shadowOffset = .zero
        timerGroup.frame = orbRoot.bounds
        timerGroup.opacity = 0
        orbRoot.addSublayer(timerGroup)
        if Behave.timerFont == "segment" {
            segGhost.fillColor = Behave.timerColor.copy(alpha: 0.12)
            segLit.fillColor = Behave.timerColor
            timerGroup.addSublayer(segGhost)   // 未亮的段不加陰影，避免干擾閱讀
            for l in [segLit] {
                l.shadowColor = Behave.timerOutline
                l.shadowOpacity = 1
                l.shadowRadius = 2.5
                l.shadowOffset = .zero
                timerGroup.addSublayer(l)
            }
        } else {
            timerGroup.addSublayer(label)
        }

        sleepEmitter.emitterPosition = CGPoint(x: center.x, y: center.y + d * 0.3)
        sleepEmitter.emitterShape = .line
        sleepEmitter.emitterSize = CGSize(width: d * 0.5, height: 1)
        sleepEmitter.renderMode = .oldestLast
        sleepEmitter.birthRate = 0
        orbRoot.addSublayer(sleepEmitter)

        // 藍色主題中央的 J.A.R.V.I.S.：放在內核之外，所以內核跟著滑鼠偏時文字不動
        let bf = NSFont.systemFont(ofSize: Behave.brandFontSize, weight: .semibold)
        brandLabel.string = NSAttributedString(string: Behave.brandText, attributes: [
            .font: bf, .kern: Behave.brandFontSize * 0.12,
            .foregroundColor: NSColor(red: 0.85, green: 0.97, blue: 1, alpha: 1)])
        brandLabel.alignmentMode = .center
        brandLabel.contentsScale = scale
        let bh = ceil(bf.ascender - bf.descender)
        brandLabel.bounds = CGRect(x: 0, y: 0, width: d * 1.2, height: bh)
        brandLabel.position = center
        brandLabel.shadowColor = CGColor(red: 0.1, green: 0.55, blue: 1, alpha: 1)
        brandLabel.shadowOpacity = 1
        brandLabel.shadowRadius = 2.5
        brandLabel.shadowOffset = .zero
        brandLabel.opacity = 0
        orbRoot.addSublayer(brandLabel)
    }
    required init?(coder: NSCoder) { fatalError() }

    func apply(_ t: OrbTheme) {
        let art = t.art
        shellLayer.contents = art.shell
        midLayer.contents = art.mid
        let cb = coreLayer.bounds, cc = CGPoint(x: cb.midX, y: cb.midY)
        coreLayer.contents = nil
        coreLayer.sublayers?.forEach { $0.removeFromSuperlayer() }
        for (l, img) in [(coreGlowLayer, art.coreGlow), (coreBaseLayer, art.core), (coreSpinLayer, art.coreSpinner)] {
            l.contents = img
            l.bounds = cb
            l.position = cc
            coreLayer.addSublayer(l)
        }
        armLayers = art.arms.map { arm in
            let l = CALayer()
            l.contents = arm.image
            l.bounds = cb
            l.position = cc
            coreLayer.addSublayer(l)
            return (l, arm.angle)
        }
        let rpt = cb.width * 0.44
        dotLayers = art.dots.map { d in
            let l = CALayer()
            let sz = max(1.2, d.size * 0.75)
            l.bounds = CGRect(x: 0, y: 0, width: sz, height: sz)
            l.cornerRadius = sz / 2
            l.backgroundColor = CGColor(red: 1, green: 0.9, blue: 0.6, alpha: 1)
            l.position = CGPoint(x: cc.x + d.p.x * rpt, y: cc.y + d.p.y * rpt)
            l.opacity = Float(d.alpha)
            coreLayer.addSublayer(l)
            return DotState(layer: l, p: d.p, alpha: d.alpha)
        }
        glowLayer.colors = t.glowColors
        label.foregroundColor = t.timerColor
        label.shadowColor = t.accent
        segLit.fillColor = t.timerColor
        segLit.shadowColor = t.accent
        segGhost.fillColor = t.timerColor.copy(alpha: 0.12)
        let mote = CAEmitterCell()
        mote.contents = art.spark
        mote.birthRate = 1.4
        mote.lifetime = 3
        mote.lifetimeRange = 0.8
        mote.velocity = 14
        mote.velocityRange = 5
        mote.emissionLongitude = .pi / 2       // 向上
        mote.emissionRange = 0.35
        mote.scale = 0.22
        mote.scaleRange = 0.08
        mote.scaleSpeed = -0.04
        mote.alphaRange = 0.3
        mote.alphaSpeed = -0.32
        sleepEmitter.emitterCells = [mote]
    }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with event: NSEvent) { onMouseDown?(event) }
    override func mouseUp(with event: NSEvent) { onMouseUp?(event) }
    override func mouseDragged(with event: NSEvent) {}
    override func rightMouseDown(with event: NSEvent) { onRightClick?(event) }
}

// MARK: - 碎片（全螢幕透明、可點擊穿透的覆蓋視窗，碎片留在螢幕座標上）

func makeFragmentCells(speed: CGFloat, theme: OrbTheme) -> [CAEmitterCell] {
    let dot = CAEmitterCell()
    dot.contents = theme.art.spark
    dot.birthRate = 1
    dot.lifetime = 0.9
    dot.lifetimeRange = 0.3
    dot.velocity = speed
    dot.velocityRange = speed
    dot.emissionRange = .pi * 2
    dot.scale = 0.3
    dot.scaleRange = 0.12
    dot.scaleSpeed = -0.2
    dot.alphaSpeed = -0.9
    dot.color = CGColor(red: 1, green: 1, blue: 1, alpha: 1)
    dot.greenRange = 0.1

    let shard = CAEmitterCell()
    shard.contents = theme.art.shard
    shard.birthRate = 0.8
    shard.lifetime = 1.0
    shard.lifetimeRange = 0.3
    shard.velocity = speed * 0.85
    shard.velocityRange = speed * 0.85
    shard.emissionRange = .pi * 2
    shard.scale = 0.68
    shard.scaleRange = 0.3
    shard.scaleSpeed = -0.3
    shard.spinRange = 8
    shard.alphaSpeed = -0.85
    shard.color = CGColor(red: 1, green: 1, blue: 1, alpha: 1)
    shard.greenRange = 0.1
    return [dot, shard]
}

final class TrailOverlay {
    let window: NSWindow
    let root = CALayer()
    let emitter = CAEmitterLayer()      // 移動時持續灑出
    let burstEmitter = CAEmitterLayer() // 撞擊、醒來、鬧鐘時一次爆出
    var screenFrame = CGRect.zero
    var burstEnd = 0.0

    init() {
        window = NSWindow(contentRect: .zero, styleMask: .borderless, backing: .buffered, defer: false)
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = false
        window.ignoresMouseEvents = true
        window.level = .floating
        window.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
        let v = NSView()
        v.wantsLayer = true
        window.contentView = v
        v.layer?.addSublayer(root)

        for (e, speed) in [(emitter, CGFloat(30)), (burstEmitter, CGFloat(170))] {
            e.emitterShape = .circle
            e.emitterMode = .volume
            e.renderMode = .oldestLast   // 一般混合：淺色背景上也顯眼
            e.birthRate = 0
            root.addSublayer(e)
        }
        window.orderFrontRegardless()
    }

    var sparkImage: CGImage?
    var shardImage: CGImage?

    func apply(_ t: OrbTheme) {
        sparkImage = t.art.spark
        shardImage = t.art.shard
        emitter.emitterCells = makeFragmentCells(speed: 30, theme: t)
        burstEmitter.emitterCells = makeFragmentCells(speed: 170, theme: t)
    }

    func local(_ p: CGPoint) -> CGPoint { CGPoint(x: p.x - screenFrame.minX, y: p.y - screenFrame.minY) }

    func update(pos: CGPoint, rate: Float, screen: CGRect, now: Double) {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        if screen != screenFrame {
            screenFrame = screen
            window.setFrame(screen, display: false)
            root.frame = CGRect(origin: .zero, size: screen.size)
        }
        emitter.emitterPosition = local(pos)
        emitter.emitterSize = CGSize(width: Cfg.orbDiameter * 0.55, height: Cfg.orbDiameter * 0.55)
        emitter.birthRate = rate
        if now > burstEnd { burstEmitter.birthRate = 0 }
        CATransaction.commit()
    }

    /// 吸入：碎片從四周飛進光球中心（複製到剪貼簿時用）
    func absorb(to p: CGPoint, count: Int) {
        let center = local(p)
        let d = Cfg.orbDiameter
        CATransaction.begin()
        for _ in 0..<count {
            let a = CGFloat.random(in: 0..<(2 * .pi))
            let dist = d * .random(in: 0.9...1.6)
            let start = CGPoint(x: center.x + cos(a) * dist, y: center.y + sin(a) * dist)
            let l = CALayer()
            let isShard = Bool.random()
            l.contents = isShard ? shardImage : sparkImage
            let sz: CGFloat = isShard ? .random(in: 18...26) : .random(in: 10...14)
            l.bounds = CGRect(x: 0, y: 0, width: sz, height: sz)
            l.position = center
            l.opacity = 0
            l.setAffineTransform(CGAffineTransform(rotationAngle: a))   // 細長碎片指向中心
            root.addSublayer(l)

            let dur = Double.random(in: 0.42...0.58)
            let move = CABasicAnimation(keyPath: "position")
            move.fromValue = NSValue(point: start)
            move.toValue = NSValue(point: center)
            move.timingFunction = CAMediaTimingFunction(name: .easeIn)
            let fade = CAKeyframeAnimation(keyPath: "opacity")
            fade.values = [0, 1, 1, 0]
            fade.keyTimes = [0, 0.15, 0.85, 1]
            let shrink = CABasicAnimation(keyPath: "transform.scale")
            shrink.fromValue = 1.0
            shrink.toValue = 0.45
            let g = CAAnimationGroup()
            g.animations = [move, fade, shrink]
            g.duration = dur
            g.isRemovedOnCompletion = true
            CATransaction.begin()
            CATransaction.setCompletionBlock { l.removeFromSuperlayer() }
            l.add(g, forKey: "absorb")
            CATransaction.commit()
        }
        CATransaction.commit()
    }

    func burst(at p: CGPoint, count: Int, now: Double) {
        let window = 0.06
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        burstEmitter.emitterPosition = local(p)
        burstEmitter.emitterSize = CGSize(width: 20, height: 20)
        burstEmitter.birthRate = Float(Double(count) / 1.8 / window)  // 兩種碎片合計約 1.8 顆/單位
        CATransaction.commit()
        burstEnd = now + window
    }
}

// MARK: - 系統狀態（CPU / 電池）

final class SystemMonitor {
    private(set) var cpu: Double = 0
    private(set) var batteryPercent: Double = 1
    private(set) var onAC = true
    private var prevTicks: (busy: Double, total: Double)?
    private var lastCPU = -10.0, lastBattery = -100.0

    var lowBattery: Bool { !onAC && batteryPercent <= 0.2 }

    func poll(now: Double) {
        if now - lastCPU >= 2 { lastCPU = now; sampleCPU() }
        if now - lastBattery >= 30 { lastBattery = now; sampleBattery() }
    }

    private func sampleCPU() {
        var info = host_cpu_load_info()
        var count = mach_msg_type_number_t(MemoryLayout<host_cpu_load_info_data_t>.size / MemoryLayout<integer_t>.size)
        let kr = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                host_statistics(mach_host_self(), HOST_CPU_LOAD_INFO, $0, &count)
            }
        }
        guard kr == KERN_SUCCESS else { return }
        let t = info.cpu_ticks   // user, system, idle, nice
        let busy = Double(t.0) + Double(t.1) + Double(t.3)
        let total = busy + Double(t.2)
        if let p = prevTicks, total > p.total {
            cpu = (busy - p.busy) / (total - p.total)
        }
        prevTicks = (busy, total)
    }

    private func sampleBattery() {
        guard let blob = IOPSCopyPowerSourcesInfo()?.takeRetainedValue(),
              let list = IOPSCopyPowerSourcesList(blob)?.takeRetainedValue() as? [CFTypeRef] else { return }
        for ps in list {
            guard let desc = IOPSGetPowerSourceDescription(blob, ps)?.takeUnretainedValue() as? [String: Any],
                  desc[kIOPSTypeKey] as? String == kIOPSInternalBatteryType,
                  let cap = desc[kIOPSCurrentCapacityKey] as? Int,
                  let maxCap = desc[kIOPSMaxCapacityKey] as? Int, maxCap > 0 else { continue }
            batteryPercent = Double(cap) / Double(maxCap)
            onAC = (desc[kIOPSPowerSourceStateKey] as? String) == kIOPSACPowerValue
            return
        }
    }
}

// MARK: - 物理 + 動畫 + 互動

final class Pet: NSObject, NSMenuDelegate {
    let window: NSPanel
    let view: OrbView
    let trail = TrailOverlay()
    let sys = SystemMonitor()

    var pos = CGPoint.zero          // 光球中心（螢幕座標，y 向上）
    var vel = CGVector.zero
    var dragging = false
    var dragOffset = CGVector.zero
    var gravityOn = true
    var grounded = false

    var sqX: CGFloat = 1, sqY: CGFloat = 1, sqVX: CGFloat = 0, sqVY: CGFloat = 0
    var spin: CGFloat = 0, spinVel: CGFloat = 0
    var coreSpin: CGFloat = 0
    var midSpin: CGFloat = 0
    var arcSpin: CGFloat = 0
    var theme = OrbTheme.saved
    var hidden = false
    let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    var hover: CGFloat = 0
    var dirVec = CGVector(dx: 1, dy: 0)
    var stretchAmt: CGFloat = 0
    var motion: CGFloat = 0
    var breathPhase: Double = 0

    // 互動狀態
    var now: Double = CACurrentMediaTime()
    var lastMouse = CGPoint.zero
    var gaze = CGVector.zero            // 內核看向的偏移
    var rubEnergy: CGFloat = 0
    var happy: CGFloat = 0              // 被撫摸的開心程度 0…1
    var dizzyUntil: Double = 0
    var lastInteraction: Double = CACurrentMediaTime()
    var nextIdleAction: Double = 0
    var idleLook = CGVector.zero
    var idleLookUntil: Double = 0
    var asleep = false
    var sleepAmt: CGFloat = 0
    var heat: CGFloat = 0

    // 番茄鐘
    var pomoEnd: Double?
    var pomoDuration: Double = 1
    var pomoIsBreak = false
    var alarmUntil: Double = 0
    var alarmWasBreak = false
    var nextAlarmHop: Double = 0
    var hopSide: CGFloat = 1
    // 剪貼簿反應
    var clipCount = NSPasteboard.general.changeCount
    var clipFlashAt: Double = 0       // 碎片飛到中心的時間點
    var clipPulse: CGFloat = 0        // 閃光強度 0…1
    var clipboardOn: Bool = UserDefaults.standard.object(forKey: "clipboardReact") as? Bool ?? true
    var firstCelebrateHop = false
    var apexBurstCount = 0
    var apexBurstAt: Double = 0

    var lastTime = CACurrentMediaTime()
    var timer: Timer?
    var displayLink: CADisplayLink?

    var radius: CGFloat { Cfg.orbDiameter * Cfg.collisionScale }

    override init() {
        let sf = (NSScreen.main ?? NSScreen.screens[0]).frame
        window = NSPanel(contentRect: sf,
                         styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        view = OrbView(frame: NSRect(origin: .zero, size: sf.size))
        super.init()

        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = false
        window.level = NSWindow.Level(rawValue: NSWindow.Level.floating.rawValue + 1)
        window.hidesOnDeactivate = false
        window.isMovable = false
        window.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
        window.contentView = view
        view.apply(theme)
        trail.apply(theme)
        setupStatusItem()

        view.onMouseDown = { [weak self] e in self?.beginDrag(e) }
        view.onMouseUp = { [weak self] _ in self?.endDrag() }
        view.onRightClick = { [weak self] e in self?.showMenu(e) }

        let vf = (NSScreen.main ?? NSScreen.screens[0]).visibleFrame
        pos = CGPoint(x: vf.midX + vf.width * 0.3, y: vf.maxY - radius)
        lastMouse = NSEvent.mouseLocation
        applyWindowPosition()
        window.orderFrontRegardless()

        // 與螢幕刷新同步的動畫迴圈（避免 Timer 造成的卡頓）
        let link = view.displayLink(target: self, selector: #selector(frameTick(_:)))
        link.add(to: .main, forMode: .common)
        displayLink = link
        // 低頻計時：選單列倒數、隱藏時檢查番茄鐘
        let t = Timer(timeInterval: 0.25, repeats: true) { [weak self] _ in self?.slowTick() }
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }

    // MARK: 滑鼠

    func beginDrag(_ e: NSEvent) {
        noteInteraction()
        // 番茄鐘計時中：鎖定，不能拖動或雙擊（右鍵選單仍可用來停止計時）
        if pomoEnd != nil {
            sqVX += 1.2; sqVY -= 1.2   // 輕輕一縮，表示目前鎖定
            return
        }
        if e.clickCount >= 2 { poke(); return }
        let m = NSEvent.mouseLocation
        dragging = true
        grounded = false
        dragOffset = CGVector(dx: pos.x - m.x, dy: pos.y - m.y)
        NSCursor.closedHand.push()
    }

    func endDrag() {
        guard dragging else { return }
        dragging = false
        vel.dx *= Cfg.throwScale
        vel.dy *= Cfg.throwScale
        NSCursor.pop()
    }

    func poke() {
        sqVX -= 4; sqVY += 4
        if gravityOn { vel.dy += 900; grounded = false }
        spinVel += CGFloat.random(in: -2.5...2.5)
    }

    /// 跳起來後，等到最高點（開始往下掉）才爆碎片
    func queueApexBurst(_ count: Int) {
        apexBurstCount = count
        apexBurstAt = now
    }

    func checkApexBurst() {
        guard apexBurstCount > 0 else { return }
        let rising = gravityOn ? vel.dy > 0 : vel.dy > 40
        if (!rising && now - apexBurstAt > 0.08) || now - apexBurstAt > 0.6 {
            trail.burst(at: pos, count: apexBurstCount, now: now)
            apexBurstCount = 0
        }
    }

    func hop(_ strength: CGFloat = 700) {
        if gravityOn && grounded {
            vel.dy = strength; vel.dx += .random(in: -120...120); grounded = false
            sqVY -= 2.5; sqVX += 2.5
        } else {
            sqVY += 3; sqVX -= 3
            vel.dy += strength * 0.3
        }
    }

    /// 任何「有人理它」的事件：重置閒置計時，睡著就叫醒
    func noteInteraction() {
        lastInteraction = now
        if asleep {
            asleep = false
            hop(650)
            queueApexBurst(14)
        }
    }

    // MARK: 選單

    func showMenu(_ e: NSEvent) {
        noteInteraction()
        NSMenu.popUpContextMenu(buildMenu(), with: e, for: view)
    }

    /// 右鍵選單與選單列「J.」共用
    func buildMenu() -> NSMenu {
        let menu = NSMenu()
        func item(_ title: String, _ sel: Selector?, on: Bool = false) {
            let it = NSMenuItem(title: title, action: sel, keyEquivalent: "")
            it.target = self
            it.state = on ? .on : .off
            if sel == nil { it.isEnabled = false }
            menu.addItem(it)
        }
        item(hidden ? "顯示光球" : "隱藏光球", #selector(toggleHidden))
        menu.addItem(.separator())
        if let end = pomoEnd {
            item("\(pomoIsBreak ? "休息" : "專注")中・剩餘 \(fmt(end - now))", nil)
            item("停止番茄鐘", #selector(stopPomodoro))
        } else {
            item("開始專注 \(Int(Behave.focusMinutes)) 分鐘", #selector(startFocus))
            item("開始休息 \(Int(Behave.breakMinutes)) 分鐘", #selector(startBreak))
        }
        menu.addItem(.separator())
        item("CPU \(Int(sys.cpu * 100))%・電量 \(Int(sys.batteryPercent * 100))%\(sys.onAC ? "（充電中）" : "")", nil)
        menu.addItem(.separator())
        let colorItem = NSMenuItem(title: "顏色", action: nil, keyEquivalent: "")
        let sub = NSMenu()
        for t in OrbTheme.allCases {
            let it = NSMenuItem(title: t.title, action: #selector(pickTheme(_:)), keyEquivalent: "")
            it.target = self
            it.representedObject = t.rawValue
            it.state = t == theme ? .on : .off
            sub.addItem(it)
        }
        colorItem.submenu = sub
        menu.addItem(colorItem)
        item("剪貼簿反應", #selector(toggleClipboard), on: clipboardOn)
        item("重力", #selector(toggleGravity), on: gravityOn)
        item("回到螢幕中央", #selector(recenter))
        menu.addItem(.separator())
        item("退出", #selector(quit))
        return menu
    }

    // MARK: 選單列圖示「J.」

    func setupStatusItem() {
        statusItem.button?.title = "J."
        statusItem.button?.font = NSFont.menuBarFont(ofSize: 0)
        let m = NSMenu()
        m.delegate = self
        statusItem.menu = m
    }

    /// 選單列顯示：計時中顯示剩餘時間
    func updateStatusTitle() {
        let title = pomoEnd.map { "J. " + fmt($0 - now) } ?? "J."
        if statusItem.button?.title != title {
            statusItem.button?.font = pomoEnd == nil ? NSFont.menuBarFont(ofSize: 0)
                : NSFont.monospacedDigitSystemFont(ofSize: NSFont.systemFontSize, weight: .regular)
            statusItem.button?.title = title
        }
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        for it in buildMenu().items {
            it.menu?.removeItem(it)
            menu.addItem(it)
        }
    }

    @objc func toggleHidden() { setHidden(!hidden) }

    /// 複製東西：碎片從四周吸進來 → 到達時光球「吞」一下並閃光
    func onClipboard() {
        trail.absorb(to: pos, count: 18)
        clipFlashAt = now + 0.52
    }

    func updateClipboardFlash(_ dt: CGFloat) {
        if clipFlashAt > 0 && now >= clipFlashAt {
            clipFlashAt = 0
            clipPulse = 1
            sqVX -= 3.2; sqVY -= 3.2      // 吞下去：先縮一下再彈回
        }
        clipPulse *= exp(-2.2 * dt)
    }

    @objc func toggleClipboard() {
        clipboardOn.toggle()
        UserDefaults.standard.set(clipboardOn, forKey: "clipboardReact")
    }

    func setHidden(_ h: Bool) {
        guard h != hidden else { return }
        hidden = h
        if h {
            endDrag()
            window.orderOut(nil)
            trail.window.orderOut(nil)
        } else {
            trail.window.orderFrontRegardless()
            window.orderFrontRegardless()
            lastInteraction = now
            hop(500)
        }
    }

    func fmt(_ secs: Double) -> String {
        let s = max(0, Int(secs.rounded(.up)))
        return String(format: "%02d:%02d", s / 60, s % 60)
    }

    @objc func startFocus() { startPomodoro(minutes: Behave.focusMinutes, isBreak: false) }
    @objc func startBreak() { startPomodoro(minutes: Behave.breakMinutes, isBreak: true) }
    func startPomodoro(minutes: Double, isBreak: Bool) {
        pomoDuration = minutes * 60
        pomoEnd = now + pomoDuration
        pomoIsBreak = isBreak
        alarmUntil = 0
        hop(500)
    }
    @objc func stopPomodoro() { pomoEnd = nil; alarmUntil = 0 }
    @objc func pickTheme(_ sender: NSMenuItem) {
        guard let raw = sender.representedObject as? String, let t = OrbTheme(rawValue: raw), t != theme else { return }
        theme = t
        OrbTheme.saved = t
        CATransaction.begin(); CATransaction.setDisableActions(true)
        view.apply(t)
        CATransaction.commit()
        trail.apply(t)
        hop(500)
        queueApexBurst(18)
    }
    @objc func toggleGravity() { gravityOn.toggle(); grounded = false }
    @objc func recenter() {
        let vf = currentScreen().visibleFrame
        pos = CGPoint(x: vf.midX, y: vf.midY); vel = .zero; grounded = false
    }
    @objc func quit() { NSApp.terminate(nil) }

    // MARK: 迴圈

    func currentScreen() -> NSScreen {
        if let s = NSScreen.screens.first(where: { $0.frame.contains(pos) }) { return s }
        let nearest = NSScreen.screens.min { dist(pos, $0.frame) < dist(pos, $1.frame) }
        return nearest ?? NSScreen.screens[0]
    }

    func dist(_ p: CGPoint, _ r: CGRect) -> CGFloat {
        hypot(max(r.minX - p.x, 0, p.x - r.maxX), max(r.minY - p.y, 0, p.y - r.maxY))
    }

    @objc func frameTick(_ link: CADisplayLink) { tick() }

    func slowTick() {
        now = CACurrentMediaTime()
        updateStatusTitle()
        let cc = NSPasteboard.general.changeCount
        if cc != clipCount {
            clipCount = cc
            if clipboardOn && !hidden { onClipboard() }
        }
        if hidden, let end = pomoEnd, now >= end { setHidden(false) }   // 時間到自動出來慶祝
    }

    func tick() {
        now = CACurrentMediaTime()
        let dt = CGFloat(min(now - lastTime, 1.0 / 30.0))
        lastTime = now
        guard dt > 0, !hidden else { return }

        let mouse = NSEvent.mouseLocation
        if dragging && NSEvent.pressedMouseButtons & 1 == 0 { endDrag() }

        if dragging {
            noteInteraction()
            let target = CGPoint(x: mouse.x + dragOffset.dx, y: mouse.y + dragOffset.dy)
            let k = Cfg.dragStiffness
            let c = 2 * sqrt(k) * Cfg.dragDampingRatio
            vel.dx += (k * (target.x - pos.x) - c * vel.dx) * dt
            vel.dy += (k * (target.y - pos.y) - c * vel.dy) * dt
            pos.x += vel.dx * dt
            pos.y += vel.dy * dt
            spinVel += (-vel.dx / radius * Cfg.spinFactor * 0.4 - spinVel) * min(1, 3 * dt)
        } else {
            integrateFree(dt)
        }

        spinVel = max(-Cfg.maxSpin, min(Cfg.maxSpin, spinVel))
        let sp = hypot(vel.dx, vel.dy)
        if sp > Cfg.maxSpeed { vel.dx *= Cfg.maxSpeed / sp; vel.dy *= Cfg.maxSpeed / sp }

        sys.poll(now: now)
        heat += (CGFloat(max(0, min(1, (sys.cpu - 0.25) / 0.6))) - heat) * min(1, 0.6 * dt)

        updateSquash(dt)
        updateHover(mouse, dt)
        updateMood(mouse, dt)
        updatePomodoro()
        checkApexBurst()
        updateClipboardFlash(dt)
        applyWindowPosition()
        render(dt: dt)

        let speed = hypot(vel.dx, vel.dy)
        var rate: Float = ((dragging && speed > 40) || speed > Cfg.trailMinSpeed) ? Float(min(speed / 18, 180)) : 0
        if happy > 0.4 { rate += Float(happy * 10) }   // 被摸得開心時冒碎片
        trail.update(pos: pos, rate: rate, screen: currentScreen().frame, now: now)
        lastMouse = mouse
    }

    func integrateFree(_ dt: CGFloat) {
        let b = currentScreen().visibleFrame
        let r = radius

        if gravityOn && !grounded { vel.dy -= Cfg.gravity * dt }
        if !gravityOn { vel.dy -= 60 * sleepAmt * dt }   // 漂浮模式睡著會慢慢往下沉
        let drag = gravityOn ? Cfg.airDrag : Cfg.floatDrag
        vel.dx *= exp(-drag * dt)
        vel.dy *= exp(-drag * dt)
        if grounded { vel.dx *= exp(-Cfg.groundFriction * dt) }

        pos.x += vel.dx * dt
        pos.y += vel.dy * dt

        if pos.x - r < b.minX {
            pos.x = b.minX + r
            if vel.dx < 0 { impact(speed: -vel.dx, horizontal: true, at: CGPoint(x: b.minX, y: pos.y)); vel.dx = -vel.dx * Cfg.wallRestitution }
        } else if pos.x + r > b.maxX {
            pos.x = b.maxX - r
            if vel.dx > 0 { impact(speed: vel.dx, horizontal: true, at: CGPoint(x: b.maxX, y: pos.y)); vel.dx = -vel.dx * Cfg.wallRestitution }
        }
        if pos.y + r > b.maxY {
            pos.y = b.maxY - r
            if vel.dy > 0 { impact(speed: vel.dy, horizontal: false, at: CGPoint(x: pos.x, y: b.maxY)); vel.dy = -vel.dy * Cfg.wallRestitution }
        }
        if pos.y - r < b.minY {
            pos.y = b.minY + r
            if vel.dy < 0 {
                impact(speed: -vel.dy, horizontal: false, at: CGPoint(x: pos.x, y: b.minY))
                vel.dy = -vel.dy * (gravityOn ? Cfg.floorRestitution : Cfg.wallRestitution)
                if gravityOn && vel.dy < 90 { vel.dy = 0; grounded = true }
            }
        }
        if grounded && pos.y - r > b.minY + 1 { grounded = false }

        if grounded {
            spinVel += (-vel.dx / r * Cfg.spinFactor - spinVel) * min(1, 10 * dt)
        } else {
            spinVel *= exp(-0.6 * dt)
        }
    }

    func impact(speed: CGFloat, horizontal: Bool, at contact: CGPoint) {
        guard speed > 60 else { return }
        let imp = min(speed / 3800, 0.4) * 12
        if horizontal { sqVX -= imp; sqVY += imp * 0.8 }
        else { sqVY -= imp; sqVX += imp * 0.8 }
        // 用力撞 → 爆碎片 + 頭暈
        if speed > Behave.dizzySpeed {
            dizzyUntil = now + Behave.dizzyDuration
            trail.burst(at: contact, count: Int(min(40, speed / 80)), now: now)
        } else if speed > 300 {
            trail.burst(at: contact, count: Int(min(9, 2 + speed / 300)), now: now)
        }
    }

    func updateSquash(_ dt: CGFloat) {
        let k: CGFloat = 380, c: CGFloat = 13
        let steps = 2
        let h = dt / CGFloat(steps)
        for _ in 0..<steps {
            sqVX += (-k * (sqX - 1) - c * sqVX) * h
            sqVY += (-k * (sqY - 1) - c * sqVY) * h
            sqX += sqVX * h
            sqY += sqVY * h
        }
        sqX = max(0.6, min(1.4, sqX))
        sqY = max(0.6, min(1.4, sqY))

        let sp = hypot(vel.dx, vel.dy)
        let target: CGFloat
        if dragging { target = Cfg.dragStretchMax * min(1, sp / Cfg.dragStretchSpeed) }
        else if grounded { target = 0 }
        else { target = min(sp / 9000, Cfg.flyStretchMax) }
        stretchAmt += (target - stretchAmt) * min(1, 14 * dt)

        if sp > 20 {
            let w = min(1, 16 * dt)
            dirVec.dx += (vel.dx / sp - dirVec.dx) * w
            dirVec.dy += (vel.dy / sp - dirVec.dy) * w
            let l = hypot(dirVec.dx, dirVec.dy)
            if l > 0.001 { dirVec.dx /= l; dirVec.dy /= l }
        }
    }

    func updateHover(_ mouse: CGPoint, _ dt: CGFloat) {
        let inside = hypot(mouse.x - pos.x, mouse.y - pos.y) <= Cfg.orbDiameter * 0.5
        let ignore = !(inside || dragging)
        if window.ignoresMouseEvents != ignore { window.ignoresMouseEvents = ignore }
        let target: CGFloat = (inside || dragging) ? 1 : 0
        hover += (target - hover) * min(1, 8 * dt)
    }

    /// 看滑鼠、撫摸、閒置、睡覺
    func updateMood(_ mouse: CGPoint, _ dt: CGFloat) {
        let d = Cfg.orbDiameter
        let dx = mouse.x - pos.x, dy = mouse.y - pos.y
        let dm = hypot(dx, dy)
        if dm < Behave.wakeDistance { noteInteraction() }

        // 撫摸：滑鼠在球上（沒按鍵）來回移動累積能量
        if dm <= d * 0.5 && !dragging && NSEvent.pressedMouseButtons == 0 {
            rubEnergy += hypot(mouse.x - lastMouse.x, mouse.y - lastMouse.y) / d * 0.5
        }
        rubEnergy = min(4, rubEnergy * exp(-1.2 * dt))
        let happyTarget = max(0, min(1, (rubEnergy - 0.6) / 1.2))
        happy += (happyTarget - happy) * min(1, (happyTarget > happy ? 4 : 1.2) * dt)

        // 閒置 → 自己玩 → 睡著
        let idle = now - lastInteraction
        let timing = pomoEnd != nil   // 計時中保持安靜：不睡、不自己跳、不轉頭，數字才穩
        if !asleep && !timing && idle > Behave.sleepAfter && alarmUntil < now { asleep = true }
        sleepAmt += ((asleep ? 1 : 0) - sleepAmt) * min(1, (asleep ? 0.6 : 3) * dt)
        if !asleep && !timing && !dragging && idle > Behave.idleAfter && now > nextIdleAction && now > dizzyUntil {
            nextIdleAction = now + .random(in: 6...14)
            // 只東張西望，不跳不滾，位置保持不動
            let ang = CGFloat.random(in: 0..<(2 * .pi))
            idleLook = CGVector(dx: cos(ang) * d * 0.11, dy: sin(ang) * d * 0.11)
            idleLookUntil = now + .random(in: 1.2...2.6)
        }

        // 看滑鼠（或閒置時東張西望）
        var g = (now < idleLookUntil && !timing) ? idleLook : .zero
        if !dragging && dm > d * 0.5 && dm < Behave.gazeRange && sleepAmt < 0.5 {
            let k = d * 0.11 * min(1, (Behave.gazeRange - dm) / 150)
            g = CGVector(dx: dx / dm * k, dy: dy / dm * k)
        }
        if sleepAmt > 0.5 { g = .zero }
        gaze.dx += (g.dx - gaze.dx) * min(1, 6 * dt)
        gaze.dy += (g.dy - gaze.dy) * min(1, 6 * dt)
    }

    func updatePomodoro() {
        if let end = pomoEnd, now >= end {
            pomoEnd = nil
            alarmWasBreak = pomoIsBreak
            alarmUntil = now + Behave.celebrateSeconds
            nextAlarmHop = now
            NSSound(named: "Glass")?.play()
            firstCelebrateHop = true
        }
        // 雀躍：左右蹦跳、轉圈、開心發亮、一路灑碎片
        if now < alarmUntil {
            lastInteraction = now
            if asleep { asleep = false }
            rubEnergy = 4
            if now >= nextAlarmHop {
                nextAlarmHop = now + 0.55
                hopSide = -hopSide
                if gravityOn && grounded {
                    vel.dy = .random(in: 700...900)
                    vel.dx = hopSide * .random(in: 180...280)
                    grounded = false
                    sqVY -= 3; sqVX += 3
                } else {
                    vel.dx += hopSide * 200; vel.dy += 300
                    sqVY += 3; sqVX -= 3
                }
                spinVel += hopSide * 3
                // 先跳，跳到最高點才爆碎片；第一跳爆得最大
                queueApexBurst(firstCelebrateHop ? 34 : 14)
                firstCelebrateHop = false
            }
        }
    }

    /// 視窗固定覆蓋整個螢幕，只移動光球圖層；換螢幕時才移動視窗
    func applyWindowPosition() {
        let sf = currentScreen().frame
        if window.frame != sf { window.setFrame(sf, display: false) }
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        view.orbRoot.position = CGPoint(x: pos.x - sf.minX, y: pos.y - sf.minY)
        CATransaction.commit()
    }

    /// 呼吸曲線：吸氣 40% → 呼氣 50% → 停頓 10%，回傳 0...1
    func breath(_ phase: Double) -> CGFloat {
        let p = phase.truncatingRemainder(dividingBy: 1)
        func ease(_ x: Double) -> Double { 0.5 - 0.5 * cos(.pi * x) }
        let v: Double
        if p < 0.4 { v = ease(p / 0.4) }
        else if p < 0.9 { v = 1 - ease((p - 0.4) / 0.5) }
        else { v = 0 }
        return CGFloat(v)
    }

    func render(dt: CGFloat) {
        let d = Cfg.orbDiameter
        let dizzy = CGFloat(max(0, min(1, (dizzyUntil - now) / 0.8)))

        // 呼吸節奏：CPU 忙、開心時變快；睡覺、低電量時變慢
        var period = Cfg.breathPeriod / Double(1 + 1.2 * heat + 1.5 * happy)
        period *= Double(1 + 0.8 * sleepAmt)
        if sys.lowBattery { period *= 1.3 }
        breathPhase += Double(dt) / period
        let b = breath(breathPhase)
        let amp = Cfg.breathAmplitude * (1 - 0.5 * happy)
        let breathScale = 1 - amp + 2 * amp * b + hover * 0.03 + happy * 0.04 + clipPulse * 0.06

        // 形變矩陣 = R(θ)·diag(1+e, 1/(1+e))·R(-θ) · diag(sx, sy)
        let e = stretchAmt
        let co = dirVec.dx, si = dirVec.dy
        let a = 1 + e, bb = 1 / (1 + e)
        let m00 = a * co * co + bb * si * si
        let m01 = (a - bb) * co * si
        let m11 = a * si * si + bb * co * co
        let purr = happy * 0.02 * CGFloat(sin(now * 38))      // 開心時微微顫動
        let flatY = 1 - 0.08 * sleepAmt, flatX = 1 + 0.05 * sleepAmt  // 睡覺時攤扁
        let sx = sqX * breathScale * (1 + purr) * flatX
        let sy = sqY * breathScale * (1 - purr) * flatY

        var ty: CGFloat = 0
        if pos.y - radius < currentScreen().visibleFrame.minY + 2 { ty = (sqY * flatY - 1) * d * 0.5 }

        let lead = e * d * 0.18
        let mid = CGPoint(x: d / 2, y: d / 2)
        let coreOff = e * d * Cfg.coreLead
        let glowOff = -e * d * 0.22

        let moveTarget: CGFloat = (grounded && !dragging) ? 0 : min(1, hypot(vel.dx, vel.dy) / 500)
        motion += (moveTarget - motion) * min(1, 10 * dt)

        let rateScale = 1 - 0.7 * sleepAmt
        let per = theme.spinPeriods
        func rate(_ p: Double) -> CGFloat { p == 0 ? 0 : CGFloat(2 * Double.pi / p) }
        spin += (spinVel + rate(per.shell) * rateScale) * dt
        midSpin += (rate(per.mid) * rateScale - spinVel * 0.3) * dt
        coreSpin += (rate(per.core) * rateScale - dizzy * 14) * dt   // 只有撞暈時會轉

        // 頭暈：內核繞圈晃
        let wobX = CGFloat(cos(now * 9)) * d * 0.08 * dizzy
        let wobY = CGFloat(sin(now * 11)) * d * 0.08 * dizzy
        let dim: CGFloat = (1 - 0.4 * sleepAmt) * (sys.lowBattery ? 0.65 : 1)

        CATransaction.begin()
        CATransaction.setDisableActions(true)
        view.bodyLayer.setAffineTransform(CGAffineTransform(a: m00 * sx, b: m01 * sx, c: m01 * sy, d: m11 * sy,
                                                            tx: co * lead, ty: ty + si * lead))
        view.bodyLayer.opacity = Float(dim)
        view.shellLayer.setAffineTransform(CGAffineTransform(rotationAngle: spin + dizzy * 0.15 * CGFloat(sin(now * 13))))
        let par = view.armLayers.isEmpty ? gaze : .zero   // 有光絲時整顆球不位移，只伸光絲
        view.shellLayer.position = CGPoint(x: mid.x + par.dx * 0.35, y: mid.y + par.dy * 0.35)
        view.midLayer.setAffineTransform(CGAffineTransform(rotationAngle: midSpin))
        view.midLayer.position = CGPoint(x: mid.x + par.dx * 0.65, y: mid.y + par.dy * 0.65)
        view.midLayer.opacity = Float(0.85 + 0.15 * b)
        let coreScale = theme.coreSize * (0.92 + 0.14 * b) * (1 - 0.12 * sleepAmt) * (1 + 0.1 * happy)
        view.coreLayer.setAffineTransform(CGAffineTransform(rotationAngle: coreSpin).scaledBy(x: coreScale, y: coreScale))
        // 有光絲的主題：中心固定，朝滑鼠方向的光絲伸長；沒有光絲的主題：整個內核偏向滑鼠
        // 光暈聚集（橙色）：中心與光絲不動，光暈與小亮點往滑鼠方向偏；藍色沒有這些層 → 整個內核偏向滑鼠
        let hasArms = !view.armLayers.isEmpty
        let reach = min(1, hypot(gaze.dx, gaze.dy) / (d * 0.11))
        let gLocal = atan2(gaze.dy, gaze.dx) - coreSpin          // 換到內核自身座標（撞暈時內核會轉）
        let gv = CGVector(dx: cos(gLocal) * reach, dy: sin(gLocal) * reach)
        let cb = view.coreLayer.bounds, cc = CGPoint(x: cb.midX, y: cb.midY), rpt = cb.width * 0.44
        view.coreGlowLayer.position = CGPoint(x: cc.x + gv.dx * rpt * Behave.glowShift,
                                              y: cc.y + gv.dy * rpt * Behave.glowShift)
        for dl in view.dotLayers {
            // 每顆各自：方向稍微偏開、力道不同、跟上速度不同，再加一點獨立漂浮
            let r = hypot(dl.p.x, dl.p.y)
            let cs = cos(dl.skew), sn = sin(dl.skew)
            let k = r * Behave.dotGather * dl.pull
            let tx = (gv.dx * cs - gv.dy * sn) * k, ty = (gv.dx * sn + gv.dy * cs) * k
            let w = min(1, dl.speed * dt)
            dl.off.dx += (tx - dl.off.dx) * w
            dl.off.dy += (ty - dl.off.dy) * w
            let driftX = CGFloat(sin(now * dl.f1 + dl.ph1)) * 0.018
            let driftY = CGFloat(cos(now * dl.f2 + dl.ph2)) * 0.018
            dl.layer.position = CGPoint(x: cc.x + (dl.p.x + dl.off.dx + driftX) * rpt,
                                        y: cc.y + (dl.p.y + dl.off.dy + driftY) * rpt)
            dl.layer.opacity = Float(min(1, dl.alpha * gatherDot(dl.p, gv).gain))
        }
        let gz = hasArms ? CGVector.zero : gaze
        view.coreLayer.position = CGPoint(x: mid.x + co * coreOff + gz.dx + wobX,
                                          y: mid.y + si * coreOff + gz.dy + wobY)
        if !hasArms {
            // 藍色：準星跟著滑鼠，但中心光暈抵銷這個偏移 → 光暈固定在中間
            let cr = cos(-coreSpin), sr = sin(-coreSpin)
            let lx = (gz.dx * cr - gz.dy * sr) / coreScale, ly = (gz.dx * sr + gz.dy * cr) / coreScale
            view.coreGlowLayer.position = CGPoint(x: cc.x - lx, y: cc.y - ly)
        }
        arcSpin += CGFloat(2 * Double.pi / Behave.innerArcPeriod) * rateScale * dt
        view.coreSpinLayer.setAffineTransform(CGAffineTransform(rotationAngle: arcSpin))
        view.glowLayer.position = CGPoint(x: mid.x + co * glowOff, y: mid.y + si * glowOff)
        view.glowLayer.opacity = Float((0.45 + 0.45 * b + 0.25 * hover + 0.45 * happy) * (1 - 0.9 * motion) * (1 - 0.5 * sleepAmt) + 0.8 * clipPulse)
        view.shellLayer.opacity = Float(0.85 + 0.15 * b)
        view.heatLayer.opacity = Float(heat * 0.6)
        view.coreLayer.opacity = Float(min(1, 0.75 + 0.25 * b + 0.2 * e + 0.2 * happy + 0.4 * clipPulse))

        view.sleepEmitter.birthRate = sleepAmt > 0.6 ? 1 : 0
        let c = CGPoint(x: Cfg.windowSize / 2, y: Cfg.windowSize / 2)

        view.timerGroup.setAffineTransform(CGAffineTransform(translationX: co * lead, y: ty + si * lead))
        view.brandLabel.setAffineTransform(CGAffineTransform(translationX: co * lead, y: ty + si * lead))
        // 只在藍色主題、且沒有倒計時佔用中央時顯示
        view.brandLabel.opacity = (theme == .blue && pomoEnd == nil) ? Float(0.95 - 0.4 * sleepAmt) : 0
        renderPomodoro(center: c)
        CATransaction.commit()
    }

    func renderPomodoro(center: CGPoint) {
        if let end = pomoEnd {
            let text = fmt(max(0, end - now))
            if text != view.lastTimerText {
                view.lastTimerText = text
                if Behave.timerFont == "segment" {
                    let h = Behave.timerFontSize * 0.95
                    let p = segmentPaths(text, height: h)
                    let tf = CGAffineTransform(translationX: center.x - p.width / 2, y: center.y - h / 2)
                    view.segLit.path = p.lit.copy(using: [tf])
                    view.segGhost.path = p.all.copy(using: [tf])
                } else {
                    view.label.string = text
                }
            }
            view.timerGroup.opacity = Float(1 - 0.6 * sleepAmt)
        } else {
            view.timerGroup.opacity = 0
        }
    }
}

// MARK: - 入口

// 除錯用：輸出光球圖片  OrbPet --export out.png
let args = CommandLine.arguments
if args.count >= 3 && args[1] == "--export" {
    let t = args.count >= 4 ? (OrbTheme(rawValue: args[3]) ?? .orange) : .orange
    let n = 512
    let ctx = makeContext(n)
    ctx.setFillColor(CGColor(red: 0.04, green: 0.03, blue: 0.03, alpha: 1))
    ctx.setBlendMode(.normal)
    ctx.fill(CGRect(x: 0, y: 0, width: n, height: n))
    ctx.setBlendMode(.plusLighter)
    for img in [t.art.shell, t.art.mid, t.art.coreGlow, t.art.core, t.art.coreSpinner].compactMap({ $0 }) {
        ctx.draw(img, in: CGRect(x: 0, y: 0, width: n, height: n))
    }
    let rep = NSBitmapImageRep(cgImage: ctx.makeImage()!)
    try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: args[2]))
    print("exported"); exit(0)
}

// 除錯用：光暈聚集效果  OrbPet --export-gather out.png 角度(度)
if args.count == 4 && args[1] == "--export-gather" {
    let n = 512, g = CGFloat(Double(args[3]) ?? 45) * .pi / 180
    let ctx = makeContext(n)
    ctx.setBlendMode(.normal)
    ctx.setFillColor(CGColor(red: 0.04, green: 0.03, blue: 0.03, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: n, height: n))
    ctx.setBlendMode(.plusLighter)
    let parts = drawCoreParts(n), r = CGRect(x: 0, y: 0, width: n, height: n), R = CGFloat(n) * 0.44
    let gv = CGVector(dx: cos(g), dy: sin(g))
    ctx.draw(parts.glow, in: r.offsetBy(dx: gv.dx * R * Behave.glowShift, dy: gv.dy * R * Behave.glowShift))
    ctx.draw(parts.base, in: r)
    for a in parts.arms { ctx.draw(a.image, in: r) }
    drawDots(ctx, parts.dots, n: n, shift: gv)
    let c = CGFloat(n) / 2
    ctx.setStrokeColor(CGColor(red: 0.3, green: 0.8, blue: 1, alpha: 1)); ctx.setLineWidth(3)
    ctx.move(to: CGPoint(x: c + cos(g) * 220, y: c + sin(g) * 220)); ctx.addLine(to: CGPoint(x: c + cos(g) * 250, y: c + sin(g) * 250)); ctx.strokePath()
    let rep = NSBitmapImageRep(cgImage: ctx.makeImage()!)
    try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: args[2]))
    print("exported"); exit(0)
}

// 除錯用：直接把光球圖層畫成圖片  OrbPet --snapshot out.png orange|blue
if args.count == 4 && args[1] == "--snapshot" {
    let t = OrbTheme(rawValue: args[3]) ?? .blue
    let v = OrbView(frame: NSRect(x: 0, y: 0, width: Cfg.windowSize, height: Cfg.windowSize))
    v.apply(t)
    v.orbRoot.position = CGPoint(x: Cfg.windowSize / 2, y: Cfg.windowSize / 2)
    v.glowLayer.opacity = 0.8
    v.brandLabel.opacity = t == .blue ? 0.95 : 0
    let px = Int(Cfg.windowSize * 3)
    let ctx = CGContext(data: nil, width: px, height: px, bitsPerComponent: 8, bytesPerRow: px * 4,
                        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.setFillColor(CGColor(red: 0.05, green: 0.06, blue: 0.08, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: px, height: px))
    ctx.scaleBy(x: 3, y: 3)
    v.orbRoot.render(in: ctx)
    let rep = NSBitmapImageRep(cgImage: ctx.makeImage()!)
    try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: args[2]))
    print("exported"); exit(0)
}

// 字體預覽：OrbPet --font-preview out.png
let fontChoices: [(key: String, name: String)] = [
    ("segment", "七段數碼管（自繪）"), ("mono", "SF Mono"), ("DINCondensed-Bold", "DIN Condensed"),
    ("DINAlternate-Bold", "DIN Alternate"), ("Menlo-Bold", "Menlo"), ("AndaleMono", "Andale Mono"),
    ("Krungthep", "Krungthep"), ("Silom", "Silom")]
if args.count == 3 && args[1] == "--font-preview" {
    let cols = 4, rows = 2, tw: CGFloat = 230, th: CGFloat = 230, sc: CGFloat = 2
    let W = Int(CGFloat(cols) * tw * sc), H = Int(CGFloat(rows) * th * sc)
    let ctx = CGContext(data: nil, width: W, height: H, bitsPerComponent: 8, bytesPerRow: W * 4,
                        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.scaleBy(x: sc, y: sc)
    NSGraphicsContext.current = NSGraphicsContext(cgContext: ctx, flipped: false)
    ctx.setFillColor(CGColor(red: 0.95, green: 0.95, blue: 0.96, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: CGFloat(cols) * tw, height: CGFloat(rows) * th))
    let shell = drawShell(), core = drawCore()
    let orb: CGFloat = 150, fsize = Behave.timerFontSize * 150 / Cfg.orbDiameter
    for (i, fc) in fontChoices.enumerated() {
        let x = CGFloat(i % cols) * tw, y = CGFloat(rows - 1 - i / cols) * th
        let c = CGPoint(x: x + tw / 2, y: y + th / 2 + 14)
        let r = CGRect(x: c.x - orb * 0.55, y: c.y - orb * 0.55, width: orb * 1.1, height: orb * 1.1)
        ctx.draw(shell, in: r); ctx.draw(core, in: r)
        if fc.key == "segment" {
            let h = fsize * 0.95
            let p = segmentPaths("24:59", height: h)
            ctx.saveGState()
            ctx.translateBy(x: c.x - p.width / 2, y: c.y - h / 2)
            ctx.addPath(p.all); ctx.setFillColor(Behave.timerColor.copy(alpha: 0.12)!); ctx.fillPath()
            ctx.setShadow(offset: .zero, blur: 2.5 * 150 / Cfg.orbDiameter, color: Behave.timerOutline)
            ctx.beginTransparencyLayer(auxiliaryInfo: nil)
            ctx.addPath(p.lit); ctx.setFillColor(Behave.timerColor); ctx.fillPath()
            ctx.addPath(p.lit); ctx.fillPath()
            ctx.endTransparencyLayer()
            ctx.restoreGState()
        } else {
        let font = makeTimerFont(fc.key, size: fsize)
        let sh = NSShadow(); sh.shadowColor = NSColor(red: 0.35, green: 0.1, blue: 0, alpha: 0.95); sh.shadowBlurRadius = 4
        let t = NSAttributedString(string: "24:59", attributes: [.font: font, .foregroundColor: NSColor.white, .shadow: sh])
        let ts = t.size()
        t.draw(at: CGPoint(x: c.x - ts.width / 2, y: c.y - ts.height / 2))
        }
        let cap = NSAttributedString(string: "\(i + 1). \(fc.name)", attributes: [
            .font: NSFont.systemFont(ofSize: 13, weight: .medium), .foregroundColor: NSColor(white: 0.2, alpha: 1)])
        cap.draw(at: CGPoint(x: x + tw / 2 - cap.size().width / 2, y: y + 12))
    }
    let rep = NSBitmapImageRep(cgImage: ctx.makeImage()!)
    try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: args[2]))
    print("exported"); exit(0)
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    var pet: Pet?
    func applicationDidFinishLaunching(_ notification: Notification) { pet = Pet() }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let delegate = AppDelegate()
app.delegate = delegate
app.run()
