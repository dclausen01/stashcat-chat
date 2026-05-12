"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const token_crypto_1 = require("../token-crypto");
const get_client_1 = require("../lib/get-client");
const onlyoffice_1 = require("../onlyoffice");
const nextcloud_1 = require("../nextcloud");
const nextcloud_creds_1 = require("../lib/nextcloud-creds");
const logging_1 = require("../lib/logging");
const router = (0, express_1.Router)();
router.get('/onlyoffice/view', async (req, res) => {
    try {
        const client = req.client;
        const token = (0, get_client_1.extractToken)(req);
        const payload = (0, token_crypto_1.decryptSession)(token);
        const { fileId, fileName } = req.query;
        if (!fileId || !fileName) {
            return res.status(400).json({ error: 'fileId and fileName required' });
        }
        if (!(0, onlyoffice_1.getOfficeDocType)(fileName)) {
            return res.status(400).json({ error: 'Dateityp wird nicht unterstützt' });
        }
        const me = await client.getMe();
        const userId = String(me.id);
        const userName = `${me.first_name || ''} ${me.last_name || ''}`.trim() || 'User';
        const dlToken = (0, onlyoffice_1.createDownloadToken)({ fileId, clientKey: payload.clientKey });
        const downloadUrl = `${onlyoffice_1.PUBLIC_URL}/api/onlyoffice/dl?secret=${encodeURIComponent(dlToken)}`;
        const result = (0, onlyoffice_1.buildViewerConfig)({ fileId, fileName, userId, userName, downloadUrl });
        res.json(result);
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err, 'OnlyOffice-Konfiguration fehlgeschlagen') });
    }
});
router.post('/onlyoffice/view-nc', async (req, res) => {
    try {
        const creds = await (0, nextcloud_creds_1.getNCCred)(req);
        if (!creds)
            return res.status(401).json({ error: 'Nextcloud-Zugangsdaten nicht konfiguriert' });
        const { path: filePath, fileName } = req.query;
        if (!filePath || !fileName) {
            return res.status(400).json({ error: 'path and fileName required' });
        }
        if (!(0, onlyoffice_1.getOfficeDocType)(fileName)) {
            return res.status(400).json({ error: 'Dateityp wird nicht unterstützt' });
        }
        const token = (0, get_client_1.extractToken)(req);
        const payload = (0, token_crypto_1.decryptSession)(token);
        const dlToken = (0, onlyoffice_1.createDownloadToken)({ ncPath: filePath, ncUsername: creds.username, ncAppPassword: creds.password, clientKey: payload.clientKey });
        const downloadUrl = `${onlyoffice_1.PUBLIC_URL}/api/onlyoffice/dl-nc?secret=${encodeURIComponent(dlToken)}`;
        const userName = creds.username;
        const result = (0, onlyoffice_1.buildViewerConfig)({ fileName, userId: creds.username, userName, downloadUrl });
        res.json(result);
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err, 'OnlyOffice-Konfiguration fehlgeschlagen') });
    }
});
router.get('/onlyoffice/dl-nc', async (req, res) => {
    try {
        const { secret } = req.query;
        if (!secret)
            return res.status(400).json({ error: 'Missing secret' });
        const tokenData = (0, onlyoffice_1.validateDownloadToken)(secret);
        if (!tokenData)
            return res.status(403).json({ error: 'Invalid or expired token' });
        if (!tokenData.ncPath || !tokenData.ncUsername || !tokenData.ncAppPassword) {
            return res.status(403).json({ error: 'Not a valid Nextcloud token' });
        }
        const baseUrl = process.env.NEXTCLOUD_URL || 'https://cloud.bbz-rd-eck.de';
        const creds = { baseUrl, username: tokenData.ncUsername, password: tokenData.ncAppPassword };
        const ncResp = await (0, nextcloud_1.ncDownload)(creds, tokenData.ncPath);
        const buf = Buffer.from(await ncResp.arrayBuffer());
        res.setHeader('Content-Type', ncResp.headers.get('content-type') || 'application/octet-stream');
        res.setHeader('Content-Disposition', 'inline');
        res.send(buf);
    }
    catch (err) {
        console.error('[OnlyOffice/dl-nc] Error:', err);
        res.status(500).json({ error: (0, logging_1.errorMessage)(err, 'Download fehlgeschlagen') });
    }
});
router.get('/onlyoffice/dl', async (req, res) => {
    try {
        const { secret } = req.query;
        if (!secret)
            return res.status(400).json({ error: 'Missing secret' });
        const tokenData = (0, onlyoffice_1.validateDownloadToken)(secret);
        if (!tokenData)
            return res.status(403).json({ error: 'Invalid or expired token' });
        if (!tokenData.fileId)
            return res.status(403).json({ error: 'Not a Stashcat token' });
        const client = (0, get_client_1.touchCachedClient)(tokenData.clientKey);
        if (!client)
            return res.status(403).json({ error: 'Session expired' });
        const info = await client.getFileInfo(tokenData.fileId);
        const buf = await client.downloadFile({
            id: tokenData.fileId,
            encrypted: info.encrypted,
            e2e_iv: info.e2e_iv ?? null,
        });
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(info.name || 'document')}"`);
        res.setHeader('Content-Type', info.mime || 'application/octet-stream');
        res.send(buf);
    }
    catch (err) {
        console.error('[OnlyOffice/dl] Error:', err);
        res.status(500).json({ error: (0, logging_1.errorMessage)(err, 'Download failed') });
    }
});
exports.default = router;
