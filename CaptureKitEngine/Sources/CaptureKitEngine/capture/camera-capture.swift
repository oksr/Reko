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

    public static func listCameras() -> [CameraInfo] {
        let devices = AVCaptureDevice.DiscoverySession(
            deviceTypes: [.builtInWideAngleCamera, .external],
            mediaType: .video,
            position: .unspecified
        ).devices
        return devices.map { CameraInfo(id: $0.uniqueID, name: $0.localizedName) }
    }

    public func stopCapture() {
        session?.stopRunning()
        session = nil
    }
}
