const TWO_PI = Math.PI * 2;
const BASE_POSES = new Set([
    'neutral',
    'happy',
    'angry',
    'sad',
    'shocked',
    'embarrassed',
    'controller'
]);
const MOTION_STATES = new Set([
    'idle',
    'controller',
    'expression',
    'beat',
    'core',
    'donation',
    'listening',
    'speaking',
    'still'
]);

const BLINK_CYCLE_SECONDS = 5.4;
const BLINK_HALF_START_SECONDS = 4.86;
const BLINK_CLOSED_START_SECONDS = 4.94;
const BLINK_REOPEN_START_SECONDS = 5.06;
const BLINK_END_SECONDS = 5.14;
const POSE_ENTRY_SECONDS = 0.32;

/** 알 수 없는 값을 유한한 숫자로 바꿉니다. */
function finiteNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

/** 숫자를 지정한 범위로 제한합니다. */
function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, finiteNumber(value, minimum)));
}

/** 음수 시간도 양의 주기 안으로 접습니다. */
function wrap(value, cycle) {
    const safeCycle = Math.max(Number.EPSILON, finiteNumber(cycle, 1));
    return ((finiteNumber(value) % safeCycle) + safeCycle) % safeCycle;
}

/** 0과 1 사이를 부드럽게 보간합니다. */
function smoothstep(value) {
    const progress = clamp(value, 0, 1);
    return progress * progress * (3 - 2 * progress);
}

/** 렌더용 pose key를 안전한 기본값으로 정규화합니다. */
function normalizePose(value) {
    const pose = String(value || '').trim().toLowerCase();
    return BASE_POSES.has(pose) ? pose : 'neutral';
}

/** 상황별 동작 상태를 안전한 기본값으로 정규화합니다. */
function normalizeMotionState(value) {
    const state = String(value || '').trim().toLowerCase();
    return MOTION_STATES.has(state) ? state : 'idle';
}

/** 게임 전용 pose에서도 반응 결을 유지할 수 있도록 의미 표정을 정규화합니다. */
function normalizeEmotion(value, pose) {
    const expression = String(value || '').trim().toLowerCase();
    if (expression === 'laugh' || expression === 'happy') return 'happy';
    if (expression === 'angry' || expression === 'firm') return 'angry';
    if (expression === 'sad' || expression === 'tired') return 'sad';
    if (expression === 'shocked' || expression === 'surprised') return 'shocked';
    if (expression === 'embarrassed' || expression === 'flustered' || expression === 'anxious') {
        return 'embarrassed';
    }
    return pose;
}

/**
 * 방송 주제와 의미 표정을 실제 렌더 pose로 바꿉니다.
 * 게임 방송은 표정 응답과 무관하게 컨트롤러 포즈를 유지합니다.
 *
 * @param {{topicId?:string,expression?:string,expressionPoses?:Record<string,string>}} options
 * @returns {string} 실제 렌더 pose key입니다.
 */
export function resolveAeroLiveHeroPose({
    topicId,
    expression,
    expressionPoses = {}
} = {}) {
    if (String(topicId || '').trim().toLowerCase() === 'game') {
        return 'controller';
    }

    const expressionKey = String(expression || '').trim().toLowerCase();
    return normalizePose(expressionPoses?.[expressionKey]);
}

/** 중립 포즈의 결정론적 눈 깜빡임 프레임을 고릅니다. */
function resolveBlinkAssetKey(pose, elapsedSeconds) {
    if (pose !== 'neutral') return pose;
    const phase = wrap(elapsedSeconds, BLINK_CYCLE_SECONDS);
    if (phase < BLINK_HALF_START_SECONDS || phase >= BLINK_END_SECONDS) return pose;
    if (phase < BLINK_CLOSED_START_SECONDS) return 'blink-half';
    if (phase < BLINK_REOPEN_START_SECONDS) return 'blink-closed';
    return 'blink-half';
}

/** 0에서 시작하고 끝점에서 정확히 0으로 돌아오는 단발 pulse입니다. */
function oneShotPulse(ageSeconds, durationSeconds) {
    const duration = Math.max(Number.EPSILON, finiteNumber(durationSeconds, 1));
    const age = Math.max(0, finiteNumber(ageSeconds, Number.MAX_SAFE_INTEGER));
    if (age >= duration) return 0;
    const progress = age / duration;
    return Math.sin(progress * Math.PI) * smoothstep(progress / 0.12);
}

