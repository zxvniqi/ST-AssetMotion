// Asset Motion: animates character-asset images inside chat messages.
// Works alongside the Character Assets extension without modifying it.

const MODULE_NAME = 'asset_motion';
const PROMPT_KEY = 'asset_motion_tags';

// Images produced by Character Assets (regex styles, markdown default, built-in renderer)
const ASSET_SELECTOR = 'img[class*="characterImage"], img.character_asset, img.character-asset-rendered';
// Raw tokens that each become one asset image, in order
const RAW_ASSET_REGEX = /\{\{img::([^}]+)\}\}|!\[[^[\]]+\]\(([^()]+)\)/gi;
const MARKER_REGEX = /\[(motion|fx)\s*:\s*([a-z_-]+)\s*\]/gi;
// A marker on the same line as the image tag breaks the asset's <style> block in markdown
const INLINE_MARKER_REGEX = /(\[(?:motion|fx)\s*:\s*[a-z_-]+\s*\])[ \t]*(?=\{\{img::|!\[)/gi;

const DEFAULT_RULES = `# 파일명 패턴 = 모션 효과   (* 는 아무 글자, 위에서부터 먼저 맞는 줄 적용, 모션·효과 중 하나만 써도 됨)
*angry* = rattle anger
*happy* = hop
*smile* = sparkle
*sad* = gloom
*cry* = tremble
*surprise* = jump startle
*shy* = jelly
*love* = hearts
*confus* = question`;

// Default rules shipped in earlier versions; replaced automatically because they use removed names
const LEGACY_DEFAULT_RULES = [`# 파일명 패턴 = 모션   (* 는 아무 글자, 위에서부터 먼저 맞는 줄 적용)
*angry* = rattle
*happy* = bounce
*smile* = bounce
*sad* = sink
*cry* = tremble
*surprise* = jump
*shy* = jelly
*love* = heartbeat
* = pop`, `# 파일명 패턴 = 모션 효과   (* 는 아무 글자, 위에서부터 먼저 맞는 줄 적용, 모션·효과 중 하나만 써도 됨)
*angry* = rattle anger
*happy* = bounce
*smile* = sparkle
*sad* = gloom
*cry* = tremble
*surprise* = jump exclaim
*shy* = jelly blush
*love* = heartbeat hearts
*confus* = question`, `# 파일명 패턴 = 모션 효과   (* 는 아무 글자, 위에서부터 먼저 맞는 줄 적용, 모션·효과 중 하나만 써도 됨)
*angry* = rattle anger
*happy* = bounce
*smile* = sparkle
*sad* = gloom
*cry* = tremble
*surprise* = jump startle
*shy* = jelly
*love* = heartbeat hearts
*confus* = question`];

const defaultSettings = Object.freeze({
    enabled: true,
    mode: 'tag',
    onlyNew: true,
    loopAmbient: false,
    intensity: 1,
    speed: 1,
    rules: DEFAULT_RULES,
    depth: 1,
    motionsEnabled: true,
    effectsEnabled: true,
    disabledMotions: [],
    disabledEffects: [],
});

// k = intensity multiplier. tf = transform keyframes (added on top of existing transform).
// fx = opacity/filter keyframes (replace). loop = ambient motion that may repeat forever.
const MOTIONS = {
    hop: { label: '깡총', hint: 'cheerful, excited, eager, happy little jumps', dur: 1100,
        tf: k => [
            { transform: 'translateY(0) scale(1, 1)' },
            { transform: `translateY(0) scale(${1 + 0.04 * k}, ${1 - 0.04 * k})`, offset: 0.08 },
            { transform: `translateY(${-24 * k}px) scale(${1 - 0.025 * k}, ${1 + 0.025 * k})`, offset: 0.24 },
            { transform: `translateY(0) scale(${1 + 0.035 * k}, ${1 - 0.035 * k})`, offset: 0.4 },
            { transform: `translateY(${-20 * k}px) scale(${1 - 0.02 * k}, ${1 + 0.02 * k})`, offset: 0.58 },
            { transform: `translateY(0) scale(${1 + 0.03 * k}, ${1 - 0.03 * k})`, offset: 0.76 },
            { transform: 'translateY(0) scale(1, 1)' },
        ] },
    rattle: { label: '덜그럭', hint: 'rattling, clattering, frustrated, fidgeting, grumbling', dur: 550,
        tf: k => [0, -5, 4, -4, 3, -2, 1, 0].map(d => ({ transform: `rotate(${d * k}deg) translateX(${d * 0.3 * k}px)` })) },
    shake: { label: '도리도리', hint: 'refusing, denying, angry no, shaking off', dur: 500,
        tf: k => [0, -10, 10, -8, 8, -4, 4, 0].map(x => tx(x * k)) },
    tremble: { label: '부들부들', hint: 'fear, suppressed rage, cold, about to cry', dur: 700,
        tf: k => jitter(14, 1.6 * k, 0) },
    quake: { label: '쾅쾅', hint: 'explosion, earthquake, furious outburst, huge impact', dur: 800,
        tf: k => jitter(12, 7 * k, 3 * k) },
    wobble: { label: '흔들흔들', hint: 'unsteady, drunk, flustered, losing balance', dur: 900,
        tf: k => [[0, 0], [-12, -5], [10, 3], [-8, -3], [6, 2], [-3, -1], [0, 0]]
            .map(([x, r]) => ({ transform: `translateX(${x * k}px) rotate(${r * k}deg)` })) },
    jelly: { label: '말랑', hint: 'cute, soft, shy, embarrassed in a cute way', dur: 900,
        tf: k => [[1, 1, 0], [1 + 0.15 * k, 1 - 0.15 * k, 0.3], [1 - 0.1 * k, 1 + 0.1 * k, 0.4],
            [1 + 0.08 * k, 1 - 0.08 * k, 0.5], [1 - 0.03 * k, 1 + 0.03 * k, 0.65], [1 + 0.02 * k, 1 - 0.02 * k, 0.75], [1, 1, 1]]
            .map(([x, y, o]) => ({ transform: `scale(${x}, ${y})`, offset: o })) },
    pop: { label: '뿅', hint: 'sudden appearance, an idea, a cute entrance', dur: 500,
        tf: k => [sc(0.3), sc(1 + 0.12 * k, 0.6), sc(0.95, 0.8), sc(1)],
        fx: [{ opacity: 0 }, { opacity: 1, offset: 0.4 }, { opacity: 1 }] },
    jump: { label: '깜짝', hint: 'startled, surprised, shocked', dur: 650,
        tf: k => [ty(0), ty(-18 * k, 0.22), ty(0, 0.5), ty(-4 * k, 0.65), ty(0)] },
    drop: { label: '쿵', hint: 'heavy landing, dramatic entrance, slamming down', dur: 700,
        tf: k => [
            { transform: `translateY(${-60 * k}px) scale(1, 1)`, easing: 'ease-in' },
            { transform: 'translateY(0) scale(1, 1)', offset: 0.5 },
            { transform: `translateY(0) scale(${1 + 0.1 * k}, ${1 - 0.1 * k})`, offset: 0.62 },
            { transform: `translateY(0) scale(${1 - 0.03 * k}, ${1 + 0.03 * k})`, offset: 0.78 },
            { transform: 'translateY(0) scale(1, 1)' },
        ],
        fx: [{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 1 }] },
    squash: { label: '찌부', hint: 'comedic bonk, getting hit, squished', dur: 600,
        tf: k => [[1, 1, 0], [1 + 0.25 * k, 1 - 0.3 * k, 0.25], [1 - 0.1 * k, 1 + 0.1 * k, 0.5], [1 + 0.03 * k, 1 - 0.03 * k, 0.75], [1, 1, 1]]
            .map(([x, y, o]) => ({ transform: `scale(${x}, ${y})`, offset: o })) },
    float: { label: '둥실', hint: 'dreamy, calm, magical, floating', dur: 3000, loop: true,
        tf: k => [ty(0), ty(-8 * k, 0.5), ty(0)] },
    flip: { label: '휙', hint: 'reveal, transformation, a sudden change', dur: 800,
        tf: () => [{ transform: 'perspective(600px) rotateY(0deg)' }, { transform: 'perspective(600px) rotateY(360deg)' }] },
    fade: { label: '스르륵', hint: 'quiet, gentle, melancholic, appearing softly', dur: 1200,
        fx: [{ opacity: 0, filter: 'blur(6px)' }, { opacity: 1, filter: 'blur(0px)' }] },
    slide_left: { label: '슥(왼쪽)', hint: 'entering the scene from the left', dur: 600,
        tf: k => [tx(-60 * k), tx(0)], fx: [{ opacity: 0 }, { opacity: 1 }] },
    slide_right: { label: '슥(오른쪽)', hint: 'entering the scene from the right', dur: 600,
        tf: k => [tx(60 * k), tx(0)], fx: [{ opacity: 0 }, { opacity: 1 }] },
};

function ty(px, offset) { return withOffset({ transform: `translateY(${px}px)` }, offset); }
function tx(px, offset) { return withOffset({ transform: `translateX(${px}px)` }, offset); }
function rot(deg, offset) { return withOffset({ transform: `rotate(${deg}deg)` }, offset); }
function sc(s, offset) { return withOffset({ transform: `scale(${s})` }, offset); }
function withOffset(frame, offset) {
    if (offset !== undefined) frame.offset = offset;
    return frame;
}
// Deterministic jitter so the same motion always looks the same
function jitter(steps, amp, rotAmp) {
    const pattern = [[1, -1], [-1, 1], [1, 1], [-1, -1], [0.5, -1], [-1, 0.5], [1, 0], [-0.5, -0.5]];
    const frames = [{ transform: 'translate(0px, 0px) rotate(0deg)' }];
    for (let i = 0; i < steps; i++) {
        const [x, y] = pattern[i % pattern.length];
        const fade = 1 - i / steps;
        frames.push({ transform: `translate(${x * amp * fade}px, ${y * amp * fade}px) rotate(${(i % 2 ? 1 : -1) * rotAmp * fade}deg)` });
    }
    frames.push({ transform: 'translate(0px, 0px) rotate(0deg)' });
    return frames;
}

// --- effects: things that appear over the picture ---
// Assets are mostly landscape pictures with the face near the center (FACE_X, FACE_Y in %).

const FACE_X = 50;
const FACE_Y = 40;

// Whirlwind: loops that shrink and drift down-right, drawn as one stroke
function tornadoPath(turns) {
    const steps = turns * 28;
    let d = '';
    for (let i = 0; i <= steps; i++) {
        const p = i / steps;
        const t = p * turns * 2 * Math.PI;
        const rx = 28 * (1 - p) + 4;
        const x = 32 + p * 24 + rx * Math.cos(t);
        const y = 10 + p * 56 + rx * 0.38 * Math.sin(t);
        d += `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    return d;
}
// Staggered rows of tiny arcs, like a cartoon cold sweat
function scalePath() {
    let d = '';
    [8, 16, 24, 32].forEach((y, row) => {
        (row % 2 ? [11, 21, 31] : [6, 16, 26]).forEach(x => { d += `M${x} ${y} q3 4 6 0 `; });
    });
    return d.trim();
}
function burstPoints(n, outer, inner, c) {
    const pts = [];
    for (let i = 0; i < n * 2; i++) {
        const r = i % 2 ? inner : outer * (0.8 + 0.2 * ((i * 7) % 5) / 4);
        const a = (i / (n * 2)) * 2 * Math.PI;
        pts.push(`${(c + r * Math.cos(a)).toFixed(1)},${(c + r * Math.sin(a)).toFixed(1)}`);
    }
    return pts.join(' ');
}

const ANGER_SVG = `<svg viewBox="0 0 40 40" width="100%" height="100%"><g fill="none" stroke="#ff3b3b" stroke-width="5" stroke-linecap="round">
<path d="M6 15 Q15 15 15 6"/><path d="M25 6 Q25 15 34 15"/><path d="M6 25 Q15 25 15 34"/><path d="M34 25 Q25 25 25 34"/></g></svg>`;
const TORNADO_SVG = `<svg viewBox="0 0 70 75" width="100%" height="100%"><path d="${tornadoPath(5)}" fill="none" stroke="#1e1e1e" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const SPIKE_SVG = `<svg viewBox="0 0 50 28" width="100%" height="100%"><path d="M2 24 C6 22 9 16 11 6 C12 14 15 18 19 18 C22 12 24 6 27 2 C28 10 31 15 36 16 C39 12 42 9 46 8 C44 14 44 19 47 24" fill="none" stroke="#1e1e1e" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const SCALE_SVG = `<svg viewBox="0 0 40 40" width="100%" height="100%"><path d="${scalePath()}" fill="none" stroke="#1e1e1e" stroke-width="2" stroke-linecap="round"/></svg>`;
const BURST_SVG = `<svg viewBox="0 0 60 60" width="100%" height="100%"><polygon points="${burstPoints(11, 29, 13, 30)}" fill="#fff" stroke="#1e1e1e" stroke-width="2" stroke-linejoin="round"/></svg>`;
const BULB_SVG = `<svg viewBox="0 0 48 48" width="100%" height="100%"><g stroke="#e0a800" stroke-width="2.5" stroke-linecap="round">
<path d="M24 2 L24 6"/><path d="M8 8 L11 11"/><path d="M40 8 L37 11"/><path d="M2 21 L6 21"/><path d="M46 21 L42 21"/></g>
<circle cx="24" cy="21" r="11" fill="#ffe66d" stroke="#8a6d00" stroke-width="2"/>
<path d="M20 22 Q22 17 24 22 Q26 17 28 22" fill="none" stroke="#c48a00" stroke-width="1.5"/>
<rect x="18.5" y="31" width="11" height="9" rx="2" fill="#cfcfcf" stroke="#666" stroke-width="1.5"/><path d="M19 34.5 H29 M19 37.5 H29" stroke="#888" stroke-width="1"/></svg>`;
const BANDAGE_BAND = '<rect x="3" y="15" width="34" height="10" rx="1.5" fill="#fbfbfb" stroke="#b4b4b4" stroke-width="1.2"/><rect x="15" y="15" width="10" height="10" fill="#ececec" stroke="#c4c4c4" stroke-width="0.8"/>';
const BANDAGE_SVG = `<svg viewBox="0 0 40 40" width="100%" height="100%"><g transform="rotate(45 20 20)">${BANDAGE_BAND}</g><g transform="rotate(-45 20 20)">${BANDAGE_BAND}</g></svg>`;
const GHOST_SVG = `<svg viewBox="0 0 40 56" width="100%" height="100%"><path d="M20 3 C31 3 36 12 35 21 C34 32 28 39 24 46 C22 50 24 53 28 55 C19 55 14 50 15 44 C16 38 6 32 5 21 C4 11 9 3 20 3 Z" fill="rgba(255,255,255,0.88)" stroke="#9aa6b8" stroke-width="1.5"/>
<ellipse cx="15" cy="18" rx="2" ry="3" fill="#444"/><ellipse cx="25" cy="18" rx="2" ry="3" fill="#444"/><ellipse cx="20" cy="26" rx="2.5" ry="3" fill="#666"/></svg>`;
const HOLD = [{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }];
// Spots all around the face for notes / sparkles / hearts
const AROUND_FACE = [[24, 26], [76, 22], [18, 54], [82, 52], [36, 10], [64, 8], [30, 78], [70, 80]];

// play(layer, unit px, duration ms). Positions are % of the picture box.
const EFFECTS = {
    notes: { label: '음표', hint: 'singing, humming, music, a carefree good mood', dur: 2400,
        play(L, u, d) {
            AROUND_FACE.slice(0, 6).forEach(([x, y], i) => {
                const dx = (i % 2 ? 1 : -1) * u * 0.4;
                run(place(L, glyph(i % 3 === 1 ? '♫' : '♪', '#5ab4ff', u * (i % 2 ? 0.9 : 1.1)), x, y),
                    [pf(0, 0, 0.3, 0, 0), pf(0, -u * 0.2, 1, -12, 1, 0.15), pf(dx, -u * 0.7, 1, 12, 1, 0.55), pf(-dx * 0.5, -u * 1.3, 0.9, -8, 0)],
                    d * 0.65, i * d * 0.07);
            });
        } },
    sparkle: { label: '반짝', hint: 'delighted, proud, dazzling, beautiful, a magical moment', dur: 1800,
        play(L, u, d) {
            AROUND_FACE.forEach(([x, y], i) => {
                const el = place(L, glyph('✦', '#fff6b0', u * [1.1, 0.8, 0.9, 1.2, 0.7, 1, 0.85, 0.75][i]), x, y);
                el.classList.add('am-glow');
                run(el, [pf(0, 0, 0, 0, 0), pf(0, 0, 1.2, 45, 1, 0.4), pf(0, 0, 0, 90, 0)], d * 0.5, ((i * 3) % 8) * d * 0.06);
            });
        } },
    hearts: { label: '하트', hint: 'love, affection, adoration, being smitten', dur: 2200,
        play(L, u, d) {
            AROUND_FACE.slice(0, 6).forEach(([x, y], i) => {
                const sway = (i % 2 ? 1 : -1) * u * 0.3;
                run(place(L, glyph('♥︎', '#ff6b9e', u * (i % 3 ? 0.9 : 1.2)), x, y),
                    [pf(0, 0, 0.2, 0, 0), pf(0, -u * 0.2, 1.1, 0, 1, 0.2), pf(sway, -u * 0.7, 1, -8, 1, 0.6), pf(-sway * 0.5, -u * 1.3, 0.9, 8, 0)],
                    d * 0.65, i * d * 0.07);
            });
        } },
    question: { label: '물음표', hint: 'confused, puzzled, wondering, not understanding', dur: 1800,
        play(L, u, d) {
            run(place(L, glyph('?', '#ffd54a', u * 1.4), 68, 16),
                [pf(0, 0, 0, 0, 0), pf(0, 0, 1.25, 0, 1, 0.15), pf(0, 0, 1, -14, 1, 0.3), pf(0, 0, 1, 12, 1, 0.45),
                    pf(0, 0, 1, -6, 1, 0.6), pf(0, 0, 1, 0, 1, 0.85), pf(0, -u * 0.3, 1, 0, 0)], d);
            run(place(L, glyph('?', '#ffd54a', u * 0.9), 59, 24),
                [pf(0, 0, 0, 0, 0), pf(0, 0, 1.2, 0, 1, 0.2), pf(0, 0, 1, 10, 1, 0.4), pf(0, 0, 1, 0, 1, 0.8), pf(0, -u * 0.3, 1, 0, 0)],
                d * 0.85, d * 0.15);
        } },
    exclaim: { label: '느낌표', hint: 'surprised, alarmed, suddenly noticing something', dur: 1400,
        play(L, u, d) {
            const j = u * 0.08;
            run(place(L, glyph('!', '#ff4d4d', u * 1.5), 68, 14),
                [pf(0, u * 0.3, 0, 0, 0), pf(0, 0, 1.4, 0, 1, 0.12), pf(0, 0, 1, 0, 1, 0.25), pf(-j * 2, 0, 1, -6, 1, 0.32),
                    pf(j * 2, 0, 1, 6, 1, 0.39), pf(-j, 0, 1, -3, 1, 0.46), pf(0, 0, 1, 0, 1, 0.8), pf(0, 0, 1, 0, 0)], d);
        } },
    startle: { label: '깜짝(^^^)', hint: 'jolted with surprise, shocked, caught off guard', dur: 1300,
        play(L, u, d) {
            [[32, 14, -30], [68, 14, 30]].forEach(([x, y, r]) => {
                const el = place(L, svg(SPIKE_SVG, u * 1.1, u * 0.62), x, y);
                el.classList.add('am-ink');
                run(el, [pf(0, u * 0.3, 0.3, r, 0), pf(0, 0, 1.2, r, 1, 0.12), pf(0, 0, 1, r, 1, 0.25), pf(0, -u * 0.08, 1.05, r, 1, 0.4),
                    pf(0, 0, 1, r, 1, 0.8), pf(0, -u * 0.2, 1, r, 0)], d);
            });
        } },
    cold_sweat: { label: '식은땀', hint: 'breaking into a cold sweat, flustered, awkward panic, nervously cornered', dur: 1800,
        play(L, u, d) {
            const el = place(L, svg(SCALE_SVG, u * 1.1, u * 1.1), 78, 24);
            el.classList.add('am-ink');
            const j = u * 0.03;
            run(el, [pf(0, 0, 0.8, 0, 0), pf(0, 0, 1, 0, 1, 0.15), pf(-j, 0, 1, 0, 1, 0.3), pf(j, 0, 1, 0, 1, 0.4), pf(-j, 0, 1, 0, 1, 0.5),
                pf(j, 0, 1, 0, 1, 0.6), pf(0, 0, 1, 0, 1, 0.8), pf(0, u * 0.1, 1, 0, 0)], d);
        } },
    sweat: { label: '땀', hint: 'nervous, awkward, embarrassed, an uh-oh moment', dur: 1600,
        play(L, u, d) {
            [[66, 20, 0.7, 0], [61, 30, 0.45, 0.25]].forEach(([x, y, s, delay]) => {
                const drop = document.createElement('span');
                drop.className = 'am-p am-drop';
                drop.style.width = drop.style.height = `${u * s}px`;
                run(place(L, drop, x, y),
                    [pf(0, -u * 0.2, 0, -45, 0), pf(0, 0, 1, -45, 1, 0.2), pf(0, 0, 1, -45, 1, 0.5), pf(0, u * 0.9, 0.9, -45, 0)],
                    d * (1 - delay), d * delay, 'ease-in');
            });
        } },
    anger: { label: '빠직', hint: 'annoyed, irritated, angry, a vein popping', dur: 1500,
        play(L, u, d) {
            run(place(L, svg(ANGER_SVG, u * 1.2, u * 1.2), 67, 16),
                [pf(0, 0, 0, 0, 0), pf(0, 0, 1.3, 0, 1, 0.15), pf(0, 0, 0.9, 0, 1, 0.3), pf(0, 0, 1.15, 0, 1, 0.45),
                    pf(0, 0, 0.95, 0, 1, 0.6), pf(0, 0, 1.05, 0, 1, 0.8), pf(0, 0, 1, 0, 0)], d);
        } },
    zzz: { label: '졸림', hint: 'sleepy, tired, bored, dozing off', dur: 2400,
        play(L, u, d) {
            [['Z', 1.1], ['z', 0.85], ['z', 0.7]].forEach(([g, s], i) => {
                run(place(L, glyph(g, '#c9d3ff', u * s), 62, 24),
                    [pf(0, 0, 0.4, 0, 0), pf(u * 0.3, -u * 0.4, 1, -10, 1, 0.25), pf(u * 1.1, -u * 1.3, 1, -15, 1, 0.7), pf(u * 1.5, -u * 1.9, 0.9, -20, 0)],
                    d * 0.6, i * d * 0.2);
            });
        } },
    idea: { label: '전구', hint: 'a sudden idea, realization, figuring something out', dur: 1800,
        play(L, u, d) {
            const el = place(L, svg(BULB_SVG, u * 1.8, u * 1.8), 68, 16);
            el.classList.add('am-shine');
            run(el, [pf(0, u * 0.4, 0, 0, 0), pf(0, 0, 1.25, -8, 1, 0.15), pf(0, 0, 1, 6, 1, 0.3), pf(0, 0, 1.08, 0, 1, 0.45),
                pf(0, 0, 1, 0, 1, 0.6), pf(0, 0, 1.08, 0, 1, 0.75), pf(0, -u * 0.2, 1, 0, 0)], d);
        } },
    dizzy: { label: '멘탈붕괴', hint: 'mentally shattered, overwhelmed, dizzy, head spinning in confusion', dur: 2400,
        play(L, u, d) {
            const el = place(L, svg(TORNADO_SVG, u * 1.4, u * 1.5), FACE_X, 12);
            el.classList.add('am-ink');
            run(el, [pf(0, 0, 0.3, 0, 0), pf(0, 0, 1.05, -6, 1, 0.15), pf(0, 0, 0.95, 6, 1, 0.3), pf(0, 0, 1.05, -6, 1, 0.45),
                pf(0, 0, 0.95, 6, 1, 0.6), pf(0, 0, 1.03, -4, 1, 0.75), pf(0, -u * 0.2, 1, 0, 0)], d, 0, 'ease-in-out');
            veil(L, 'rgba(60, 50, 90, 0.25)', HOLD, d);
        } },
    hit: { label: '타격', hint: 'getting hit, a punch or slap landing, a sharp impact', dur: 900,
        play(L, u, d) {
            // Two quick hits: lower left, then upper right
            [[30, 66, 0], [70, 30, 0.2]].forEach(([x, y, delay]) => {
                run(place(L, svg(BURST_SVG, u * 1.5, u * 1.5), x, y),
                    [pf(0, 0, 0.2, 0, 0), pf(0, 0, 1.3, 10, 1, 0.15), pf(0, 0, 1, 0, 1, 0.35), pf(0, 0, 1, 0, 1, 0.65), pf(0, 0, 1.15, 0, 0)],
                    d * 0.75, d * delay);
            });
            veil(L, 'rgba(255, 255, 255, 0.6)', [{ opacity: 0 }, { opacity: 1, offset: 0.06 }, { opacity: 0, offset: 0.18 }, { opacity: 1, offset: 0.26 },
                { opacity: 0, offset: 0.4 }, { opacity: 0 }], d);
        } },
    bandage: { label: '반창고', hint: 'hurt, bruised, beaten up, after getting hit', dur: 2200,
        play(L, u, d) {
            run(place(L, svg(BANDAGE_SVG, u * 1.1, u * 1.1), 58, 10),
                [pf(0, 0, 1.8, -10, 0), pf(0, 0, 0.9, -10, 1, 0.12), pf(0, 0, 1.05, -10, 1, 0.22), pf(0, 0, 1, -10, 1, 0.85), pf(0, 0, 1, -10, 0)], d);
        } },
    soul: { label: '영혼 가출', hint: 'soul leaving the body, utterly drained, dumbfounded, mortified to death', dur: 3000,
        play(L, u, d) {
            run(place(L, svg(GHOST_SVG, u * 0.9, u * 1.26), FACE_X, 50),
                [pf(0, 0, 0.3, 0, 0), pf(0, -u * 0.5, 1, 0, 0.9, 0.2), pf(0, -u * 1.5, 1, 0, 0.9, 0.5),
                    pf(0, -u * 2.5, 1, 0, 0.8, 0.8), pf(0, -u * 3.2, 1, 0, 0)], d, 0, 'ease-in-out');
            veil(L, 'rgba(200, 210, 230, 0.3)', HOLD, d, { mixBlendMode: 'saturation' });
        } },
    focus: { label: '집중선', hint: 'intense focus, a dramatic moment, sudden tension', dur: 1600,
        play(L, u, d) {
            const mask = `radial-gradient(ellipse 40% 45% at ${FACE_X}% ${FACE_Y}%, transparent 55%, #000 100%)`;
            const flicker = [{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 0.75, offset: 0.4 }, { opacity: 1, offset: 0.6 }, { opacity: 0.85, offset: 0.85 }, { opacity: 0 }];
            veil(L, `repeating-conic-gradient(from 0deg at ${FACE_X}% ${FACE_Y}%, rgba(15, 15, 15, 0.65) 0deg 0.8deg, transparent 0.8deg 5deg)`, flicker, d,
                { maskImage: mask, webkitMaskImage: mask });
            veil(L, `repeating-conic-gradient(from 2deg at ${FACE_X}% ${FACE_Y}%, rgba(15, 15, 15, 0.5) 0deg 0.5deg, transparent 0.5deg 7.3deg)`, flicker, d,
                { maskImage: mask, webkitMaskImage: mask });
        } },
    dreamy: { label: '아련', hint: 'nostalgic, wistful, a tender memory, a soft dreamlike moment', dur: 3600,
        play(L, u, d) {
            veil(L, 'radial-gradient(ellipse at center, rgba(255, 255, 255, 0) 35%, rgba(255, 255, 255, 0.6) 100%)', HOLD, d);
            // Bokeh stays inside the picture
            const box = veil(L, 'none', [{ opacity: 1 }, { opacity: 1 }], d, { overflow: 'hidden' });
            [[12, 20, 1.6, 0], [30, 70, 1.1, 1], [80, 18, 1.9, 1], [88, 66, 1.2, 0], [56, 86, 1.4, 1], [20, 46, 0.7, 0],
                [70, 50, 0.6, 0], [44, 14, 0.9, 1], [92, 40, 0.8, 0], [8, 82, 1.3, 1]].forEach(([x, y, s, ring], i) => {
                const b = document.createElement('span');
                b.className = ring ? 'am-p am-bokeh am-ring' : 'am-p am-bokeh';
                b.style.width = b.style.height = `${u * s}px`;
                run(place(box, b, x, y), [pf(0, u * 0.2, 0.7, 0, 0), pf(0, 0, 1, 0, 1, 0.3), pf(0, -u * 0.3, 1, 0, 1, 0.75), pf(0, -u * 0.5, 1.1, 0, 0)],
                    d * 0.8, (i % 4) * d * 0.06, 'ease-in-out');
            });
        } },
    halo: { label: '후광', hint: 'radiant, holy, admirable, shining with charm or glory', dur: 3200,
        play(L, u, d) {
            // The whole picture glows from its edges (gradients, since some themes disable box-shadow)
            const pulse = [{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 0.7, offset: 0.45 }, { opacity: 1, offset: 0.65 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }];
            const g = Math.round(u * 0.5);
            const inner = 'rgba(255, 245, 200, 0.8)';
            veil(L, [`linear-gradient(to right, ${inner}, transparent ${g}px)`, `linear-gradient(to left, ${inner}, transparent ${g}px)`,
                `linear-gradient(to bottom, ${inner}, transparent ${g}px)`, `linear-gradient(to top, ${inner}, transparent ${g}px)`].join(', '), pulse, d);
            // A bright edge whose drop-shadow spills light outside the picture
            veil(L, 'none', pulse, d, {
                border: '3px solid rgba(255, 248, 215, 0.95)', boxSizing: 'border-box',
                filter: `drop-shadow(0 0 ${Math.round(g * 0.3)}px #fff0b0) drop-shadow(0 0 ${Math.round(g * 0.6)}px #ffe08a) drop-shadow(0 0 ${g}px #ffd060)`,
            });
        } },
    gloom: { label: '안색 어두움', hint: 'feeling sick, dread, despair, depressed, mortified', dur: 3200,
        play(L, u, d) {
            veil(L, 'linear-gradient(to bottom, rgba(72, 28, 120, 0.85), rgba(96, 52, 160, 0.45) 35%, rgba(96, 52, 160, 0) 70%)', HOLD, d);
            const mask = 'linear-gradient(to bottom, #000, transparent 45%)';
            veil(L, 'repeating-linear-gradient(90deg, rgba(30, 0, 60, 0.5) 0 2px, transparent 2px 9px)', HOLD, d,
                { maskImage: mask, webkitMaskImage: mask });
        } },
    flash: { label: '번쩍', hint: 'sudden realization, a blinding flash, a striking impact', dur: 700,
        play(L, u, d) {
            veil(L, 'rgba(255, 255, 255, 0.9)', [{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 0 }], d);
        } },
    rage: { label: '분노', hint: 'furious, seething, boiling with rage', dur: 1600,
        play(L, u, d) {
            veil(L, 'radial-gradient(ellipse at center, rgba(255, 0, 0, 0) 40%, rgba(210, 20, 20, 0.65) 100%)',
                [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 0.45, offset: 0.35 }, { opacity: 1, offset: 0.55 }, { opacity: 0.6, offset: 0.75 }, { opacity: 0 }], d);
        } },
    chill: { label: '오싹', hint: 'fear, a chill down the spine, cold, a creeping realization', dur: 3000,
        play(L, u, d) {
            veil(L, 'linear-gradient(to top, rgba(70, 140, 255, 0.6), rgba(70, 140, 255, 0.2) 40%, transparent 70%)', HOLD, d);
        } },
};

function glyph(text, color, size) {
    const el = document.createElement('span');
    el.className = 'am-p';
    el.textContent = text;
    el.style.color = color;
    el.style.fontSize = `${size}px`;
    return el;
}
function svg(markup, width, height) {
    const el = document.createElement('span');
    el.className = 'am-p';
    el.innerHTML = markup;
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;
    return el;
}
function place(layer, el, x, y) {
    el.style.left = `${x}%`;
    el.style.top = `${y}%`;
    layer.append(el);
    return el;
}
// Particle frame: centered on its anchor, then moved / scaled / rotated
function pf(x, y, s, r, o, offset) {
    return withOffset({ transform: `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${s}) rotate(${r}deg)`, opacity: o }, offset);
}
function run(el, frames, duration, delay = 0, easing = 'ease-out') {
    el.animate(frames, { duration, delay, easing, fill: 'both' });
}
function veil(layer, background, frames, duration, style = {}) {
    const el = document.createElement('span');
    el.className = 'am-veil';
    el.style.background = background;
    Object.assign(el.style, style);
    layer.append(el);
    el.animate(frames, { duration, easing: 'ease-in-out', fill: 'both' });
    return el;
}

// --- state ---
let baselineMesId = -1;          // messages at or below this id existed when the chat opened
const freshMes = new Set();      // old message ids that got a new render (swipe / regenerate / edit)
let playedKeys = new Set();      // one-shot motions already shown this session
const loopedImages = new WeakSet();
const activeLayers = new WeakMap(); // element -> cleanup of its effect layer
let generating = false;
const rawCache = new Map();      // raw message text -> parsed asset list

function getSettings() {
    const { extensionSettings } = SillyTavern.getContext();
    if (!extensionSettings[MODULE_NAME]) {
        extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
    }
    for (const key of Object.keys(defaultSettings)) {
        if (!Object.hasOwn(extensionSettings[MODULE_NAME], key)) {
            extensionSettings[MODULE_NAME][key] = structuredClone(defaultSettings[key]);
        }
    }
    if (LEGACY_DEFAULT_RULES.includes(extensionSettings[MODULE_NAME].rules)) {
        extensionSettings[MODULE_NAME].rules = DEFAULT_RULES;
    }
    return extensionSettings[MODULE_NAME];
}

function motionOn(name) {
    const settings = getSettings();
    return !!MOTIONS[name] && settings.motionsEnabled && !settings.disabledMotions.includes(name);
}

function effectOn(name) {
    const settings = getSettings();
    return !!EFFECTS[name] && settings.effectsEnabled && !settings.disabledEffects.includes(name);
}

// --- motion resolution ---

function rawTextOf(message) {
    return message?.extra?.display_text ?? message?.mes ?? '';
}

function parseRaw(text) {
    if (rawCache.has(text)) return rawCache.get(text);
    const items = [];
    const tokenRegex = new RegExp(`${MARKER_REGEX.source}|${RAW_ASSET_REGEX.source}`, 'gi');
    let pending = {};
    for (const m of text.matchAll(tokenRegex)) {
        if (m[1] !== undefined) {
            pending[m[1].toLowerCase()] = m[2].toLowerCase();
        } else {
            items.push({ name: (m[3] ?? m[4] ?? '').trim(), motion: pending.motion ?? null, effect: pending.fx ?? null });
            pending = {};
        }
    }
    if (rawCache.size > 300) rawCache.clear();
    rawCache.set(text, items);
    return items;
}

function parseRules(text) {
    const rules = [];
    for (const line of String(text || '').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.lastIndexOf('=');
        if (eq < 0) continue;
        const pattern = trimmed.slice(0, eq).trim().toLowerCase();
        const names = trimmed.slice(eq + 1).trim().toLowerCase().split(/[\s,+]+/);
        const motion = names.find(n => MOTIONS[n]) ?? null;
        const effect = names.find(n => EFFECTS[n]) ?? null;
        if (!pattern || (!motion && !effect)) continue;
        const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
        rules.push({ regex: new RegExp(`^${escaped}$`), motion, effect });
    }
    return rules;
}

function fileNameOf(img, rawName) {
    if (rawName) return rawName.split('/').pop();
    try {
        return decodeURIComponent((img.getAttribute('src') || '').split('?')[0].split('/').pop() || '');
    } catch {
        return img.getAttribute('alt') || '';
    }
}

// Returns { motion, effect } (either may be null) or null when nothing applies
function resolveAsset(img, item) {
    const settings = getSettings();
    let found = null;
    if (settings.mode === 'tag') {
        found = item;
    } else {
        const name = fileNameOf(img, item?.name).toLowerCase();
        if (name) found = parseRules(settings.rules).find(r => r.regex.test(name));
    }
    const motion = motionOn(found?.motion) ? found.motion : null;
    const effect = effectOn(found?.effect) ? found.effect : null;
    return motion || effect ? { motion, effect } : null;
}

function isLooping(found) {
    return !!(found.motion && MOTIONS[found.motion].loop && getSettings().loopAmbient);
}

// --- DOM processing ---

// Puts markers written right before an image tag onto their own line and re-renders
function splitInlineMarkers(mesId, message) {
    let changed = false;
    const fix = (text) => {
        if (typeof text !== 'string') return text;
        const next = text.replace(INLINE_MARKER_REGEX, '$1\n');
        if (next !== text) changed = true;
        return next;
    };
    message.mes = fix(message.mes);
    if (message.extra?.display_text) message.extra.display_text = fix(message.extra.display_text);
    if (Array.isArray(message.swipes) && typeof message.swipes[message.swipe_id] === 'string') {
        message.swipes[message.swipe_id] = fix(message.swipes[message.swipe_id]);
    }
    if (changed) SillyTavern.getContext().updateMessageBlock(mesId, message);
    return changed;
}

function stripMarkers(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const hits = [];
    while (walker.nextNode()) {
        const value = walker.currentNode.nodeValue;
        if (value.includes('[motion') || value.includes('[fx')) hits.push(walker.currentNode);
    }
    for (const node of hits) {
        const next = node.nodeValue.replace(MARKER_REGEX, '');
        if (next === node.nodeValue) continue;
        node.nodeValue = next;
        // A marker line renders as its own paragraph; drop it once empty
        const parent = node.parentElement;
        if (parent?.tagName === 'P' && !parent.textContent.trim() && !parent.querySelector(':not(br)')) parent.remove();
    }
}

function isEligible(mesId) {
    if (!getSettings().onlyNew) return true;
    return mesId > baselineMesId || freshMes.has(mesId);
}

function processMessage(mesEl) {
    const settings = getSettings();
    if (!settings.enabled) return;
    const textEl = mesEl.querySelector('.mes_text');
    if (!textEl) return;

    const mesId = Number(mesEl.getAttribute('mesid'));
    const isLast = mesEl.classList.contains('last_mes');
    const { chat, getCurrentChatId } = SillyTavern.getContext();
    const message = chat?.[mesId];
    // Streaming text is still changing; fix it after generation ends
    if (message && !(generating && isLast) && splitInlineMarkers(mesId, message)) return;

    stripMarkers(textEl);

    const images = textEl.querySelectorAll(ASSET_SELECTOR);
    if (!images.length) return;

    // Wait for streaming to finish; the final render replaces the images anyway
    if (generating && isLast) return;
    if (!isEligible(mesId)) return;

    const items = parseRaw(rawTextOf(message));
    const chatId = getCurrentChatId?.() ?? '';

    images.forEach((img, index) => {
        const found = resolveAsset(img, items[index]);
        if (!found) return;
        const key = `${chatId}|${mesId}|${message?.swipe_id ?? 0}|${index}|${img.getAttribute('src')}`;
        const looping = isLooping(found);
        if (looping ? loopedImages.has(img) : playedKeys.has(key)) return;
        if (img.dataset.amQueued === key) return;
        img.dataset.amQueued = key;
        queueWhenVisible(img, () => {
            if (looping) {
                if (loopedImages.has(img)) return;
                loopedImages.add(img);
            } else {
                if (playedKeys.has(key)) return;
                playedKeys.add(key);
            }
            playAsset(img, found, looping);
        });
    });
}

// Clicking an asset picture replays its motion and effect
function onAssetClick(event) {
    if (!getSettings().enabled) return;
    const img = event.target.closest?.(ASSET_SELECTOR);
    const textEl = img?.closest('.mes_text');
    const mesEl = textEl?.closest('.mes');
    if (!mesEl) return;
    const message = SillyTavern.getContext().chat?.[Number(mesEl.getAttribute('mesid'))];
    const index = [...textEl.querySelectorAll(ASSET_SELECTOR)].indexOf(img);
    const found = resolveAsset(img, parseRaw(rawTextOf(message))[index]);
    if (!found) return;
    const looping = isLooping(found);
    if (looping) loopedImages.add(img);
    playAsset(img, found, looping);
}

const visibilityCallbacks = new WeakMap();
const visibilityObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        visibilityObserver.unobserve(entry.target);
        const callback = visibilityCallbacks.get(entry.target);
        visibilityCallbacks.delete(entry.target);
        callback?.();
    }
}, { threshold: 0.3 });

