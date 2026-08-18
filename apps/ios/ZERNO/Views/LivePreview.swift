import SwiftUI
import MetalKit

/// Живое превью: кадры камеры проходят плёночный тракт прямо на экран.
struct LivePreview: UIViewRepresentable {
    let camera: CameraModel
    /// Читается на каждом кадре, поэтому замыкание, а не значение.
    let params: () -> FilmParams

    func makeCoordinator() -> Coordinator { Coordinator(camera: camera, params: params) }

    func makeUIView(context: Context) -> MTKView {
        let view = MTKView()
        view.device = FilmRenderer.shared?.device
        view.colorPixelFormat = .bgra8Unorm
        view.framebufferOnly = true
        view.isOpaque = true
        view.backgroundColor = .black
        view.preferredFramesPerSecond = 30
        view.delegate = context.coordinator
        view.contentMode = .scaleAspectFill
        return view
    }

    func updateUIView(_ view: MTKView, context: Context) {
        context.coordinator.params = params
    }

    final class Coordinator: NSObject, MTKViewDelegate {
        let camera: CameraModel
        var params: () -> FilmParams

        init(camera: CameraModel, params: @escaping () -> FilmParams) {
            self.camera = camera
            self.params = params
        }

        func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}

        func draw(in view: MTKView) {
            guard let renderer = FilmRenderer.shared,
                  let drawable = view.currentDrawable,
                  let buffer = camera.takeLatestBuffer(),
                  let source = renderer.texture(from: buffer),
                  let command = renderer.queue.makeCommandBuffer()
            else { return }

            renderer.encode(source: source, params: params(),
                            into: drawable.texture, buffer: command)
            command.present(drawable)
            command.commit()
        }
    }
}
