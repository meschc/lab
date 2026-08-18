import SwiftUI
import PhotosUI

/// Экран съёмки: живой кадр с наложенной плёнкой и спуск затвора.
struct ShootView: View {
    @EnvironmentObject var state: AppState
    @State private var showsGrid = false
    @State private var flash = false
    @State private var pickerItem: PhotosPickerItem?

    var body: some View {
        VStack(spacing: 0) {
            topBar

            HStack(spacing: 6) {
                FilmRail(text: state.stock.edgeText, hot: true)
                frame
                FilmRail(text: state.camera.isRunning ? "ЖИВОЙ КАДР" : "КАМЕРА ЖДЁТ", mirrored: true)
            }
            .padding(.horizontal, 6)
            .frame(maxHeight: .infinity)

            deck
        }
        .background(Ink.ground)
        .overlay {
            if flash {
                Ink.paper.ignoresSafeArea().transition(.opacity)
            }
        }
        .onChange(of: pickerItem) { _, item in load(item) }
    }

    // MARK: - Части экрана

    private var topBar: some View {
        HStack {
            HStack(spacing: 9) {
                ApertureMark(open: 1)
                    .frame(width: 22, height: 22)
                Text("ЗЕРНО")
                    .font(Kind.display(17, .bold))
                    .tracking(3.4)
                    .foregroundStyle(Ink.paper)
            }
            Spacer()
            Button {
                state.camera.flip(); Haptics.tap()
            } label: {
                Image(systemName: "arrow.triangle.2.circlepath.camera")
                    .font(.system(size: 18, weight: .light))
                    .foregroundStyle(Ink.silver)
                    .frame(width: 40, height: 40)
            }
            .pressable(scale: 0.9)
            Button {
                showsGrid.toggle(); Haptics.tap()
            } label: {
                Image(systemName: "grid")
                    .font(.system(size: 17, weight: .light))
                    .foregroundStyle(showsGrid ? Ink.amber : Ink.silver)
                    .frame(width: 40, height: 40)
            }
            .pressable(scale: 0.9)
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 10)
    }

    private var frame: some View {
        ZStack {
            if FilmRenderer.shared == nil {
                unsupported
            } else if state.camera.permissionDenied {
                permissionNotice
            } else {
                LivePreview(camera: state.camera) { state.params }
                    .aspectRatio(3.0 / 4.0, contentMode: .fit)
            }
            if showsGrid { GridOverlay() }
        }
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .shadow(color: .black.opacity(0.75), radius: 26, y: 12)
        .overlay(RoundedRectangle(cornerRadius: 8)
            .strokeBorder(Ink.paper.opacity(0.07), lineWidth: 1))
    }

