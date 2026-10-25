import SwiftUI

/// Carte explicative : comment réussir un scan.
struct ScanTipsCard: View {
    @State private var expanded = true

    private let tips: [(String, String, String)] = [
        ("sun.max", "Good light", "Turn on the lamps and open the shutters."),
        ("figure.walk", "Walk slowly", "Slow movements give sharper walls."),
        ("arrow.up.and.down.and.arrow.left.and.right", "Sweep everything", "Walls, floor, and corners, up to the ceiling."),
        ("door.left.hand.closed", "Close the doors", "The app detects them, and the room keeps clear edges."),
        ("square.split.2x2", "Room by room", "Scan each room, then go on to the next without leaving the app."),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Button {
                withAnimation(.snappy) { expanded.toggle() }
            } label: {
                HStack {
                    Label("How it works", systemImage: "lightbulb.max")
                        .font(.headline)
                        .foregroundStyle(Theme.ink)
                    Spacer()
                    Image(systemName: "chevron.down")
                        .rotationEffect(.degrees(expanded ? 0 : -90))
                        .foregroundStyle(Theme.inkSoft)
                }
            }
            .buttonStyle(.plain)

            if expanded {
                Text("The iPhone uses LiDAR to measure walls, doors, windows, and furniture. Then you drop the exported file into the Appart3D web app.")
                    .font(.footnote)
                    .foregroundStyle(Theme.inkSoft)
                ForEach(tips, id: \.1) { symbol, title, detail in
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: symbol)
                            .font(.body.weight(.semibold))
                            .foregroundStyle(Theme.terracotta)
                            .frame(width: 32, height: 32)
                            .background(Theme.terracotta.opacity(0.12), in: Circle())
                        VStack(alignment: .leading, spacing: 2) {
                            Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                            Text(detail).font(.footnote).foregroundStyle(Theme.inkSoft)
                        }
                    }
                }
            }
        }
        .card()
    }
}
