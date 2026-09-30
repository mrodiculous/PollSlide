// Pull still frames from a video for checking: swift frames.swift <video.mp4> <out-prefix> <sec> [sec…]
import AVFoundation
import AppKit
let a = CommandLine.arguments
let asset = AVURLAsset(url: URL(fileURLWithPath: a[1]))
let gen = AVAssetImageGenerator(asset: asset)
gen.appliesPreferredTrackTransform = true
gen.requestedTimeToleranceBefore = .zero; gen.requestedTimeToleranceAfter = .zero
gen.maximumSize = CGSize(width: 960, height: 540)
for s in a[3...] {
  let t = CMTime(seconds: Double(s)!, preferredTimescale: 600)
  guard let cg = try? gen.copyCGImage(at: t, actualTime: nil) else { print("no frame at", s); continue }
  let rep = NSBitmapImageRep(cgImage: cg)
  let out = "\(a[2])-\(s).jpg"
  try! rep.representation(using: .jpeg, properties: [.compressionFactor: 0.8])!.write(to: URL(fileURLWithPath: out))
  print(out)
}
