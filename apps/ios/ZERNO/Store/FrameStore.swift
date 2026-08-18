import UIKit
import Photos

/// Один проявленный кадр.
struct DevelopedFrame: Identifiable, Codable, Equatable {
    let id: String
    let stock: String
    let date: Date
    let fileName: String

    var fileURL: URL { FrameStore.directory.appendingPathComponent(fileName) }
}

/// Отснятая плёнка: файлы в папке приложения, опись — в JSON.
@MainActor
final class FrameStore: ObservableObject {

    @Published private(set) var frames: [DevelopedFrame] = []

    nonisolated static let directory: URL = {
        let base = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let dir = base.appendingPathComponent("Roll", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    private var indexURL: URL { Self.directory.appendingPathComponent("index.json") }

    init() { load() }

    private func load() {
        guard let data = try? Data(contentsOf: indexURL),
              let list = try? JSONDecoder().decode([DevelopedFrame].self, from: data) else { return }
        frames = list.filter { FileManager.default.fileExists(atPath: $0.fileURL.path) }
    }

    private func persist() {
        guard let data = try? JSONEncoder().encode(frames) else { return }
        try? data.write(to: indexURL, options: .atomic)
    }

    @discardableResult
    func add(_ image: UIImage, stock: String) -> DevelopedFrame? {
        guard let data = image.jpegData(compressionQuality: 0.92) else { return nil }
        let id = UUID().uuidString
        let name = "\(id).jpg"
        do {
            try data.write(to: Self.directory.appendingPathComponent(name), options: .atomic)
        } catch {
            return nil
        }
        let frame = DevelopedFrame(id: id, stock: stock, date: Date(), fileName: name)
        frames.insert(frame, at: 0)
        persist()
        return frame
    }

    func remove(_ frame: DevelopedFrame) {
        try? FileManager.default.removeItem(at: frame.fileURL)
        frames.removeAll { $0.id == frame.id }
        persist()
    }

    func removeAll() {
        frames.forEach { try? FileManager.default.removeItem(at: $0.fileURL) }
        frames = []
        persist()
    }

    func image(for frame: DevelopedFrame) -> UIImage? {
        UIImage(contentsOfFile: frame.fileURL.path)
    }

    /// Сохранение в системную галерею — по явному действию пользователя.
    func exportToPhotos(_ image: UIImage, completion: @escaping (Bool) -> Void) {
        PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
            guard status == .authorized || status == .limited else {
                DispatchQueue.main.async { completion(false) }
                return
            }
            PHPhotoLibrary.shared().performChanges {
                PHAssetChangeRequest.creationRequestForAsset(from: image)
            } completionHandler: { ok, _ in
                DispatchQueue.main.async { completion(ok) }
            }
        }
    }
}
