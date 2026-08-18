//
//  Shaders.metal — плёночный конвейер ЗЕРНО
//
//  Порядок операций повторяет реальный тракт: экспозиция → баланс белого →
//  цветокоррекция → кривая → тонирование → насыщенность → выцветание →
//  гало → виньетка → зерно → дефекты плёнки.
//

#include <metal_stdlib>
using namespace metal;

// Раскладка должна совпадать с FilmParams в Swift:
// сначала шесть float3 (по 16 байт), затем скаляры.
struct FilmParams {
    float3 lift;
    float3 gamma;
    float3 gain;
    float3 shadowTint;
    float3 highTint;
    float3 mono;

    float exposure;
    float contrast;
    float saturation;
    float temp;
    float tint;
    float fade;
    float toe;
    float isMono;
    float grain;
    float grainSize;
    float halation;
    float bloom;
    float vignette;
    float aberration;
    float leak;
    float dust;
    float amount;
    float seed;
    float resX;
    float resY;
};

struct VertexOut {
    float4 position [[position]];
    float2 uv;
};

// Полноэкранный треугольник — без вершинного буфера.
vertex VertexOut fullscreenVertex(uint vid [[vertex_id]]) {
    const float2 pos[3] = { float2(-1.0, -3.0), float2(-1.0, 1.0), float2(3.0, 1.0) };
    VertexOut out;
    out.position = float4(pos[vid], 0.0, 1.0);
    // текстуры камеры и изображений приходят с началом координат сверху
    out.uv = float2((pos[vid].x + 1.0) * 0.5, 1.0 - (pos[vid].y + 1.0) * 0.5);
    return out;
}

constexpr sampler linearSampler(coord::normalized, address::clamp_to_edge, filter::linear);

// ── выделение светов для гало ────────────────────────────────────────────
fragment float4 brightPassFragment(VertexOut in [[stage_in]],
                                   texture2d<float> src [[texture(0)]]) {
    float3 c = src.sample(linearSampler, in.uv).rgb;
    float l = max(max(c.r, c.g), c.b);
    return float4(c * smoothstep(0.80, 1.0, l), 1.0);
}

// ── шум ──────────────────────────────────────────────────────────────────
static inline float hash21(float2 p) {
    p = fract(p * float2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}
static inline float vnoise(float2 p) {
    float2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i),                b = hash21(i + float2(1.0, 0.0));
    float c = hash21(i + float2(0.0, 1.0)), d = hash21(i + float2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
// Две октавы: кристаллы эмульсии сбиваются в комки, одной октавы мало.
static inline float grainAt(float2 p) {
    return (vnoise(p) * 0.66 + vnoise(p * 2.17 + 19.3) * 0.34 - 0.5) * 2.0;
}

// ── основной проход ──────────────────────────────────────────────────────
fragment float4 filmFragment(VertexOut in [[stage_in]],
                             texture2d<float> src   [[texture(0)]],
                             texture2d<float> bloom [[texture(1)]],
                             constant FilmParams &p [[buffer(0)]]) {
    const float3 LUM = float3(0.2126, 0.7152, 0.0722);
    float2 uv = in.uv;
    float2 ctr = uv - 0.5;
    float aspect = p.resX / max(p.resY, 1.0);
    float rad = length(ctr * float2(aspect, 1.0)) / length(float2(aspect, 1.0) * 0.5);

    // хроматическая аберрация растёт к краям кадра
    float ab = p.aberration * 0.0035 * rad * rad;
    float3 source;
    source.r = src.sample(linearSampler, uv + ctr * ab).r;
    source.g = src.sample(linearSampler, uv).g;
    source.b = src.sample(linearSampler, uv - ctr * ab).b;

    float3 c = max(source, 0.0);

    c *= pow(2.0, p.exposure);
    c *= float3(1.0 + p.temp * 0.30, 1.0 + p.tint * 0.12, 1.0 - p.temp * 0.30);
    c = c * p.gain + p.lift * (1.0 - c);
    c = pow(max(c, 1e-5), 1.0 / p.gamma);

    c = (c - 0.5) * p.contrast + 0.5;
    c = mix(c, c * c * (3.0 - 2.0 * c), p.toe);

    float lum = dot(clamp(c, 0.0, 1.0), LUM);
    c += p.shadowTint * (1.0 - lum);
    c += p.highTint * lum;

    float3 mono = float3(dot(max(c, 0.0), p.mono));
    c = mix(mix(float3(dot(c, LUM)), c, p.saturation), mono, p.isMono);
    c = c * (1.0 - p.fade) + p.fade * 0.11;

    c = mix(source, c, p.amount);

    float3 bl = bloom.sample(linearSampler, uv).rgb;
    c += bl * float3(1.0, 0.34, 0.16) * p.halation * 1.15;
    c += bl * p.bloom * 0.45;

    if (p.leak > 0.0) {
        float2 lp = (uv - float2(1.02, 0.18)) * float2(1.6, 1.0);
        float l = exp(-dot(lp, lp) * 2.6);
        c += float3(1.0, 0.44, 0.18) * l * p.leak * 1.5;
        c += float3(1.0, 0.62, 0.30) * pow(max(uv.x - 0.72, 0.0) / 0.28, 2.0) * p.leak * 0.35;
    }

    c *= 1.0 - p.vignette * pow(rad, 2.4);

    if (p.grain > 0.0) {
        float2 gp = uv * float2(p.resX, p.resY) / max(p.grainSize, 0.4) + p.seed * 53.0;
        float l = dot(clamp(c, 0.0, 1.0), LUM);
        float gm = smoothstep(0.0, 0.22, l) * (1.0 - smoothstep(0.7, 1.05, l));
        c += grainAt(gp) * p.grain * 0.19 * (0.35 + gm);
        c.r += grainAt(gp + 7.7) * p.grain * 0.035;
        c.b += grainAt(gp - 4.1) * p.grain * 0.035;
    }

    if (p.dust > 0.0) {
        float col = floor(uv.x * p.resX / 2.0);
        float scratch = step(0.99955, hash21(float2(col, floor(p.seed * 97.0))));
        c += scratch * 0.055 * p.dust * smoothstep(0.0, 0.25, uv.y);
        float2 dp = floor(uv * float2(p.resX, p.resY) / 2.5);
        c += step(0.99955, hash21(dp + p.seed * 31.0)) * 0.5 * p.dust;
    }

    return float4(clamp(c, 0.0, 1.0), 1.0);
}
