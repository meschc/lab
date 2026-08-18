import UIKit

enum FrameStyle: String, CaseIterable, Identifiable {
    case none, paper, film
    var id: String { rawValue }
    var title: String {
        switch self {
        case .none:  return "Без рамки"
        case .paper: return "Бумага"
        case .film:  return "Плёнка"
        }
    }
}

/// Сборка готового кадра: рамка, перфорация, краевая печать и дата.
enum Compositor {

    struct Options {
        var style: FrameStyle = .none
        var date: Date?
        var edge: String = ""
        var edgeRight: String = ""
    }

    static func compose(_ image: UIImage, options: Options) -> UIImage {
        let iw = image.size.width, ih = image.size.height
        let s = min(iw, ih)

        let canvasSize: CGSize
        switch options.style {
        case .none:  canvasSize = CGSize(width: iw, height: ih)
        case .paper: canvasSize = CGSize(width: iw + s * 0.11, height: ih + s * 0.055 + s * 0.16)
        case .film:  canvasSize = CGSize(width: iw + s * 0.056, height: ih + s * 0.21)
        }

        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        format.opaque = true

        return UIGraphicsImageRenderer(size: canvasSize, format: format).image { ctx in
            let cg = ctx.cgContext
            switch options.style {
            case .none:
                image.draw(at: .zero)
            case .paper:
                drawPaper(image, s: s, size: canvasSize, cg: cg, options: options)
            case .film:
                drawFilm(image, s: s, size: canvasSize, cg: cg, options: options)
            }
            if let date = options.date {
                drawDateStamp(date, in: canvasSize, cg: cg)
            }
        }
    }

    // MARK: - Рамки

    private static func drawPaper(_ image: UIImage, s: CGFloat, size: CGSize,
                                  cg: CGContext, options: Options) {
        let p = s * 0.055
        UIColor(red: 0.953, green: 0.929, blue: 0.882, alpha: 1).setFill()
        cg.fill(CGRect(origin: .zero, size: size))
        image.draw(at: CGPoint(x: p, y: p))
        UIColor(white: 0, alpha: 0.14).setStroke()
        cg.setLineWidth(max(1, s * 0.002))
        cg.stroke(CGRect(x: p, y: p, width: image.size.width, height: image.size.height))

        let attrs: [NSAttributedString.Key: Any] = [
            .font: UIFont.monospacedSystemFont(ofSize: s * 0.042, weight: .medium),
            .foregroundColor: UIColor(red: 0.227, green: 0.196, blue: 0.165, alpha: 1),
            .kern: s * 0.006
        ]
        let text = options.edge as NSString
        let h = text.size(withAttributes: attrs).height
        text.draw(at: CGPoint(x: p, y: p + image.size.height + (s * 0.16 - h) / 2), withAttributes: attrs)
    }

    private static func drawFilm(_ image: UIImage, s: CGFloat, size: CGSize,
                                 cg: CGContext, options: Options) {
        let px = s * 0.028, py = s * 0.105
        UIColor(red: 0.063, green: 0.051, blue: 0.043, alpha: 1).setFill()
        cg.fill(CGRect(origin: .zero, size: size))
        image.draw(at: CGPoint(x: px, y: py))

        // перфорация сверху и снизу
        let hw = s * 0.042, hh = s * 0.030, r = hh * 0.28
        let step = hw * 1.95
        let n = max(1, Int(size.width / step))
        let off = (size.width - (CGFloat(n) * step - (step - hw))) / 2
        UIColor(red: 0.941, green: 0.918, blue: 0.871, alpha: 1).setFill()
        for i in 0..<n {
            let x = off + CGFloat(i) * step
            for y in [py * 0.30 - hh / 2, size.height - py * 0.30 - hh / 2] {
                UIBezierPath(roundedRect: CGRect(x: x, y: y, width: hw, height: hh),
                             cornerRadius: r).fill()
            }
        }

        let attrs: [NSAttributedString.Key: Any] = [
            .font: UIFont.monospacedSystemFont(ofSize: s * 0.028, weight: .medium),
            .foregroundColor: UIColor(red: 0.788, green: 0.541, blue: 0.192, alpha: 1),
            .kern: s * 0.004
        ]
        (options.edge as NSString).draw(at: CGPoint(x: off, y: py * 0.58), withAttributes: attrs)
        (options.edgeRight as NSString).draw(
            at: CGPoint(x: off, y: size.height - py * 0.58 - s * 0.034), withAttributes: attrs)
    }

    // MARK: - Дата семисегментным индикатором

    private static let segments: [Character: [Bool]] = [
        "0": [true, true, true, true, true, true, false],
        "1": [false, true, true, false, false, false, false],
        "2": [true, true, false, true, true, false, true],
        "3": [true, true, true, true, false, false, true],
        "4": [false, true, true, false, false, true, true],
        "5": [true, false, true, true, false, true, true],
        "6": [true, false, true, true, true, true, true],
        "7": [true, true, true, false, false, false, false],
        "8": [true, true, true, true, true, true, true],
        "9": [true, true, true, true, false, true, true],
        " ": [false, false, false, false, false, false, false]
    ]

    private static func drawDigit(_ ch: Character, at o: CGPoint,
                                  w: CGFloat, h: CGFloat, t: CGFloat, cg: CGContext) {
        guard let on = segments[ch] else { return }
        let rects: [CGRect] = [
            CGRect(x: o.x + t, y: o.y, width: w - 2 * t, height: t),
            CGRect(x: o.x + w - t, y: o.y + t, width: t, height: h / 2 - 1.5 * t),
            CGRect(x: o.x + w - t, y: o.y + h / 2 + 0.5 * t, width: t, height: h / 2 - 1.5 * t),
            CGRect(x: o.x + t, y: o.y + h - t, width: w - 2 * t, height: t),
            CGRect(x: o.x, y: o.y + h / 2 + 0.5 * t, width: t, height: h / 2 - 1.5 * t),
            CGRect(x: o.x, y: o.y + t, width: t, height: h / 2 - 1.5 * t),
            CGRect(x: o.x + t, y: o.y + h / 2 - 0.5 * t, width: w - 2 * t, height: t)
        ]
        for (i, lit) in on.enumerated() where lit { cg.fill(rects[i]) }
    }

    private static func drawDateStamp(_ date: Date, in size: CGSize, cg: CGContext) {
        let cal = Calendar.current
        let c = cal.dateComponents([.day, .month, .year], from: date)
        let text = String(format: "%02d %02d %02d",
                          c.day ?? 1, c.month ?? 1, (c.year ?? 2000) % 100)

        let h = max(11, min(size.width, size.height) * 0.034)
        let w = h * 0.58, gap = h * 0.20, t = max(1.4, h * 0.115)
        let total = CGFloat(text.count) * (w + gap) - gap
        let startX = size.width - total - size.width * 0.052
        let y = size.height - h - size.height * 0.048

        cg.saveGState()
        cg.setShadow(offset: .zero, blur: h * 0.9,
                     color: UIColor(red: 1, green: 0.43, blue: 0.12, alpha: 0.95).cgColor)
        UIColor(red: 1, green: 0.541, blue: 0.180, alpha: 1).setFill()
        var x = startX
        for ch in text {
            drawDigit(ch, at: CGPoint(x: x, y: y), w: w, h: h, t: t, cg: cg)
            x += w + gap
        }
        cg.restoreGState()
    }
}
