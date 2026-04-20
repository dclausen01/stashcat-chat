"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOfficeDocType = getOfficeDocType;
exports.createDownloadToken = createDownloadToken;
exports.validateDownloadToken = validateDownloadToken;
exports.buildViewerConfig = buildViewerConfig;
/**
 * OnlyOffice Document Server integration (read-only).
 *
 * Enables viewing Office documents in the OnlyOffice editor.
 * No save-back / callback logic — purely read-only.
 */
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = require("crypto");
// ── Configuration ────────────────────────────────────────────────────────────
const ONLYOFFICE_URL = process.env.ONLYOFFICE_URL || 'https://office.bbz-rd-eck.de';
const ONLYOFFICE_JWT_SECRET = process.env.ONLYOFFICE_JWT_SECRET || '';
const PUBLIC_URL = process.env.PUBLIC_URL || 'https://chat.bbz-rd-eck.com';
if (!ONLYOFFICE_JWT_SECRET) {
    console.warn('[OnlyOffice] ONLYOFFICE_JWT_SECRET is not set — JWT signing will fail');
}
// ── Office file type detection ───────────────────────────────────────────────
const OFFICE_EXTENSIONS = {
    docx: 'word', doc: 'word', odt: 'word', rtf: 'word', txt: 'word',
    xlsx: 'cell', xls: 'cell', ods: 'cell', csv: 'cell',
    pptx: 'slide', ppt: 'slide', odp: 'slide',
};
function getOfficeDocType(fileName) {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    return OFFICE_EXTENSIONS[ext] ?? null;
}
const downloadTokens = new Map();
const TOKEN_TTL = 60 * 60 * 1000; // 1 hour — viewing session only
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of downloadTokens) {
        if (now - entry.createdAt > TOKEN_TTL)
            downloadTokens.delete(key);
    }
}, 60_000);
function createDownloadToken(fileId, clientKey) {
    const secret = (0, crypto_1.randomBytes)(32).toString('hex');
    downloadTokens.set(secret, { fileId, clientKey, createdAt: Date.now() });
    return secret;
}
function validateDownloadToken(secret) {
    const entry = downloadTokens.get(secret);
    if (!entry)
        return null;
    if (Date.now() - entry.createdAt > TOKEN_TTL) {
        downloadTokens.delete(secret);
        return null;
    }
    return entry;
}
function buildViewerConfig(opts) {
    const ext = opts.fileName.split('.').pop()?.toLowerCase() || '';
    const docType = OFFICE_EXTENSIONS[ext];
    if (!docType)
        throw new Error(`Unsupported file type: .${ext}`);
    const dlToken = createDownloadToken(opts.fileId, opts.clientKey);
    const docKey = `${opts.fileId}_view_${Date.now()}`;
    const config = {
        documentType: docType,
        document: {
            key: docKey,
            fileType: ext,
            title: opts.fileName,
            url: `${PUBLIC_URL}/api/onlyoffice/dl?secret=${encodeURIComponent(dlToken)}`,
            permissions: {
                edit: false,
                download: true,
                print: true,
                comment: false,
                copy: true,
            },
        },
        editorConfig: {
            mode: 'view',
            lang: 'de',
            user: {
                id: opts.userId,
                name: opts.userName,
            },
            customization: {
                chat: false,
                compactHeader: false,
            },
        },
    };
    config.token = jsonwebtoken_1.default.sign(config, ONLYOFFICE_JWT_SECRET, { algorithm: 'HS256' });
    return { config, onlyofficeUrl: ONLYOFFICE_URL };
}
