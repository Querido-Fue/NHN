import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ENGINE_ROOT = path.resolve('project/engine');
const FORBIDDEN_DEPLOYED_STRINGS = [
    'api_key.txt',
    'x-goog-api-key',
    'generativelanguage.googleapis.com',
    'PUT_YOUR_GEMINI_API_KEY_HERE'
];
const FORBIDDEN_AUDIO_REQUEST_STRINGS = [
    'new Audio(',
    '.mp3',
    '"sound/": "./script/sound/"'
];
const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.html', '.json']);

function collectFiles(directory) {
    const files = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const filePath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            files.push(...collectFiles(filePath));
        } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
            files.push(filePath);
        }
    }
    return files;
}

const violations = [];
for (const filePath of collectFiles(ENGINE_ROOT)) {
    const source = fs.readFileSync(filePath, 'utf8');
    for (const forbidden of FORBIDDEN_DEPLOYED_STRINGS) {
        if (source.includes(forbidden)) {
            violations.push(`${path.relative(ENGINE_ROOT, filePath)}: ${forbidden}`);
        }
    }
    for (const forbidden of FORBIDDEN_AUDIO_REQUEST_STRINGS) {
        if (source.includes(forbidden)) {
            violations.push(`${path.relative(ENGINE_ROOT, filePath)}: ${forbidden}`);
        }
    }
}

assert.deepEqual(
    violations,
    [],
    `배포 engine 소스에서 금지된 직접 Gemini/키 문자열이 발견되었습니다:\n${violations.join('\n')}`
);

console.log('I Can Fix Her! Pages engine static security scan passed');
