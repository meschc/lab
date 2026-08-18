import SwiftUI

/// Рейка рядом с кадром: перфорация и краевая печать, как на рибейте 35 мм.
struct FilmRail: View {
    let text: String
    var mirrored = false
    var hot = false

    var body: some View {
        ZStack {
            GeometryReader { geo in
                let holeH: CGFloat = 10, gap: CGFloat = 7
                let count = max(1, Int(geo.size.height / (holeH + gap)))
                VStack(spacing: gap) {
                    ForEach(0..<count, id: \.self) { _ in
                        RoundedRectangle(cornerRadius: 2)
                            .fill(Ink.hair)
                            .frame(width: 8, height: holeH)
                    }
                }
                .frame(width: geo.size.width, alignment: mirrored ? .trailing : .leading)
                .opacity(0.55)
                .mask(LinearGradient(stops: [
                    .init(color: .clear, location: 0), .init(color: .black, location: 0.18),
                    .init(color: .black, location: 0.82), .init(color: .clear, location: 1)
                ], startPoint: .top, endPoint: .bottom))
            }
            Text(text)
                .font(Kind.mono(8.5))
                .tracking(1.6)
                .foregroundStyle(hot ? Ink.accent : Ink.text3)
                .fixedSize()
                .rotationEffect(.degrees(mirrored ? -90 : 90))
                .lineLimit(1)
        }
        .frame(width: 26)
    }
}

/// Полоса выбора плёнки с живыми миниатюрами.
struct StockStrip: View {
    @Binding var selection: String
    let thumbnails: [String: UIImage]
    let onSelect: (String) -> Void

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(FilmLibrary.all) { stock in
                        Button {
                            onSelect(stock.id)
                            withAnimation(.spring(response: 0.4, dampingFraction: 0.75)) {
                                proxy.scrollTo(stock.id, anchor: .center)
                            }
                        } label: {
                            chip(stock)
                        }
                        .pressable()
                        .id(stock.id)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 6)
            }
            .onAppear { proxy.scrollTo(selection, anchor: .center) }
        }
    }

    private func chip(_ stock: FilmStock) -> some View {
        let picked = stock.id == selection
        return VStack(spacing: 7) {
            ZStack {
                RoundedRectangle(cornerRadius: 20, style: .continuous).fill(Color.white)
                if let img = thumbnails[stock.id] {
                    Image(uiImage: img)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                }
            }
            .frame(width: 66, height: 66)
            .overlay(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.6), lineWidth: 1))
            .overlay(
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .strokeBorder(Ink.action, lineWidth: picked ? 2.5 : 0)
                    .padding(-4))
            .shadow(color: picked ? Ink.accent.opacity(0.32) : .black.opacity(0.12),
                    radius: picked ? 14 : 8, y: picked ? 6 : 3)

            Text(stock.name)
                .font(Kind.ui(10.5, .semibold))
                .foregroundStyle(picked ? Ink.text : Ink.text3)
        }
        .offset(y: picked ? -6 : 0)
        .animation(.spring(response: 0.35, dampingFraction: 0.6), value: picked)
    }
}

/// Подпись под полосой: имя плёнки, чувствительность, характер.
struct StockCaption: View {
    let stock: FilmStock

    var body: some View {
        HStack(spacing: 8) {
            Text(stock.name)
                .font(Kind.ui(11, .bold))
                .foregroundStyle(Ink.text)
            Circle().fill(Ink.action).frame(width: 4, height: 4)
            Text(stock.subtitle)
                .font(Kind.ui(11, .semibold))
                .foregroundStyle(Ink.text2)
        }
        .tracking(0.7)
        .textCase(.uppercase)
        .padding(.horizontal, 16)
        .frame(height: 30)
        .glass(radius: 15)
        .id(stock.id)
        .transition(.opacity.combined(with: .offset(y: 5)))
    }
}

/// Спуск затвора.
struct ShutterButton: View {
    let action: () -> Void
    @State private var pressed = false

