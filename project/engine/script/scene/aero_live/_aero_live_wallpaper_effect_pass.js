const DEFAULT_ASSET_PATHS = Object.freeze({
    base: '../asset/image/aero_live/wallpaper/ocean_rings_base.png',
    waterNormal: '../asset/image/aero_live/wallpaper/ocean_rings_normal.png',
    waterMask: '../asset/image/aero_live/wallpaper/ocean_rings_water_mask.png',
    cursorMask: '../asset/image/aero_live/wallpaper/ocean_rings_cursor_mask.png'
});

const ORIGINAL_PARAMETERS = Object.freeze({
    referenceWidth: 1920,
    referenceHeight: 1080,
    simulationWidth: 512,
    simulationHeight: 288,
    water: Object.freeze({
        animationSpeed: 0.12,
        ratio: 1.0,
        rippleStrength: 0.090000004,
        scale: 1.0,
        scrollDirection: 1.5296264,
        scrollSpeed: 0.079999998
    }),
    cursor: Object.freeze({
        rippleScale: 0.30000001,
        rippleSpeed: 0.5,
        rippleDecay: 1.0,
        rippleStrength: 0.5
    })
});

const PROGRAM_UNIFORMS = Object.freeze({
    copy: Object.freeze(['u_texture']),
    apply: Object.freeze([
        'u_force',
        'u_frameTime',
        'u_pointerCurrent',
        'u_pointerLast',
        'u_pointScale',
        'u_pointerDown'
    ]),
    simulate: Object.freeze([
        'u_force',
        'u_collisionMask',
        'u_frameTime',
        'u_resolution',
        'u_rippleSpeed',
        'u_rippleDecay'
    ]),
    water: Object.freeze([
        'u_base',
        'u_waterMask',
        'u_normal',
        'u_time',
        'u_baseResolution',
        'u_animationSpeed',
        'u_ratio',
        'u_strength',
        'u_scale',
        'u_scrollDirection',
        'u_scrollSpeed'
    ]),
    combine: Object.freeze(['u_force', 'u_water', 'u_strength'])
});

