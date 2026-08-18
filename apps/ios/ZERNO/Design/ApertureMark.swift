import SwiftUI

/// Логотип ЗЕРНО: шесть лепестков диафрагмы вокруг тёплого светового ядра.
/// Геометрия считается, а не берётся из ассета, — знак чист на любом размере.
struct ApertureMark: View {
    /// 0 — диафрагма закрыта и повёрнута, 1 — раскрыта.
    var open: CGFloat = 1
    var showsBody = true

    private let bladeCount = 6

    var body: some View {
        GeometryReader { geo in
            let side = min(geo.size.width, geo.size.height)
            let c = CGPoint(x: geo.size.width / 2, y: geo.size.height / 2)
            let bodyR = side / 2
            let bowlR = bodyR * 0.895
            let inner = bowlR * (0.24 + 0.26 * open)

            ZStack {
                if showsBody {
                    Circle()
                        .fill(LinearGradient(colors: [Color(red: 0.18, green: 0.16, blue: 0.14),
                                                      Color(red: 0.047, green: 0.043, blue: 0.039)],
                                             startPoint: .top, endPoint: .bottom))
                    Circle()
                        .fill(RadialGradient(colors: [Color(red: 0.10, green: 0.09, blue: 0.078),
                                                      Color(red: 0.031, green: 0.027, blue: 0.027)],
                                             center: .center, startRadius: 0, endRadius: bowlR))
                        .padding(side * 0.052)
                }

                // ядро света
                AperturePolygon(sides: bladeCount, radius: inner, center: c)
                    .fill(RadialGradient(colors: [Color(red: 1.0, green: 0.965, blue: 0.878),
                                                  Color(red: 0.718, green: 0.204, blue: 0.078)],
                                         center: .center, startRadius: 0, endRadius: inner * 1.15))
                // гало
                AperturePolygon(sides: bladeCount, radius: inner * 1.08, center: c)
                    .fill(Ink.halation)
                    .blur(radius: inner * 0.35)
                    .blendMode(.screen)
                    .opacity(0.75 * open)

                // лепестки
                ForEach(0..<bladeCount, id: \.self) { i in
                    BladeShape(index: i, count: bladeCount, inner: inner, outer: bowlR * 1.02, center: c)
                        .fill(bladeColor(i))
                }
                .mask(Circle().padding(side * 0.052))

                AperturePolygon(sides: bladeCount, radius: inner, center: c)
                    .stroke(Color(red: 0.078, green: 0.047, blue: 0.031), lineWidth: side * 0.012)

                if showsBody {
                    Circle()
                        .strokeBorder(Ink.paper.opacity(0.18), lineWidth: side * 0.011)
                }
            }
            .rotationEffect(.degrees(-30 * Double(1 - open)))
            .scaleEffect(1 + 0.22 * (1 - open))
        }
        .aspectRatio(1, contentMode: .fit)
    }

    /// Свет из отверстия ложится на лепестки неравномерно.
    private func bladeColor(_ i: Int) -> Color {
        let t = (sin(Double(i) / Double(bladeCount) * 2 * .pi - 1.2) + 1) / 2
        let v = 0.13 + 0.24 * t
        return Color(red: v, green: v * 0.92, blue: v * 0.84)
    }
}

/// Правильный многоугольник — отверстие диафрагмы.
struct AperturePolygon: Shape {
    let sides: Int
    let radius: CGFloat
    let center: CGPoint

    func path(in rect: CGRect) -> Path {
        var p = Path()
        for i in 0..<sides {
            let a: Double = .pi / 2 + Double(i) * 2 * .pi / Double(sides)
            let pt = CGPoint(x: center.x + radius * CGFloat(cos(a)),
                             y: center.y + radius * CGFloat(sin(a)))
            if i == 0 { p.move(to: pt) } else { p.addLine(to: pt) }
        }
        p.closeSubpath()
        return p
    }
}

/// Один лепесток: ребро отверстия, два шва и внешняя дуга.
struct BladeShape: Shape {
    let index: Int
    let count: Int
    let inner: CGFloat
    let outer: CGFloat
    let center: CGPoint

    private func vertex(_ i: Int) -> CGPoint {
        let a: Double = .pi / 2 + Double(i % count) * 2 * .pi / Double(count)
        return CGPoint(x: center.x + inner * CGFloat(cos(a)),
                       y: center.y + inner * CGFloat(sin(a)))
    }

    /// Точка, где шов от вершины упирается во внешнюю окружность.
    private func seamEnd(from a: CGPoint, toward b: CGPoint) -> CGPoint {
        var dx = a.x - b.x, dy = a.y - b.y
        let len = max(sqrt(dx * dx + dy * dy), 0.0001)
        dx /= len; dy /= len
        let ox = a.x - center.x, oy = a.y - center.y
        let bq = ox * dx + oy * dy
        let cq = ox * ox + oy * oy - outer * outer
        let t = -bq + sqrt(max(bq * bq - cq, 0))
        return CGPoint(x: a.x + dx * t, y: a.y + dy * t)
    }

    func path(in rect: CGRect) -> Path {
        let v0 = vertex(index), v1 = vertex(index + 1), v2 = vertex(index + 2)
        let p0 = seamEnd(from: v0, toward: v1)
        let p1 = seamEnd(from: v1, toward: v2)

        var p = Path()
        p.move(to: v0)
        p.addLine(to: p0)
        p.addArc(center: center, radius: outer,
                 startAngle: .radians(atan2(p0.y - center.y, p0.x - center.x)),
                 endAngle: .radians(atan2(p1.y - center.y, p1.x - center.x)),
                 clockwise: false)
        p.addLine(to: v1)
        p.closeSubpath()
        return p
    }
}
