import SwiftUI

struct RootView: View {
    @StateObject private var state = AppState()
    @State private var splash = true
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack {
            MeshBackground()

            Group {
                switch state.screen {
                case .shoot:   ShootView()
                case .develop: DevelopView()
                case .roll:    RollView()
                }
            }
            .environmentObject(state)
            .opacity(splash ? 0 : 1)

            GrainOverlay()

            if splash {
                SplashView().transition(.opacity)
            }

            if let toast = state.toast {
                VStack {
                    Spacer()
                    ToastView(text: toast).padding(.bottom, 150)
                }
                .animation(.spring(response: 0.4, dampingFraction: 0.8), value: state.toast)
            }
        }
        .preferredColorScheme(.light)
        .statusBarHidden(splash)
        .animation(.easeOut(duration: 0.34), value: state.screen)
        .task {
            state.camera.start()
            try? await Task.sleep(nanoseconds: 2_050_000_000)
            withAnimation(.easeOut(duration: 0.7)) { splash = false }
        }
        .task(id: state.screen) {
            // Пока открыт экран съёмки, миниатюры плёнок живут вместе с кадром.
            guard state.screen == .shoot else { return }
            while !Task.isCancelled {
                state.refreshThumbnailsFromCamera()
                try? await Task.sleep(nanoseconds: 2_400_000_000)
            }
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active:     if state.screen == .shoot { state.camera.start() }
            case .background: state.camera.stop()
            default: break
            }
        }
        .onChange(of: state.screen) { _, screen in
            if screen == .shoot { state.camera.start() } else { state.camera.stop() }
        }
    }
}
