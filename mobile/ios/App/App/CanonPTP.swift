import Foundation

// The EOS command/event constants and field offsets follow libgphoto2's maintained
// camlibs/ptp2/{ptp.h,config.c,ptp-pack.c}. This implements a narrow card-preserving
// EOS-1D X Mark III path using Apple's public ImageCaptureCore PTP passthrough.
// It does not include libgphoto2 code or enable host-only capture destinations.
enum CanonPTP {
    static let maxPhotoBytes = 40 * 1024 * 1024
    static let chunkBytes = 256 * 1024

    struct Photo {
        let handle: UInt32
        let name: String
        let size: Int
    }
    struct Events {
        var photos: [Photo] = []
        var recordCount = 0
        var destination: UInt32?
        var cameraBusy: Bool?
    }
    enum Failure: LocalizedError {
        case invalid(String)
        case response(UInt16)
        var errorDescription: String? {
            switch self {
            case .invalid(let message): return message
            case .response(let code):
                if code == 0x2019 { return "Camera is busy. Stop USB, close Photos and Canon Camera Connect, disconnect the cable, turn the camera off and on, then reconnect." }
                return String(format: "Camera rejected the USB command (PTP 0x%04X). Stop USB and reconnect the camera.", code)
            }
        }
    }
    static func u16(_ data: Data, _ offset: Int) throws -> UInt16 {
        guard offset >= 0, offset + 2 <= data.count else { throw Failure.invalid("Truncated camera response.") }
        return UInt16(data[offset]) | UInt16(data[offset + 1]) << 8
    }
    static func u32(_ data: Data, _ offset: Int) throws -> UInt32 {
        guard offset >= 0, offset + 4 <= data.count else { throw Failure.invalid("Truncated camera response.") }
        return UInt32(data[offset]) | UInt32(data[offset + 1]) << 8 | UInt32(data[offset + 2]) << 16 | UInt32(data[offset + 3]) << 24
    }
    static func command(_ operation: UInt16, transaction: UInt32, parameters: [UInt32] = []) -> Data {
        var result = Data()
        func append<T: FixedWidthInteger>(_ value: T) {
            var littleEndian = value.littleEndian
            withUnsafeBytes(of: &littleEndian) { result.append(contentsOf: $0) }
        }
        append(UInt32(12 + parameters.count * 4)); append(UInt16(1)); append(operation); append(transaction)
        parameters.forEach { append($0) }
        return result
    }
    static func payload(_ data: Data, operation: UInt16) throws -> Data {
        // ImageCaptureCore returns the data payload. Some device modules retain
        // its PTP data-container header, which is unwrapped only when exact.
        if data.count >= 12, (try u16(data, 4)) == 2, (try u16(data, 6)) == operation,
           (try u32(data, 0)) == data.count { return Data(data.dropFirst(12)) }
        return data
    }
    static func validate(_ response: Data) throws {
        guard response.count >= 12, try u16(response, 4) == 3,
              try u32(response, 0) == response.count else { throw Failure.invalid("Invalid PTP response from camera.") }
        let code = try u16(response, 6)
        guard code == 0x2001 else { throw Failure.response(code) }
    }
    static func operations(_ data: Data) throws -> Set<UInt16> {
        guard data.count >= 10 else { throw Failure.invalid("Missing camera device information.") }
        // StandardVersion/u16, VendorExtensionID/u32, VendorExtensionVersion/u16,
        // vendor-description/PTP string, FunctionalMode/u16, Operations/u16 array.
        var offset = 8
        let stringCount = Int(data[offset]); offset += 1 + stringCount * 2
        guard offset + 6 <= data.count else { throw Failure.invalid("Invalid camera device information.") }
        offset += 2
        let count = Int(try u32(data, offset)); offset += 4
        guard count <= 4096, offset + count * 2 <= data.count else { throw Failure.invalid("Invalid camera operation list.") }
        return Set(try (0..<count).map { try u16(data, offset + $0 * 2) })
    }
    static func events(_ data: Data) throws -> Events {
        var result = Events(), offset = 0
        guard data.count <= 4 * 1024 * 1024 else { throw Failure.invalid("Camera event response exceeded its limit.") }
        while offset < data.count {
            guard offset + 8 <= data.count else { throw Failure.invalid("Truncated Canon event.") }
            let size = Int(try u32(data, offset)), code = try u32(data, offset + 4)
            guard size >= 8, size <= data.count - offset else { throw Failure.invalid("Invalid Canon event length.") }
            if size == 8 && code == 0 { break }
            result.recordCount += 1
            if code == 0xc189 {
                guard size >= 12 else { throw Failure.invalid("Truncated Canon property event.") }
                if try u32(data, offset + 8) == 0xd11c {
                    guard size >= 16 else { throw Failure.invalid("Truncated Canon capture destination.") }
                result.destination = try u32(data, offset + 12)
                }
            } else if code == 0xc18b {
                guard size >= 12 else { throw Failure.invalid("Truncated Canon status event.") }
                result.cameraBusy = try u32(data, offset + 8) == 1
            } else if code == 0xc181 || code == 0xc1a7 {
                let nameOffset = code == 0xc181 ? 0x28 : 0x2c
                guard size > nameOffset else { throw Failure.invalid("Truncated Canon photo event.") }
                let filenameBytes = data[(offset + nameOffset)..<(offset + size)]
                guard filenameBytes.contains(0) else { throw Failure.invalid("Unterminated camera filename.") }
                let bytes = filenameBytes.prefix { $0 != 0 }
                guard let name = String(bytes: bytes, encoding: .utf8), !name.isEmpty,
                      name.count <= 255 else { throw Failure.invalid("Invalid camera filename.") }
                let format = try u16(data, offset + 0x10)
                if format == 0x3801 && ["jpg", "jpeg"].contains((name as NSString).pathExtension.lowercased()) {
                    let photoSize = Int(try u32(data, offset + 0x1c))
                    // Ex64's high size word must also fit the bounded JPEG path.
                    if code == 0xc1a7, try u32(data, offset + 0x20) != 0 { throw Failure.invalid("Camera image exceeds the JPEG size limit.") }
                    guard photoSize > 0, photoSize <= maxPhotoBytes else { throw Failure.invalid("Camera JPEG exceeds the 40 MB transfer limit.") }
                    result.photos.append(Photo(handle: try u32(data, offset + 8), name: (name as NSString).lastPathComponent, size: photoSize))
                }
            }
            offset += size
        }
        return result
    }
}
