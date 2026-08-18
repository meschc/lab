import SwiftUI

/// Экран проявки: снятый кадр, выбор плёнки и тонкая настройка.
struct DevelopView: View {
    @EnvironmentObject var state: AppState
    @State private var tuning = false
    @State private var developed = false

    var body: some View {
        VStack(spacing: 0) {
            topBar

            HStack(spacing: 6) {
                FilmRail(text: state.stock.edgeText, hot: true)
                    .opacity(tuning ? 0 : 1)
                frame
                FilmRail(text: state.frameNumber, mirrored: true)
                    .opacity(tuning ? 0 : 1)
            }
            .padding(.horizontal, 6)
            .frame(maxHeight: .infinity, alignment: tuning ? .top : .center)

            deck
        }
        .background(Ink.ground)
        .overlay(alignment: .bottom) {
            if tuning {
                TuningSheet(isPresented: $tuning)
                    .transition(.move(edge: .bottom))
            }
        }
        .animation(.timingCurve(0.22, 1, 0.36, 1, duration: 0.42), value: tuning)
        .onAppear {
            developed = false
            withAnimation(.easeOut(duration: 1.1)) { developed = true }
        }
    }

    private var topBar: some View {
        HStack {
            Button {
                state.screen = .shoot
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 18, weight: .regular))
                    .foregroundStyle(Ink.silver)
                    .frame(width: 40, height: 40)
            }
            .pressable(scale: 0.9)
            Spacer()
            Text("Проявка").eyebrow()
            Spacer()
            Button {
                tuning.toggle(); Haptics.tap()
            } label: {
                Image(systemName: "slider.horizontal.3")
                    .font(.system(size: 17, weight: .light))
                    .foregroundStyle(tuning ? Ink.amber : Ink.silver)
                    .frame(width: 40, height: 40)
            }
            .pressable(scale: 0.9)
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 10)
    }

    private var frame: some View {
        Group {
            if let image = state.developed {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    // «проявление»: кадр проступает из темноты, как в ванночке
                    .brightness(developed ? 0 : -0.35)
                    .saturation(developed ? 1 : 0.25)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .shadow(color: .black.opacity(0.75), radius: 26, y: 12)
            } else {
                RoundedRectangle(cornerRadius: 8)
                    .fill(Ink.surface)
                    .aspectRatio(3.0 / 4.0, contentMode: .fit)
                    .overlay(ProgressView().tint(Ink.amber))
            }
        }
        .scaleEffect(tuning ? 0.46 : 1, anchor: .top)
    }

    private var deck: some View {
        VStack(spacing: 0) {
            StockStrip(selection: .constant(state.stockID),
                       thumbnails: state.thumbnails) { state.select(stockID: $0) }
            StockCaption(stock: state.stock)
                .animation(.easeOut(duration: 0.3), value: state.stockID)

            HStack(spacing: 12) {
                Button {
                    state.randomStock()
                } label: {
                    Label("Наугад", systemImage: "shuffle")
                        .font(Kind.ui(14, .semibold))
                        .foregroundStyle(Ink.paper)
                        .padding(.horizontal, 22)
                        .padding(.vertical, 13)
                        .background(Capsule().strokeBorder(Ink.edge, lineWidth: 1))
                }
                .pressable()

                Button {
                    state.save()
                } label: {
                    Label("Сохранить", systemImage: "arrow.down.to.line")
                        .font(Kind.ui(14, .semibold))
                        .foregroundStyle(Ink.ground)
                        .padding(.horizontal, 22)
                        .padding(.vertical, 13)
                        .background(Capsule().fill(Ink.paper))
                }
                .pressable()
            }
            .padding(.top, 10)
            .padding(.bottom, 18)
        }
        .background(
            LinearGradient(colors: [Ink.ground.opacity(0), Ink.surface],
                           startPoint: .top, endPoint: .bottom)
                .frame(height: 40), alignment: .top)
    }
}

/// Лист тонкой настройки: поправки поверх выбранной плёнки.
struct TuningSheet: View {
    @EnvironmentObject var state: AppState
    @Binding var isPresented: Bool

