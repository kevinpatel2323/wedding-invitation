import Foundation
import Vision
import CoreImage

let path = CommandLine.arguments[1]
guard let img = CIImage(contentsOf: URL(fileURLWithPath: path)) else {
    print("ERR: cannot load"); exit(1)
}
let req = VNDetectBarcodesRequest()
req.symbologies = [.qr]
let handler = VNImageRequestHandler(ciImage: img, options: [:])
do {
    try handler.perform([req])
    let results = req.results ?? []
    if results.isEmpty { print("NO_CODE_FOUND"); exit(2) }
    for r in results {
        print("DECODED: \(r.payloadStringValue ?? "<no payload>")")
    }
} catch {
    print("ERR: \(error)"); exit(1)
}
