import SwiftUI
import UIKit

enum Screen { case shoot, develop, roll }

/// Общее состояние приложения: выбранная плёнка, поправки, снятый кадр.
@MainActor
final class AppState: ObservableObject {

    @Published var screen: Screen = .shoot
    @Published var stockID = "zarya"
    @Published var adjustments = Adjustments.neutral
    @Published var frameStyle = FrameStyle.none
    @Published var stampsDate = false
    @Published var dust = false
    @Published var seed: Float = Float.random(in: 0...1)

    /// Снятый или загруженный кадр до проявки.
    @Published var source: UIImage?
    /// Готовый кадр — то, что видно на экране проявки.
    @Published var developed: UIImage?
    @Published var thumbnails: [String: UIImage] = [:]
    @Published var toast: String?

    let camera = CameraModel()
    let store = FrameStore()

    var stock: FilmStock { FilmLibrary.stock(id: stockID) }
    var params: FilmParams { adjustments.applied(to: stock, dust: dust, seed: seed) }

    var frameNumber: String { String(format: "КАДР %02d", store.frames.count + 1) }

    var composeOptions: Compositor.Options {
        Compositor.Options(
            style: frameStyle,
            date: stampsDate ? Date() : nil,
            edge: stock.edgeText,
            edgeRight: "\(stock.kind.uppercased()) · \(frameNumber)")
    }

    // MARK: - Выбор плёнки

    func select(stockID id: String) {
        guard id != stockID else { return }
        stockID = id
        seed = Float.random(in: 0...1)
        Haptics.tap()
        redevelop()
    }

    func randomStock() {
        let pool = FilmLibrary.all.filter { $0.id != "orig" && $0.id != stockID }
        guard let pick = pool.randomElement() else { return }
        select(stockID: pick.id)
    }

    func resetAdjustments() {
        adjustments = .neutral
        frameStyle = .none
        stampsDate = false
        dust = false
        redevelop()
        show("Настройки сброшены")
    }

    // MARK: - Проявка

    func accept(source image: UIImage) {
        source = image
        seed = Float.random(in: 0...1)
        screen = .develop
        redevelop()
        refreshThumbnails(from: image)
    }

    /// Пересчитывает превью проявленного кадра. Лёгкая операция — можно
    /// звать на каждое движение ползунка.
    func redevelop() {
        guard let source, let renderer = FilmRenderer.shared,
              let texture = renderer.texture(from: source) else { return }
        let long = max(source.size.width, source.size.height)
        let k = min(1600 / long, 1)
        let w = Int(source.size.width * k), h = Int(source.size.height * k)
        guard let graded = renderer.develop(source: texture, params: params, width: w, height: h)
        else { return }
        developed = Compositor.compose(graded, options: composeOptions)
    }

    /// Полное разрешение — только в момент сохранения.
    func save() {
        guard let source, let renderer = FilmRenderer.shared,
              let texture = renderer.texture(from: source) else { return }
        let long = max(source.size.width, source.size.height)
        let k = min(3000 / long, 1)
        let w = Int(source.size.width * k), h = Int(source.size.height * k)
        guard let graded = renderer.develop(source: texture, params: params, width: w, height: h)
        else { show("Не удалось проявить кадр"); return }
        let final = Compositor.compose(graded, options: composeOptions)
        if store.add(final, stock: stock.name) != nil {
            Haptics.done()
            show("Кадр проявлен и лежит в плёнке")
        } else {
            show("Не удалось сохранить кадр")
        }
    }

    // MARK: - Миниатюры плёнок

    private var lastThumbnailUpdate = Date.distantPast

    /// Квадратный кроп источника прогоняется через каждую эмульсию.
    func refreshThumbnails(from image: UIImage, throttle: TimeInterval = 0) {
        if throttle > 0, Date().timeIntervalSince(lastThumbnailUpdate) < throttle { return }
        lastThumbnailUpdate = Date()

        guard let renderer = FilmRenderer.shared,
              let square = image.squareCrop(side: 256),
              let texture = renderer.texture(from: square) else { return }

        var result: [String: UIImage] = [:]
        for stock in FilmLibrary.all {
            var p = adjustments.applied(to: stock, dust: false, seed: seed)
            p.amount = 1
            if let img = renderer.develop(source: texture, params: p, width: 160, height: 160) {
                result[stock.id] = img
            }
        }
        thumbnails = result
    }

    func refreshThumbnailsFromCamera() {
        guard let renderer = FilmRenderer.shared,
              let buffer = camera.takeLatestBuffer(),
              let texture = renderer.texture(from: buffer) else { return }
        if Date().timeIntervalSince(lastThumbnailUpdate) < 1.2 { return }
        lastThumbnailUpdate = Date()

        var result: [String: UIImage] = [:]
        for stock in FilmLibrary.all {
            var p = stock.params
            p.seed = seed
            if let img = renderer.develop(source: texture, params: p, width: 160, height: 213) {
                result[stock.id] = img
            }
        }
        thumbnails = result
    }

    // MARK: - Подсказки

    private var toastTask: Task<Void, Never>?
    func show(_ message: String) {
        toast = message
        toastTask?.cancel()
        toastTask = Task {
            try? await Task.sleep(nanoseconds: 2_400_000_000)
            if !Task.isCancelled { toast = nil }
        }
    }
}

extension UIImage {
    /// Квадратный кроп по центру — основа для миниатюр плёнок.
    func squareCrop(side: CGFloat) -> UIImage? {
        let s = min(size.width, size.height)
        let origin = CGPoint(x: (size.width - s) / 2, y: (size.height - s) / 2)
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        format.opaque = true
        return UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: format).image { _ in
            draw(in: CGRect(x: -origin.x * side / s, y: -origin.y * side / s,
                            width: size.width * side / s, height: size.height * side / s))
        }
    }
}