    var body: some View {
        VStack(spacing: 0) {
            Capsule()
                .fill(Ink.edge)
                .frame(width: 38, height: 4)
                .padding(.vertical, 10)
                .onTapGesture { isPresented = false }

            Text("Настройка плёнки")
                .font(Kind.display(20))
                .foregroundStyle(Ink.paper)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 20)
                .padding(.bottom, 10)

            ScrollView {
                VStack(spacing: 0) {
                    slider("Сила плёнки", value: $state.adjustments.amount,
                           range: 0...1, neutral: 1) { "\(Int($0 * 100))%" }

                    row("Рамка") {
                        HStack(spacing: 8) {
                            ForEach(FrameStyle.allCases) { style in
                                pill(style.title, on: state.frameStyle == style) {
                                    state.frameStyle = style
                                    state.redevelop()
                                }
                            }
                        }
                    }
                    row("Отпечаток") {
                        HStack(spacing: 8) {
                            pill("Дата на кадре", on: state.stampsDate) {
                                state.stampsDate.toggle(); state.redevelop()
                            }
                            pill("Пыль и царапины", on: state.dust) {
                                state.dust.toggle(); state.redevelop()
                            }
                        }
                    }

                    slider("Экспозиция", value: $state.adjustments.exposure,
                           range: -1.5...1.5, neutral: 0) {
                        String(format: "%@%.2f EV", $0 > 0 ? "+" : "", $0)
                    }
                    slider("Тепло", value: $state.adjustments.temp,
                           range: -0.5...0.5, neutral: 0) { signed($0) }
                    slider("Контраст", value: $state.adjustments.contrast,
                           range: -0.4...0.5, neutral: 0) { signed($0) }
                    slider("Выцветание", value: $state.adjustments.fade,
                           range: 0...0.6, neutral: 0) { "\(Int($0 / 0.6 * 100))%" }
                    slider("Зерно", value: $state.adjustments.grain,
                           range: -0.4...0.9, neutral: 0) { signed($0) }
                    slider("Гало", value: $state.adjustments.halation,
                           range: -0.3...0.9, neutral: 0) { signed($0) }
                    slider("Виньетка", value: $state.adjustments.vignette,
                           range: -0.3...0.6, neutral: 0) { signed($0) }

                    row("") {
                        pill("Сбросить настройки", on: false) { state.resetAdjustments() }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 20)
            }
        }
        .frame(maxHeight: UIScreen.main.bounds.height * 0.62)
        .background(
            Ink.surface
                .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous)))
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .strokeBorder(Ink.edge, lineWidth: 1))
        .shadow(color: .black.opacity(0.6), radius: 30, y: -12)
        .ignoresSafeArea(edges: .bottom)
    }

    private func signed(_ v: Float) -> String {
        "\(v > 0 ? "+" : "")\(Int((v * 100).rounded()))"
    }

    private func slider(_ title: String, value: Binding<Float>,
                        range: ClosedRange<Float>, neutral: Float,
                        format: @escaping (Float) -> String) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack {
                Text(title).eyebrow()
                Spacer()
                Text(format(value.wrappedValue))
                    .font(Kind.mono(12))
                    .foregroundStyle(Ink.amber)
                    .monospacedDigit()
            }
            BipolarSlider(value: value, range: range, neutral: neutral) {
                state.redevelop()
            }
        }
        .padding(.vertical, 11)
        .overlay(Divider().overlay(Ink.edge.opacity(0.6)), alignment: .bottom)
    }

    private func row<Content: View>(_ title: String,
                                    @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            if !title.isEmpty { Text(title).eyebrow() }
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 11)
        .overlay(Divider().overlay(Ink.edge.opacity(0.6)), alignment: .bottom)
    }

    private func pill(_ title: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button {
            action(); Haptics.tap()
        } label: {
            Text(title)
                .font(Kind.mono(10, on ? .bold : .medium))
                .tracking(1.4)
                .textCase(.uppercase)
                .foregroundStyle(on ? Ink.ground : Ink.silver)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(Capsule().fill(on ? Ink.amber : .clear))
                .overlay(Capsule().strokeBorder(on ? Ink.amber : Ink.edge, lineWidth: 1))
        }
        .pressable(scale: 0.95)
    }
}

/// Ползунок, у которого заливка идёт от нейтрального значения, а не от края.
struct BipolarSlider: View {
    @Binding var value: Float
    let range: ClosedRange<Float>
    let neutral: Float
    let onChange: () -> Void

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let span = range.upperBound - range.lowerBound
            let pos = CGFloat((value - range.lowerBound) / span) * w
            let zero = CGFloat((neutral - range.lowerBound) / span) * w

            ZStack(alignment: .leading) {
                Capsule().fill(Ink.edge).frame(height: 2)
                Capsule()
                    .fill(Ink.amber)
                    .frame(width: abs(pos - zero), height: 2)
                    .offset(x: min(pos, zero))
                Circle()
                    .fill(Ink.paper)
                    .frame(width: 17, height: 17)
                    .shadow(color: .black.opacity(0.5), radius: 4, y: 2)
                    .offset(x: pos - 8.5)
            }
            .frame(height: 26)
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0).onChanged { g in
                    let t = Float(min(max(g.location.x / w, 0), 1))
                    value = range.lowerBound + t * span
                    onChange()
                })
        }
        .frame(height: 26)
    }
}