function queueWhenVisible(img, callback) {
    const run = () => {
        visibilityCallbacks.set(img, callback);
        visibilityObserver.observe(img);
    };
    if (img.complete) {
        run();
    } else {
        img.addEventListener('load', run, { once: true });
        img.addEventListener('error', () => img.removeEventListener('load', run), { once: true });
    }
}

function playAsset(el, found, looping = false) {
    const layer = found.effect ? playEffect(el, found.effect) : null;
    if (found.motion) playMotion(el, found.motion, looping, layer);
}

// follower = effect layer that should move together with the picture
function playMotion(el, motion, looping = false, follower = null) {
    const def = MOTIONS[motion];
    if (!def) return;
    const settings = getSettings();
    const k = Number(settings.intensity) || 1;
    const duration = def.dur / (Number(settings.speed) || 1);
    const iterations = looping ? Infinity : 1;
    el.getAnimations().forEach(a => a.id?.startsWith(MODULE_NAME) && a.cancel());
    const easing = def.loop ? 'ease-in-out' : 'ease-out';
    if (def.tf) {
        const frames = def.tf(k);
        const a = el.animate(frames, { duration, iterations, easing, composite: 'add' });
        a.id = `${MODULE_NAME}-tf`;
        follower?.animate(frames, { duration, iterations, easing, composite: 'add' });
    }
    if (def.fx) {
        const a = el.animate(def.fx, { duration, iterations: 1, easing: 'ease-out' });
        a.id = `${MODULE_NAME}-fx`;
    }
}

