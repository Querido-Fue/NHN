export const AERO_LIVE_PLAYER_NAME_TOKEN = '{playerName}';
export const AERO_LIVE_PLAYER_NAME_MIN_CHARS = 2;
export const AERO_LIVE_PLAYER_NAME_MAX_CHARS = 16;

const CONTROL_OR_INVISIBLE_PATTERN = /[\p{Default_Ignorable_Code_Point}\p{Cc}]/gu;
const ALLOWED_PLAYER_NAME_PATTERN = /^[A-Za-z0-9_\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]+$/u;
const PRIVATE_NAME_SEPARATOR_PATTERN = /^[\p{White_Space}\p{Default_Ignorable_Code_Point}\p{Cc}\p{Co}]$/u;

/**
 * 원문의 실질 문자를 소문자 비교 항목으로 펼치고 원문 범위를 함께 기록합니다.
 * 기존 `{playerName}` 토큰과 공백·제어·기본 비가시·private-use 문자는 비교에서 제외합니다.
 */
function buildPrivateNameSkeleton(source) {
    const entries = [];
    let offset = 0;
    while (offset < source.length) {
        if (source.startsWith(AERO_LIVE_PLAYER_NAME_TOKEN, offset)) {
            offset += AERO_LIVE_PLAYER_NAME_TOKEN.length;
            continue;
        }
        const codePoint = source.codePointAt(offset);
        const character = String.fromCodePoint(codePoint);
        const end = offset + character.length;
        if (!PRIVATE_NAME_SEPARATOR_PATTERN.test(character)) {
            for (const loweredCharacter of Array.from(
                character.toLocaleLowerCase('ko-KR')
            )) {
                entries.push({
                    character: loweredCharacter,
                    start: offset,
                    end
                });
            }
        }
        offset = end;
    }
    return entries;
}

/**
 * 닉네임 입력을 화면과 로컬 상태에서 사용할 canonical 문자열로 정리합니다.
 * @param {*} value - 사용자 입력값입니다.
 * @returns {string} 제어문자와 공백이 제거된 닉네임입니다.
 */
export function normalizeAeroLivePlayerName(value) {
    return Array.from(String(value ?? '')
        .normalize('NFKC')
        .replace(CONTROL_OR_INVISIBLE_PATTERN, '')
        .trim())
        .slice(0, AERO_LIVE_PLAYER_NAME_MAX_CHARS)
        .join('');
}

/**
 * 플레이어 닉네임의 길이와 허용 문자를 검사합니다.
 * @param {*} value - 사용자 입력값입니다.
 * @returns {{valid:boolean,name:string,reason:string}} 검증 결과입니다.
 */
export function validateAeroLivePlayerName(value) {
    const name = normalizeAeroLivePlayerName(value);
    const length = Array.from(name).length;
    if (length < AERO_LIVE_PLAYER_NAME_MIN_CHARS) {
        return {
            valid: false,
            name,
            reason: `닉네임은 ${AERO_LIVE_PLAYER_NAME_MIN_CHARS}자 이상 입력해 주세요.`
        };
    }
    if (!ALLOWED_PLAYER_NAME_PATTERN.test(name)) {
        return {
            valid: false,
            name,
            reason: '닉네임에는 한글·영문·숫자·밑줄만 사용할 수 있습니다.'
        };
    }
    return { valid: true, name, reason: '' };
}

/**
 * 모델에 보낼 문자열에서 로컬 플레이어 닉네임을 고정 토큰으로 치환합니다.
 * 닉네임을 포함하지 않는 문자열은 내용 변경 없이 반환합니다.
 * @param {*} value - 모델 입력 후보 문자열입니다.
 * @param {*} playerName - 로컬에만 보관하는 플레이어 닉네임입니다.
 * @returns {string} 닉네임 실값이 제거된 모델용 문자열입니다.
 */
export function replaceAeroLivePlayerNameForModel(value, playerName) {
    const source = String(value ?? '').normalize('NFKC');
    const normalizedName = normalizeAeroLivePlayerName(playerName);
    if (!normalizedName) {
        return source;
    }
    const nameCharacters = Array.from(normalizedName.toLocaleLowerCase('ko-KR'));
    const skeleton = buildPrivateNameSkeleton(source);
    const ranges = [];
    for (let index = 0; index <= skeleton.length - nameCharacters.length;) {
        const matched = nameCharacters.every(
            (character, offset) => skeleton[index + offset]?.character === character
        );
        if (!matched) {
            index += 1;
            continue;
        }
        ranges.push({
            start: skeleton[index].start,
            end: skeleton[index + nameCharacters.length - 1].end
        });
        index += nameCharacters.length;
    }
    if (ranges.length === 0) {
        return source;
    }

    let cursor = 0;
    let masked = '';
    for (const range of ranges) {
        masked += source.slice(cursor, range.start);
        masked += AERO_LIVE_PLAYER_NAME_TOKEN;
        cursor = range.end;
    }
    return masked + source.slice(cursor);
}

/**
 * 검증이 끝난 모델 출력의 `{playerName}` 토큰을 로컬 닉네임으로 표시합니다.
 * @param {*} value - 모델이 만든 템플릿 문자열입니다.
 * @param {*} playerName - 화면에만 사용할 플레이어 닉네임입니다.
 * @returns {string} 로컬 표시용 문자열입니다.
 */
export function resolveAeroLivePlayerNameTemplate(value, playerName) {
    const source = String(value ?? '');
    const normalizedName = normalizeAeroLivePlayerName(playerName) || '플레이어';
    return source.replace(/\{playerName\}/gu, normalizedName);
}