/** 시작과 끝이 안정된 감쇠형 단발 파형입니다. */
function dampedWave(ageSeconds, durationSeconds, halfWaves = 3) {
    const duration = Math.max(Number.EPSILON, finiteNumber(durationSeconds, 1));
    const age = Math.max(0, finiteNumber(ageSeconds, Number.MAX_SAFE_INTEGER));
    if (age >= duration) return 0;
    const progress = age / duration;
    const onset = smoothstep(progress / 0.12);
    const decay = Math.pow(1 - progress, 1.45);
    return Math.sin(progress * Math.PI * halfWaves) * onset * decay;
}

/** pose와 현재 상황을 차분한 기본 자세 또는 짧은 단발 반응으로 합성합니다. */
function resolveMotion(pose, elapsedSeconds, poseAgeSeconds, motionState, motionStateAgeSeconds, emotion) {
    const time = Math.max(0, finiteNumber(elapsedSeconds));
    const poseAge = Math.max(0, finiteNumber(poseAgeSeconds, Number.MAX_SAFE_INTEGER));
    const state = normalizeMotionState(motionState);
    const stateAge = Math.max(0, finiteNumber(motionStateAgeSeconds, Number.MAX_SAFE_INTEGER));
    if (state === 'still') {
        return {
            offsetXRatio: 0,
            offsetYRatio: 0,
            scaleX: 1,
            scaleY: 1,
            rotation: 0,
            animation: 'still'
        };
    }

    const idleStrength = state === 'listening' ? 0.38 : 1;
    const breath = Math.sin(time * TWO_PI / 5.2);
    const slowSway = Math.sin(time * TWO_PI / 11);
    let offsetXRatio = slowSway * 0.0012 * idleStrength;
    let offsetYRatio = -breath * 0.0007 * idleStrength;
    let scaleX = 1 - breath * 0.0008 * idleStrength;
    let scaleY = 1 + breath * 0.0015 * idleStrength;
    let rotation = slowSway * 0.07 * idleStrength;
    let animation = state === 'listening'
        ? 'listening'
        : (state === 'controller' ? 'controller-idle' : 'idle-breathing');

    if (pose === 'happy') {
        offsetYRatio -= 0.001;
    } else if (pose === 'angry') {
        rotation -= 0.08;
    } else if (pose === 'sad') {
        offsetYRatio += 0.004;
        rotation -= 0.18;
        scaleY -= 0.003;
    } else if (pose === 'embarrassed') {
        rotation += slowSway * 0.05 * idleStrength;
    } else if (pose === 'controller') {
        offsetYRatio += Math.max(0, breath) * 0.0005 * idleStrength;
    }

    if (state === 'beat') {
        const pulse = oneShotPulse(stateAge, 0.9);
        offsetYRatio -= pulse * 0.004;
        scaleY += pulse * 0.003;
        animation = pulse ? 'beat-intro' : animation;
    } else if (state === 'core') {
        const wave = dampedWave(stateAge, 0.82, 4);
        offsetXRatio += wave * 0.003;
        rotation += wave * 0.16;
        animation = wave ? 'core-alert' : animation;
    } else if (state === 'donation') {
        const pulse = oneShotPulse(stateAge, 0.95);
        const wave = dampedWave(stateAge, 0.95, 3);
        offsetYRatio -= pulse * 0.0045;
        scaleX += pulse * 0.002;
        scaleY += pulse * 0.003;
        rotation += wave * 0.08;
        animation = pulse || wave ? 'donation-notice' : animation;
    } else if (state === 'speaking') {
        const reaction = normalizeEmotion(emotion, pose);
        const pulse = oneShotPulse(stateAge, 1.35);
        const wave = dampedWave(stateAge, 1.35, 3);
        if (reaction === 'happy') {
            offsetYRatio -= Math.abs(wave) * 0.0065;
            scaleX += Math.abs(wave) * 0.0035;
            scaleY += Math.abs(wave) * 0.0045;
        } else if (reaction === 'shocked') {
            offsetYRatio -= pulse * 0.007;
            scaleX += pulse * 0.006;
            scaleY += pulse * 0.006;
            rotation -= wave * 0.1;
        } else if (reaction === 'angry') {
            const angryWave = dampedWave(stateAge, 0.72, 5);
            offsetXRatio += angryWave * 0.004;
            rotation += angryWave * 0.26;
        } else if (reaction === 'sad') {
            offsetYRatio += pulse * 0.003;
            offsetXRatio += wave * 0.002;
            rotation -= pulse * 0.1;
        } else if (reaction === 'embarrassed') {
            offsetXRatio += wave * 0.0032;
            rotation += wave * 0.16;
        } else if (pose === 'controller') {
            offsetXRatio += wave * 0.0025;
            offsetYRatio -= Math.abs(wave) * 0.0025;
            rotation += wave * 0.08;
        } else {
            offsetXRatio += wave * 0.0045;
            offsetYRatio -= pulse * 0.002;
            rotation += wave * 0.14;
        }
        animation = pulse || wave ? `speaking-${reaction}` : animation;
    }

    const emphasizesPoseEntry = state === 'beat' || state === 'speaking' || state === 'expression';
    const emphasisAge = emphasizesPoseEntry ? Math.min(poseAge, stateAge) : Number.MAX_SAFE_INTEGER;
    if (emphasisAge < POSE_ENTRY_SECONDS) {
        const progress = emphasisAge / POSE_ENTRY_SECONDS;
        const pop = Math.sin(progress * Math.PI) * smoothstep(progress / 0.12);
        offsetYRatio -= pop * 0.006;
        scaleX += pop * 0.006;
        scaleY += pop * 0.007;
        animation = `${animation}+pose-entry`;
    }

    return {
        offsetXRatio: clamp(offsetXRatio, -0.05, 0.05),
        offsetYRatio: clamp(offsetYRatio, -0.05, 0.05),
        scaleX: clamp(scaleX, 0.92, 1.08),
        scaleY: clamp(scaleY, 0.92, 1.08),
        rotation: clamp(rotation, -2.5, 2.5),
        animation
    };
}

