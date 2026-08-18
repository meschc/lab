import AVFoundation
import UIKit
import Combine

/// Захват с камеры: живой поток для превью и полноразмерный снимок по спуску.
final class CameraModel: NSObject, ObservableObject {

    @Published private(set) var isRunning = false
    @Published private(set) var permissionDenied = false
    @Published var position: AVCaptureDevice.Position = .back

    /// Последний кадр живого потока — его читает слой превью.
    private(set) var latestBuffer: CVPixelBuffer?
    private let bufferLock = NSLock()

    /// Вызывается на главной очереди, когда снимок готов.
    var onPhoto: ((UIImage) -> Void)?

    private let session = AVCaptureSession()
    private let videoOutput = AVCaptureVideoDataOutput()
    private let photoOutput = AVCapturePhotoOutput()
    private let sessionQueue = DispatchQueue(label: "ru.kirmesch.zerno.session")
    private let bufferQueue = DispatchQueue(label: "ru.kirmesch.zerno.buffers")
    private var configured = false

    // MARK: - Жизненный цикл

    func start() {
        AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
            guard let self else { return }
            guard granted else {
                DispatchQueue.main.async { self.permissionDenied = true }
                return
            }
            self.sessionQueue.async {
                self.configureIfNeeded()
                guard !self.session.isRunning else { return }
                self.session.startRunning()
                DispatchQueue.main.async { self.isRunning = self.session.isRunning }
            }
        }
    }

    func stop() {
        sessionQueue.async {
            guard self.session.isRunning else { return }
            self.session.stopRunning()
            DispatchQueue.main.async { self.isRunning = false }
        }
    }

    func flip() {
        position = position == .back ? .front : .back
        sessionQueue.async {
            self.session.beginConfiguration()
            self.session.inputs.forEach { self.session.removeInput($0) }
            self.addInput()
            self.session.commitConfiguration()
            self.applyOrientation()
        }
    }

    // MARK: - Настройка

    private func configureIfNeeded() {
        guard !configured else { return }
        configured = true

        session.beginConfiguration()
        session.sessionPreset = .hd1920x1080
        addInput()

        videoOutput.videoSettings = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
        ]
        videoOutput.alwaysDiscardsLateVideoFrames = true
        videoOutput.setSampleBufferDelegate(self, queue: bufferQueue)
        if session.canAddOutput(videoOutput) { session.addOutput(videoOutput) }
        if session.canAddOutput(photoOutput) { session.addOutput(photoOutput) }

        session.commitConfiguration()
        applyOrientation()
    }

    private func addInput() {
        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera,
                                                   for: .video, position: position),
              let input = try? AVCaptureDeviceInput(device: device),
              session.canAddInput(input) else { return }
        session.addInput(input)
    }

    /// Кадр должен приходить в портретной ориентации — приложение вертикальное.
    private func applyOrientation() {
        for output in [videoOutput as AVCaptureOutput, photoOutput] {
            guard let connection = output.connection(with: .video) else { continue }
            if #available(iOS 17.0, *) {
                if connection.isVideoRotationAngleSupported(90) {
                    connection.videoRotationAngle = 90
                }
            } else if connection.isVideoOrientationSupported {
                connection.videoOrientation = .portrait
            }
            if connection.isVideoMirroringSupported {
                connection.automaticallyAdjustsVideoMirroring = false
                connection.isVideoMirrored = (position == .front)
            }
        }
    }

    // MARK: - Снимок

    func capturePhoto() {
        sessionQueue.async {
            guard self.session.isRunning else {
                // без камеры снимаем то, что показано в превью
                DispatchQueue.main.async { self.onPhoto?(UIImage()) }
                return
            }
            let settings = AVCapturePhotoSettings()
            settings.flashMode = .off
            self.photoOutput.capturePhoto(with: settings, delegate: self)
        }
    }

    func takeLatestBuffer() -> CVPixelBuffer? {
        bufferLock.lock()
        defer { bufferLock.unlock() }
        return latestBuffer
    }
}

extension CameraModel: AVCaptureVideoDataOutputSampleBufferDelegate {
    func captureOutput(_ output: AVCaptureOutput,
                       didOutput sampleBuffer: CMSampleBuffer,
                       from connection: AVCaptureConnection) {
        guard let buffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        bufferLock.lock()
        latestBuffer = buffer
        bufferLock.unlock()
    }
}

extension CameraModel: AVCapturePhotoCaptureDelegate {
    func photoOutput(_ output: AVCapturePhotoOutput,
                     didFinishProcessingPhoto photo: AVCapturePhoto,
                     error: Error?) {
        guard error == nil,
              let data = photo.fileDataRepresentation(),
              let image = UIImage(data: data) else { return }
        DispatchQueue.main.async { self.onPhoto?(image.normalizedUp()) }
    }
}

extension UIImage {
    /// Убирает поворот из метаданных — дальше работаем с честными пикселями.
    func normalizedUp() -> UIImage {
        guard imageOrientation != .up else { return self }
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        format.opaque = true
        return UIGraphicsImageRenderer(size: size, format: format).image { _ in
            draw(in: CGRect(origin: .zero, size: size))
        }
    }
}
