import Metal
import MetalKit
import MetalPerformanceShaders
import CoreImage
import UIKit

/// Отрисовка плёночного тракта. Один рендерер обслуживает и живое превью,
/// и миниатюры, и экспорт в полном разрешении.
final class FilmRenderer {

    /// Пусто, если устройство без Metal — интерфейс тогда показывает предупреждение.
    static let shared: FilmRenderer? = FilmRenderer()

    let device: MTLDevice
    let queue: MTLCommandQueue

    private let filmPipeline: MTLRenderPipelineState
    private let brightPipeline: MTLRenderPipelineState
    private let ciContext: CIContext

    private var brightTexture: MTLTexture?
    private var bloomTexture: MTLTexture?
    private var exportTexture: MTLTexture?
    private var blackTexture: MTLTexture?

    /// Кэш текстур для CVPixelBuffer с камеры.
    private var textureCache: CVMetalTextureCache?

    private init?() {
        guard let device = MTLCreateSystemDefaultDevice(),
              let queue = device.makeCommandQueue(),
              let library = device.makeDefaultLibrary(),
              let vfn = library.makeFunction(name: "fullscreenVertex"),
              let film = library.makeFunction(name: "filmFragment"),
              let bright = library.makeFunction(name: "brightPassFragment")
        else { return nil }

        self.device = device
        self.queue = queue
        self.ciContext = CIContext(mtlDevice: device, options: [.cacheIntermediates: false])

        func pipeline(_ fragment: MTLFunction, _ format: MTLPixelFormat) throws -> MTLRenderPipelineState {
            let d = MTLRenderPipelineDescriptor()
            d.vertexFunction = vfn
            d.fragmentFunction = fragment
            d.colorAttachments[0].pixelFormat = format
            return try device.makeRenderPipelineState(descriptor: d)
        }
        do {
            filmPipeline = try pipeline(film, .bgra8Unorm)
            brightPipeline = try pipeline(bright, .rgba16Float)
        } catch {
            return nil
        }
        CVMetalTextureCacheCreate(kCFAllocatorDefault, nil, device, nil, &textureCache)
    }

    // MARK: - Вспомогательные текстуры

