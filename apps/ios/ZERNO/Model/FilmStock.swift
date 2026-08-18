import simd

/// Параметры плёночного тракта. Раскладка совпадает со структурой
/// `FilmParams` в Shaders.metal: сначала шесть `float3`, затем скаляры.
struct FilmParams {
    var lift       = SIMD3<Float>(0, 0, 0)
    var gamma      = SIMD3<Float>(1, 1, 1)
    var gain       = SIMD3<Float>(1, 1, 1)
    var shadowTint = SIMD3<Float>(0, 0, 0)
    var highTint   = SIMD3<Float>(0, 0, 0)
    var mono       = SIMD3<Float>(0.299, 0.587, 0.114)

    var exposure   : Float = 0
    var contrast   : Float = 1
    var saturation : Float = 1
    var temp       : Float = 0
    var tint       : Float = 0
    var fade       : Float = 0
    var toe        : Float = 0.15
    var isMono     : Float = 0
    var grain      : Float = 0.28
    var grainSize  : Float = 1.6
    var halation   : Float = 0.18
    var bloom      : Float = 0.10
    var vignette   : Float = 0.22
    var aberration : Float = 0.15
    var leak       : Float = 0
    var dust       : Float = 0
    var amount     : Float = 1
    var seed       : Float = 0
    var resX       : Float = 1
    var resY       : Float = 1

    var needsBloom: Bool { halation > 0.001 || bloom > 0.001 }
}

/// Эмульсия: имя, чувствительность, характер и параметры тракта.
struct FilmStock: Identifiable, Equatable {
    let id: String
    let name: String
    let iso: String
    let kind: String
    let params: FilmParams

    static func == (a: FilmStock, b: FilmStock) -> Bool { a.id == b.id }

    /// Краевая печать, как на рибейте 35 мм.
    var edgeText: String {
        iso == "—" ? "ЗЕРНО \(name.uppercased())" : "ЗЕРНО \(name.uppercased()) \(iso)"
    }
    var subtitle: String { iso == "—" ? kind : "ISO \(iso) · \(kind)" }
}

private func makeStock(_ id: String, _ name: String, _ iso: String, _ kind: String,
                       _ build: (inout FilmParams) -> Void) -> FilmStock {
    var p = FilmParams()
    build(&p)
    return FilmStock(id: id, name: name, iso: iso, kind: kind, params: p)
}

