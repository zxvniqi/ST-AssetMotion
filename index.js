// Asset Motion: animates character-asset images inside chat messages.
// Works alongside the Character Assets extension without modifying it.

const MODULE_NAME = 'asset_motion';
const PROMPT_KEY = 'asset_motion_tags';

// Images produced by Character Assets (regex styles, markdown default, built-in renderer)
const ASSET_SELECTOR = 'img[class*="characterImage"], img.character_asset, img.character-asset-rendered';
// Raw tokens that each become one asset image, in order
const RAW_ASSET_REGEX = /\{\{img::([^}]+)\}\}|!\[[^[\]]+\]\(([^()]+)\)/gi;
const MARKER_REGEX = /\[motion\s*:\s*([a-z_-]+)\s*\]/gi;

const DEFAULT_RULES = `# 파일명 패턴 = 모션   (* 는 아무 글자, 위에서부터 먼저 맞는 줄 적용)
*angry* = rattle
*happy* = bounce
*smile* = bounce
*sad* = sink
*cry* = tremble
*surprise* = jump
*shy* = jelly
*love* = heartbeat
* = pop`;

const defaultSettings = Object.freeze({
    enabled: true,
    mode: 'tag',
    onlyNew: true,
    loopAmbient: false,
    intensity: 1,
    speed: 1,
    rules: DEFAULT_RULES,
    depth: 1,
});

