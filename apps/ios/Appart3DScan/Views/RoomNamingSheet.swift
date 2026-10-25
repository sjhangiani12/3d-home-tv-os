import SwiftUI

/// Après chaque pièce : la nommer, puis enchaîner ou terminer.
struct RoomNamingSheet: View {
    let roomNumber: Int
    let alreadyUsed: [String]
    var onAction: (Action, String) -> Void

    enum Action { case scanAnother, finish, redo }

    @State private var name = ""
    @FocusState private var focused: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack(spacing: 10) {
                    Image(systemName: "checkmark.seal.fill")
                        .font(.title2)
                        .foregroundStyle(Theme.sage)
                    Text("Room \(roomNumber) captured")
                        .font(.system(.title2, design: .rounded, weight: .bold))
                        .foregroundStyle(Theme.ink)
                }
                Text("What is this room called?")
                    .font(.subheadline)
                    .foregroundStyle(Theme.inkSoft)

                TextField("Room name", text: $name)
                    .textInputAutocapitalization(.sentences)
                    .focused($focused)
                    .padding(14)
                    .background(Theme.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(Theme.creamDeep, lineWidth: 1))

                FlowLayout(spacing: 8) {
                    ForEach(DisplayLabels.roomSuggestions, id: \.self) { suggestion in
                        Button { name = suggestedName(suggestion) } label: {
                            Text(suggestion)
                                .font(.subheadline.weight(.medium))
                                .padding(.horizontal, 14)
                                .padding(.vertical, 8)
                                .foregroundStyle(name == suggestion ? .white : Theme.slate)
                                .background(name == suggestion ? Theme.slate : Theme.slate.opacity(0.12),
                                            in: Capsule())
                        }
                        .buttonStyle(.plain)
                    }
                }

                VStack(spacing: 10) {
                    Button { onAction(.scanAnother, name) } label: {
                        Label("Scan another room", systemImage: "plus.viewfinder")
                    }
                    .buttonStyle(PrimaryButtonStyle())

                    Button { onAction(.finish, name) } label: {
                        Label("Finish home", systemImage: "checkmark")
                    }
                    .buttonStyle(PrimaryButtonStyle(color: Theme.sage))

                    Button(role: .destructive) { onAction(.redo, name) } label: {
                        Label("Redo this room", systemImage: "arrow.counterclockwise")
                    }
                    .buttonStyle(SecondaryButtonStyle(color: Theme.terracotta))
                }
                .padding(.top, 6)
            }
            .padding(24)
        }
        .background(Theme.cream.ignoresSafeArea())
        .scrollDismissesKeyboard(.interactively)
        .interactiveDismissDisabled()
    }

    /// "Bedroom" already used → "Bedroom 2".
    private func suggestedName(_ base: String) -> String {
        guard alreadyUsed.contains(base) else { return base }
        var index = 2
        while alreadyUsed.contains("\(base) \(index)") { index += 1 }
        return "\(base) \(index)"
    }
}

#Preview {
    RoomNamingSheet(roomNumber: 2, alreadyUsed: ["Living room"]) { _, _ in }
}