const FRAGMENT_BODIES = Object.freeze({
    copy: `
        uniform sampler2D u_texture;

        void main() {
            FRAG_COLOR = SAMPLE_2D(u_texture, v_uv);
        }
    `,
    apply: `
        uniform sampler2D u_force;
        uniform float u_frameTime;
        uniform vec2 u_pointerCurrent;
        uniform vec2 u_pointerLast;
        uniform vec2 u_pointScale;
        uniform float u_pointerDown;

        void main() {
            vec4 albedo = SAMPLE_2D(u_force, v_uv);
            vec2 lineDelta = u_pointerCurrent - u_pointerLast;
            vec2 textureDelta = v_uv - u_pointerLast;
            float lineLength = length(lineDelta) + 0.0001;
            lineDelta /= lineLength;
            float distanceOnLine = dot(lineDelta, textureDelta);
            float rayMask = max(
                step(0.0, distanceOnLine) * step(distanceOnLine, lineLength),
                step(lineLength, 0.1)
            );
            distanceOnLine = clamp(distanceOnLine / lineLength, 0.0, 1.0) * lineLength;
            vec2 positionOnLine = u_pointerLast + lineDelta * distanceOnLine;
            vec2 pointerDelta = (v_uv - positionOnLine) * u_pointScale;
            float pointerDistance = clamp(1.0 - length(pointerDelta), 0.0, 1.0) * rayMask;
            float timeAmount = min(1.0 / 30.0, u_frameTime) / 0.02;
            float pointerMoveAmount = length(u_pointerCurrent - u_pointerLast) * 100.0;
            float inputStrength = pointerDistance * timeAmount
                * (pointerMoveAmount + u_pointerDown * 5.0);
            vec2 impulseDirection = clamp(pointerDelta, vec2(-1.0), vec2(1.0));
            vec4 colorAdd = vec4(
                step(0.0, impulseDirection.x) * impulseDirection.x * inputStrength,
                step(0.0, impulseDirection.y) * impulseDirection.y * inputStrength,
                step(impulseDirection.x, 0.0) * -impulseDirection.x * inputStrength,
                step(impulseDirection.y, 0.0) * -impulseDirection.y * inputStrength
            );
            FRAG_COLOR = albedo + colorAdd;
        }
    `,
    simulate: `
        uniform sampler2D u_force;
        uniform sampler2D u_collisionMask;
        uniform float u_frameTime;
        uniform vec2 u_resolution;
        uniform float u_rippleSpeed;
        uniform float u_rippleDecay;

        vec4 sampleForce(vec4 a, vec4 b, vec4 c) {
            return max(a, max(b, c));
        }

        void main() {
            vec2 source = v_uv;
            vec2 simulationTexel = 1.0 / u_resolution;
            vec2 rippleOffset = simulationTexel * 100.0 * u_rippleSpeed
                * min(1.0 / 30.0, u_frameTime);
            vec2 insideRipple = rippleOffset * 1.61;
            vec2 outsideRipple = rippleOffset;

            float reflectUp = step(1.0 - simulationTexel.y, source.y);
            float reflectDown = step(source.y, simulationTexel.y);
            float reflectLeft = step(1.0 - simulationTexel.x, source.x);
            float reflectRight = step(source.x, simulationTexel.x);

            float inverseMaskCenter = 1.0
                - step(0.5, SAMPLE_2D(u_collisionMask, source).r);
            vec2 maskOffset = insideRipple;
            float maskUp = SAMPLE_2D(
                u_collisionMask,
                source + vec2(0.0, -maskOffset.y)
            ).r * inverseMaskCenter;
            float maskDown = SAMPLE_2D(
                u_collisionMask,
                source + vec2(0.0, maskOffset.y)
            ).r * inverseMaskCenter;
            float maskLeft = SAMPLE_2D(
                u_collisionMask,
                source + vec2(-maskOffset.x, 0.0)
            ).r * inverseMaskCenter;
            float maskRight = SAMPLE_2D(
                u_collisionMask,
                source + vec2(maskOffset.x, 0.0)
            ).r * inverseMaskCenter;

            reflectDown = step(0.5, reflectDown + maskUp);
            reflectUp = step(0.5, reflectUp + maskDown);
            reflectRight = step(0.5, reflectRight + maskLeft);
            reflectLeft = step(0.5, reflectLeft + maskRight);

            vec4 up = sampleForce(
                SAMPLE_2D(u_force, source + vec2(0.0, -insideRipple.y)),
                SAMPLE_2D(u_force, source + vec2(-outsideRipple.x, -outsideRipple.y)),
                SAMPLE_2D(u_force, source + vec2(outsideRipple.x, -outsideRipple.y))
            );
            vec4 down = sampleForce(
                SAMPLE_2D(u_force, source + vec2(0.0, insideRipple.y)),
                SAMPLE_2D(u_force, source + vec2(-outsideRipple.x, outsideRipple.y)),
                SAMPLE_2D(u_force, source + vec2(outsideRipple.x, outsideRipple.y))
            );
            vec4 left = sampleForce(
                SAMPLE_2D(u_force, source + vec2(-insideRipple.x, 0.0)),
                SAMPLE_2D(u_force, source + vec2(-outsideRipple.x, -outsideRipple.y)),
                SAMPLE_2D(u_force, source + vec2(-outsideRipple.x, outsideRipple.y))
            );
            vec4 right = sampleForce(
                SAMPLE_2D(u_force, source + vec2(insideRipple.x, 0.0)),
                SAMPLE_2D(u_force, source + vec2(outsideRipple.x, -outsideRipple.y)),
                SAMPLE_2D(u_force, source + vec2(outsideRipple.x, outsideRipple.y))
            );

            vec4 force = vec4(0.0);
            force.x += up.x;
            force.z += up.z;
            force.y += up.y;
            force.x += down.x;
            force.z += down.z;
            force.w += down.w;
            force.x += left.x;
            force.y += left.y;
            force.w += left.w;
            force.z += right.z;
            force.y += right.y;
            force.w += right.w;
            force *= 1.0 / 3.0;

            vec4 forceCopy = force;
            force.y = mix(force.y, forceCopy.w, reflectDown);
            force.w = mix(force.w, forceCopy.y, reflectUp);
            force.x = mix(force.x, forceCopy.z, reflectRight);
            force.z = mix(force.z, forceCopy.x, reflectLeft);

            float drop = max(
                1.001 / 255.0,
                1.5 / 255.0 * (u_frameTime / 0.02) * u_rippleDecay
            );
            force -= drop;
            force *= inverseMaskCenter;
            FRAG_COLOR = force;
        }
    `,
    water: `
        uniform sampler2D u_base;
        uniform sampler2D u_waterMask;
        uniform sampler2D u_normal;
        uniform float u_time;
        uniform vec2 u_baseResolution;
        uniform float u_animationSpeed;
        uniform float u_ratio;
        uniform float u_strength;
        uniform float u_scale;
        uniform float u_scrollDirection;
        uniform float u_scrollSpeed;

        vec2 rotateVector(vec2 value, float angle) {
            float sine = sin(angle);
            float cosine = cos(angle);
            return vec2(
                cosine * value.x - sine * value.y,
                sine * value.x + cosine * value.y
            );
        }

        void main() {
            float mask = SAMPLE_2D(u_waterMask, v_uv).r;
            vec2 scroll = rotateVector(vec2(0.0, 1.0), u_scrollDirection)
                * u_scrollSpeed * u_scrollSpeed * u_time;
            vec4 rippleCoordinates = vec4(
                v_uv + u_time * u_animationSpeed * u_animationSpeed + scroll,
                v_uv * 1.333 - u_time * u_animationSpeed * u_animationSpeed + scroll
            );
            rippleCoordinates *= u_scale;
            float aspect = u_baseResolution.x / max(1.0, u_baseResolution.y);
            rippleCoordinates.xz *= aspect;
            rippleCoordinates.yw *= u_ratio;

            vec3 normalA = SAMPLE_2D(u_normal, rippleCoordinates.xy).xyz * 2.0 - 1.0;
            vec3 normalB = SAMPLE_2D(u_normal, rippleCoordinates.zw).xyz * 2.0 - 1.0;
            vec3 normal = normalize(vec3(normalA.xy + normalB.xy, normalA.z));
            vec2 source = v_uv + normal.xy * u_strength * u_strength * mask;
            FRAG_COLOR = SAMPLE_2D(u_base, source);
        }
    `,
    combine: `
        uniform sampler2D u_force;
        uniform sampler2D u_water;
        uniform float u_strength;

        void main() {
            vec4 albedo = SAMPLE_2D(u_force, v_uv);
            albedo *= albedo;
            vec2 direction = vec2(albedo.r - albedo.b, albedo.g - albedo.a);
            vec2 offset = direction * (-0.1 * u_strength);
            FRAG_COLOR = SAMPLE_2D(u_water, v_uv + offset);
        }
    `
});

/** Wallpaper Engine 원본 scene의 asset 기본 경로입니다. */
export const AERO_LIVE_WALLPAPER_ASSET_PATHS = DEFAULT_ASSET_PATHS;

/** Wallpaper Engine 원본 scene의 수치 파라미터입니다. */
export const AERO_LIVE_WALLPAPER_PARAMETERS = ORIGINAL_PARAMETERS;

