import Foundation

// Run with mobile/scripts/test-canon-ptp.sh. Fixtures are synthetic protocol
// packets, not a substitute for EOS-1D X Mark III / iPhone cable acceptance.
// Field layout independently checked against libgphoto2 ptp-pack.c:
// https://github.com/gphoto/libgphoto2/blob/09f8a940b1e418b5693f5c11e3016a1ad2cea62d/camlibs/ptp2/ptp-pack.c#L1797-L1811
// Event/property constants: upstream camlibs/ptp2/ptp.h. This test does not
// incorporate libgphoto2 implementation code or require its runtime.

private enum CheckFailure: Error, CustomStringConvertible {
    case failed(String)
    var description: String { switch self { case .failed(let message): return message } }
}

private func check(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
    if try !condition() { throw CheckFailure.failed(message) }
}

private func rejects(_ operation: () throws -> Void) throws {
    do { try operation() }
    catch is CanonPTP.Failure { return }
    throw CheckFailure.failed("Expected a recoverable CanonPTP.Failure")
}

// Explicit byte assembly intentionally does not call CanonPTP serialization.
private func le16(_ value: UInt16) -> [UInt8] {
    [UInt8(truncatingIfNeeded: value), UInt8(truncatingIfNeeded: value >> 8)]
}
private func le32(_ value: UInt32) -> [UInt8] {
    (0..<4).map { UInt8(truncatingIfNeeded: value >> ($0 * 8)) }
}
private func put(_ bytes: [UInt8], _ offset: Int, in data: inout Data) {
    data.replaceSubrange(offset..<(offset + bytes.count), with: bytes)
}
private func container(type: UInt16, code: UInt16, transaction: UInt32 = 0x12345678,
                       body: Data = Data()) -> Data {
    Data(le32(UInt32(12 + body.count)) + le16(type) + le16(code) + le32(transaction)) + body
}
private func event(_ code: UInt32, words: [UInt32] = []) -> Data {
    Data(le32(UInt32(8 + words.count * 4)) + le32(code) + words.flatMap(le32))
}
private func deviceInfo(description: String = "Canon", operations: [UInt16]) -> Data {
    let text = Array(description.utf16) + [UInt16(0)]
    return Data(le16(100) + le32(11) + le16(100) + [UInt8(text.count)]
        + text.flatMap(le16) + le16(0) + le32(UInt32(operations.count)) + operations.flatMap(le16))
}
private func photoEvent(_ code: UInt32 = 0xc181, handle: UInt32 = 0xA1020304,
                        name: String = "IMG_0042.JPG", size: UInt32 = 6_291_456,
                        format: UInt16 = 0x3801, highSize: UInt32 = 0,
                        terminated: Bool = true) -> Data {
    let nameOffset = code == 0xc1a7 ? 0x2c : 0x28
    let bytes = Array(name.utf8) + (terminated ? [UInt8(0)] : [])
    var result = Data(repeating: 0, count: nameOffset + bytes.count)
    put(le32(UInt32(result.count)), 0, in: &result)
    put(le32(code), 4, in: &result)
    put(le32(handle), 8, in: &result)
    put(le32(0x00010001), 0x0c, in: &result)
    put(le16(format), 0x10, in: &result)
    put(le32(size), 0x1c, in: &result)
    if code == 0xc1a7 { put(le32(highSize), 0x20, in: &result) }
    put(bytes, nameOffset, in: &result)
    return result
}

