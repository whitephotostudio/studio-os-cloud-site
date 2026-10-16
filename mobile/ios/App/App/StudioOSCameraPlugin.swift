import Foundation
import UIKit
import Capacitor
import ImageCaptureCore
import ImageIO

@objc(StudioOSCameraPlugin)
public final class StudioOSCameraPlugin: CAPPlugin, CAPBridgedPlugin, ICDeviceBrowserDelegate, ICCameraDeviceDelegate {
    public let identifier = "StudioOSCameraPlugin"
    public let jsName = "StudioOSCamera"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "capture", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listPhotos", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readPhoto", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "acknowledgePhoto", returnType: CAPPluginReturnPromise)
    ]

    private struct Pending: Codable {
        let id: String
        let name: String
        let size: Int
        let createdAt: Double
        var json: JSObject { ["id": id, "name": name, "size": size, "mimeType": "image/jpeg"] }
    }
    private struct Transfer {
        let photo: CanonPTP.Photo
        let file: ICCameraFile?
    }
    private var browser: ICDeviceBrowser?
    private var camera: ICCameraDevice?
    private var ownerID: String?
    private var state = "disconnected"
    private var message = "Connect a camera with a USB data cable, then tap Connect USB."
    private var cameraName: String?
    private var canCapture = false
    private var generation = UUID()
    private var transaction: UInt32 = 0
    private var commandInFlight = false
    private var commandTimeout: DispatchWorkItem?
    private var connectionTimeout: DispatchWorkItem?
    private var captureTimeout: DispatchWorkItem?
    private var pollTimer: Timer?
    private var seenHandles = Set<UInt32>()
    private var pending: [Pending] = []
    private var transfers: [Transfer] = []
    private var transfer: Transfer?
    private var transferID: String?
    private var transferHandle: FileHandle?
    private var transferOffset = 0
    private var transferStarted: Date?
    private var canonEOS = false
    private var remoteModeRequested = false
    private var eventModeRequested = false
    private var eosDestination: UInt32?
    private var eosBusy = false
    private var supportsKeepAlive = false
    private var lastKeepAlive = Date()
    private var captureWaiting = false
    private var captureCall: CAPPluginCall?
    private var baselineComplete = false
    private var acceptingPhotos = false
    private var backgroundObserver: NSObjectProtocol?
    private var navigationObserver: NSKeyValueObservation?
    private var closingSession = false
    private var retiringCamera: ICCameraDevice?
    private var teardownToken = UUID()
    private var backgroundTask: UIBackgroundTaskIdentifier = .invalid

    public override func load() {
        backgroundObserver = NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
            guard let self = self else { return }
            if self.camera != nil && self.backgroundTask == .invalid {
                self.backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "Release USB camera") { [weak self] in
                    self?.retiringCamera?.requestCloseSession()
                    self?.endBackgroundTask()
                }
            }
            self.detach(message: "USB camera disconnected while Studio OS is in the background. Reconnect when you return.")
        }
        navigationObserver = bridge?.webView?.observe(\.url, options: [.new]) { [weak self] _, _ in
            guard let self = self, !self.trustedOrigin else { return }
            self.detach(message: "USB camera disconnected after leaving Studio OS.")
            self.ownerID = nil
            self.pending = []
        }
    }
    deinit {
        if let observer = backgroundObserver { NotificationCenter.default.removeObserver(observer) }
        pollTimer?.invalidate()
        commandTimeout?.cancel(); connectionTimeout?.cancel(); captureTimeout?.cancel()
        try? transferHandle?.close()
        camera?.requestCloseSession()
        browser?.stop()
    }
    private var trustedOrigin: Bool {
        guard let url = bridge?.webView?.url, let configured = bridge?.config.serverURL,
              configured.scheme == "https", ["www.studiooscloud.com", "studiooscloud.com"].contains(configured.host ?? "") else { return false }
        return url.scheme == configured.scheme && url.host == configured.host && url.port == configured.port
    }
    private func authorized(_ call: CAPPluginCall, requiresOwner: Bool = true, checkOwner: Bool = true) -> Bool {
        guard trustedOrigin else { call.reject("USB camera access is available only on the configured secure Studio OS site."); return false }
        if requiresOwner {
            guard let requested = call.getString("ownerId"), let owner = UUID(uuidString: requested),
                  ownerID != nil, owner.uuidString.lowercased() == ownerID else {
                call.reject("Reconnect USB for the signed-in photographer before accessing photos or capture."); return false
            }
        }
        if checkOwner, let requested = call.getString("ownerId"), UUID(uuidString: requested)?.uuidString.lowercased() != ownerID {
            call.reject("USB photos belong to a different photographer. Reconnect for this account."); return false
        }
        return true
    }
    private func status() -> JSObject {
        var result: JSObject = ["state": state, "message": message, "canCapture": canCapture && state == "ready"]
        if let name = cameraName { result["cameraName"] = name }
        return result
    }
    private func setStatus(_ next: String, _ detail: String) {
        let changed = state != next || message != detail
        state = next; message = detail
        if changed && trustedOrigin { notifyListeners("statusChanged", data: status()) }
    }
    @objc public func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, self.authorized(call, requiresOwner: false, checkOwner: false) else { return }
            guard let id = call.getString("ownerId"), let owner = UUID(uuidString: id) else { call.reject("A valid signed-in photographer ID is required."); return }
            if self.closingSession, self.retiringCamera?.hasOpenSession == false {
                self.closingSession = false; self.retiringCamera = nil
            }
            guard !self.closingSession else { call.reject("Camera is disconnecting. Wait a moment, then reconnect."); return }
            let normalized = owner.uuidString.lowercased()
            if self.browser != nil, self.ownerID == normalized { call.resolve(self.status()); return }
            if self.camera != nil || self.browser != nil {
                self.detach(message: "Camera disconnected. Reconnect for this photographer.")
                call.reject("Camera is disconnecting. Wait a moment, then reconnect."); return
            }
            self.ownerID = normalized
            do { self.pending = try self.loadPending() } catch { call.reject("Could not open private USB photo storage: \(error.localizedDescription)"); return }
            let session = UUID(); self.generation = session
            self.canCapture = false; self.cameraName = nil
            self.setStatus("searching", "Allow USB camera access, unlock your iPhone, and connect the powered-on camera with a data cable.")
            let browser = ICDeviceBrowser(); self.browser = browser; browser.delegate = self
            if #available(iOS 15.2, *) { browser.browsedDeviceTypeMask = ICDeviceTypeMask(rawValue: ICDeviceTypeMask.camera.rawValue | ICDeviceLocationTypeMask.local.rawValue)! }
            browser.requestContentsAuthorization { [weak self, weak browser] status in
                DispatchQueue.main.async {
                    guard let self = self, let browser = browser, self.generation == session, self.browser === browser else { return }
                    guard status == .authorized else { self.fail("Allow external camera access in iPhone Settings, then reconnect USB."); return }
                    browser.requestControlAuthorization { [weak self, weak browser] status in
                        DispatchQueue.main.async {
                            guard let self = self, let browser = browser, self.generation == session, self.browser === browser else { return }
                            guard status == .authorized else { self.fail("Allow camera control in iPhone Settings, then reconnect USB."); return }
                            self.armConnectionTimeout(session, seconds: 30, detail: "No USB camera was found. Use a data-capable cable, unlock iPhone, close Photos and Canon Camera Connect, and reconnect.")
                            browser.start()
                        }
                    }
                }
            }
            call.resolve(self.status())
        }
    }
    @objc public func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, self.authorized(call, requiresOwner: false) else { return }
            self.detach(message: "USB disconnected. Photos already received stay here until you import or discard them.")
            call.resolve(self.status())
        }
    }
    @objc public func getStatus(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, self.authorized(call, requiresOwner: false) else { return }
            call.resolve(self.status())
        }
    }
    @objc public func capture(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, self.authorized(call) else { return }
            guard self.state == "ready", self.canCapture, !self.commandInFlight, self.transfer == nil, !self.captureWaiting, !self.eosBusy else { call.reject("Camera is not ready. Wait for Ready before taking a photo."); return }
            let session = self.generation
            self.captureWaiting = true
            self.captureCall = call
            self.setStatus("busy", "Camera shutter requested. Waiting for the new JPEG; check focus and use single-shot drive mode.")
            let timeout = DispatchWorkItem { [weak self] in
                guard let self = self, self.generation == session, self.captureWaiting else { return }
                self.fail("No new JPEG arrived after the shutter request. Check focus, JPEG recording and camera single-shot mode, then reconnect USB. No automatic retry was sent.")
            }
            self.captureTimeout = timeout
            DispatchQueue.main.asyncAfter(deadline: .now() + 30, execute: timeout)
            if self.canonEOS {
                // One half/full press sequence. Every branch releases the shutter
                // before teardown; an error never automatically repeats a capture.
                self.send(0x9128, [1, 0]) { [weak self] result in
                    guard let self = self, self.generation == session else { return }
                    guard self.succeeded(result) else { return }
                    self.send(0x9128, [2, 0]) { [weak self] result in
                        guard let self = self, self.generation == session else { return }
                        guard self.succeeded(result) else { return }
                        self.send(0x9129, [2]) { [weak self] result in
                            guard let self = self, self.generation == session else { return }
                            guard self.succeeded(result) else { return }
                            self.send(0x9129, [1]) { [weak self] result in
                                guard let self = self, self.generation == session else { return }
                                guard self.succeeded(result) else { return }
                                self.captureCall = nil; call.resolve(["dispatched": true]); self.pollEOS()
                            }
                        }
                    }
                }
            } else {
                self.send(0x100e, [0, 0]) { [weak self] result in
                    guard let self = self, self.generation == session else { return }
                    guard self.succeeded(result) else { return }
                    self.captureCall = nil; call.resolve(["dispatched": true])
                    // A camera may announce its JPEG before InitiateCapture's
                    // response. Resume a transfer queued while the command ran.
                    self.startTransfer()
                }
            }
        }
    }
    @objc public func listPhotos(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, self.authorized(call) else { return }
            call.resolve(["photos": self.pending.map(\.json)])
        }
    }
    @objc public func readPhoto(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, self.authorized(call) else { return }
            guard let id = call.getString("id"), let photo = self.pending.first(where: { $0.id == id }) else { call.reject("USB photo was not found for this photographer."); return }
            let offset = call.getInt("offset") ?? 0, length = call.getInt("length") ?? CanonPTP.chunkBytes
            guard offset >= 0, offset <= photo.size, length > 0, length <= CanonPTP.chunkBytes else { call.reject("Invalid photo read range (maximum 262144 bytes)."); return }
            do {
                let handle = try FileHandle(forReadingFrom: self.photoURL(id)); defer { try? handle.close() }
                try handle.seek(toOffset: UInt64(offset))
                let data = try handle.read(upToCount: min(length, photo.size - offset)) ?? Data()
                guard data.count == min(length, photo.size - offset) else { throw CanonPTP.Failure.invalid("USB photo is incomplete.") }
                call.resolve(["data": data.base64EncodedString(), "done": offset + data.count == photo.size])
            } catch { call.reject(error.localizedDescription) }
        }
    }
    @objc public func acknowledgePhoto(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, self.authorized(call) else { return }
            guard let id = call.getString("id"), self.pending.contains(where: { $0.id == id }) else { call.reject("USB photo was not found for this photographer."); return }
            do {
                for url in [try self.photoURL(id), try self.photoURL(id, ext: "json")] {
                    if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
                }
                self.pending.removeAll { $0.id == id }; call.resolve()
            } catch { call.reject("Could not remove the local USB copy: \(error.localizedDescription)") }
        }
    }

    private func directory() throws -> URL {
        guard let owner = ownerID else { throw CanonPTP.Failure.invalid("Photographer is not selected.") }
        let root = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        var url = root.appendingPathComponent("StudioOSCamera", isDirectory: true).appendingPathComponent(owner, isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        var values = URLResourceValues(); values.isExcludedFromBackup = true; try url.setResourceValues(values)
        return url
    }
    private func photoURL(_ id: String, ext: String = "jpg") throws -> URL {
        guard UUID(uuidString: id) != nil else { throw CanonPTP.Failure.invalid("Invalid USB photo ID.") }
        return try directory().appendingPathComponent(id).appendingPathExtension(ext)
    }
    private func loadPending() throws -> [Pending] {
        let root = try directory()
        var results: [Pending] = []
        for url in try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil) {
            if url.pathExtension == "partial" { try? FileManager.default.removeItem(at: url); continue }
            guard url.pathExtension == "json", let value = try? JSONDecoder().decode(Pending.self, from: Data(contentsOf: url)),
                  UUID(uuidString: value.id) != nil, value.size > 0, value.size <= CanonPTP.maxPhotoBytes,
                  let attributes = try? FileManager.default.attributesOfItem(atPath: photoURL(value.id).path),
                  (attributes[.size] as? NSNumber)?.intValue == value.size else { continue }
            results.append(value)
        }
        return results.sorted { $0.createdAt < $1.createdAt }
    }
    private func armConnectionTimeout(_ session: UUID, seconds: Double, detail: String) {
        connectionTimeout?.cancel()
        let task = DispatchWorkItem { [weak self] in guard let self = self, self.generation == session else { return }; self.fail(detail) }
        connectionTimeout = task
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: task)
    }
    private func fail(_ detail: String) {
        detach(message: detail)
        setStatus("error", detail)
    }
    private func succeeded(_ result: Result<Data, Error>) -> Bool {
        if case .failure(let error) = result { fail(error.localizedDescription); return false }
        return true
    }
    private func send(_ operation: UInt16, _ parameters: [UInt32] = [], completion: @escaping (Result<Data, Error>) -> Void) {
        guard let camera = camera, camera.hasOpenSession, !commandInFlight else { completion(.failure(CanonPTP.Failure.invalid("USB camera session is not ready."))); return }
        let session = generation, token = UUID()
        transaction &+= 1
        commandInFlight = true
        let timeout = DispatchWorkItem { [weak self] in
            guard let self = self, self.generation == session, self.commandInFlight else { return }
            self.commandInFlight = false
            completion(.failure(CanonPTP.Failure.invalid("USB camera command timed out. Stop USB, close other camera apps, turn the camera off and on, then reconnect.")))
        }
        // UUID retained by closure so callbacks from a timed-out earlier command
        // can never complete a subsequent command in the same connection.
        activeCommandToken = token; commandTimeout = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 15, execute: timeout)
        camera.requestSendPTPCommand(CanonPTP.command(operation, transaction: transaction, parameters: parameters), outData: nil) { [weak self] data, response, error in
            DispatchQueue.main.async {
                guard let self = self, self.generation == session, self.activeCommandToken == token, self.commandInFlight else { return }
                self.commandInFlight = false; self.commandTimeout?.cancel(); self.commandTimeout = nil
                if let error = error { completion(.failure(error)); return }
                do { try CanonPTP.validate(response); completion(.success(try CanonPTP.payload(data, operation: operation))) }
                catch { completion(.failure(error)) }
            }
        }
    }
    private var activeCommandToken = UUID()

    private func detach(message detail: String) {
        generation = UUID(); activeCommandToken = UUID()
        captureCall?.reject(detail); captureCall = nil
        commandTimeout?.cancel(); connectionTimeout?.cancel(); captureTimeout?.cancel()
        pollTimer?.invalidate(); pollTimer = nil
        commandInFlight = false; acceptingPhotos = false; baselineComplete = false
        canCapture = false; captureWaiting = false; eosBusy = false
        transfers = []; transfer = nil
        try? transferHandle?.close(); transferHandle = nil
        if let id = transferID, let url = try? photoURL(id, ext: "partial") { try? FileManager.default.removeItem(at: url) }
        transferID = nil; transferOffset = 0
        let oldCamera = camera; camera = nil
        let oldBrowser = browser; browser = nil
        oldBrowser?.delegate = nil; oldBrowser?.stop()
        seenHandles = []
        if let oldCamera = oldCamera {
            oldCamera.delegate = nil
            closingSession = true; retiringCamera = oldCamera
            let cleanupToken = UUID(); teardownToken = cleanupToken
            // The same public PTP path releases both shutter stages and reverses
            // the EOS event/remote settings before closing. Each step is bounded.
            let operations: [(UInt16, [UInt32])] = remoteModeRequested ? [(0x9129,[2]), (0x9129,[1]), (0x9114,[0]), (0x9114,[1]), (0x9115,[0])] : []
            cleanup(oldCamera, operations: operations, index: 0) { [weak self] in
                oldCamera.requestCloseSession(options: nil) { [weak self] error in
                    DispatchQueue.main.async {
                        guard let self = self, self.teardownToken == cleanupToken else { return }
                        if !oldCamera.hasOpenSession {
                            self.closingSession = false; self.retiringCamera = nil
                        } else if error != nil && self.state == "disconnected" {
                            self.setStatus("error", "Camera did not close its USB session. Unplug USB, turn the camera off and on, then reconnect.")
                        }
                        self.endBackgroundTask()
                    }
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
                    guard let self = self, self.teardownToken == cleanupToken else { return }
                    if !oldCamera.hasOpenSession { self.closingSession = false; self.retiringCamera = nil }
                    self.endBackgroundTask()
                }
            }
        }
        if oldCamera == nil { endBackgroundTask() }
        canonEOS = false; remoteModeRequested = false; eventModeRequested = false; eosDestination = nil
        setStatus("disconnected", detail)
    }
    private func endBackgroundTask() {
        if backgroundTask != .invalid { UIApplication.shared.endBackgroundTask(backgroundTask); backgroundTask = .invalid }
    }
    private func cleanup(_ device: ICCameraDevice, operations: [(UInt16, [UInt32])], index: Int, completion: @escaping () -> Void) {
        guard device.hasOpenSession, index < operations.count else { completion(); return }
        var completed = false
        let next = { [weak self] in
            guard !completed else { return }; completed = true
            self?.cleanup(device, operations: operations, index: index + 1, completion: completion)
        }
        let (op, args) = operations[index]
        device.requestSendPTPCommand(CanonPTP.command(op, transaction: UInt32(index + 0xf000), parameters: args), outData: nil) { _, _, _ in DispatchQueue.main.async(execute: next) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            guard !completed else { return }; completed = true
            // Never queue more vendor commands behind an unresponsive one.
            // Closing the session is the final recovery operation.
            completion()
        }
    }

    // MARK: ImageCaptureCore discovery and baseline
    public func deviceBrowser(_ browser: ICDeviceBrowser, didAdd device: ICDevice, moreComing: Bool) {
        guard self.browser === browser, camera == nil, let camera = device as? ICCameraDevice,
              camera.transportType == ICDeviceTransport.transportTypeUSB.rawValue else { return }
        self.camera = camera; cameraName = camera.name ?? "USB camera"
        canonEOS = camera.usbVendorID == 0x04a9 && ["canon eos-1d x mark iii", "canon eos 1d x mark iii", "eos-1d x mark iii"].contains((camera.name ?? "").lowercased())
        camera.delegate = self
        let session = generation
        setStatus("opening", "Opening \(cameraName ?? "camera") and establishing a baseline. Existing card photos will stay on the camera.")
        armConnectionTimeout(session, seconds: 90, detail: "Camera did not finish opening. Close Photos and other camera apps, disconnect USB, turn the camera off and on, then reconnect.")
        camera.requestOpenSession(options: nil) { [weak self, weak camera] error in
            DispatchQueue.main.async {
                guard let self = self, let camera = camera else { return }
                guard self.generation == session, self.camera === camera else { camera.requestCloseSession(); return }
                if let error = error { self.fail("Could not open USB camera: \(error.localizedDescription). Close other camera apps and reconnect.") }
            }
        }
    }
    public func deviceBrowser(_ browser: ICDeviceBrowser, didRemove device: ICDevice, moreGoing: Bool) {
        guard self.browser === browser, self.camera === device else { return }
        detach(message: "USB camera disconnected. Received photos are saved for review.")
    }
    public func deviceDidBecomeReady(withCompleteContentCatalog device: ICCameraDevice) {
        guard camera === device, !baselineComplete else { return }
        baselineComplete = true
        for item in device.mediaFiles ?? [] { seenHandles.insert(item.ptpObjectHandle) }
        guard device.capabilities.contains(ICDeviceCapability.cameraDeviceCanAcceptPTPCommands.rawValue) else {
            configureGeneric(operations: []); return
        }
        send(0x1001) { [weak self] result in
            guard let self = self else { return }
            switch result {
            case .failure(let error): self.fail(error.localizedDescription)
            case .success(let data):
                do {
                    let operations = try CanonPTP.operations(data)
                    if self.canonEOS { self.configureEOS(operations) } else { self.configureGeneric(operations: operations) }
                } catch { self.fail(error.localizedDescription) }
            }
        }
    }
    private func configureGeneric(operations: Set<UInt16>) {
        guard let camera = camera else { return }
        canCapture = operations.contains(0x100e)
        let physical = camera.capabilities.contains(ICDeviceCapability.cameraDeviceCanTakePictureUsingShutterReleaseOnCamera.rawValue)
        guard canCapture || physical else {
            fail("\(cameraName ?? "This camera") exposes photo import only on this iPhone. USB capture is not supported by this connection; disconnect the cable to clear Busy and use the photo picker or a supported tethering connection.")
            return
        }
        acceptingPhotos = true; connectionTimeout?.cancel()
        setStatus("ready", canCapture ? "USB ready. Take a single JPEG; review each received photo before importing it for a student." : "USB ready for the camera shutter. Take a JPEG on the camera, then review it before importing it for a student.")
    }
    private func configureEOS(_ operations: Set<UInt16>) {
        let required: Set<UInt16> = [0x9114, 0x9115, 0x9116, 0x9128, 0x9129, 0x101b]
        guard required.isSubset(of: operations) else { fail("This Canon firmware did not advertise the USB remote commands required for EOS-1D X Mark III. Disconnect USB to clear Busy; update or check camera firmware before retrying."); return }
        supportsKeepAlive = operations.contains(0x911d); lastKeepAlive = Date()
        remoteModeRequested = true
        send(0x9114, [1]) { [weak self] result in
            guard let self = self, self.succeeded(result) else { return }
            self.eventModeRequested = true
            self.send(0x9115, [1]) { [weak self] result in
                guard let self = self, self.succeeded(result) else { return }
                self.drainBaseline(remaining: 12)
            }
        }
    }
    private func drainBaseline(remaining: Int) {
        send(0x9116) { [weak self] result in
            guard let self = self else { return }
            switch result {
            case .failure(let error): self.fail(error.localizedDescription)
            case .success(let data):
                do {
                    let events = try CanonPTP.events(data)
                    self.eosDestination = events.destination ?? self.eosDestination
                    self.eosBusy = events.cameraBusy ?? self.eosBusy
                    events.photos.forEach { self.seenHandles.insert($0.handle) }
                    guard remaining > 0 else { self.fail("Canon did not finish its USB baseline. Stop USB, wait for the camera to finish writing, then reconnect."); return }
                    if events.recordCount == 0, let destination = self.eosDestination {
                        guard destination != 4 && destination != 0 else { self.fail("Canon is set to capture to a computer only. Disconnect USB, set capture to the camera card, then reconnect. Studio OS keeps originals on the card."); return }
                        self.canCapture = true; self.acceptingPhotos = true; self.connectionTimeout?.cancel()
                        self.setStatus(self.eosBusy ? "busy" : "ready", self.eosBusy ? "Canon is writing a photo. Wait before taking another shot." : "Canon USB ready. Use single-shot JPEG capture; review each received photo before importing it for a student.")
                        self.pollTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in self?.pollEOS() }
                    } else {
                        let session = self.generation
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { [weak self] in guard let self = self, self.generation == session else { return }; self.drainBaseline(remaining: remaining - 1) }
                    }
                } catch { self.fail(error.localizedDescription) }
            }
        }
    }
    private func pollEOS() {
        guard canonEOS, acceptingPhotos, !commandInFlight, transfer == nil else { return }
        if supportsKeepAlive && !captureWaiting && Date().timeIntervalSince(lastKeepAlive) >= 20 {
            lastKeepAlive = Date()
            send(0x911d) { [weak self] result in _ = self?.succeeded(result) }
            return
        }
        send(0x9116) { [weak self] result in
            guard let self = self else { return }
            switch result {
            case .failure(let error): self.fail(error.localizedDescription)
            case .success(let data):
                do {
                    let events = try CanonPTP.events(data)
                    if let destination = events.destination, destination == 4 || destination == 0 { self.fail("Canon capture destination changed away from the camera card. USB stopped to protect originals; restore card capture and reconnect."); return }
                    self.eosBusy = events.cameraBusy ?? self.eosBusy
                    for photo in events.photos { self.enqueue(Transfer(photo: photo, file: nil)) }
                    if self.transfer == nil && self.transfers.isEmpty && !self.captureWaiting {
                        self.setStatus(self.eosBusy ? "busy" : "ready", self.eosBusy ? "Canon is writing. Wait for Ready." : "Canon USB ready. Review received JPEGs before importing them for a student.")
                    }
                } catch { self.fail(error.localizedDescription) }
            }
        }
    }

    // MARK: bounded sequential transfer; never deletes on camera
    private func enqueue(_ value: Transfer) {
        guard acceptingPhotos, !seenHandles.contains(value.photo.handle) else { return }
        seenHandles.insert(value.photo.handle)
        guard value.photo.size > 0, value.photo.size <= CanonPTP.maxPhotoBytes, transfers.count < 32,
              pending.count + transfers.count + (transfer == nil ? 0 : 1) < 200,
              pending.reduce(0, { $0 + $1.size }) + transfers.reduce(0, { $0 + $1.photo.size }) + (transfer?.photo.size ?? 0) + value.photo.size <= 1024 * 1024 * 1024 else {
            fail("USB queue is full or the JPEG is too large. Original photos remain on the camera card. Import saved photos before reconnecting."); return
        }
        captureWaiting = false; captureTimeout?.cancel()
        transfers.append(value)
        startTransfer()
    }
    private func startTransfer() {
        guard transfer == nil, !commandInFlight, !transfers.isEmpty, acceptingPhotos else { return }
        let value = transfers.removeFirst(), id = UUID().uuidString.lowercased()
        do {
            let partial = try photoURL(id, ext: "partial")
            let capacity = try directory().resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]).volumeAvailableCapacityForImportantUsage ?? 0
            guard capacity > Int64(value.photo.size + 64 * 1024 * 1024) else { throw CanonPTP.Failure.invalid("iPhone storage is too low to receive this JPEG. Original photos remain on the camera card.") }
            guard FileManager.default.createFile(atPath: partial.path, contents: nil, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]) else { throw CanonPTP.Failure.invalid("Could not create private USB photo storage.") }
            transferHandle = try FileHandle(forWritingTo: partial)
            transfer = value; transferID = id; transferOffset = 0; transferStarted = Date()
            setStatus("busy", "Receiving \(value.photo.name). Keep USB connected.")
            readNextChunk()
        } catch { fail(error.localizedDescription) }
    }
    private func readNextChunk() {
        guard let value = transfer, let id = transferID, let started = transferStarted else { return }
        guard Date().timeIntervalSince(started) < 120 else { fail("JPEG transfer timed out. Original photo remains on the card. Stop USB and reconnect."); return }
        let session = generation, offset = transferOffset, length = min(CanonPTP.chunkBytes, value.photo.size - offset)
        let completion: (Result<Data, Error>) -> Void = { [weak self] result in
            guard let self = self, self.generation == session, self.transferID == id else { return }
            switch result {
            case .failure(let error): self.fail("JPEG transfer failed: \(error.localizedDescription). Original photo remains on the card.")
            case .success(let data):
                guard data.count == length else { self.fail("Camera returned an incomplete JPEG chunk. Original photo remains on the card; reconnect USB to recover."); return }
                do {
                    try self.transferHandle?.write(contentsOf: data); self.transferOffset += data.count
                    if self.transferOffset == value.photo.size { try self.finishTransfer(value, id: id) }
                    else { self.readNextChunk() }
                } catch { self.fail(error.localizedDescription) }
            }
        }
        if let file = value.file {
            commandInFlight = true
            let token = UUID(); activeCommandToken = token
            let timeout = DispatchWorkItem { [weak self] in
                guard let self = self, self.generation == session, self.activeCommandToken == token else { return }
                self.commandInFlight = false; completion(.failure(CanonPTP.Failure.invalid("USB JPEG read timed out.")))
            }
            commandTimeout = timeout; DispatchQueue.main.asyncAfter(deadline: .now() + 15, execute: timeout)
            file.requestReadData(atOffset: off_t(offset), length: off_t(length)) { [weak self] data, error in
                DispatchQueue.main.async {
                    guard let self = self, self.generation == session, self.activeCommandToken == token, self.commandInFlight else { return }
                    self.commandInFlight = false; self.commandTimeout?.cancel()
                    if let error = error { completion(.failure(error)) }
                    else { completion(.success(data ?? Data())) }
                }
            }
        } else { send(0x101b, [value.photo.handle, UInt32(offset), UInt32(length)], completion: completion) }
    }
    private func finishTransfer(_ value: Transfer, id: String) throws {
        try transferHandle?.synchronize(); try transferHandle?.close(); transferHandle = nil
        let partial = try photoURL(id, ext: "partial")
        guard let source = CGImageSourceCreateWithURL(partial as CFURL, nil), CGImageSourceGetStatus(source) == .statusComplete,
              CGImageSourceGetCount(source) == 1, CGImageSourceGetType(source) as String? == "public.jpeg" else {
            throw CanonPTP.Failure.invalid("Camera transfer was not a complete JPEG. Original remains on the card.")
        }
        let photo = Pending(id: id, name: value.photo.name, size: value.photo.size, createdAt: Date().timeIntervalSince1970)
        let final = try photoURL(id)
        try FileManager.default.moveItem(at: partial, to: final)
        do { try JSONEncoder().encode(photo).write(to: photoURL(id, ext: "json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]) }
        catch { try? FileManager.default.moveItem(at: final, to: partial); throw error }
        pending.append(photo)
        transfer = nil; transferID = nil; transferOffset = 0
        if trustedOrigin { notifyListeners("photoReady", data: photo.json) }
        if transfers.isEmpty { setStatus(eosBusy ? "busy" : "ready", eosBusy ? "JPEG received. Camera is writing; wait for Ready." : "JPEG received. Review it and select the student before importing.") }
        startTransfer()
    }

    public func cameraDevice(_ camera: ICCameraDevice, didAdd items: [ICCameraItem]) {
        guard self.camera === camera else { return }
        for item in items {
            guard let file = item as? ICCameraFile else { continue }
            if !acceptingPhotos { seenHandles.insert(file.ptpObjectHandle); continue }
            // Canon events provide stable handles and complete file sizes; one
            // event source avoids duplicate transfers and catalog-refresh races.
            guard !canonEOS else { continue }
            let name = file.name ?? "photo.jpg"
            guard ["jpg", "jpeg"].contains((name as NSString).pathExtension.lowercased()) else { continue }
            enqueue(Transfer(photo: CanonPTP.Photo(handle: file.ptpObjectHandle, name: (name as NSString).lastPathComponent, size: Int(file.fileSize)), file: file))
        }
    }
    public func cameraDevice(_ camera: ICCameraDevice, didRemove items: [ICCameraItem]) {}
    public func cameraDevice(_ camera: ICCameraDevice, didRenameItems items: [ICCameraItem]) {}
    public func cameraDevice(_ camera: ICCameraDevice, didReceiveThumbnail thumbnail: CGImage?, for item: ICCameraItem, error: Error?) {}
    public func cameraDevice(_ camera: ICCameraDevice, didReceiveMetadata metadata: [AnyHashable: Any]?, for item: ICCameraItem, error: Error?) {}
    public func cameraDeviceDidChangeCapability(_ camera: ICCameraDevice) {}
    public func cameraDevice(_ camera: ICCameraDevice, didReceivePTPEvent eventData: Data) {
        if self.camera === camera { pollEOS() }
    }
    public func cameraDeviceDidRemoveAccessRestriction(_ device: ICDevice) {}
    public func cameraDeviceDidEnableAccessRestriction(_ device: ICDevice) {
        if camera === device { fail("USB camera access was restricted. Unlock iPhone and reconnect.") }
    }
    public func device(_ device: ICDevice, didOpenSessionWithError error: Error?) {}
    public func device(_ device: ICDevice, didCloseSessionWithError error: Error?) {
        if camera === device { fail("USB camera session closed. Received photos remain saved; reconnect to continue.") }
    }
    public func didRemove(_ device: ICDevice) {
        if camera === device { detach(message: "USB camera disconnected. Received photos remain saved for review.") }
    }
    public func device(_ device: ICDevice, didEncounterError error: Error?) {
        if camera === device { fail("USB camera error: \(error?.localizedDescription ?? "Unknown error"). Stop USB and reconnect.") }
    }
    public func deviceBrowserWillSuspendOperations(_ browser: ICDeviceBrowser) {
        if self.browser === browser { detach(message: "USB stopped while iPhone suspended camera access. Reconnect to continue.") }
    }
}