// Effects draw on a layer placed exactly over the picture, next to it in the DOM
function playEffect(el, effect) {
    const def = EFFECTS[effect];
    if (!def || !el.isConnected || !el.offsetParent) return null;
    activeLayers.get(el)?.();

    const layer = document.createElement('span');
    layer.className = 'am-fx-layer';
    layer.style.borderRadius = getComputedStyle(el).borderRadius;
    el.after(layer);
    const fit = () => {
        layer.style.left = `${el.offsetLeft}px`;
        layer.style.top = `${el.offsetTop}px`;
        layer.style.width = `${el.offsetWidth}px`;
        layer.style.height = `${el.offsetHeight}px`;
    };
    fit();
    const resize = new ResizeObserver(fit);
    resize.observe(el);
    const cleanup = () => {
        resize.disconnect();
        layer.remove();
        if (activeLayers.get(el) === cleanup) activeLayers.delete(el);
    };
    activeLayers.set(el, cleanup);

    const unit = Math.max(24, Math.min(100, Math.min(el.offsetWidth, el.offsetHeight) * 0.28));
    def.play(layer, unit, def.dur / (Number(getSettings().speed) || 1));
    Promise.allSettled(layer.getAnimations({ subtree: true }).map(a => a.finished)).then(cleanup);
    return layer;
}