/**
 * Wallpaper Engine scene에서 추출한 water/cursor ripple을 단일 WebGL 컨텍스트에서 실행합니다.
 * GL 리소스는 첫 render 시점에만 생성하며, 최종 출력 FBO는 호출자가 소유합니다.
 */
export class AeroLiveWallpaperEffectPass {
    /**
     * @param {object} [options] - 생성 옵션입니다.
     * @param {object} [options.assetPaths] - asset 경로 override입니다.
     * @param {object} [options.images] - 미리 생성한 HTMLImageElement 맵입니다.
     * @param {Function} [options.imageFactory] - 테스트/런타임용 이미지 생성 함수입니다.
     */
    constructor(options = {}) {
        this.assetPaths = Object.freeze({ ...DEFAULT_ASSET_PATHS, ...(options.assetPaths || {}) });
        this.parameters = this.#normalizeParameters(options.parameters || {});
        this.imageFactory = typeof options.imageFactory === 'function'
            ? options.imageFactory
            : () => typeof Image === 'function' ? new Image() : null;
        this.assets = {};
        this.assetPromises = [];
        const suppliedAssets = options.assets || options.images || {};
        const suppliedByKey = {
            base: suppliedAssets.base,
            waterNormal: suppliedAssets.waterNormal ?? suppliedAssets.normal,
            waterMask: suppliedAssets.waterMask,
            cursorMask: suppliedAssets.cursorMask
        };
        for (const key of Object.keys(DEFAULT_ASSET_PATHS)) {
            const hasSuppliedAsset = Object.prototype.hasOwnProperty.call(suppliedAssets, key)
                || (key === 'waterNormal' && Object.prototype.hasOwnProperty.call(suppliedAssets, 'normal'));
            const record = this.#createAssetRecord(key, suppliedByKey[key] || null, hasSuppliedAsset);
            this.assets[key] = record;
            this.assetPromises.push(record.promise);
        }

        this.destroyed = false;
        this.gl = null;
        this.webglVersion = 0;
        this.contextLost = false;
        this.resources = this.#emptyResources();
        this.pointerCurrent = { x: 0.5, y: 0.5 };
        this.pointerLast = { x: 0.5, y: 0.5 };
        this.pointerInitialized = false;
        this.lastRenderSeconds = null;
        this.lastWidth = 0;
        this.lastHeight = 0;
        this.mode = 'static';
        this.ready = false;
        this.failed = false;
        this.fallbackReason = 'assets-loading';
        this.frameCount = 0;
        this.lastStepSeconds = 0;
        this.lastPassOrder = [];
        this.lastGlError = 0;
        this.resourceRevision = 0;
        this.lastResolvedMode = '';
        this.shaderStatus = {};
        this.fboStatus = {};
        this.metrics = {
            contextLosses: 0,
            renders: 0,
            fullFrames: 0,
            waterOnlyFrames: 0,
            staticFrames: 0,
            resourceAllocations: { textures: 0, framebuffers: 0, programs: 0, buffers: 0 },
            resourceDeletions: { textures: 0, framebuffers: 0, programs: 0, buffers: 0 }
        };
    }

    /** 모든 asset 요청이 성공 또는 실패로 정착할 때까지 기다립니다. */
    async whenReady() {
        await Promise.all(this.assetPromises);
        return this.assets.base.ready;
    }

    /** 포인터 이력을 다음 유효 좌표에서 다시 시작하게 합니다. */
    resetPointer() {
        this.pointerInitialized = false;
    }

    /** WebGL context lost 이벤트에서 호출합니다. */
    handleContextLost() {
        if (!this.contextLost) {
            this.metrics.contextLosses += 1;
        }
        this.contextLost = true;
        this.resourceRevision += 1;
        this.gl = null;
        this.#abandonGLResources();
        this.resetPointer();
        this.fallbackReason = 'webgl-context-lost';
    }

    /** WebGL context restored 이벤트에서 호출합니다. 다음 render가 모든 리소스를 다시 만듭니다. */
    handleContextRestored() {
        this.contextLost = false;
        this.gl = null;
        this.#abandonGLResources();
        this.resetPointer();
        this.fallbackReason = 'webgl-context-restoring';
    }

