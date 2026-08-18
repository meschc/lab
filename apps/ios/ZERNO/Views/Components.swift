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
                            .fill(Ink.edge)
                            .frame(width: 8, height: holeH)
                    }
                }
                .frame(width: geo.size.width, alignment: mirrored ? .trailing : .leading)
                .opacity(0.55)
            }
            Text(text)
                .font(Kind.mono(8.5))
                .tracking(1.6)
                .foregroundStyle(hot ? Ink.amber : Ink.amberDim)
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
                RoundedRectangle(cornerRadius: 8).fill(Ink.rebate)
                if let img = thumbnails[stock.id] {
                    Image(uiImage: img)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }
            }
            .frame(width: 66, height: 66)
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .strokeBorder(picked ? Ink.amber : Ink.paper.opacity(0.08),
                                  lineWidth: picked ? 2 : 1))
            .shadow(color: picked ? Ink.amber.opacity(0.28) : .clear, radius: 10, y: 4)

            Text(stock.name)
                .font(Kind.mono(9.5))
                .tracking(0.9)
                .textCase(.uppercase)
                .foregroundStyle(picked ? Ink.amber : Ink.silver)
        }
        .offset(y: picked ? -5 : 0)
        .animation(.spring(response: 0.35, dampingFraction: 0.6), value: picked)
    }
}

/// Подпись под полосой: имя плёнки, чувствительность, характер.
struct StockCaption: View {
    let stock: FilmStock

    var body: some View {
        HStack(spacing: 8) {
            Text(stock.name)
                .font(Kind.mono(10, .semibold))
                .foregroundStyle(Ink.paper)
            Circle().fill(Ink.amberDim).frame(width: 3, height: 3)
            Text(stock.subtitle)
                .font(Kind.mono(10))
                .foregroundStyle(Ink.silver)
        }
        .tracking(1.6)
        .textCase(.uppercase)
        .frame(height: 22)
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
                    .strokeBorder(pressed ? Ink.halation : Ink.paper.opacity(0.30), lineWidth: 2)
                    .frame(width: 74, height: 74)
                    .scaleEffect(pressed ? 1.08 : 1)
                Circle()
                    .fill(RadialGradient(
                        colors: pressed
                            ? [Color(red: 1, green: 0.85, blue: 0.77), Ink.halation]
                            : [Color(red: 1, green: 0.953, blue: 0.894), Ink.paper,
                               Color(red: 0.725, green: 0.686, blue: 0.627)],
                        center: UnitPoint(x: 0.4, y: 0.32), startRadius: 2, endRadius: 44))
                    .frame(width: 60, height: 60)
                    .scaleEffect(pressed ? 0.86 : 1)
                    .shadow(color: .black.opacity(0.55), radius: 8, y: 4)
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
            .foregroundStyle(Ink.silver)
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
            .font(Kind.mono(11))
            .tracking(0.6)
            .foregroundStyle(Ink.paper)
            .padding(.horizontal, 20)
            .padding(.vertical, 11)
            .background(Capsule().fill(Ink.rebate))
            .overlay(Capsule().strokeBorder(Ink.edge, lineWidth: 1))
            .shadow(color: .black.opacity(0.6), radius: 16, y: 8)
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
                .blendMode(.screen)
                .opacity(0.055)
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }
}