/**
 * 명시적 시각 시간으로 현재 이미지 프레임과 transform을 결정합니다.
 * 호출 횟수, 실제 시계, 난수에 의존하지 않습니다.
 *
 * @param {{pose?:string,elapsedSeconds?:number,poseAgeSeconds?:number,motionState?:string,motionStateAgeSeconds?:number,emotion?:string}} options
 * @returns {{pose:string,assetKey:string,motion:object}} 렌더 프레임입니다.
 */
export function getAeroLiveHeroAnimationFrame({
    pose,
    elapsedSeconds = 0,
    poseAgeSeconds = Number.MAX_SAFE_INTEGER,
    motionState = 'expression',
    motionStateAgeSeconds = Number.MAX_SAFE_INTEGER,
    emotion = ''
} = {}) {
    const normalizedPose = normalizePose(pose);
    const normalizedMotionState = normalizeMotionState(motionState);
    const safeElapsedSeconds = Math.max(0, finiteNumber(elapsedSeconds));
    const safePoseAgeSeconds = Math.max(0, finiteNumber(poseAgeSeconds, Number.MAX_SAFE_INTEGER));
    const safeMotionStateAgeSeconds = Math.max(0, finiteNumber(motionStateAgeSeconds, Number.MAX_SAFE_INTEGER));
    let assetKey = normalizedMotionState === 'still'
        ? normalizedPose
        : resolveBlinkAssetKey(normalizedPose, safeElapsedSeconds);

    const emphasizesPoseEntry = normalizedMotionState === 'beat'
        || normalizedMotionState === 'speaking'
        || normalizedMotionState === 'expression';
    const emphasisAge = emphasizesPoseEntry
        ? Math.min(safePoseAgeSeconds, safeMotionStateAgeSeconds)
        : Number.MAX_SAFE_INTEGER;
    if (normalizedPose === 'angry' && emphasisAge >= 0.08 && emphasisAge < POSE_ENTRY_SECONDS) {
        assetKey = 'angry-strong';
    }

    return {
        pose: normalizedPose,
        assetKey,
        motionState: normalizedMotionState,
        motion: resolveMotion(
            normalizedPose,
            safeElapsedSeconds,
            safePoseAgeSeconds,
            normalizedMotionState,
            safeMotionStateAgeSeconds,
            emotion
        )
    };
}