    /**
     * ripple pipeline을 실행합니다.
     * @param {object} options - 렌더 옵션입니다.
     * @param {WebGLRenderingContext|WebGL2RenderingContext} options.gl - 기존 overlay WebGL 컨텍스트입니다.
     * @param {object|null} [options.target] - 최종 출력 target({framebuffer, texture})입니다.
     * @param {WebGLFramebuffer|null} [options.framebuffer] - target 대신 전달할 최종 FBO입니다.
     * @param {number} options.width - 출력 backing-store 너비입니다.
     * @param {number} options.height - 출력 backing-store 높이입니다.
     * @param {number} [options.timeSeconds] - 원본 g_Time에 대응하는 시각입니다.
     * @param {number} [options.deltaSeconds] - 원본 g_Frametime에 대응하는 프레임 간격입니다.
     * @param {{u:number,v:number,leftDown?:boolean,inside?:boolean}} [options.pointer] - top-down 정규화 포인터입니다.
     * @param {boolean} [options.resetPointer] - 포인터 이력 초기화 여부입니다.
     * @returns {object} 렌더 결과와 최종 texture 정보입니다.
     */
    render(options = {}) {
        const gl = options.gl;
        const width = Math.max(1, Math.round(Number(options.width) || gl?.drawingBufferWidth || 1));
        const height = Math.max(1, Math.round(Number(options.height) || gl?.drawingBufferHeight || 1));
        const target = options.target || null;
        const destinationFramebuffer = target?.framebuffer ?? options.framebuffer ?? null;

        if (this.destroyed || !gl) {
            return this.#renderResult(false, target, width, height);
        }
        if (typeof gl.isContextLost === 'function' && gl.isContextLost()) {
            this.handleContextLost();
            return this.#renderResult(false, target, width, height);
        }

        if (!this.#ensureContext(gl)) {
            return this.#renderResult(false, target, width, height);
        }
        this.#syncAssetTextures();

        const resized = width !== this.lastWidth || height !== this.lastHeight;
        if (resized) {
            this.lastWidth = width;
            this.lastHeight = height;
            this.resetPointer();
            this.#destroyTarget(this.resources.waterTarget);
            this.resources.waterTarget = null;
            this.#clearSimulation();
        }

        this.#resolveMode(width, height);
        this.#updatePointer(options.pointer, options.resetPointer === true, options.viewport);
        const timeSeconds = this.#resolveTime(options.timeSeconds ?? options.elapsedSeconds);
        const deltaSeconds = this.#resolveDelta(options.deltaSeconds, timeSeconds);
        this.lastStepSeconds = deltaSeconds;
        this.lastPassOrder = [];

        let rendered = false;
        if (this.mode === 'full') {
            rendered = this.#renderFull(destinationFramebuffer, width, height, timeSeconds, deltaSeconds);
            if (rendered) this.metrics.fullFrames += 1;
        } else if (this.mode === 'water-only') {
            rendered = this.#renderWater(destinationFramebuffer, width, height, timeSeconds);
            if (rendered) this.metrics.waterOnlyFrames += 1;
        } else if (this.assets.base.texture && this.resources.programs.copy) {
            rendered = this.#renderCopy(this.assets.base.texture, destinationFramebuffer, width, height);
            if (rendered) this.metrics.staticFrames += 1;
        }

        this.#finishFrame();
        if (rendered) {
            this.frameCount += 1;
            this.metrics.renders += 1;
            this.ready = true;
            this.failed = false;
        } else if (this.assets.base.failed || this.fallbackReason === 'webgl-initialization-failed') {
            this.failed = true;
        }
        return this.#renderResult(rendered, target, width, height);
    }

    /** 직렬화 가능한 진단 상태를 반환합니다. */
    getStatus() {
        const assetStatus = {};
        for (const [key, asset] of Object.entries(this.assets)) {
            assetStatus[key] = {
                path: asset.path,
                ready: asset.ready,
                failed: asset.failed,
                width: asset.width,
                height: asset.height,
                error: asset.error
            };
        }
        return {
            ready: this.ready,
            failed: this.failed,
            mode: this.mode,
            contextLost: this.contextLost,
            fallbackReason: this.fallbackReason,
            webglVersion: this.webglVersion,
            assets: assetStatus,
            simulation: {
                width: this.parameters.simulationWidth,
                height: this.parameters.simulationHeight,
                format: 'rgba8',
                frameCount: this.frameCount,
                lastStepSeconds: this.lastStepSeconds
            },
            passes: {
                expectedOrder: ['apply', 'simulate', 'water', 'combine', 'blit'],
                lastInternalOrder: [...this.lastPassOrder],
                requiresCallerBlit: true
            },
            shaders: JSON.parse(JSON.stringify(this.shaderStatus)),
            framebuffers: JSON.parse(JSON.stringify(this.fboStatus)),
            lastGlError: this.lastGlError,
            resourceRevision: this.resourceRevision,
            metrics: JSON.parse(JSON.stringify(this.metrics)),
            parameterSnapshot: {
                referenceWidth: this.parameters.referenceWidth,
                referenceHeight: this.parameters.referenceHeight,
                water: { ...this.parameters.water },
                cursor: { ...this.parameters.cursor }
            }
        };
    }

