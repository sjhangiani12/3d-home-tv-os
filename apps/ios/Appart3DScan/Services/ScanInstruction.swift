import RoomPlan

/// Sendable copy of `RoomCaptureSession.Instruction` with an English message.
enum ScanInstruction: Sendable, Equatable {
    case normal, moveCloseToWall, moveAwayFromWall, slowDown, turnOnLight, lowTexture

    init(_ instruction: RoomCaptureSession.Instruction) {
        switch instruction {
        case .moveCloseToWall: self = .moveCloseToWall
        case .moveAwayFromWall: self = .moveAwayFromWall
        case .slowDown: self = .slowDown
        case .turnOnLight: self = .turnOnLight
        case .lowTexture: self = .lowTexture
        default: self = .normal
        }
    }

    var message: String? {
        switch self {
        case .normal: nil
        case .moveCloseToWall: "Move closer to the wall"
        case .moveAwayFromWall: "Move a little away from the wall"
        case .slowDown: "Slow down"
        case .turnOnLight: "Turn on the light"
        case .lowTexture: "Low texture: aim at more detailed areas"
        }
    }

    var symbol: String {
        switch self {
        case .normal: "checkmark.circle"
        case .moveCloseToWall: "arrow.up.forward"
        case .moveAwayFromWall: "arrow.down.backward"
        case .slowDown: "tortoise"
        case .turnOnLight: "lightbulb"
        case .lowTexture: "square.dashed"
        }
    }
}