@main
private struct CanonPTPTests {
    static func main() {
        var passed = 0, failures: [String] = []
        func test(_ name: String, _ run: () throws -> Void) {
            do { try run(); passed += 1 }
            catch { failures.append("\(name): \(error)") }
        }

        test("command is an exact little-endian PTP command container") {
            let result = CanonPTP.command(0x9128, transaction: 0xA1B2C3D4, parameters: [0x01020304, 0xFEDCBA98])
            try check(Array(result) == [20,0,0,0, 1,0, 0x28,0x91, 0xD4,0xC3,0xB2,0xA1,
                                        4,3,2,1, 0x98,0xBA,0xDC,0xFE], "Unexpected wire command bytes")
        }
        test("parameterless command has a 12 byte header") {
            try check(Array(CanonPTP.command(0x1001, transaction: 0)) ==
                [12,0,0,0, 1,0, 1,0x10, 0,0,0,0], "Wrong no-parameter command")
        }
        test("unaligned integer reads are little endian") {
            let bytes = Data([0xEE, 0x78, 0x56, 0x34, 0x12])
            try check(try CanonPTP.u16(bytes, 1) == 0x5678, "Wrong u16")
            try check(try CanonPTP.u32(bytes, 1) == 0x12345678, "Wrong u32")
        }
        test("out-of-bounds integer reads reject") {
            for offset in [-1, 0, 1, 2] {
                try rejects { _ = try CanonPTP.u16(Data([0]), offset) }
                try rejects { _ = try CanonPTP.u32(Data([0]), offset) }
            }
        }
        test("data container unwraps only exact operation and length") {
            let body = Data([1, 2, 3, 4])
            let packet = container(type: 2, code: 0x9116, body: body)
            try check(try CanonPTP.payload(packet, operation: 0x9116) == body, "Did not unwrap valid payload")
            try check(try CanonPTP.payload(packet, operation: 0x1001) == packet, "Unwrapped different operation")
            let wrongType = container(type: 1, code: 0x9116, body: body)
            try check(try CanonPTP.payload(wrongType, operation: 0x9116) == wrongType, "Unwrapped command as data")
            let extra = packet + Data([0])
            try check(try CanonPTP.payload(extra, operation: 0x9116) == extra, "Unwrapped inexact length")
        }
        test("short/raw data payload remains intact") {
            for count in 0..<12 {
                let bytes = Data(repeating: 0xFF, count: count)
                try check(try CanonPTP.payload(bytes, operation: 0x9116) == bytes, "Changed raw payload")
            }
        }
        test("successful PTP response accepts optional response parameter") {
            try CanonPTP.validate(container(type: 3, code: 0x2001))
            try CanonPTP.validate(container(type: 3, code: 0x2001, body: Data(le32(128))))
        }
        test("all truncated PTP response prefixes reject") {
            let packet = container(type: 3, code: 0x2001)
            for count in 0..<packet.count {
                try rejects { try CanonPTP.validate(Data(packet.prefix(count))) }
            }
        }
        test("wrong PTP response type and length reject") {
            try rejects { try CanonPTP.validate(container(type: 2, code: 0x2001)) }
            try rejects { try CanonPTP.validate(container(type: 3, code: 0x2001) + Data([0])) }
            var packet = container(type: 3, code: 0x2001)
            put(le32(0xFFFFFFFF), 0, in: &packet)
            try rejects { try CanonPTP.validate(packet) }
        }
        test("0x2019 is a recoverable busy response with actionable text") {
            do { try CanonPTP.validate(container(type: 3, code: 0x2019)) }
            catch CanonPTP.Failure.response(let code) {
                try check(code == 0x2019, "Lost busy response code")
                let message = CanonPTP.Failure.response(code).localizedDescription
                try check(message.lowercased().contains("busy") && message.contains("Stop USB"), "Missing busy recovery guidance")
                return
            }
            throw CheckFailure.failed("Busy did not throw response failure")
        }
        test("unknown PTP response preserves hexadecimal error") {
            do { try CanonPTP.validate(container(type: 3, code: 0xA123)) }
            catch CanonPTP.Failure.response(let code) {
                try check(code == 0xA123 && CanonPTP.Failure.response(code).localizedDescription.contains("A123"), "Lost unknown response code")
                return
            }
            throw CheckFailure.failed("Unknown failure did not reject")
        }
        test("deviceinfo parses advertised operations past UTF16 vendor text") {
            let ops: Set<UInt16> = [0x1001, 0x1002, 0x101B, 0x9114, 0x9115, 0x9116]
            try check(try CanonPTP.operations(deviceInfo(description: "Canon EOS", operations: Array(ops))) == ops, "Wrong operation set")
        }
        test("deviceinfo accepts zero-length vendor description and operation list") {
            let packet = Data(le16(100) + le32(11) + le16(100) + [0] + le16(0) + le32(0))
            try check(try CanonPTP.operations(packet).isEmpty, "Zero operation list is not empty")
        }
        test("all truncated deviceinfo prefixes reject") {
            let packet = deviceInfo(operations: [0x1001, 0x9116])
            for count in 0..<packet.count {
                try rejects { _ = try CanonPTP.operations(Data(packet.prefix(count))) }
            }
        }
        test("deviceinfo rejects oversized operation and vendor string counts") {
            var packet = deviceInfo(operations: [])
            put(le32(4097), packet.count - 4, in: &packet)
            try rejects { _ = try CanonPTP.operations(packet) }
            packet = deviceInfo(operations: [0x1001]); packet[8] = 255
            try rejects { _ = try CanonPTP.operations(packet) }
        }
        test("ObjectAddedEx field offsets return exact handle/name/size") {
            let result = try CanonPTP.events(photoEvent())
            try check(result.photos.count == 1, "JPEG was not discovered")
            try check(result.photos[0].handle == 0xA1020304 && result.photos[0].name == "IMG_0042.JPG"
                && result.photos[0].size == 6_291_456, "Wrong ObjectAddedEx fields")
        }
        test("ObjectAddedEx64 field offsets return independent new handle") {
            let result = try CanonPTP.events(photoEvent(0xc1a7, handle: 0x99FEDCBA, name: "IMG_0043.JPEG", size: 8_388_607))
            try check(result.photos.count == 1 && result.photos[0].handle == 0x99FEDCBA
                && result.photos[0].name == "IMG_0043.JPEG" && result.photos[0].size == 8_388_607, "Wrong ObjectAddedEx64 fields")
        }
        test("multiple JPEG events preserve camera order across unknown events") {
            let packet = photoEvent(handle: 1) + event(0xC1FF, words: [0xBEEF]) + photoEvent(0xc1a7, handle: 2)
            try check(try CanonPTP.events(packet).photos.map(\.handle) == [1, 2], "Lost or reordered event")
        }
        test("non-JPEG object formats and extensions are ignored") {
            let packets = [photoEvent(name: "IMG_0042.CR3", format: 0xB108),
                           photoEvent(name: "IMG_0042.CR3"), photoEvent(name: "IMG_0042.JPG", format: 0x380B),
                           photoEvent(name: "MOV_0042.MP4", format: 0xB982)]
            for packet in packets { try check(try CanonPTP.events(packet).photos.isEmpty, "Accepted unsupported object") }
        }
        test("JPEG matching is case insensitive and removes directory traversal") {
            let result = try CanonPTP.events(photoEvent(name: "../../DCIM/IMG_0042.jPeG"))
            try check(result.photos.count == 1 && result.photos[0].name == "IMG_0042.jPeG", "Unsafe or lost camera basename")
        }
        test("bounded JPEG path accepts the 40 MiB limit") {
            let result = try CanonPTP.events(photoEvent(size: 40 * 1024 * 1024))
            try check(result.photos.first?.size == 40 * 1024 * 1024, "Rejected valid boundary")
        }
        test("zero and excessive JPEG sizes reject") {
            for size: UInt32 in [0, 40 * 1024 * 1024 + 1, UInt32.max] {
                try rejects { _ = try CanonPTP.events(photoEvent(size: size)) }
            }
            try rejects { _ = try CanonPTP.events(photoEvent(0xc1a7, highSize: 1)) }
        }
        test("card capture destination and busy state use property/event offsets") {
            let packet = event(0xc189, words: [0xd11c, 1]) + event(0xc18b, words: [1])
            let result = try CanonPTP.events(packet)
            try check(result.destination == 1 && result.cameraBusy == true, "Wrong destination/busy values")
            let ready = try CanonPTP.events(event(0xc18b, words: [0]))
            try check(ready.cameraBusy == false, "Camera readiness did not clear")
        }
        test("unrelated properties do not impersonate capture destination") {
            let result = try CanonPTP.events(event(0xc189, words: [0xd11d, 2]))
            try check(result.destination == nil && result.cameraBusy == nil && result.photos.isEmpty, "Misidentified unrelated property")
        }
        test("unrelated variable-length properties may have short string values") {
            // Property payloads are typed by their property code; an empty
            // ASCII string is not a truncated capture-destination u32 value.
            var packet = event(0xc189, words: [0xd1d0]) + Data([0])
            put(le32(UInt32(packet.count)), 0, in: &packet)
            let result = try CanonPTP.events(packet)
            try check(result.destination == nil && result.photos.isEmpty, "Misread an unrelated string property")
        }
        test("latest destination and readiness values win within one event batch") {
            let result = try CanonPTP.events(event(0xc189, words: [0xd11c, 1]) + event(0xc189, words: [0xd11c, 3])
                + event(0xc18b, words: [1]) + event(0xc18b, words: [0]))
            try check(result.destination == 3 && result.cameraBusy == false, "Retained stale property")
        }
        test("empty event data and terminator produce no photos") {
            try check(try CanonPTP.events(Data()).photos.isEmpty, "Empty events not accepted")
            try check(try CanonPTP.events(event(0)).photos.isEmpty, "Terminator not accepted")
        }
        test("baseline record count distinguishes property-only batch from empty") {
            try check(try CanonPTP.events(Data()).recordCount == 0, "Empty batch has records")
            try check(try CanonPTP.events(event(0)).recordCount == 0, "Terminator counted as camera record")
            let batch = event(0xc189, words: [0xd11c, 1]) + event(0xC1FF) + event(0)
            let result = try CanonPTP.events(batch)
            try check(result.recordCount == 2 && result.photos.isEmpty, "Property-only baseline looked empty")
        }
        test("unknown event is skipped without consuming subsequent valid event") {
            let result = try CanonPTP.events(event(0xDEADBEEF) + event(0xc189, words: [0xd11c, 1]))
            try check(result.photos.isEmpty && result.destination == 1, "Unknown event broke following event")
        }
        test("all truncated photo-event prefixes reject safely") {
            for packet in [photoEvent(), photoEvent(0xc1a7)] {
                for count in 1..<packet.count {
                    try rejects { _ = try CanonPTP.events(Data(packet.prefix(count))) }
                }
            }
        }
        test("malformed event envelope lengths reject") {
            for length: UInt32 in [0, 1, 7, 9, UInt32.max] {
                try rejects { _ = try CanonPTP.events(Data(le32(length) + le32(0xC1FF))) }
            }
            try rejects { _ = try CanonPTP.events(event(0xC1FF) + Data([0])) }
        }
        test("known event payload truncations reject") {
            try rejects { _ = try CanonPTP.events(event(0xc189)) }
            try rejects { _ = try CanonPTP.events(event(0xc189, words: [0xd11c])) }
            try rejects { _ = try CanonPTP.events(event(0xc18b)) }
        }
        test("empty, invalid UTF8, overlong and unterminated filenames reject") {
            try rejects { _ = try CanonPTP.events(photoEvent(name: "")) }
            try rejects { _ = try CanonPTP.events(photoEvent(name: String(repeating: "A", count: 256) + ".JPG")) }
            try rejects { _ = try CanonPTP.events(photoEvent(terminated: false)) }
            var badUTF8 = photoEvent(); badUTF8[0x28] = 0xFF
            try rejects { _ = try CanonPTP.events(badUTF8) }
        }
        test("oversized event responses reject before parsing") {
            try rejects { _ = try CanonPTP.events(Data(repeating: 0, count: 4 * 1024 * 1024 + 1)) }
        }

        for failure in failures { print("FAIL \(failure)") }
        print("CanonPTP: \(passed) fixture groups passed, \(failures.count) failed")
        if !failures.isEmpty { exit(1) }
    }
}