// --- observers and events ---

let pendingMessages = new Set();
let flushScheduled = false;

function scheduleMessage(mesEl) {
    pendingMessages.add(mesEl);
    if (flushScheduled) return;
    flushScheduled = true;
    queueMicrotask(() => {
        flushScheduled = false;
        const batch = pendingMessages;
        pendingMessages = new Set();
        batch.forEach(el => el.isConnected && processMessage(el));
    });
}

function processMessageById(mesId) {
    const el = document.querySelector(`#chat .mes[mesid="${mesId}"]`);
    if (el) scheduleMessage(el);
}

function processAll() {
    document.querySelectorAll('#chat .mes').forEach(scheduleMessage);
}

function startObserver() {
    const chatEl = document.getElementById('chat');
    if (!chatEl) return;
    const observer = new MutationObserver((mutations) => {
        if (!getSettings().enabled) return;
        for (const mutation of mutations) {
            const target = mutation.target.nodeType === 1 ? mutation.target : mutation.target.parentElement;
            const mes = target?.closest?.('.mes');
            if (mes) {
                scheduleMessage(mes);
                continue;
            }
            for (const node of mutation.addedNodes) {
                if (node.nodeType !== 1) continue;
                if (node.classList.contains('mes')) scheduleMessage(node);
                node.querySelectorAll?.('.mes').forEach(scheduleMessage);
            }
        }
    });
    observer.observe(chatEl, { childList: true, subtree: true, characterData: true });
    chatEl.addEventListener('click', onAssetClick);
}

