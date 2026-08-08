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

const BLINK_CYCLE_SECONDS = 5.4;
const BLINK_HALF_START_SECONDS = 4.86;
const BLINK_CLOSED_START_SECONDS = 4.94;
const BLINK_REOPEN_START_SECONDS = 5.06;
const BLINK_END_SECONDS = 5.14;
const GESTURE_CYCLE_SECONDS = 8.6;
const GESTURE_START_SECONDS = 1.2;
const GESTURE_DURATION_SECONDS = 2.2;

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

/** 참고 GIF의 감쇠형 좌우/상하 탄성 파형을 반환합니다. */
function referenceGestureWave(elapsedSeconds) {
    const phase = wrap(elapsedSeconds, GESTURE_CYCLE_SECONDS);
    if (phase < GESTURE_START_SECONDS || phase >= GESTURE_START_SECONDS + GESTURE_DURATION_SECONDS) {
        return 0;
    }
    const progress = (phase - GESTURE_START_SECONDS) / GESTURE_DURATION_SECONDS;
    const onset = smoothstep(progress / 0.1);
    const decay = Math.pow(1 - progress, 1.65);
    return Math.sin(progress * Math.PI * 5) * onset * decay;
}

/** pose별 호흡·탄성·감정 동작을 한 프레임의 transform으로 합성합니다. */
function resolveMotion(pose, elapsedSeconds, poseAgeSeconds) {
    const time = Math.max(0, finiteNumber(elapsedSeconds));
    const poseAge = Math.max(0, finiteNumber(poseAgeSeconds, Number.MAX_SAFE_INTEGER));
    const breath = Math.sin(time * TWO_PI / 3.8);
    const slowSway = Math.sin(time * TWO_PI / 7.2);
    const gesture = referenceGestureWave(time);

    let offsetXRatio = slowSway * 0.004;
    let offsetYRatio = -breath * 0.0018;
    let scaleX = 1 - breath * 0.0025;
    let scaleY = 1 + breath * 0.0045;
    let rotation = slowSway * 0.22;
    let animation = 'breathing';

    if (pose === 'neutral') {
        offsetXRatio += gesture * 0.032;
        scaleX += Math.abs(gesture) * 0.008;
        scaleY -= Math.abs(gesture) * 0.004;
        rotation += gesture * 1.05;
        if (gesture) animation = 'elastic-sway';
    } else if (pose === 'happy' || pose === 'shocked') {
        offsetYRatio += gesture * 0.029;
        scaleX += gesture * 0.024;
        scaleY -= gesture * 0.034;
        rotation += gesture * (pose === 'happy' ? 0.35 : -0.25);
        if (gesture) animation = 'elastic-bounce';
    } else if (pose === 'angry') {
        const shakeEnvelope = 0.45 + Math.abs(Math.sin(time * 1.7)) * 0.55;
        offsetXRatio += Math.sin(time * 28) * 0.008 * shakeEnvelope;
        rotation += Math.sin(time * 24) * 0.62 * shakeEnvelope;
        animation = 'angry-shake';
    } else if (pose === 'sad') {
        offsetYRatio += 0.008 + Math.abs(breath) * 0.003;
        offsetXRatio += gesture * 0.012;
        rotation -= 0.35 + slowSway * 0.22;
        scaleY -= 0.006;
        animation = gesture ? 'sad-sway' : 'sad-breathing';
    } else if (pose === 'embarrassed') {
        offsetXRatio += Math.sin(time * 11.5) * 0.0045 + gesture * 0.014;
        rotation += Math.sin(time * 9.5) * 0.42 + gesture * 0.45;
        animation = 'nervous-sway';
    } else if (pose === 'controller') {
        const inputPulse = Math.sin(time * 12.5);
        offsetXRatio += inputPulse * 0.0045;
        offsetYRatio += Math.abs(inputPulse) * 0.0035 + gesture * 0.012;
        scaleX += gesture * 0.01;
        scaleY -= gesture * 0.014;
        rotation += inputPulse * 0.2;
        animation = gesture ? 'controller-bounce' : 'controller-input';
    }

    if (poseAge < 0.44) {
        const progress = poseAge / 0.44;
        const pop = Math.sin(progress * Math.PI) * Math.pow(1 - progress, 0.35);
        offsetYRatio -= pop * 0.016;
        scaleX += pop * 0.018;
        scaleY += pop * 0.02;
        animation = `${animation}+pose-pop`;
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
 * @param {{pose?:string,elapsedSeconds?:number,poseAgeSeconds?:number}} options
 * @returns {{pose:string,assetKey:string,motion:object}} 렌더 프레임입니다.
 */
export function getAeroLiveHeroAnimationFrame({
    pose,
    elapsedSeconds = 0,
    poseAgeSeconds = Number.MAX_SAFE_INTEGER
} = {}) {
    const normalizedPose = normalizePose(pose);
    const safeElapsedSeconds = Math.max(0, finiteNumber(elapsedSeconds));
    const safePoseAgeSeconds = Math.max(0, finiteNumber(poseAgeSeconds, Number.MAX_SAFE_INTEGER));
    let assetKey = resolveBlinkAssetKey(normalizedPose, safeElapsedSeconds);

    if (normalizedPose === 'angry' && safePoseAgeSeconds >= 0.08 && safePoseAgeSeconds < 0.44) {
        assetKey = 'angry-strong';
    }

    return {
        pose: normalizedPose,
        assetKey,
        motion: resolveMotion(normalizedPose, safeElapsedSeconds, safePoseAgeSeconds)
    };
}

