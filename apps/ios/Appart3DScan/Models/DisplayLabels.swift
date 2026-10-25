import Foundation

/// English display labels and SF Symbols for RoomPlan categories.
enum DisplayLabels {
    static let roomSuggestions = ["Living room", "Bedroom", "Kitchen", "Bathroom", "Toilet", "Hallway", "Office"]

    static func objectName(_ key: String) -> String {
        switch key {
        case "storage": "Storage"
        case "refrigerator": "Refrigerator"
        case "stove": "Stove"
        case "bed": "Bed"
        case "sink": "Sink"
        case "washerDryer": "Washer / dryer"
        case "toilet": "Toilet"
        case "bathtub": "Bathtub"
        case "oven": "Oven"
        case "dishwasher": "Dishwasher"
        case "table": "Table"
        case "sofa": "Sofa"
        case "chair": "Chair"
        case "fireplace": "Fireplace"
        case "television": "Television"
        case "stairs": "Stairs"
        default: "Other"
        }
    }

    static func objectSymbol(_ key: String) -> String {
        switch key {
        case "storage": "cabinet"
        case "refrigerator": "refrigerator"
        case "stove": "stove"
        case "bed": "bed.double"
        case "sink": "sink"
        case "washerDryer": "washer"
        case "toilet": "toilet"
        case "bathtub": "bathtub"
        case "oven": "oven"
        case "dishwasher": "dishwasher"
        case "table": "table.furniture"
        case "sofa": "sofa"
        case "chair": "chair"
        case "fireplace": "fireplace"
        case "television": "tv"
        case "stairs": "stairs"
        default: "cube"
        }
    }

    /// The envelope keeps the placeholder "Pièce N" for unnamed rooms because the web importer
    /// matches that exact pattern. Show it as "Room N" in the app.
    static func roomName(_ name: String) -> String {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard trimmed.hasPrefix(EnvelopeExporter.placeholderRoomPrefix) else { return name }
        let number = trimmed.dropFirst(EnvelopeExporter.placeholderRoomPrefix.count)
        guard !number.isEmpty, number.allSatisfy(\.isNumber) else { return name }
        return "Room \(number)"
    }

    static func plural(_ count: Int, _ singular: String, _ plural: String? = nil) -> String {
        "\(count) " + (count > 1 ? (plural ?? singular + "s") : singular)
    }
}