function resetForChat() {
    const { chat } = SillyTavern.getContext();
    baselineMesId = (chat?.length ?? 0) - 1;
    freshMes.clear();
    playedKeys = new Set();
    processAll();
}

function markFresh(mesId) {
    const id = Number(mesId);
    if (Number.isNaN(id)) return;
    freshMes.add(id);
    processMessageById(id);
    // Asset renderer swaps tags in lazily; catch images that appear a moment later
    setTimeout(() => processMessageById(id), 400);
}

function buildTagPrompt() {
    const motions = Object.entries(MOTIONS).filter(([name]) => motionOn(name));
    const effects = Object.entries(EFFECTS).filter(([name]) => effectOn(name));
    if (!motions.length && !effects.length) return '';
    const list = defs => defs.map(([name, def]) => `- ${name}: ${def.hint}`).join('\n');
    const both = motions.length && effects.length;
    const what = both ? 'at most one motion and at most one effect' : motions.length ? 'at most one motion' : 'at most one effect';
    const markers = [motions.length ? '[motion:NAME]' : '', effects.length ? '[fx:NAME]' : ''].filter(Boolean).join(' ');
    const sections = [
        motions.length ? `Motions (how the picture moves):\n${list(motions)}` : '',
        effects.length ? `Effects (what appears over the picture):\n${list(effects)}` : '',
    ].filter(Boolean).join('\n');
    return `[Asset Motion]
You may decorate an internal image tag ({{img::filename.ext}}) with ${what}. Write the marker${both ? 's' : ''} on their own line directly above the image tag, never on the same line as the tag:
${markers}
{{img::filename.ext}}
Markers are optional and most images need none. Add one only when the paragraph right before the image shows a clear emotion, action, or event that it expresses well; otherwise write the image tag alone.${both ? ' A motion and an effect can be combined, or either can be used alone.' : ''} Do not fall into using the same choice every time.
${sections}
Use only names from these lists. Never write a marker without an image tag right below it.`;
}

