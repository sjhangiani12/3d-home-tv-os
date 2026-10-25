import SwiftUI

/// Parcours de scan plein écran : pièces successives dans le même repère, puis fusion et export.
struct ScanFlowView: View {
    let session: ScanSession
    /// Appelé à la fermeture ; reçoit le projet exporté en cas de succès.
    var onClose: (ScanProject?) -> Void

    @Environment(ProjectStore.self) private var store
    @State private var confirmQuit = false

    var body: some View {
        Group {
            if ScanSession.isSupported {
                captureScreen
            } else {
                UnsupportedDeviceView()
                    .onDisappear { onClose(nil) }
            }
        }
        .onChange(of: session.phase) { _, phase in
            if phase == .finished, let result = session.result { onClose(result) }
        }
    }

    private var captureScreen: some View {
        ZStack {
            RoomCaptureContainer(session: session)
                .ignoresSafeArea()
            VStack(spacing: 12) {
                topBar
                if let message = session.instruction.message, session.phase == .scanning {
                    Label(message, systemImage: session.instruction.symbol)
                        .font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .background(.ultraThinMaterial, in: Capsule())
                        .transition(.move(edge: .top).combined(with: .opacity))
                }
                Spacer()
                if let notice = session.notice {
                    NoticeBanner(text: notice) { session.notice = nil }
                }
                bottomPanel
            }
            .padding(16)
            .animation(.snappy, value: session.phase)
            .animation(.snappy, value: session.instruction)
        }
        .sheet(isPresented: Binding(get: { session.phase == .naming }, set: { _ in })) {
            RoomNamingSheet(roomNumber: session.nextRoomNumber, alreadyUsed: session.roomNames) { action, name in
                handleNaming(action, name: name)
            }
            .presentationDetents([.medium, .large])
            .presentationBackground(Theme.cream)
        }
        .confirmationDialog("Quit the scan?", isPresented: $confirmQuit, titleVisibility: .visible) {
            Button("Quit without saving", role: .destructive) {
                session.cancel()
                onClose(nil)
            }
        } message: {
            Text("You will lose the rooms you already scanned.")
        }
    }

    private var topBar: some View {
        HStack(spacing: 12) {
            Button {
                if session.rooms.isEmpty && session.phase != .scanning {
                    session.cancel()
                    onClose(nil)
                } else {
                    confirmQuit = true
                }
            } label: {
                Image(systemName: "xmark")
                    .font(.headline)
                    .frame(width: 40, height: 40)
                    .background(.ultraThinMaterial, in: Circle())
            }
            .disabled(isBusy)
            .accessibilityLabel("Quit")

            VStack(alignment: .leading, spacing: 1) {
                Text(session.projectName).font(.headline)
                Text(DisplayLabels.plural(session.rooms.count, "room scanned", "rooms scanned"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 6)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            Spacer()
        }
    }

    @ViewBuilder private var bottomPanel: some View {
        VStack(spacing: 12) {
            switch session.phase {
            case .ready:
                if session.rooms.isEmpty {
                    Text("Stand at the entrance of the first room with the door closed, then start.")
                        .font(.subheadline)
                        .multilineTextAlignment(.center)
                } else {
                    ScannedRoomsStrip(names: session.roomNames)
                }
                Button { session.startRoom() } label: {
                    Label(session.rooms.isEmpty ? "Start scan" : "Scan room \(session.nextRoomNumber)",
                          systemImage: "record.circle")
                }
                .buttonStyle(PrimaryButtonStyle())
                if !session.rooms.isEmpty {
                    Button { Task { await session.finish(store: store) } } label: {
                        Label("Finish home", systemImage: "checkmark")
                    }
                    .buttonStyle(PrimaryButtonStyle(color: Theme.sage))
                }
            case .scanning:
                Text("Slowly sweep the walls, floor, and furniture.")
                    .font(.subheadline)
                Button { session.stopRoom() } label: {
                    Label("Finish this room", systemImage: "stop.circle.fill")
                }
                .buttonStyle(PrimaryButtonStyle())
            case .processing:
                ProgressRow(text: "Processing the room…")
            case .naming:
                ProgressRow(text: "Room ready")
            case .merging:
                ProgressRow(text: "Merging the rooms…")
            case .exporting:
                ProgressRow(text: "Exporting the file…")
            case .finished:
                ProgressRow(text: "Done")
            case .failed(let message):
                Label(message, systemImage: "exclamationmark.triangle.fill")
                    .font(.subheadline)
                    .foregroundStyle(Theme.terracotta)
                Button("Try again") { session.recoverFromFailure() }
                    .buttonStyle(SecondaryButtonStyle())
            }
        }
        .padding(16)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    private var isBusy: Bool {
        [.processing, .merging, .exporting].contains(session.phase)
    }

    private func handleNaming(_ action: RoomNamingSheet.Action, name: String) {
        switch action {
        case .redo:
            session.discardPendingRoom()
        case .scanAnother:
            session.acceptPendingRoom(named: name)
            session.startRoom()
        case .finish:
            session.acceptPendingRoom(named: name)
            Task { await session.finish(store: store) }
        }
    }
}

private struct ProgressRow: View {
    let text: String

    var body: some View {
        HStack(spacing: 12) {
            ProgressView()
            Text(text).font(.headline)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
    }
}

private struct ScannedRoomsStrip: View {
    let names: [String]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(Array(names.enumerated()), id: \.offset) { _, name in
                    Label(DisplayLabels.roomName(name), systemImage: "checkmark.circle.fill")
                        .font(.subheadline.weight(.medium))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .foregroundStyle(.white)
                        .background(Theme.sage, in: Capsule())
                }
            }
        }
    }
}

struct NoticeBanner: View {
    let text: String
    var onDismiss: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "info.circle.fill").foregroundStyle(Theme.slate)
            Text(text).font(.footnote).foregroundStyle(Theme.ink)
            Spacer(minLength: 0)
            Button(action: onDismiss) {
                Image(systemName: "xmark").font(.caption.weight(.bold)).foregroundStyle(Theme.inkSoft)
            }
            .accessibilityLabel("Dismiss message")
        }
        .padding(12)
        .background(Theme.card.opacity(0.95), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}
