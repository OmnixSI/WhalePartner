import AppKit
import CoreImage
import CoreImage.CIFilterBuiltins
import CoreGraphics
import Foundation

guard CommandLine.arguments.count == 3 else {
    fputs("usage: qr-code.swift <text> <output.png>\n", stderr)
    exit(2)
}

let text = CommandLine.arguments[1]
let outputPath = CommandLine.arguments[2]
let generator = CIFilter.qrCodeGenerator()
generator.message = Data(text.utf8)
generator.correctionLevel = "M"

guard let code = generator.outputImage else {
    fputs("Could not create QR code.\n", stderr)
    exit(1)
}

let scale: CGFloat = 12
let margin = scale * 4
let context = CIContext(options: [.useSoftwareRenderer: true])
let sourceWidth = Int(code.extent.width)
let sourceHeight = Int(code.extent.height)
guard let sourceBitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: sourceWidth,
    pixelsHigh: sourceHeight,
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 0
) else {
    fputs("Could not allocate QR source image.\n", stderr)
    exit(1)
}
context.render(
    code,
    toBitmap: sourceBitmap.bitmapData!,
    rowBytes: sourceBitmap.bytesPerRow,
    bounds: code.extent,
    format: .RGBA8,
    colorSpace: CGColorSpaceCreateDeviceRGB()
)

guard let cgImage = sourceBitmap.cgImage else {
    fputs("Could not render QR code.\n", stderr)
    exit(1)
}

let codeWidth = CGFloat(cgImage.width) * scale
let codeHeight = CGFloat(cgImage.height) * scale
let side = Int(max(codeWidth, codeHeight) + margin * 2)
guard let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: side,
    pixelsHigh: side,
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 0
) else {
    fputs("Could not allocate QR image.\n", stderr)
    exit(1)
}

NSGraphicsContext.saveGraphicsState()
let graphics = NSGraphicsContext(bitmapImageRep: bitmap)!
NSGraphicsContext.current = graphics
graphics.imageInterpolation = .none
NSColor.white.setFill()
NSRect(x: 0, y: 0, width: side, height: side).fill()
NSImage(cgImage: cgImage, size: NSSize(width: CGFloat(cgImage.width), height: CGFloat(cgImage.height))).draw(
    in: NSRect(x: margin, y: margin, width: codeWidth, height: codeHeight),
    from: .zero,
    operation: .copy,
    fraction: 1
)
graphics.flushGraphics()
NSGraphicsContext.restoreGraphicsState()

guard let png = bitmap.representation(using: NSBitmapImageRep.FileType.png, properties: [:]) else {
    fputs("Could not encode QR image.\n", stderr)
    exit(1)
}

do {
    try png.write(to: URL(fileURLWithPath: outputPath), options: Data.WritingOptions.atomic)
} catch {
    fputs("Could not save QR image.\n", stderr)
    exit(1)
}