function updatePromptInjection() {
    const { setExtensionPrompt } = SillyTavern.getContext();
    const settings = getSettings();
    const active = settings.enabled && settings.mode === 'tag';
    // position 1 = in chat at depth, role 0 = system
    setExtensionPrompt(PROMPT_KEY, active ? buildTagPrompt() : '', 1, Number(settings.depth) || 0, false, 0);
}

// --- settings UI ---

function createSettingsUI() {
    const settings = getSettings();
    const chips = (defs, kind, disabled) => Object.entries(defs)
        .map(([name, def]) => `<span class="am-chip" data-${kind}="${name}" title="${name}">`
            + `<input type="checkbox" class="am-chip-on" ${disabled.includes(name) ? '' : 'checked'} />`
            + `<span class="am-chip-text">${def.label}<small>${name}</small></span></span>`)
        .join('');
    const html = `
    <div id="${MODULE_NAME}_settings" class="extension_settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>에셋 모션</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
              <div class="am-body">
                <label class="checkbox_label">
                    <input id="am_enabled" type="checkbox" />
                    <span>사용</span>
                </label>
                <label class="am-row">
                    <span>모션 고르는 방식</span>
                    <select id="am_mode" class="text_pole">
                        <option value="tag">AI 태그 (AI가 상황 보고 고름)</option>
                        <option value="filename">파일명 규칙 (직접 지정)</option>
                    </select>
                </label>
                <label class="checkbox_label">
                    <input id="am_motionsEnabled" type="checkbox" />
                    <span>모션 사용</span>
                </label>
                <label class="checkbox_label">
                    <input id="am_effectsEnabled" type="checkbox" />
                    <span>효과 사용</span>
                </label>
                <label class="checkbox_label">
                    <input id="am_onlyNew" type="checkbox" />
                    <span>새로 온 메시지에만 (채팅 열 때 예전 이미지는 안 움직임)</span>
                </label>
                <label class="checkbox_label">
                    <input id="am_loopAmbient" type="checkbox" />
                    <span>둥실은 계속 반복</span>
                </label>
                <label class="am-row">
                    <span>세기 <b id="am_intensity_value"></b></span>
                    <input id="am_intensity" type="range" min="0.5" max="2" step="0.1" />
                </label>
                <label class="am-row">
                    <span>속도 <b id="am_speed_value"></b></span>
                    <input id="am_speed" type="range" min="0.5" max="2" step="0.1" />
                </label>

                <div id="am_tag_section" class="am-section">
                    <small>AI에게 어울리는 장면에서만 이미지 바로 윗줄에 <code>[motion:이름]</code> <code>[fx:이름]</code>을 쓰라고 자동으로 알려줘요. 표시는 화면에서 자동으로 지워집니다.</small>
                    <label class="am-row">
                        <span>프롬프트 삽입 깊이</span>
                        <input id="am_depth" type="number" min="0" max="20" class="text_pole am-num" />
                    </label>
                </div>

                <div id="am_filename_section" class="am-section">
                    <small>한 줄에 <code>파일명 패턴 = 모션 효과</code> (하나만 써도 돼요). 위에서부터 먼저 맞는 줄이 적용돼요.</small>
                    <textarea id="am_rules" class="text_pole" rows="8"></textarea>
                </div>

                <div class="am-section">
                    <small>미리보기 (눌러보세요) · 체크를 끄면 그 항목은 안 나와요 · 채팅에서는 에셋 사진을 누르면 다시 재생돼요</small>
                    <div class="am-preview"><div id="am_preview_target" class="am-preview-target"><i class="fa-solid fa-user"></i></div></div>
                    <small>모션</small>
                    <div class="am-chips">${chips(MOTIONS, 'motion', settings.disabledMotions)}</div>
                    <small>효과</small>
                    <div class="am-chips">${chips(EFFECTS, 'effect', settings.disabledEffects)}</div>
                </div>
              </div>
            </div>
        </div>
    </div>`;
    document.getElementById('extensions_settings2').insertAdjacentHTML('beforeend', html);

    const { saveSettingsDebounced } = SillyTavern.getContext();
    const $ = id => document.getElementById(id);

    const syncSections = () => {
        $('am_tag_section').style.display = settings.mode === 'tag' ? '' : 'none';
        $('am_filename_section').style.display = settings.mode === 'filename' ? '' : 'none';
    };
    const save = () => {
        saveSettingsDebounced();
        updatePromptInjection();
    };

    for (const key of ['enabled', 'motionsEnabled', 'effectsEnabled', 'onlyNew', 'loopAmbient']) {
        const box = $(`am_${key}`);
        box.checked = !!settings[key];
        box.addEventListener('change', () => {
            settings[key] = box.checked;
            save();
            processAll();
        });
    }

    const mode = $('am_mode');
    mode.value = settings.mode;
    mode.addEventListener('change', () => {
        settings.mode = mode.value;
        syncSections();
        save();
        processAll();
    });

    for (const key of ['intensity', 'speed']) {
        const slider = $(`am_${key}`);
        const value = $(`am_${key}_value`);
        slider.value = settings[key];
        value.textContent = `${Number(settings[key]).toFixed(1)}x`;
        slider.addEventListener('input', () => {
            settings[key] = Number(slider.value);
            value.textContent = `${settings[key].toFixed(1)}x`;
            save();
        });
    }

    const depth = $('am_depth');
    depth.value = settings.depth;
    depth.addEventListener('change', () => {
        settings.depth = Math.max(0, Number(depth.value) || 0);
        save();
    });

    const rules = $('am_rules');
    rules.value = settings.rules;
    rules.addEventListener('input', () => {
        settings.rules = rules.value;
        save();
    });

    document.querySelectorAll(`#${MODULE_NAME}_settings .am-chip`).forEach(chip => {
        const name = chip.dataset.motion ?? chip.dataset.effect;
        const list = chip.dataset.motion ? 'disabledMotions' : 'disabledEffects';
        const box = chip.querySelector('.am-chip-on');
        box.addEventListener('click', event => event.stopPropagation());
        box.addEventListener('change', () => {
            settings[list] = settings[list].filter(n => n !== name);
            if (!box.checked) settings[list].push(name);
            save();
        });
        chip.addEventListener('click', () => {
            const target = $('am_preview_target');
            if (chip.dataset.motion) playMotion(target, name, false, null);
            else playEffect(target, name);
        });
    });

    syncSections();
}

(function init() {
    const { eventSource, event_types } = SillyTavern.getContext();

    eventSource.on(event_types.APP_READY, () => {
        getSettings();
        createSettingsUI();
        startObserver();
        updatePromptInjection();
        resetForChat();
    });

    eventSource.on(event_types.CHAT_CHANGED, () => {
        rawCache.clear();
        resetForChat();
        updatePromptInjection();
    });

    eventSource.on(event_types.GENERATION_STARTED, (type, _options, dryRun) => {
        if (dryRun || type === 'quiet') return;
        generating = true;
    });
    const endGeneration = () => {
        generating = false;
        processAll();
    };
    eventSource.on(event_types.GENERATION_ENDED, endGeneration);
    eventSource.on(event_types.GENERATION_STOPPED, endGeneration);

    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, markFresh);
    eventSource.on(event_types.USER_MESSAGE_RENDERED, markFresh);
    eventSource.on(event_types.MESSAGE_SWIPED, markFresh);
    eventSource.on(event_types.MESSAGE_UPDATED, markFresh);
})();
