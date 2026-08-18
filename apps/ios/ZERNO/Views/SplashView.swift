import SwiftUI

/// Заставка: диафрагма раскрывается, свет заливает отверстие, проступает имя.
struct SplashView: View {
    @State private var open: CGFloat = 0
    @State private var letters = false
    @State private var subtitle = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let title = Array("ЗЕРНО")

    var body: some View {
        ZStack {
            Ink.ground.ignoresSafeArea()
            VStack(spacing: 30) {
                ApertureMark(open: open)
                    .frame(width: 150, height: 150)
                    .shadow(color: Ink.amber.opacity(0.35 * open), radius: 60)

                HStack(spacing: 0) {
                    ForEach(Array(title.enumerated()), id: \.offset) { index, ch in
                        Text(String(ch))
                            .font(Kind.display(52, .heavy))
                            .tracking(14)
                            .foregroundStyle(Ink.paper)
                            .offset(y: letters ? 0 : 70)
                            .opacity(letters ? 1 : 0)
                            .animation(.spring(response: 0.7, dampingFraction: 0.8)
                                .delay(0.42 + Double(index) * 0.08), value: letters)
                    }
                }
                .padding(.leading, 14)

                Text("Плёночная лаборатория · 12 эмульсий")
                    .eyebrow()
                    .opacity(subtitle ? 1 : 0)
                    .animation(.easeOut(duration: 0.8).delay(1.05), value: subtitle)
            }
        }
        .onAppear {
            if reduceMotion {
                open = 1; letters = true; subtitle = true
            } else {
                withAnimation(.timingCurve(0.22, 1, 0.36, 1, duration: 1.25)) { open = 1 }
                letters = true
                subtitle = true
            }
        }
    }
}
