"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const promises_1 = __importDefault(require("fs/promises"));
const stream_1 = require("stream");
const token_crypto_1 = require("../token-crypto");
const logging_1 = require("../lib/logging");
const router = (0, express_1.Router)();
const upload = (0, multer_1.default)({ dest: os_1.default.tmpdir() });
router.get('/files/folder', async (req, res) => {
    try {
        const client = req.client;
        const { type, typeId, folderId, offset, limit } = req.query;
        const result = await client.listFolder({
            type: type,
            type_id: typeId,
            folder_id: folderId ?? '0',
            offset: offset ? Number(offset) : 0,
            limit: limit ? Number(limit) : 200,
        });
        console.log(`[files/folder] type=${type} typeId=${typeId} folderId=${folderId ?? '0'} → folders=${result.folder.length} files=${result.files.length}`);
        if (result.files.length > 0)
            console.log('[files/folder] first file:', JSON.stringify(result.files[0]));
        res.json(result);
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err) });
    }
});
router.get('/files/quota', async (req, res) => {
    try {
        const client = req.client;
        const { type, typeId } = req.query;
        if (!type || !typeId) {
            res.status(400).json({ error: 'type and typeId are required' });
            return;
        }
        (0, logging_1.serverLog)(`[quota] Fetching quota for type=${type}, typeId=${typeId}`);
        const quota = await client.getQuota(type, typeId);
        (0, logging_1.serverLog)(`[quota] Raw API response:`, JSON.stringify(quota));
        res.json(quota);
    }
    catch (err) {
        (0, logging_1.serverLog)(`[quota] Error:`, (0, logging_1.errorMessage)(err));
        res.status(500).json({ error: (0, logging_1.errorMessage)(err, 'Failed to get quota') });
    }
});
router.get('/files/personal', async (req, res) => {
    try {
        const client = req.client;
        const { folderId, offset, limit } = req.query;
        const result = await client.listPersonalFiles({
            folder_id: folderId ?? '0',
            offset: offset ? Number(offset) : 0,
            limit: limit ? Number(limit) : 200,
        });
        console.log(`[files/personal] folderId=${folderId ?? '0'} → folders=${result.folder.length} files=${result.files.length}`);
        if (result.files.length > 0)
            console.log('[files/personal] first file:', JSON.stringify(result.files[0]));
        else if (result.folder.length > 0)
            console.log('[files/personal] first folder:', JSON.stringify(result.folder[0]));
        res.json(result);
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err) });
    }
});
router.post('/files/upload', upload.single('file'), async (req, res) => {
    // currentPath always points at the on-disk temp file (whether the original
    // multer path or the renamed path) so the finally cleanup is correct even
    // if uploadFile rejects after the rename.
    let currentPath = req.file?.path;
    try {
        const client = req.client;
        if (!req.file)
            throw new Error('No file received');
        const { type, typeId, folderId } = req.body;
        const originalName = req.file.originalname;
        const ext = path_1.default.extname(originalName);
        const namedPath = currentPath + ext;
        await promises_1.default.rename(currentPath, namedPath);
        currentPath = namedPath;
        let resolvedTypeId = typeId;
        if (type === 'personal' && !resolvedTypeId) {
            const me = await client.getMe();
            resolvedTypeId = String(me.id);
        }
        const folderIdNum = folderId ? parseInt(folderId, 10) : undefined;
        await client.uploadFile(namedPath, {
            type,
            type_id: resolvedTypeId,
            folder: folderIdNum,
            filename: originalName,
        });
        res.json({ ok: true });
    }
    catch (err) {
        const message = (0, logging_1.errorMessage)(err, String(err));
        if (err instanceof Error)
            (0, logging_1.debugLog)(`[files/upload] ERROR: ${err.message}\n${err.stack}`);
        res.status(500).json({ error: message });
    }
    finally {
        if (currentPath)
            await promises_1.default.unlink(currentPath).catch(() => { });
    }
});
router.post('/files/:fileId/move', async (req, res) => {
    try {
        const client = req.client;
        const { target_folder_id } = req.body;
        await client.moveFile(req.params.fileId, target_folder_id);
        res.json({ ok: true });
    }
    catch (e) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(e) });
    }
});
router.post('/files/folder/create', async (req, res) => {
    try {
        const client = req.client;
        const { folder_name, parent_id, type, type_id } = req.body;
        const folder = await client.createFolder(folder_name, parent_id, type, type_id);
        res.json(folder);
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err, 'Failed to create folder') });
    }
});
router.post('/folder/delete', async (req, res) => {
    try {
        const client = req.client;
        const { folderId } = req.body;
        await client.deleteFolder(parseInt(folderId, 10));
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err, 'Failed to delete folder') });
    }
});
router.post('/files/delete', async (req, res) => {
    try {
        const client = req.client;
        const { fileIds } = req.body;
        await client.deleteFiles(fileIds);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err) });
    }
});
router.patch('/files/:fileId', async (req, res) => {
    try {
        const client = req.client;
        const { name } = req.body;
        await client.renameFile(req.params.fileId, name);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err) });
    }
});
router.get('/file/:fileId', async (req, res) => {
    try {
        const client = req.client;
        const { fileId } = req.params;
        const fileName = req.query.name || 'download';
        const info = await client.getFileInfo(fileId);
        const disposition = req.query.view === '1' ? 'inline' : 'attachment';
        res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(fileName)}"`);
        const mime = info.mime || 'application/octet-stream';
        res.setHeader('Content-Type', mime);
        res.setHeader('Accept-Ranges', 'bytes');
        // Cache static assets (images, audio) for 1 h — file IDs are permanent
        if (mime.startsWith('image/') || mime.startsWith('audio/')) {
            res.setHeader('Cache-Control', 'private, max-age=3600, immutable');
        }
        if (!info.encrypted) {
            const rawToken = (req.headers['authorization']?.split(' ')[1] ?? req.query.token);
            const { baseUrl } = (0, token_crypto_1.decryptSession)(rawToken);
            const authData = client.api.createAuthenticatedRequestData({});
            const formBody = new URLSearchParams({
                client_key: authData.client_key ?? '',
                device_id: authData.device_id ?? '',
            }).toString();
            const stashRes = await fetch(`${baseUrl}/file/download?id=${encodeURIComponent(fileId)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: formBody,
            });
            if (!stashRes.ok || !stashRes.body)
                throw new Error(`Stashcat download failed: ${stashRes.status}`);
            const contentLength = stashRes.headers.get('content-length');
            if (contentLength)
                res.setHeader('Content-Length', contentLength);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            stream_1.Readable.fromWeb(stashRes.body).pipe(res);
        }
        else {
            const buf = await client.downloadFile({
                id: fileId,
                encrypted: info.encrypted,
                e2e_iv: info.e2e_iv ?? null,
            });
            // Range support for the encrypted-buffer path. The whole file must be
            // decrypted server-side, but we can serve byte slices to the client so
            // mobile WebView downloads of large files behave well.
            const range = req.headers['range'];
            if (typeof range === 'string') {
                const match = /^bytes=(\d*)-(\d*)$/.exec(range);
                if (match) {
                    const total = buf.length;
                    const start = match[1] === '' ? Math.max(0, total - Number(match[2])) : Number(match[1]);
                    const end = match[2] === '' ? total - 1 : Math.min(total - 1, Number(match[2]));
                    if (Number.isFinite(start) && Number.isFinite(end) && start <= end) {
                        res.status(206);
                        res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
                        res.setHeader('Content-Length', String(end - start + 1));
                        res.end(buf.subarray(start, end + 1));
                        return;
                    }
                }
            }
            res.setHeader('Content-Length', String(buf.length));
            res.send(buf);
        }
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err, 'Download failed') });
    }
});
router.post('/upload/:type/:targetId', upload.single('file'), async (req, res) => {
    let currentPath = req.file?.path;
    try {
        const client = req.client;
        const { type, targetId } = req.params;
        const chatType = type;
        if (!req.file)
            throw new Error('No file received');
        const originalName = req.file.originalname;
        const ext = path_1.default.extname(originalName);
        const namedPath = currentPath + ext;
        await promises_1.default.rename(currentPath, namedPath);
        currentPath = namedPath;
        const fileInfo = await client.uploadFile(namedPath, {
            type: chatType,
            type_id: targetId,
            filename: originalName,
        });
        await client.sendMessage({
            target: targetId,
            target_type: chatType,
            text: req.body.text || '',
            files: [fileInfo.id],
        });
        res.json({ ok: true, file: fileInfo });
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err, 'Upload failed') });
    }
    finally {
        if (currentPath)
            await promises_1.default.unlink(currentPath).catch(() => { });
    }
});
exports.default = router;