    private var deck: some View {
        VStack(spacing: 0) {
            StockStrip(selection: .constant(state.stockID),
                       thumbnails: state.thumbnails) { state.select(stockID: $0) }
            StockCaption(stock: state.stock)
                .animation(.easeOut(duration: 0.3), value: state.stockID)

            HStack {
                PhotosPicker(selection: $pickerItem, matching: .images) {
                    VStack(spacing: 6) {
                        Image(systemName: "photo.on.rectangle.angled")
                            .font(.system(size: 21, weight: .light))
                            .frame(width: 26, height: 26)
                        Text("Из галереи")
                            .font(Kind.mono(9)).tracking(1.3).textCase(.uppercase)
                    }
                    .foregroundStyle(Ink.silver)
                    .frame(minWidth: 62)
                }

                Spacer()
                ShutterButton(action: shoot)
                Spacer()

                DeckButton(rollTitle) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 5).fill(Ink.rebate)
                        if let first = state.store.frames.first,
                           let img = state.store.image(for: first) {
                            Image(uiImage: img)
                                .resizable()
                                .aspectRatio(contentMode: .fill)
                                .clipShape(RoundedRectangle(cornerRadius: 5))
                        } else {
                            Image(systemName: "camera")
                                .font(.system(size: 12, weight: .light))
                                .foregroundStyle(Ink.silver)
                        }
                    }
                } action: {
                    state.screen = .roll
                }
            }
            .padding(.horizontal, 26)
            .padding(.top, 10)
            .padding(.bottom, 16)
        }
        .background(
            LinearGradient(colors: [Ink.ground.opacity(0), Ink.surface],
                           startPoint: .top, endPoint: .bottom)
                .frame(height: 40), alignment: .top)
    }

    private var rollTitle: String {
        let n = state.store.frames.count
        let form: String
        switch (n % 10, n % 100) {
        case (1, let h) where h != 11:                       form = "кадр"
        case (2...4, let h) where !(12...14).contains(h):    form = "кадра"
        default:                                             form = "кадров"
        }
        return "\(n) \(form)"
    }

    private var permissionNotice: some View {
        VStack(spacing: 14) {
            Image(systemName: "camera.metering.unknown")
                .font(.system(size: 34, weight: .ultraLight))
                .foregroundStyle(Ink.edge)
            Text("Нет доступа к камере")
                .font(Kind.display(20))
                .foregroundStyle(Ink.paper)
            Text("Разреши доступ в настройках — или загрузи фотографию из галереи.")
                .font(Kind.ui(13))
                .foregroundStyle(Ink.silver)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 260)
            Button("Открыть настройки") {
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    UIApplication.shared.open(url)
                }
            }
            .font(Kind.ui(14, .semibold))
            .foregroundStyle(Ink.amber)
        }
        .padding(40)
        .frame(maxWidth: .infinity)
        .aspectRatio(3.0 / 4.0, contentMode: .fit)
        .background(Ink.surface)
    }

    private var unsupported: some View {
        Text("Этому устройству не хватает Metal — фильтры недоступны.")
            .font(Kind.ui(14))
            .foregroundStyle(Ink.silver)
            .multilineTextAlignment(.center)
            .padding(40)
            .aspectRatio(3.0 / 4.0, contentMode: .fit)
            .background(Ink.surface)
    }

    // MARK: - Действия

    private func shoot() {
        Haptics.shutter()
        withAnimation(.easeOut(duration: 0.06)) { flash = true }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.14) {
            withAnimation(.easeOut(duration: 0.28)) { flash = false }
        }
        state.camera.onPhoto = { image in
            guard image.size.width > 0 else {
                state.show("Кадр не получился — попробуй ещё раз")
                return
            }
            state.accept(source: image)
        }
        state.camera.capturePhoto()
    }

    private func load(_ item: PhotosPickerItem?) {
        guard let item else { return }
        Task {
            guard let data = try? await item.loadTransferable(type: Data.self),
                  let image = UIImage(data: data)?.normalizedUp() else {
                state.show("Не получилось открыть фотографию")
                return
            }
            state.accept(source: image.downscaled(longestSide: 3200))
            pickerItem = nil
        }
    }
}

/// Сетка по третям.
struct GridOverlay: View {
    var body: some View {
        GeometryReader { geo in
            Path { p in
                for i in 1..<3 {
                    let x = geo.size.width * CGFloat(i) / 3
                    let y = geo.size.height * CGFloat(i) / 3
                    p.move(to: CGPoint(x: x, y: 0)); p.addLine(to: CGPoint(x: x, y: geo.size.height))
                    p.move(to: CGPoint(x: 0, y: y)); p.addLine(to: CGPoint(x: geo.size.width, y: y))
                }
            }
            .stroke(Ink.paper.opacity(0.26), lineWidth: 0.7)
        }
        .transition(.opacity)
    }
}

extension UIImage {
    /// Ограничивает длинную сторону — экономит память на больших снимках.
    func downscaled(longestSide: CGFloat) -> UIImage {
        let long = max(size.width, size.height)
        guard long > longestSide else { return self }
        let k = longestSide / long
        let target = CGSize(width: size.width * k, height: size.height * k)
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        format.opaque = true
        return UIGraphicsImageRenderer(size: target, format: format).image { _ in
            draw(in: CGRect(origin: .zero, size: target))
        }
    }
}