    /** 소유한 GL 리소스를 해제합니다. 여러 번 호출해도 안전합니다. */
    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.#releaseGLResources();
        this.gl = null;
        this.ready = false;
    }

    #createAssetRecord(key, suppliedImage, suppliedExplicitly = false) {
        const path = this.assetPaths[key];
        const record = {
            key,
            path,
            image: suppliedImage,
            texture: null,
            ready: false,
            failed: false,
            width: 0,
            height: 0,
            error: '',
            promise: null
        };
        record.promise = new Promise((resolve) => {
            const image = suppliedImage || (suppliedExplicitly ? null : this.imageFactory(path, key));
            record.image = image;
            if (!image) {
                record.failed = true;
                record.error = suppliedExplicitly ? 'asset-unavailable' : 'image-api-unavailable';
                resolve(record);
                return;
            }

            let settled = false;
            const settle = (ready, error = '') => {
                if (settled) return;
                settled = true;
                record.ready = ready;
                record.failed = !ready;
                record.error = error;
                record.width = Number(image.naturalWidth || image.width) || 0;
                record.height = Number(image.naturalHeight || image.height) || 0;
                resolve(record);
            };
            if ((image.complete === true || suppliedImage) && Number(image.naturalWidth || image.width) > 0) {
                settle(true);
                return;
            }
            image.onload = () => settle(true);
            image.onerror = () => settle(false, 'asset-load-failed');
            if (!suppliedImage) image.src = path;
        });
        return record;
    }

    #normalizeParameters(parameters) {
        const water = parameters.water || parameters.WATER || {};
        const cursor = parameters.cursor || parameters.CURSOR || {};
        const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
        return Object.freeze({
            referenceWidth: Math.max(1, Math.round(finite(
                parameters.referenceWidth ?? parameters.MAX_EFFECT_WIDTH,
                ORIGINAL_PARAMETERS.referenceWidth
            ))),
            referenceHeight: Math.max(1, Math.round(finite(
                parameters.referenceHeight ?? parameters.MAX_EFFECT_HEIGHT,
                ORIGINAL_PARAMETERS.referenceHeight
            ))),
            simulationWidth: Math.max(1, Math.round(finite(
                parameters.simulationWidth ?? parameters.SIMULATION_WIDTH,
                ORIGINAL_PARAMETERS.simulationWidth
            ))),
            simulationHeight: Math.max(1, Math.round(finite(
                parameters.simulationHeight ?? parameters.SIMULATION_HEIGHT,
                ORIGINAL_PARAMETERS.simulationHeight
            ))),
            water: Object.freeze({
                animationSpeed: finite(water.animationSpeed ?? water.ANIMATION_SPEED,
                    ORIGINAL_PARAMETERS.water.animationSpeed),
                ratio: finite(water.ratio ?? water.RATIO, ORIGINAL_PARAMETERS.water.ratio),
                rippleStrength: finite(water.rippleStrength ?? water.strength ?? water.STRENGTH,
                    ORIGINAL_PARAMETERS.water.rippleStrength),
                scale: finite(water.scale ?? water.SCALE, ORIGINAL_PARAMETERS.water.scale),
                scrollDirection: finite(water.scrollDirection ?? water.SCROLL_DIRECTION,
                    ORIGINAL_PARAMETERS.water.scrollDirection),
                scrollSpeed: finite(water.scrollSpeed ?? water.SCROLL_SPEED,
                    ORIGINAL_PARAMETERS.water.scrollSpeed)
            }),
            cursor: Object.freeze({
                rippleScale: finite(cursor.rippleScale ?? cursor.scale ?? cursor.SCALE,
                    ORIGINAL_PARAMETERS.cursor.rippleScale),
                rippleSpeed: finite(cursor.rippleSpeed ?? cursor.speed ?? cursor.SPEED,
                    ORIGINAL_PARAMETERS.cursor.rippleSpeed),
                rippleDecay: finite(cursor.rippleDecay ?? cursor.decay ?? cursor.DECAY,
                    ORIGINAL_PARAMETERS.cursor.rippleDecay),
                rippleStrength: finite(cursor.rippleStrength ?? cursor.strength ?? cursor.STRENGTH,
                    ORIGINAL_PARAMETERS.cursor.rippleStrength)
            })
        });
    }

    #emptyResources() {
        return {
            quadBuffer: null,
            programs: {},
            simulationA: null,
            simulationB: null,
            waterTarget: null
        };
    }

    #abandonGLResources() {
        this.resources = this.#emptyResources();
        for (const asset of Object.values(this.assets)) {
            asset.texture = null;
        }
    }

    #ensureContext(gl) {
        if (this.gl === gl && this.resources.quadBuffer) return true;
        if (this.gl && this.gl !== gl) this.#releaseGLResources();
        this.gl = gl;
        this.contextLost = false;
        this.webglVersion = this.#isWebGL2(gl) ? 2 : 1;
        this.resourceRevision += 1;
        this.resources = this.#emptyResources();
        this.shaderStatus = {};
        this.fboStatus = {};

        const buffer = gl.createBuffer();
        if (!buffer) {
            this.fallbackReason = 'webgl-initialization-failed';
            return false;
        }
        this.metrics.resourceAllocations.buffers += 1;
        this.resources.quadBuffer = buffer;
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1,
            1, -1,
            -1, 1,
            -1, 1,
            1, -1,
            1, 1
        ]), gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        this.#initializePrograms();
        if (!this.resources.programs.copy && !this.resources.programs.water) {
            this.fallbackReason = 'webgl-initialization-failed';
            return false;
        }
        return true;
    }

    #initializePrograms() {
        const gl = this.gl;
        const sources = this.#createShaderSources();
        const vertexShader = this.#compileShader('sharedVertex', gl.VERTEX_SHADER, sources.vertex);
        if (!vertexShader) return;

        for (const name of Object.keys(FRAGMENT_BODIES)) {
            const fragmentShader = this.#compileShader(name, gl.FRAGMENT_SHADER, sources.fragments[name]);
            if (!fragmentShader) continue;
            const program = gl.createProgram();
            if (!program) {
                gl.deleteShader(fragmentShader);
                this.shaderStatus[name] = {
                    ...(this.shaderStatus[name] || {}),
                    linked: false,
                    linkLog: 'createProgram returned null'
                };
                continue;
            }
            this.metrics.resourceAllocations.programs += 1;
            gl.attachShader(program, vertexShader);
            gl.attachShader(program, fragmentShader);
            gl.linkProgram(program);
            const linked = !!gl.getProgramParameter(program, gl.LINK_STATUS);
            const linkLog = String(gl.getProgramInfoLog(program) || '').slice(0, 1000);
            gl.deleteShader(fragmentShader);
            this.shaderStatus[name] = {
                ...(this.shaderStatus[name] || {}),
                linked,
                linkLog
            };
            if (!linked) {
                gl.deleteProgram(program);
                this.metrics.resourceDeletions.programs += 1;
                continue;
            }
            const uniforms = {};
            for (const uniformName of PROGRAM_UNIFORMS[name]) {
                uniforms[uniformName] = gl.getUniformLocation(program, uniformName);
            }
            this.resources.programs[name] = {
                program,
                position: gl.getAttribLocation(program, 'a_position'),
                uniforms
            };
        }
        gl.deleteShader(vertexShader);
    }

    #compileShader(name, type, source) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        if (!shader) return null;
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        const compiled = !!gl.getShaderParameter(shader, gl.COMPILE_STATUS);
        const compileLog = String(gl.getShaderInfoLog(shader) || '').slice(0, 1000);
        this.shaderStatus[name] = {
            ...(this.shaderStatus[name] || {}),
            compiled,
            compileLog
        };
        if (!compiled) {
            gl.deleteShader(shader);
            return null;
        }
        return shader;
    }

    #createShaderSources() {
        const gl = this.gl;
        const webgl2 = this.webglVersion === 2;
        let precision = 'mediump';
        try {
            const format = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
            if (format && format.precision > 0) precision = 'highp';
        } catch (_) {
            precision = 'mediump';
        }
        const vertex = webgl2
            ? `#version 300 es
                in vec2 a_position;
                out vec2 v_uv;
                void main() {
                    v_uv = (a_position + 1.0) * 0.5;
                    gl_Position = vec4(a_position, 0.0, 1.0);
                }
            `
            : `
                attribute vec2 a_position;
                varying vec2 v_uv;
                void main() {
                    v_uv = (a_position + 1.0) * 0.5;
                    gl_Position = vec4(a_position, 0.0, 1.0);
                }
            `;
        const fragments = {};
        for (const [name, body] of Object.entries(FRAGMENT_BODIES)) {
            const header = webgl2
                ? `#version 300 es
                    precision ${precision} float;
                    in vec2 v_uv;
                    out vec4 fragmentColor;
                    #define SAMPLE_2D texture
                    #define FRAG_COLOR fragmentColor
                `
                : `
                    precision ${precision} float;
                    varying vec2 v_uv;
                    #define SAMPLE_2D texture2D
                    #define FRAG_COLOR gl_FragColor
                `;
            fragments[name] = `${header}\n${body}`;
        }
        return { vertex, fragments };
    }

    #syncAssetTextures() {
        for (const asset of Object.values(this.assets)) {
            if (!asset.ready || asset.texture) continue;
            asset.texture = this.#createImageTexture(asset.image, asset.key === 'waterNormal');
            if (!asset.texture) {
                asset.failed = true;
                asset.error = 'texture-upload-failed';
            } else {
                this.resourceRevision += 1;
            }
        }
    }

    #createImageTexture(image, repeat) {
        const gl = this.gl;
        const texture = gl.createTexture();
        if (!texture) return null;
        this.metrics.resourceAllocations.textures += 1;
        const imageWidth = Number(image?.naturalWidth || image?.width) || 0;
        const imageHeight = Number(image?.naturalHeight || image?.height) || 0;
        const powerOfTwo = (value) => value > 0 && (value & (value - 1)) === 0;
        const canRepeat = repeat && (this.webglVersion === 2
            || (powerOfTwo(imageWidth) && powerOfTwo(imageHeight)));
        let previousFlip = false;
        let previousPremultiply = false;
        let previousColorspace = gl.BROWSER_DEFAULT_WEBGL;
        try {
            previousFlip = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
            previousPremultiply = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL);
            previousColorspace = gl.getParameter(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL);
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
            gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, canRepeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, canRepeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texImage2D(
                gl.TEXTURE_2D,
                0,
                gl.RGBA,
                gl.RGBA,
                gl.UNSIGNED_BYTE,
                image
            );
            return texture;
        } catch (_) {
            gl.deleteTexture(texture);
            this.metrics.resourceDeletions.textures += 1;
            return null;
        } finally {
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, previousFlip);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, previousPremultiply);
            gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, previousColorspace);
            gl.bindTexture(gl.TEXTURE_2D, null);
        }
    }

    #resolveMode(width, height) {
        const programs = this.resources.programs;
        const waterReady = !!(
            this.assets.base.texture
            && this.assets.waterNormal.texture
            && this.assets.waterMask.texture
            && programs.water
        );
        const cursorProgramsReady = !!(
            programs.apply
            && programs.simulate
            && programs.combine
            && this.assets.cursorMask.texture
        );
        if (waterReady && cursorProgramsReady) {
            this.#ensureSimulationTargets();
            this.#ensureWaterTarget(width, height);
        }
        if (waterReady && cursorProgramsReady
            && this.resources.simulationA && this.resources.simulationB && this.resources.waterTarget) {
            this.#setMode('full', '');
            return;
        }
        if (waterReady) {
            this.#setMode('water-only', cursorProgramsReady
                ? 'cursor-framebuffer-unavailable'
                : 'cursor-ripple-unavailable');
            return;
        }
        this.#setMode('static', this.assets.base.texture
            ? 'water-ripple-unavailable'
            : this.assets.base.failed ? 'base-asset-unavailable' : 'assets-loading');
    }

    #setMode(mode, fallbackReason) {
        if (this.lastResolvedMode !== mode) {
            this.lastResolvedMode = mode;
            this.resourceRevision += 1;
        }
        this.mode = mode;
        this.fallbackReason = fallbackReason;
    }

    #ensureSimulationTargets() {
        if (this.resources.simulationA && this.resources.simulationB) return;
        const width = this.parameters.simulationWidth;
        const height = this.parameters.simulationHeight;
        this.resources.simulationA ||= this.#createTarget(width, height, 'simulationA');
        this.resources.simulationB ||= this.#createTarget(width, height, 'simulationB');
        if (!this.resources.simulationA || !this.resources.simulationB) {
            this.#destroyTarget(this.resources.simulationA);
            this.#destroyTarget(this.resources.simulationB);
            this.resources.simulationA = null;
            this.resources.simulationB = null;
        }
    }

    #ensureWaterTarget(width, height) {
        const target = this.resources.waterTarget;
        if (target && target.width === width && target.height === height) return;
        this.#destroyTarget(target);
        this.resources.waterTarget = this.#createTarget(width, height, 'water');
    }

    #createTarget(width, height, name) {
        const gl = this.gl;
        const texture = gl.createTexture();
        const framebuffer = gl.createFramebuffer();
        if (!texture || !framebuffer) {
            if (texture) gl.deleteTexture(texture);
            if (framebuffer) gl.deleteFramebuffer(framebuffer);
            return null;
        }
        this.metrics.resourceAllocations.textures += 1;
        this.metrics.resourceAllocations.framebuffers += 1;
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        const internalFormat = this.webglVersion === 2 ? gl.RGBA8 : gl.RGBA;
        gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            internalFormat,
            width,
            height,
            0,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            null
        );
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.framebufferTexture2D(
            gl.FRAMEBUFFER,
            gl.COLOR_ATTACHMENT0,
            gl.TEXTURE_2D,
            texture,
            0
        );
        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        const complete = status === gl.FRAMEBUFFER_COMPLETE;
        this.fboStatus[name] = { width, height, format: 'rgba8', complete, status };
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.bindTexture(gl.TEXTURE_2D, null);
        if (!complete) {
            gl.deleteFramebuffer(framebuffer);
            gl.deleteTexture(texture);
            this.metrics.resourceDeletions.framebuffers += 1;
            this.metrics.resourceDeletions.textures += 1;
            return null;
        }
        const target = { framebuffer, texture, width, height, name };
        this.#clearTarget(target);
        this.resourceRevision += 1;
        return target;
    }

    #clearTarget(target) {
        if (!target || !this.gl) return;
        const gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
        gl.viewport(0, 0, target.width, target.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    #clearSimulation() {
        this.#clearTarget(this.resources.simulationA);
        this.#clearTarget(this.resources.simulationB);
    }

    #updatePointer(pointer, forceReset, viewport) {
        const viewportX = Number(viewport?.x) || 0;
        const viewportY = Number(viewport?.y) || 0;
        const viewportWidth = Math.max(1, Number(viewport?.w) || this.lastWidth || 1);
        const viewportHeight = Math.max(1, Number(viewport?.h) || this.lastHeight || 1);
        const rawU = Number.isFinite(Number(pointer?.u ?? pointer?.normalizedX))
            ? Number(pointer.u ?? pointer.normalizedX)
            : Number.isFinite(Number(pointer?.x))
                ? (Number(pointer.x) - viewportX) / viewportWidth
                : NaN;
        const rawV = Number.isFinite(Number(pointer?.v ?? pointer?.normalizedY))
            ? Number(pointer.v ?? pointer.normalizedY)
            : Number.isFinite(Number(pointer?.y))
                ? (Number(pointer.y) - viewportY) / viewportHeight
                : NaN;
        const geometricallyInside = rawU >= 0 && rawU <= 1 && rawV >= 0 && rawV <= 1;
        const inside = pointer?.inside !== false
            && Number.isFinite(rawU)
            && Number.isFinite(rawV)
            && geometricallyInside;
        const u = inside ? Math.min(1, Math.max(0, rawU)) : this.pointerCurrent.x;
        const topDownV = inside ? Math.min(1, Math.max(0, rawV)) : 1 - this.pointerCurrent.y;
        const currentX = u;
        const currentY = 1 - topDownV;
        if (forceReset || !inside || !this.pointerInitialized) {
            this.pointerLast.x = currentX;
            this.pointerLast.y = currentY;
        } else {
            this.pointerLast.x = this.pointerCurrent.x;
            this.pointerLast.y = this.pointerCurrent.y;
        }
        this.pointerCurrent.x = currentX;
        this.pointerCurrent.y = currentY;
        this.pointerInitialized = inside;
        this.pointerDown = inside
            && (pointer?.leftDown === true || pointer?.down === true || pointer?.pressed === true) ? 1 : 0;
    }

    #resolveTime(value) {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) return Math.max(0, numeric);
        if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
            return performance.now() / 1000;
        }
        return Date.now() / 1000;
    }

    #resolveDelta(value, timeSeconds) {
        const numeric = Number(value);
        let delta = Number.isFinite(numeric)
            ? numeric
            : this.lastRenderSeconds === null ? 0 : timeSeconds - this.lastRenderSeconds;
        this.lastRenderSeconds = timeSeconds;
        delta = Math.max(0, Math.min(1 / 30, Number.isFinite(delta) ? delta : 0));
        return delta;
    }

    #renderFull(framebuffer, width, height, timeSeconds, deltaSeconds) {
        const simulationA = this.resources.simulationA;
        const simulationB = this.resources.simulationB;
        const waterTarget = this.resources.waterTarget;
        if (!simulationA || !simulationB || !waterTarget) return false;
        this.#renderApply(simulationB.texture, simulationA.framebuffer, deltaSeconds);
        this.lastPassOrder.push('apply');
        this.#renderSimulation(simulationA.texture, simulationB.framebuffer, deltaSeconds);
        this.lastPassOrder.push('simulate');
        this.#renderWater(waterTarget.framebuffer, width, height, timeSeconds);
        this.lastPassOrder.push('water');
        this.#renderCombine(simulationB.texture, waterTarget.texture, framebuffer, width, height);
        this.lastPassOrder.push('combine');
        return true;
    }

    #renderApply(forceTexture, framebuffer, deltaSeconds) {
        const gl = this.gl;
        const entry = this.#beginPass('apply', framebuffer,
            this.parameters.simulationWidth, this.parameters.simulationHeight);
        const uniforms = entry.uniforms;
        this.#bindTexture(forceTexture, 0, uniforms.u_force);
        gl.uniform1f(uniforms.u_frameTime, deltaSeconds);
        gl.uniform2f(uniforms.u_pointerCurrent, this.pointerCurrent.x, this.pointerCurrent.y);
        gl.uniform2f(uniforms.u_pointerLast, this.pointerLast.x, this.pointerLast.y);
        const pointScaleX = 60 / Math.max(0.0001, this.parameters.cursor.rippleScale);
        gl.uniform2f(
            uniforms.u_pointScale,
            pointScaleX,
            pointScaleX * this.parameters.simulationHeight / this.parameters.simulationWidth
        );
        gl.uniform1f(uniforms.u_pointerDown, this.pointerDown || 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    #renderSimulation(forceTexture, framebuffer, deltaSeconds) {
        const gl = this.gl;
        const entry = this.#beginPass('simulate', framebuffer,
            this.parameters.simulationWidth, this.parameters.simulationHeight);
        const uniforms = entry.uniforms;
        this.#bindTexture(forceTexture, 0, uniforms.u_force);
        this.#bindTexture(this.assets.cursorMask.texture, 1, uniforms.u_collisionMask);
        gl.uniform1f(uniforms.u_frameTime, deltaSeconds);
        gl.uniform2f(uniforms.u_resolution,
            this.parameters.simulationWidth, this.parameters.simulationHeight);
        gl.uniform1f(uniforms.u_rippleSpeed, this.parameters.cursor.rippleSpeed);
        gl.uniform1f(uniforms.u_rippleDecay, this.parameters.cursor.rippleDecay);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    #renderWater(framebuffer, width, height, timeSeconds) {
        const gl = this.gl;
        const entry = this.#beginPass('water', framebuffer, width, height);
        if (!entry) return false;
        const uniforms = entry.uniforms;
        this.#bindTexture(this.assets.base.texture, 0, uniforms.u_base);
        this.#bindTexture(this.assets.waterMask.texture, 1, uniforms.u_waterMask);
        this.#bindTexture(this.assets.waterNormal.texture, 2, uniforms.u_normal);
        gl.uniform1f(uniforms.u_time, timeSeconds);
        gl.uniform2f(uniforms.u_baseResolution,
            this.assets.base.width || this.parameters.referenceWidth,
            this.assets.base.height || this.parameters.referenceHeight);
        gl.uniform1f(uniforms.u_animationSpeed, this.parameters.water.animationSpeed);
        gl.uniform1f(uniforms.u_ratio, this.parameters.water.ratio);
        gl.uniform1f(uniforms.u_strength, this.parameters.water.rippleStrength);
        gl.uniform1f(uniforms.u_scale, this.parameters.water.scale);
        gl.uniform1f(uniforms.u_scrollDirection, this.parameters.water.scrollDirection);
        gl.uniform1f(uniforms.u_scrollSpeed, this.parameters.water.scrollSpeed);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        if (this.lastPassOrder.length === 0) this.lastPassOrder.push('water');
        return true;
    }

    #renderCombine(forceTexture, waterTexture, framebuffer, width, height) {
        const gl = this.gl;
        const entry = this.#beginPass('combine', framebuffer, width, height);
        const uniforms = entry.uniforms;
        this.#bindTexture(forceTexture, 0, uniforms.u_force);
        this.#bindTexture(waterTexture, 1, uniforms.u_water);
        gl.uniform1f(uniforms.u_strength, this.parameters.cursor.rippleStrength);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    #renderCopy(texture, framebuffer, width, height) {
        const gl = this.gl;
        const entry = this.#beginPass('copy', framebuffer, width, height);
        if (!entry) return false;
        this.#bindTexture(texture, 0, entry.uniforms.u_texture);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        this.lastPassOrder.push('copy');
        return true;
    }

    #beginPass(name, framebuffer, width, height) {
        const gl = this.gl;
        const entry = this.resources.programs[name];
        if (!entry) return null;
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.viewport(0, 0, width, height);
        gl.disable(gl.BLEND);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);
        gl.disable(gl.SCISSOR_TEST);
        gl.colorMask(true, true, true, true);
        gl.useProgram(entry.program);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.resources.quadBuffer);
        gl.enableVertexAttribArray(entry.position);
        gl.vertexAttribPointer(entry.position, 2, gl.FLOAT, false, 0, 0);
        return entry;
    }

    #bindTexture(texture, unit, uniform) {
        const gl = this.gl;
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.uniform1i(uniform, unit);
    }

    #finishFrame() {
        const gl = this.gl;
        for (let unit = 0; unit < 3; unit += 1) {
            gl.activeTexture(gl.TEXTURE0 + unit);
            gl.bindTexture(gl.TEXTURE_2D, null);
        }
        gl.activeTexture(gl.TEXTURE0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        gl.useProgram(null);
        const error = gl.getError();
        if (error !== gl.NO_ERROR) this.lastGlError = error;
    }

    #renderResult(rendered, target, width, height) {
        return {
            rendered,
            mode: this.mode,
            texture: target?.texture || null,
            framebuffer: target?.framebuffer ?? null,
            width,
            height,
            frameSerial: this.frameCount,
            internalPassOrder: [...this.lastPassOrder],
            requiresBlit: rendered
        };
    }

    #destroyTarget(target) {
        if (!target || !this.gl) return;
        this.gl.deleteFramebuffer(target.framebuffer);
        this.gl.deleteTexture(target.texture);
        this.metrics.resourceDeletions.framebuffers += 1;
        this.metrics.resourceDeletions.textures += 1;
        this.resourceRevision += 1;
    }

    #releaseGLResources() {
        const gl = this.gl;
        if (!gl) return;
        this.#destroyTarget(this.resources.simulationA);
        this.#destroyTarget(this.resources.simulationB);
        this.#destroyTarget(this.resources.waterTarget);
        for (const entry of Object.values(this.resources.programs)) {
            gl.deleteProgram(entry.program);
            this.metrics.resourceDeletions.programs += 1;
        }
        if (this.resources.quadBuffer) {
            gl.deleteBuffer(this.resources.quadBuffer);
            this.metrics.resourceDeletions.buffers += 1;
        }
        for (const asset of Object.values(this.assets)) {
            if (!asset.texture) continue;
            gl.deleteTexture(asset.texture);
            this.metrics.resourceDeletions.textures += 1;
            asset.texture = null;
        }
        this.resources = this.#emptyResources();
    }

    #isWebGL2(gl) {
        return typeof WebGL2RenderingContext !== 'undefined'
            && gl instanceof WebGL2RenderingContext;
    }
}
