// Turns a recorded manifest (timestamped JPEG frames + narration clips) into an MP4.
//   swift scripts/video/assemble.swift <manifest.json>
// Native AVFoundation, so no ffmpeg is needed. Frames keep their real timing (variable
// frame rate): a frame lasts until the next one, exactly as it was on screen.
import Foundation
import AVFoundation
import CoreGraphics
import ImageIO

struct Frame: Decodable { let f: String; let t: Double }
struct Clip: Decodable { let file: String; let t: Double }
struct Manifest: Decodable { let width: Int; let height: Int; let end: Double; let frames: [Frame]; let audio: [Clip]; let out: String }

let args = CommandLine.arguments
guard args.count > 1, let data = FileManager.default.contents(atPath: args[1]),
      let m = try? JSONDecoder().decode(Manifest.self, from: data) else { print("usage: assemble.swift manifest.json"); exit(1) }

let silent = URL(fileURLWithPath: m.out).deletingPathExtension().appendingPathExtension("video-only.mp4")
let final = URL(fileURLWithPath: m.out)
try? FileManager.default.removeItem(at: silent); try? FileManager.default.removeItem(at: final)

// ── video track ──────────────────────────────────────────────────────────────
let writer = try AVAssetWriter(outputURL: silent, fileType: .mp4)
let settings: [String: Any] = [
  AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: m.width, AVVideoHeightKey: m.height,
  AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 1_300_000, AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
                                    AVVideoExpectedSourceFrameRateKey: 30, AVVideoMaxKeyFrameIntervalKey: 60]]
let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
input.expectsMediaDataInRealTime = false
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
  kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA, kCVPixelBufferWidthKey as String: m.width, kCVPixelBufferHeightKey as String: m.height])
writer.add(input)
writer.startWriting(); writer.startSession(atSourceTime: .zero)

func pixelBuffer(_ path: String) -> CVPixelBuffer? {
  guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
        let img = CGImageSourceCreateImageAtIndex(src, 0, nil), let pool = adaptor.pixelBufferPool else { return nil }
  var pb: CVPixelBuffer?; CVPixelBufferPoolCreatePixelBuffer(nil, pool, &pb); guard let buf = pb else { return nil }
  CVPixelBufferLockBaseAddress(buf, [])
  let ctx = CGContext(data: CVPixelBufferGetBaseAddress(buf), width: m.width, height: m.height, bitsPerComponent: 8,
                      bytesPerRow: CVPixelBufferGetBytesPerRow(buf), space: CGColorSpaceCreateDeviceRGB(),
                      bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)
  ctx?.setFillColor(CGColor(red: 0.03, green: 0.03, blue: 0.05, alpha: 1)); ctx?.fill(CGRect(x: 0, y: 0, width: m.width, height: m.height))
  ctx?.draw(img, in: CGRect(x: 0, y: 0, width: m.width, height: m.height))
  CVPixelBufferUnlockBaseAddress(buf, []); return buf
}
let ts: Int32 = 600
var lastValue: Int64 = -1, lastBuf: CVPixelBuffer? = nil, written = 0
for (i, fr) in m.frames.enumerated() {
  let v = i == 0 ? 0 : Int64((fr.t * Double(ts)).rounded())
  if v <= lastValue { continue }
  guard let pb = pixelBuffer(fr.f) else { continue }
  while !input.isReadyForMoreMediaData { usleep(2000) }
  adaptor.append(pb, withPresentationTime: CMTime(value: v, timescale: ts)); lastValue = v; lastBuf = pb; written += 1
}
// Hold the last picture until the end.
let endV = Int64((m.end * Double(ts)).rounded())
if let pb = lastBuf, endV > lastValue { while !input.isReadyForMoreMediaData { usleep(2000) }; adaptor.append(pb, withPresentationTime: CMTime(value: endV, timescale: ts)) }
input.markAsFinished()
writer.endSession(atSourceTime: CMTime(value: endV, timescale: ts))
let sem = DispatchSemaphore(value: 0); writer.finishWriting { sem.signal() }; sem.wait()
if writer.status != .completed { print("video write failed:", writer.error ?? "?"); exit(1) }
print("video: \(written) frames, \(String(format: "%.1f", m.end))s")

// ── mux narration at each scene's start ──────────────────────────────────────
let comp = AVMutableComposition()
let vAsset = AVURLAsset(url: silent)
let vSrc = vAsset.tracks(withMediaType: .video)[0]
let vTrack = comp.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)!
try vTrack.insertTimeRange(CMTimeRange(start: .zero, duration: vAsset.duration), of: vSrc, at: .zero)
let aTrack = comp.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)!
for c in m.audio {
  let a = AVURLAsset(url: URL(fileURLWithPath: c.file))
  guard let src = a.tracks(withMediaType: .audio).first else { continue }
  let at = CMTime(seconds: c.t, preferredTimescale: 44100)
  var dur = a.duration
  if CMTimeCompare(CMTimeAdd(at, dur), vAsset.duration) > 0 { dur = CMTimeSubtract(vAsset.duration, at) }
  try aTrack.insertTimeRange(CMTimeRange(start: .zero, duration: dur), of: src, at: at)
}
guard let exp = AVAssetExportSession(asset: comp, presetName: AVAssetExportPresetPassthrough) else { print("no exporter"); exit(1) }
exp.outputURL = final; exp.outputFileType = .mp4; exp.shouldOptimizeForNetworkUse = true
let s2 = DispatchSemaphore(value: 0); exp.exportAsynchronously { s2.signal() }; s2.wait()
if exp.status != .completed { print("export failed:", exp.error ?? "?"); exit(1) }
try? FileManager.default.removeItem(at: silent)
let size = (try? FileManager.default.attributesOfItem(atPath: final.path)[.size] as? Int) ?? 0
print("wrote \(final.path) (\(size / 1024) KB)")
