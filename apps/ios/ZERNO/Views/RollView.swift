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
                        .foregroundStyle(Ink.silver)
                        .frame(width: 40, height: 40)
                }
                .pressable(scale: 0.9)
                Spacer()
                Text("Плёнка")
                    .font(Kind.display(21))
                    .foregroundStyle(Ink.paper)
                Spacer()
                Button {
                    confirmClear = true
                } label: {
                    Image(systemName: "trash")
                        .font(.system(size: 17, weight: .light))
                        .foregroundStyle(Ink.silver)
                        .frame(width: 40, height: 40)
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
        .background(Ink.ground)
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
                Ink.rebate
            }
            Text(frame.stock)
                .font(Kind.mono(8.5))
                .tracking(1)
                .textCase(.uppercase)
                .foregroundStyle(Ink.paper)
                .shadow(color: .black.opacity(0.9), radius: 4)
                .padding(6)
        }
        .frame(height: 108)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8)
            .strokeBorder(Ink.paper.opacity(0.06), lineWidth: 1))
    }

    private var empty: some View {
        VStack(spacing: 16) {
            Image(systemName: "film")
                .font(.system(size: 40, weight: .ultraLight))
                .foregroundStyle(Ink.edge)
            Text("Здесь появятся проявленные кадры.\nСними что-нибудь или загрузи фото из галереи.")
                .font(Kind.ui(13))
                .foregroundStyle(Ink.silver)
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
                        .foregroundStyle(Ink.silver)
                        .frame(width: 40, height: 40)
                }
            }

            if let img = state.store.image(for: frame) {
                Image(uiImage: img)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .clipShape(RoundedRectangle(cornerRadius: 8))

                HStack(spacing: 12) {
                    Button {
                        state.store.exportToPhotos(img) { ok in
                            state.show(ok ? "Кадр в галерее телефона"
                                          : "Нет доступа к галерее")
                        }
                    } label: {
                        Label("В галерею", systemImage: "square.and.arrow.down")
                            .font(Kind.ui(14, .semibold))
                            .foregroundStyle(Ink.ground)
                            .padding(.horizontal, 22).padding(.vertical, 13)
                            .background(Capsule().fill(Ink.paper))
                    }
                    .pressable()

                    ShareLink(item: Image(uiImage: img), preview: SharePreview(frame.stock)) {
                        Label("Поделиться", systemImage: "square.and.arrow.up")
                            .font(Kind.ui(14, .semibold))
                            .foregroundStyle(Ink.paper)
                            .padding(.horizontal, 22).padding(.vertical, 13)
                            .background(Capsule().strokeBorder(Ink.edge, lineWidth: 1))
                    }

                    Button(role: .destructive) {
                        state.store.remove(frame)
                        dismiss()
                    } label: {
                        Image(systemName: "trash")
                            .font(.system(size: 16))
                            .foregroundStyle(Ink.silver)
                            .frame(width: 46, height: 46)
                            .background(Circle().strokeBorder(Ink.edge, lineWidth: 1))
                    }
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Ink.ground)
    }
}