    var body: some View {
        Button(action: action) {
            ZStack {
                Circle()
                    .strokeBorder(
                        AngularGradient(colors: [Ink.pink1, Ink.amber1, Ink.cyan1,
                                                 Ink.blue1, Ink.pink1],
                                        center: .center, angle: .degrees(210)),
                        lineWidth: 2.5)
                    .frame(width: 78, height: 78)
                    .rotationEffect(.degrees(pressed ? 24 : 0))
                    .scaleEffect(pressed ? 1.08 : 1)
                    .saturation(pressed ? 1.4 : 1)
                Circle()
                    .fill(RadialGradient(
                        colors: pressed
                            ? [Color(red: 1, green: 0.85, blue: 0.77), Ink.hot]
                            : [.white, Color(red: 0.949, green: 0.949, blue: 0.965),
                               Color(red: 0.871, green: 0.871, blue: 0.902)],
                        center: UnitPoint(x: 0.38, y: 0.30), startRadius: 2, endRadius: 46))
                    .frame(width: 62, height: 62)
                    .scaleEffect(pressed ? 0.86 : 1)
                    .shadow(color: Color(red: 0.12, green: 0.11, blue: 0.24, opacity: 0.22),
                            radius: 10, y: 5)
            }
            .animation(.easeOut(duration: 0.18), value: pressed)
        }
        .buttonStyle(.plain)
        .simultaneousGesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in pressed = true }
                .onEnded { _ in pressed = false })
    }
}

/// Кнопка палубы: значок и подпись.
struct DeckButton<Icon: View>: View {
    let title: String
    let icon: Icon
    let action: () -> Void

    init(_ title: String, @ViewBuilder icon: () -> Icon, action: @escaping () -> Void) {
        self.title = title
        self.icon = icon()
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            VStack(spacing: 6) {
                icon.frame(width: 26, height: 26)
                Text(title)
                    .font(Kind.mono(9))
                    .tracking(1.3)
                    .textCase(.uppercase)
            }
            .foregroundStyle(Ink.text2)
            .frame(minWidth: 62)
        }
        .pressable(scale: 0.92)
    }
}

/// Всплывающая подсказка.
struct ToastView: View {
    let text: String
    var body: some View {
        Text(text)
            .font(Kind.ui(12.5, .medium))
            .foregroundStyle(Ink.text)
            .padding(.horizontal, 22)
            .padding(.vertical, 12)
            .background(.ultraThinMaterial, in: Capsule())
            .background(Color.white.opacity(0.72), in: Capsule())
            .overlay(Capsule().strokeBorder(Color.white.opacity(0.85), lineWidth: 1))
            .shadow(color: Color(red: 0.12, green: 0.11, blue: 0.24, opacity: 0.18),
                    radius: 20, y: 8)
            .transition(.move(edge: .bottom).combined(with: .opacity))
    }
}

/// Зерно поверх интерфейса — та же эмульсия, что и на кадрах.
/// Текстура готовится один раз и просто ползает: рисовать шум покадрово
/// на весь экран слишком дорого.
struct GrainOverlay: View {
    private static let tile: UIImage = {
        let side = 128
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        format.opaque = true
        return UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: format).image { ctx in
            for y in 0..<side {
                for x in 0..<side {
                    let v = CGFloat.random(in: 0...1)
                    UIColor(white: v, alpha: 1).setFill()
                    ctx.cgContext.fill(CGRect(x: x, y: y, width: 1, height: 1))
                }
            }
        }
    }()

    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.1)) { context in
            let step = Int(context.date.timeIntervalSinceReferenceDate * 10) % 5
            Image(uiImage: Self.tile)
                .resizable(resizingMode: .tile)
                .offset(x: CGFloat(step * 23 % 61), y: CGFloat(step * 41 % 53))
                .blendMode(.multiply)
                .opacity(0.045)
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }
}