// k = intensity multiplier. tf = transform keyframes (added on top of existing transform).
// fx = opacity/filter keyframes (replace). loop = ambient motion that may repeat forever.
const MOTIONS = {
    bounce: { label: '통통', hint: 'cheerful, excited, playful, happy', dur: 800,
        tf: k => [ty(0), ty(-16 * k, 0.25), ty(0, 0.5), ty(-7 * k, 0.7), ty(0, 0.85), ty(-2 * k, 0.93), ty(0)] },
    hop: { label: '깡총', hint: 'eager, energetic, a happy little jump', dur: 700,
        tf: k => [
            { transform: 'translateY(0) scale(1, 1)' },
            { transform: `translateY(0) scale(${1 + 0.08 * k}, ${1 - 0.08 * k})`, offset: 0.15 },
            { transform: `translateY(${-26 * k}px) scale(${1 - 0.05 * k}, ${1 + 0.05 * k})`, offset: 0.45 },
            { transform: `translateY(0) scale(${1 + 0.06 * k}, ${1 - 0.06 * k})`, offset: 0.75 },
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
    nod: { label: '끄덕', hint: 'agreeing, understanding, yes', dur: 800,
        tf: k => [ty(0), ty(8 * k, 0.25), ty(0, 0.5), ty(6 * k, 0.7), ty(0)] },
    tilt: { label: '갸웃', hint: 'confused, curious, questioning', dur: 1000,
        tf: k => [rot(0), rot(-10 * k, 0.3), rot(-10 * k, 0.7), rot(0)] },
    wobble: { label: '흔들흔들', hint: 'unsteady, drunk, flustered, losing balance', dur: 900,
        tf: k => [[0, 0], [-12, -5], [10, 3], [-8, -3], [6, 2], [-3, -1], [0, 0]]
            .map(([x, r]) => ({ transform: `translateX(${x * k}px) rotate(${r * k}deg)` })) },
    jelly: { label: '말랑', hint: 'cute, soft, shy, embarrassed in a cute way', dur: 900,
        tf: k => [[1, 1, 0], [1 + 0.15 * k, 1 - 0.15 * k, 0.3], [1 - 0.1 * k, 1 + 0.1 * k, 0.4],
            [1 + 0.08 * k, 1 - 0.08 * k, 0.5], [1 - 0.03 * k, 1 + 0.03 * k, 0.65], [1 + 0.02 * k, 1 - 0.02 * k, 0.75], [1, 1, 1]]
            .map(([x, y, o]) => ({ transform: `scale(${x}, ${y})`, offset: o })) },
    pulse: { label: '두근', hint: 'anticipation, longing, a gentle heart flutter', dur: 1000, loop: true,
        tf: k => [sc(1), sc(1 + 0.07 * k, 0.5), sc(1)] },
    heartbeat: { label: '두근두근', hint: 'love, strong attraction, nervous excitement', dur: 1100,
        tf: k => [sc(1), sc(1 + 0.1 * k, 0.14), sc(1, 0.28), sc(1 + 0.1 * k, 0.42), sc(1, 0.7), sc(1)] },
    pop: { label: '뿅', hint: 'sudden appearance, an idea, a cute entrance', dur: 500,
        tf: k => [sc(0.3), sc(1 + 0.12 * k, 0.6), sc(0.95, 0.8), sc(1)],
        fx: [{ opacity: 0 }, { opacity: 1, offset: 0.4 }, { opacity: 1 }] },
    jump: { label: '깜짝', hint: 'startled, surprised, shocked', dur: 600,
        tf: k => [
            { transform: 'translateY(0) scale(1)' },
            { transform: `translateY(${-22 * k}px) scale(${1 + 0.06 * k})`, offset: 0.2 },
            { transform: 'translateY(0) scale(1)', offset: 0.45 },
            { transform: `translateY(${-4 * k}px) scale(1)`, offset: 0.6 },
            { transform: 'translateY(0) scale(1)' },
        ] },
    drop: { label: '쿵', hint: 'heavy landing, dramatic entrance, slamming down', dur: 700,
        tf: k => [
            { transform: `translateY(${-60 * k}px) scale(1, 1)`, easing: 'ease-in' },
            { transform: 'translateY(0) scale(1, 1)', offset: 0.5 },
            { transform: `translateY(0) scale(${1 + 0.1 * k}, ${1 - 0.1 * k})`, offset: 0.62 },
            { transform: `translateY(0) scale(${1 - 0.03 * k}, ${1 + 0.03 * k})`, offset: 0.78 },
            { transform: 'translateY(0) scale(1, 1)' },
        ],
        fx: [{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 1 }] },
    sink: { label: '축', hint: 'disappointed, sad, sighing, deflated', dur: 1400,
        tf: k => [
            { transform: 'translateY(0) scale(1, 1)' },
            { transform: `translateY(${10 * k}px) scale(1, ${1 - 0.04 * k})`, offset: 0.4 },
            { transform: `translateY(${10 * k}px) scale(1, ${1 - 0.04 * k})`, offset: 0.75 },
            { transform: 'translateY(0) scale(1, 1)' },
        ] },
    squash: { label: '찌부', hint: 'comedic bonk, getting hit, squished', dur: 600,
        tf: k => [[1, 1, 0], [1 + 0.25 * k, 1 - 0.3 * k, 0.25], [1 - 0.1 * k, 1 + 0.1 * k, 0.5], [1 + 0.03 * k, 1 - 0.03 * k, 0.75], [1, 1, 1]]
            .map(([x, y, o]) => ({ transform: `scale(${x}, ${y})`, offset: o })) },
    float: { label: '둥실', hint: 'dreamy, calm, magical, floating', dur: 3000, loop: true,
        tf: k => [ty(0), ty(-8 * k, 0.5), ty(0)] },
    sway: { label: '살랑', hint: 'relaxed, carefree, humming, a soft breeze', dur: 3000, loop: true,
        tf: k => [rot(0), rot(3 * k, 0.25), rot(-3 * k, 0.75), rot(0)] },
    spin: { label: '빙글', hint: 'dizzy, twirling with joy, spinning', dur: 700,
        tf: () => [rot(0), rot(360)] },
    flip: { label: '휙', hint: 'reveal, transformation, a sudden change', dur: 800,
        tf: () => [{ transform: 'perspective(600px) rotateY(0deg)' }, { transform: 'perspective(600px) rotateY(360deg)' }] },
    zoom: { label: '줌', hint: 'focus, emphasis, intense close-up moment', dur: 1200,
        tf: k => [sc(1), sc(1 + 0.15 * k, 0.35), sc(1 + 0.15 * k, 0.65), sc(1)] },
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

// --- state ---
let baselineMesId = -1;          // messages at or below this id existed when the chat opened
const freshMes = new Set();      // old message ids that got a new render (swipe / regenerate / edit)
let playedKeys = new Set();      // one-shot motions already shown this session
const loopedImages = new WeakSet();
let generating = false;
const rawCache = new Map();      // raw message text -> parsed asset list

function getSettings() {
    const { extensionSettings } = SillyTavern.getContext();
    if (!extensionSettings[MODULE_NAME]) {
        extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
    }
    for (const key of Object.keys(defaultSettings)) {
        if (!Object.hasOwn(extensionSettings[MODULE_NAME], key)) {
            extensionSettings[MODULE_NAME][key] = defaultSettings[key];
        }
    }
    return extensionSettings[MODULE_NAME];
}

// --- motion resolution ---

function parseRaw(text) {
    if (rawCache.has(text)) return rawCache.get(text);
    const items = [];
    const tokenRegex = new RegExp(`${MARKER_REGEX.source}|${RAW_ASSET_REGEX.source}`, 'gi');
    let pending = null;
    for (const m of text.matchAll(tokenRegex)) {
        if (m[1] !== undefined) {
            pending = m[1].toLowerCase();
        } else {
            items.push({ name: (m[2] ?? m[3] ?? '').trim(), tagMotion: pending });
            pending = null;
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
        const motion = trimmed.slice(eq + 1).trim().toLowerCase();
        if (!pattern || !MOTIONS[motion]) continue;
        const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
        rules.push({ regex: new RegExp(`^${escaped}$`), motion });
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

function resolveMotion(img, item) {
    const settings = getSettings();
    if (settings.mode === 'tag') {
        return item?.tagMotion && MOTIONS[item.tagMotion] ? item.tagMotion : null;
    }
    const name = fileNameOf(img, item?.name).toLowerCase();
    if (!name) return null;
    const rule = parseRules(settings.rules).find(r => r.regex.test(name));
    return rule ? rule.motion : null;
}

// --- DOM processing ---

function stripMarkers(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const hits = [];
    while (walker.nextNode()) {
        if (walker.currentNode.nodeValue.includes('[motion')) hits.push(walker.currentNode);
    }
    for (const node of hits) {
        const next = node.nodeValue.replace(MARKER_REGEX, '');
        if (next !== node.nodeValue) node.nodeValue = next;
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

    stripMarkers(textEl);

    const images = textEl.querySelectorAll(ASSET_SELECTOR);
    if (!images.length) return;

    const mesId = Number(mesEl.getAttribute('mesid'));
    const isLast = mesEl.classList.contains('last_mes');
    // Wait for streaming to finish; the final render replaces the images anyway
    if (generating && isLast) return;
    if (!isEligible(mesId)) return;

    const { chat, getCurrentChatId } = SillyTavern.getContext();
    const message = chat?.[mesId];
    const items = parseRaw(message?.mes ?? '');
    const chatId = getCurrentChatId?.() ?? '';

    images.forEach((img, index) => {
        const motion = resolveMotion(img, items[index]);
        if (!motion) return;
        const key = `${chatId}|${mesId}|${message?.swipe_id ?? 0}|${index}|${img.getAttribute('src')}`;
        const def = MOTIONS[motion];
        const looping = def.loop && settings.loopAmbient;
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
            playMotion(img, motion, looping);
        });
    });
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

function playMotion(el, motion, looping = false) {
    const def = MOTIONS[motion];
    if (!def) return;
    const settings = getSettings();
    const k = Number(settings.intensity) || 1;
    const duration = def.dur / (Number(settings.speed) || 1);
    const iterations = looping ? Infinity : 1;
    el.getAnimations().forEach(a => a.id?.startsWith(MODULE_NAME) && a.cancel());
    const easing = def.loop ? 'ease-in-out' : 'ease-out';
    if (def.tf) {
        const a = el.animate(def.tf(k), { duration, iterations, easing, composite: 'add' });
        a.id = `${MODULE_NAME}-tf`;
    }
    if (def.fx) {
        const a = el.animate(def.fx, { duration, iterations: 1, easing: 'ease-out' });
        a.id = `${MODULE_NAME}-fx`;
    }
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
    const list = Object.entries(MOTIONS).map(([name, def]) => `- ${name}: ${def.hint}`).join('\n');
    return `[Asset Motion]
When you insert an internal image tag ({{img::filename.ext}}), put ONE motion marker immediately before it to animate the image, like this:
[motion:NAME]{{img::filename.ext}}
Pick the motion that best matches the emotion, action, or event of the paragraph right before the image. Vary your choices across responses instead of repeating the same motion. If nothing fits, leave the marker out.
Available motions:
${list}
Write the marker exactly as [motion:NAME] using a name from the list. Never write a marker without an image tag right after it.`;
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
    const chips = Object.entries(MOTIONS)
        .map(([name, def]) => `<span class="am-chip" data-motion="${name}" title="${name}">${def.label}<small>${name}</small></span>`)
        .join('');
    const html = `
    <div id="${MODULE_NAME}_settings" class="extension_settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>에셋 모션</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content am-content">
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
                    <input id="am_onlyNew" type="checkbox" />
                    <span>새로 온 메시지에만 (채팅 열 때 예전 이미지는 안 움직임)</span>
                </label>
                <label class="checkbox_label">
                    <input id="am_loopAmbient" type="checkbox" />
                    <span>둥실·살랑·두근은 계속 반복</span>
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
                    <small>AI에게 이미지 바로 앞에 <code>[motion:이름]</code>을 붙이라고 자동으로 알려줘요. 표시는 화면에서 자동으로 지워집니다.</small>
                    <label class="am-row">
                        <span>프롬프트 삽입 깊이</span>
                        <input id="am_depth" type="number" min="0" max="20" class="text_pole am-num" />
                    </label>
                </div>

                <div id="am_filename_section" class="am-section">
                    <small>한 줄에 <code>파일명 패턴 = 모션이름</code>. 위에서부터 먼저 맞는 줄이 적용돼요.</small>
                    <textarea id="am_rules" class="text_pole" rows="8"></textarea>
                </div>

                <div class="am-section">
                    <small>모션 미리보기 (눌러보세요)</small>
                    <div class="am-preview"><div id="am_preview_target" class="am-preview-target fa-solid fa-face-smile"></div></div>
                    <div class="am-chips">${chips}</div>
                </div>
            </div>
        </div>
    </div>`;
    document.getElementById('extensions_settings2').insertAdjacentHTML('beforeend', html);

    const settings = getSettings();
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

    for (const key of ['enabled', 'onlyNew', 'loopAmbient']) {
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
        chip.addEventListener('click', () => playMotion($('am_preview_target'), chip.dataset.motion));
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