enum FilmLibrary {
    static let all: [FilmStock] = [
        makeStock("orig", "Оригинал", "—", "без обработки") {
            $0.grain = 0; $0.halation = 0; $0.bloom = 0
            $0.vignette = 0.04; $0.aberration = 0; $0.toe = 0
        },
        makeStock("zarya", "Заря", "400", "портрет") {
            $0.temp = 0.13
            $0.gain = [1.06, 1, 0.93]; $0.lift = [0.022, 0.014, 0.008]; $0.gamma = [1, 1, 1.03]
            $0.saturation = 1.03; $0.contrast = 1.03
            $0.highTint = [0.05, 0.028, -0.022]; $0.shadowTint = [0.008, 0.01, 0.03]
            $0.grain = 0.26; $0.halation = 0.24; $0.bloom = 0.12; $0.vignette = 0.20
        },
        makeStock("tundra", "Тундра", "160", "пейзаж") {
            $0.temp = -0.09
            $0.shadowTint = [-0.022, 0.032, 0.018]; $0.gain = [0.96, 1.02, 1]; $0.gamma = [1.02, 1, 0.99]
            $0.saturation = 0.90; $0.contrast = 1.06; $0.fade = 0.06
            $0.grain = 0.24; $0.halation = 0.12; $0.vignette = 0.26
        },
        makeStock("yantar", "Янтарь", "200", "закат") {
            $0.temp = 0.24
            $0.gain = [1.13, 1, 0.84]; $0.highTint = [0.09, 0.042, -0.045]; $0.lift = [0.026, 0.012, 0]
            $0.saturation = 1.12; $0.contrast = 1.07
            $0.grain = 0.30; $0.halation = 0.48; $0.bloom = 0.22; $0.vignette = 0.28; $0.leak = 0.14
        },
        makeStock("mayak", "Маяк", "100", "слайд") {
            $0.contrast = 1.30; $0.saturation = 1.26; $0.toe = 0.32
            $0.gain = [1.02, 1, 1.02]
            $0.vignette = 0.32; $0.grain = 0.20; $0.halation = 0.20; $0.aberration = 0.20
        },
        makeStock("kino", "Кино", "250D", "кинолента") {
            $0.shadowTint = [-0.055, 0.012, 0.085]; $0.highTint = [0.085, 0.030, -0.055]
            $0.contrast = 1.18; $0.gamma = [1.02, 1, 1.05]; $0.saturation = 1.04
            $0.gain = [1.02, 0.99, 1.02]
            $0.vignette = 0.34; $0.aberration = 0.32; $0.halation = 0.28
            $0.grain = 0.30; $0.grainSize = 1.8
        },
        makeStock("serebro", "Серебро", "125", "ч/б") {
            $0.isMono = 1; $0.mono = [0.32, 0.52, 0.16]
            $0.contrast = 1.14; $0.toe = 0.26
            $0.grain = 0.34; $0.halation = 0.10; $0.vignette = 0.26
        },
        makeStock("ugol", "Уголь", "3200", "ночь · ч/б") {
            $0.isMono = 1; $0.mono = [0.28, 0.60, 0.12]
            $0.contrast = 1.45; $0.toe = 0.42; $0.fade = 0.04
            $0.grain = 0.78; $0.grainSize = 2.7; $0.vignette = 0.40; $0.halation = 0.12
        },
        makeStock("granat", "Гранат", "—", "редскейл") {
            $0.gain = [1.26, 0.72, 0.42]; $0.lift = [0.035, 0.01, 0]
            $0.contrast = 1.12; $0.saturation = 0.95
            $0.halation = 0.38; $0.bloom = 0.16; $0.grain = 0.34; $0.vignette = 0.30; $0.leak = 0.20
        },
        makeStock("iney", "Иней", "400", "выцветшая") {
            $0.fade = 0.24; $0.contrast = 0.88; $0.saturation = 0.80; $0.temp = -0.06
            $0.lift = [0.030, 0.036, 0.052]; $0.toe = 0.05
            $0.grain = 0.30; $0.halation = 0.14; $0.vignette = 0.16
        },
        makeStock("polden", "Полдень", "100", "дневная") {
            $0.contrast = 1.07; $0.saturation = 1.06; $0.gain = [1.01, 1, 1.01]
            $0.grain = 0.14; $0.grainSize = 1.2; $0.halation = 0.10; $0.vignette = 0.12
        },
        makeStock("vecher", "Вечер", "800", "сумерки") {
            $0.temp = -0.13; $0.gain = [0.94, 0.97, 1.09]; $0.lift = [0.020, 0.026, 0.052]
            $0.contrast = 0.96; $0.saturation = 0.86
            $0.grain = 0.44; $0.grainSize = 1.9; $0.vignette = 0.32; $0.halation = 0.16
        },
        makeStock("kosmos", "Космос", "—", "кросс-процесс") {
            $0.shadowTint = [-0.075, 0.035, 0.14]; $0.highTint = [0.13, 0.105, -0.13]
            $0.contrast = 1.38; $0.saturation = 1.45
            $0.gamma = [0.92, 1.0, 1.12]; $0.gain = [1.04, 1.02, 0.92]
            $0.leak = 0.20; $0.halation = 0.32; $0.grain = 0.32; $0.vignette = 0.30; $0.aberration = 0.25
        }
    ]

    static func stock(id: String) -> FilmStock {
        all.first { $0.id == id } ?? all[0]
    }
}

/// Ручные поправки поверх выбранной плёнки. Ноль — «как задумано».
struct Adjustments: Equatable {
    var amount   : Float = 1
    var exposure : Float = 0
    var temp     : Float = 0
    var contrast : Float = 0
    var fade     : Float = 0
    var grain    : Float = 0
    var halation : Float = 0
    var vignette : Float = 0

    static let neutral = Adjustments()

    func applied(to stock: FilmStock, dust: Bool, seed: Float) -> FilmParams {
        var p = stock.params
        p.amount   = amount
        p.exposure = p.exposure + exposure
        p.temp     = min(max(p.temp + temp, -1), 1)
        p.contrast = min(max(p.contrast + contrast, 0.3), 2.2)
        p.fade     = min(max(p.fade + fade, 0), 0.8)
        p.grain    = min(max(p.grain + grain, 0), 1.6)
        p.halation = min(max(p.halation + halation, 0), 1.4)
        p.vignette = min(max(p.vignette + vignette, 0), 0.9)
        p.dust     = dust ? 1 : 0
        p.seed     = seed
        return p
    }
}
