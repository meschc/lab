import SwiftUI

/// Отснятая плёнка: сетка проявленных кадров.
struct RollView: View {
    @EnvironmentObject var state: AppState
    @State private var viewing: DevelopedFrame?
    @State private var confirmClear = false

    private let columns = [GridItem(.adaptive(minimum: 108), spacing: 8)]

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button {
                    state.screen = state.source == nil ? .shoot : .develop
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 18))
                        .foregroundStyle(Ink.text2)
                        .frame(width: 40, height: 40)
                        .glass(radius: 20)
                }
                .pressable(scale: 0.9)
                Spacer()
                Text("Плёнка")
                    .font(Kind.ui(21, .bold))
                    .foregroundStyle(Ink.text)
                Spacer()
                Button {
                    confirmClear = true
                } label: {
                    Image(systemName: "trash")
                        .font(.system(size: 17, weight: .light))
                        .foregroundStyle(Ink.text2)
                        .frame(width: 40, height: 40)
                        .glass(radius: 20)
                }
                .pressable(scale: 0.9)
                .disabled(state.store.frames.isEmpty)
                .opacity(state.store.frames.isEmpty ? 0.35 : 1)
            }
            .padding(.horizontal, 16)

            if state.store.frames.isEmpty {
                empty
            } else {
                ScrollView {
                    Text("\(state.store.frames.count) · отснято")
                        .eyebrow()
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 14)
                        .padding(.bottom, 12)

                    LazyVGrid(columns: columns, spacing: 8) {
                        ForEach(state.store.frames) { frame in
                            Button { viewing = frame } label: { cell(frame) }
                                .pressable(scale: 0.97)
                        }
                    }
                    .padding(.horizontal, 14)
                    .padding(.bottom, 28)
                }
            }
        }
        .background(MeshBackground())
        .sheet(item: $viewing) { frame in
            FrameViewer(frame: frame).environmentObject(state)
        }
        .alert("Стереть все кадры?", isPresented: $confirmClear) {
            Button("Отмена", role: .cancel) {}
            Button("Стереть", role: .destructive) {
                state.store.removeAll()
                state.show("Плёнка очищена")
            }
        } message: {
            Text("Кадры удалятся из приложения. Те, что уже сохранены в галерею, останутся.")
        }
    }

    private func cell(_ frame: DevelopedFrame) -> some View {
        ZStack(alignment: .bottomLeading) {
            if let img = state.store.image(for: frame) {
                Image(uiImage: img)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
            } else {
                Color.white
            }
            Text(frame.stock)
                .font(Kind.ui(10, .semibold))
                .foregroundStyle(.white)
                .shadow(color: .black.opacity(0.85), radius: 5)
                .padding(9)
        }
        .frame(height: 108)
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous)
            .strokeBorder(Color.white.opacity(0.6), lineWidth: 1))
        .shadow(color: Color(red: 0.12, green: 0.11, blue: 0.24, opacity: 0.13), radius: 14, y: 6)
    }

    private var empty: some View {
        VStack(spacing: 16) {
            Image(systemName: "film")
                .font(.system(size: 40, weight: .ultraLight))
                .foregroundStyle(Ink.hair)
            Text("Здесь появятся проявленные кадры.\nСними что-нибудь или загрузи фото из галереи.")
                .font(Kind.ui(13))
                .foregroundStyle(Ink.text2)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 280)
        }
        .frame(maxHeight: .infinity)
    }
}

/// Просмотр одного кадра с выгрузкой в системную галерею.
struct FrameViewer: View {
    @EnvironmentObject var state: AppState
    @Environment(\.dismiss) private var dismiss
    let frame: DevelopedFrame

    var body: some View {
        VStack(spacing: 14) {
            HStack {
                Text("\(frame.stock) · \(frame.date.formatted(date: .numeric, time: .omitted))")
                    .eyebrow()
                Spacer()
                Button { dismiss() } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 16))
                        .foregroundStyle(Ink.text2)
                        .frame(width: 40, height: 40)
                        .glass(radius: 20)
                }
            }

            if let img = state.store.image(for: frame) {
                Image(uiImage: img)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .shadow(color: Color(red: 0.12, green: 0.11, blue: 0.24, opacity: 0.24),
                            radius: 22, y: 10)

                HStack(spacing: 12) {
                    Button {
                        state.store.exportToPhotos(img) { ok in
                            state.show(ok ? "Кадр в галерее телефона"
                                          : "Нет доступа к галерее")
                        }
                    } label: {
                        Label("В галерею", systemImage: "square.and.arrow.down")
                            .font(Kind.ui(14.5, .semibold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 24).padding(.vertical, 14)
                            .background(Capsule().fill(Ink.action))
                            .shadow(color: Ink.accent.opacity(0.34), radius: 14, y: 6)
                    }
                    .pressable()

                    ShareLink(item: Image(uiImage: img), preview: SharePreview(frame.stock)) {
                        Label("Поделиться", systemImage: "square.and.arrow.up")
                            .font(Kind.ui(14.5, .semibold))
                            .foregroundStyle(Ink.text)
                            .padding(.horizontal, 24).padding(.vertical, 14)
                            .background(.ultraThinMaterial, in: Capsule())
                            .background(Color.white.opacity(0.58), in: Capsule())
                            .overlay(Capsule().strokeBorder(Color.white.opacity(0.85), lineWidth: 1))
                    }

                    Button(role: .destructive) {
                        state.store.remove(frame)
                        dismiss()
                    } label: {
                        Image(systemName: "trash")
                            .font(.system(size: 16))
                            .foregroundStyle(Ink.text2)
                            .frame(width: 48, height: 48)
                            .glass(radius: 24)
                    }
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(MeshBackground())
    }
}
