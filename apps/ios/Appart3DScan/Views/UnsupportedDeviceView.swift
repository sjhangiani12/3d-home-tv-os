import SwiftUI

/// Écran « appareil non compatible » (simulateur, iPhone sans LiDAR).
struct UnsupportedDeviceView: View {
    var onDemo: (() -> Void)?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 22) {
            Spacer()
            Image(systemName: "iphone.slash")
                .font(.system(size: 64, weight: .light))
                .foregroundStyle(Theme.slate)
                .padding(28)
                .background(Theme.slate.opacity(0.12), in: Circle())
            Text("Device not supported")
                .font(.system(.title, design: .rounded, weight: .bold))
                .foregroundStyle(Theme.ink)
            Text("Room scanning uses RoomPlan and the LiDAR sensor, available on iPhone Pro (12 Pro and later) and recent iPad Pro models. It does not work in the Simulator.")
                .font(.body)
                .multilineTextAlignment(.center)
                .foregroundStyle(Theme.inkSoft)
            Spacer()
            if let onDemo {
                Button(action: onDemo) {
                    Label("Try demo mode", systemImage: "sparkles")
                }
                .buttonStyle(PrimaryButtonStyle())
            }
            Button("Close") { dismiss() }
                .buttonStyle(SecondaryButtonStyle())
        }
        .padding(24)
        .background(Theme.cream.ignoresSafeArea())
    }
}

#Preview {
    UnsupportedDeviceView(onDemo: {})
}
