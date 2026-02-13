import Foundation
import AVFoundation
import CoreMedia

public struct CameraInfo: Codable {
    public let id: String
    public let name: String
}

public final class CameraCapture: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    private var session: AVCaptureSession?
    private var onVideoFrame: ((CMSampleBuffer) -> Void)?

    public struct CameraDimensions {
        public let width: Int
        public let height: Int
    }

    public static func listCameras() -> [CameraInfo] {
        let devices = AVCaptureDevice.DiscoverySession(
            deviceTypes: [.builtInWideAngleCamera, .external],
            mediaType: .video,
            position: .unspecified
        ).devices
        return devices.map { CameraInfo(id: $0.uniqueID, name: $0.localizedName) }
    }

    public func startCapture(
        deviceId: String,
        onVideoFrame: @escaping (CMSampleBuffer) -> Void
    ) throws -> CameraDimensions {
        self.onVideoFrame = onVideoFrame

        let session = AVCaptureSession()
        session.sessionPreset = .high

        guard let device = AVCaptureDevice.DiscoverySession(
            deviceTypes: [.builtInWideAngleCamera, .external],
            mediaType: .video,
            position: .unspecified
        ).devices.first(where: { $0.uniqueID == deviceId }) else {
            throw CaptureError.cameraNotFound
        }

        let input = try AVCaptureDeviceInput(device: device)
        guard session.canAddInput(input) else {
            throw CaptureError.cameraNotFound
        }
        session.addInput(input)

        let output = AVCaptureVideoDataOutput()
        output.videoSettings = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
        ]
        let queue = DispatchQueue(label: "com.capturekit.camera", qos: .userInteractive)
        output.setSampleBufferDelegate(self, queue: queue)
        output.alwaysDiscardsLateVideoFrames = true

        guard session.canAddOutput(output) else {
            throw CaptureError.cameraNotFound
        }
        session.addOutput(output)

        session.startRunning()
        self.session = session

        let desc = device.activeFormat.formatDescription
        let dims = CMVideoFormatDescriptionGetDimensions(desc)
        return CameraDimensions(width: Int(dims.width), height: Int(dims.height))
    }

    public func stopCapture() {
        session?.stopRunning()
        session = nil
    }

    // MARK: - AVCaptureVideoDataOutputSampleBufferDelegate

    public func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        onVideoFrame?(sampleBuffer)
    }
}