    private func makeTexture(width: Int, height: Int, format: MTLPixelFormat,
                             usage: MTLTextureUsage) -> MTLTexture? {
        let d = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: format, width: max(1, width), height: max(1, height), mipmapped: false)
        d.usage = usage
        d.storageMode = .private
        return device.makeTexture(descriptor: d)
    }

    private func fits(_ t: MTLTexture?, _ w: Int, _ h: Int) -> Bool {
        guard let t else { return false }
        return t.width == w && t.height == h
    }

    /// Чёрная текстура — подставляется вместо гало, когда оно выключено.
    private func black() -> MTLTexture? {
        if let blackTexture { return blackTexture }
        guard let t = makeTexture(width: 1, height: 1, format: .rgba16Float,
                                  usage: [.shaderRead, .renderTarget]) else { return nil }
        if let buf = queue.makeCommandBuffer() {
            let pass = MTLRenderPassDescriptor()
            pass.colorAttachments[0].texture = t
            pass.colorAttachments[0].loadAction = .clear
            pass.colorAttachments[0].storeAction = .store
            pass.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 1)
            buf.makeRenderCommandEncoder(descriptor: pass)?.endEncoding()
            buf.commit()
        }
        blackTexture = t
        return t
    }

    // MARK: - Проходы

    /// Готовит текстуру гало: света → размытие.
    private func makeBloom(source: MTLTexture, in buffer: MTLCommandBuffer) -> MTLTexture? {
        let w = max(2, source.width / 4), h = max(2, source.height / 4)
        if !fits(brightTexture, w, h) {
            brightTexture = makeTexture(width: w, height: h, format: .rgba16Float,
                                        usage: [.shaderRead, .shaderWrite, .renderTarget])
            bloomTexture = makeTexture(width: w, height: h, format: .rgba16Float,
                                       usage: [.shaderRead, .shaderWrite, .renderTarget])
        }
        guard let bright = brightTexture, let bloom = bloomTexture else { return nil }

        let pass = MTLRenderPassDescriptor()
        pass.colorAttachments[0].texture = bright
        pass.colorAttachments[0].loadAction = .clear
        pass.colorAttachments[0].storeAction = .store
        pass.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 1)
        guard let enc = buffer.makeRenderCommandEncoder(descriptor: pass) else { return nil }
        enc.setRenderPipelineState(brightPipeline)
        enc.setFragmentTexture(source, index: 0)
        enc.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
        enc.endEncoding()

        let sigma = max(2.0, Float(max(w, h)) * 0.022)
        MPSImageGaussianBlur(device: device, sigma: sigma)
            .encode(commandBuffer: buffer, sourceTexture: bright, destinationTexture: bloom)
        return bloom
    }

    /// Основной проход. `target` — куда рисуем (слой MTKView или своя текстура).
    func encode(source: MTLTexture, params: FilmParams,
                into target: MTLTexture, buffer: MTLCommandBuffer) {
        var p = params
        p.resX = Float(target.width)
        p.resY = Float(target.height)

        var bloom = black()
        if p.needsBloom, let b = makeBloom(source: source, in: buffer) {
            bloom = b
        } else {
            p.halation = 0
            p.bloom = 0
        }

        let pass = MTLRenderPassDescriptor()
        pass.colorAttachments[0].texture = target
        pass.colorAttachments[0].loadAction = .clear
        pass.colorAttachments[0].storeAction = .store
        pass.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 1)
        guard let enc = buffer.makeRenderCommandEncoder(descriptor: pass) else { return }
        enc.setRenderPipelineState(filmPipeline)
        enc.setFragmentTexture(source, index: 0)
        enc.setFragmentTexture(bloom, index: 1)
        enc.setFragmentBytes(&p, length: MemoryLayout<FilmParams>.stride, index: 0)
        enc.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
        enc.endEncoding()
    }

    // MARK: - Источники

    /// Текстура из кадра камеры.
    func texture(from pixelBuffer: CVPixelBuffer) -> MTLTexture? {
        guard let cache = textureCache else { return nil }
        let w = CVPixelBufferGetWidth(pixelBuffer)
        let h = CVPixelBufferGetHeight(pixelBuffer)
        var ref: CVMetalTexture?
        let status = CVMetalTextureCacheCreateTextureFromImage(
            kCFAllocatorDefault, cache, pixelBuffer, nil, .bgra8Unorm, w, h, 0, &ref)
        guard status == kCVReturnSuccess, let ref else { return nil }
        return CVMetalTextureGetTexture(ref)
    }

    /// Текстура из готового изображения.
    func texture(from image: UIImage) -> MTLTexture? {
        guard let cg = image.cgImage else { return nil }
        let loader = MTKTextureLoader(device: device)
        return try? loader.newTexture(cgImage: cg, options: [
            .SRGB: false,
            .textureUsage: NSNumber(value: MTLTextureUsage.shaderRead.rawValue),
            .textureStorageMode: NSNumber(value: MTLStorageMode.private.rawValue)
        ])
    }

    // MARK: - Отрисовка в изображение

    /// Синхронно проявляет кадр и возвращает готовое изображение.
    func develop(source: MTLTexture, params: FilmParams,
                 width: Int, height: Int) -> UIImage? {
        let w = max(2, width), h = max(2, height)
        if !fits(exportTexture, w, h) {
            exportTexture = makeTexture(width: w, height: h, format: .bgra8Unorm,
                                        usage: [.shaderRead, .renderTarget])
        }
        guard let target = exportTexture,
              let buffer = queue.makeCommandBuffer() else { return nil }

        encode(source: source, params: params, into: target, buffer: buffer)
        buffer.commit()
        buffer.waitUntilCompleted()

        let options: [CIImageOption: Any] = [.colorSpace: CGColorSpaceCreateDeviceRGB()]
        guard let ci = CIImage(mtlTexture: target, options: options) else { return nil }
        // CIImage из текстуры Metal приходит перевёрнутым по вертикали
        let flipped = ci.transformed(by: CGAffineTransform(scaleX: 1, y: -1)
            .translatedBy(x: 0, y: -ci.extent.height))
        guard let cg = ciContext.createCGImage(flipped, from: flipped.extent) else { return nil }
        return UIImage(cgImage: cg)
    }
}
