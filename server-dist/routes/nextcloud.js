"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const os_1 = __importDefault(require("os"));
const promises_1 = __importDefault(require("fs/promises"));
const nextcloud_1 = require("../nextcloud");
const nextcloud_creds_1 = require("../lib/nextcloud-creds");
const logging_1 = require("../lib/logging");
const router = (0, express_1.Router)();
const upload = (0, multer_1.default)({ dest: os_1.default.tmpdir() });
router.get('/nextcloud/status', async (req, res) => {
    try {
        const result = await (0, nextcloud_creds_1.getNCCreds)(req);
        if (!result) {
            return res.json({ configured: false, needsAppPassword: true });
        }
        res.json({ configured: true, authMode: result.authMode, username: result.creds.username });
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err) });
    }
});
router.get('/nextcloud/probe', async (req, res) => {
    try {
        const result = await (0, nextcloud_creds_1.getNCCreds)(req);
        if (!result) {
            return res.json({ configured: false, needsAppPassword: true });
        }
        const probe = await (0, nextcloud_1.ncProbe)(result.creds);
        if (probe.ok) {
            return res.json({ configured: true, authMode: result.authMode, username: result.creds.username });
        }
        if (probe.reason === 'throttled') {
            return res.json({ configured: true, throttled: true, authMode: result.authMode, username: result.creds.username });
        }
        if (probe.reason === 'auth') {
            return res.json({ configured: false, needsAppPassword: true, reason: 'auth' });
        }
        return res.json({ configured: false, reason: probe.reason, status: probe.status });
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err) });
    }
});
router.get('/nextcloud/folder', async (req, res) => {
    try {
        const creds = await (0, nextcloud_creds_1.getNCCred)(req);
        if (!creds)
            return res.status(401).json({ error: 'Nextcloud-Zugangsdaten nicht konfiguriert', needsAppPassword: true });
        const folderPath = req.query.path || '/';
        const entries = await (0, nextcloud_1.ncListFolder)(creds, folderPath);
        res.json(entries);
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err) });
    }
});
router.get('/nextcloud/file', async (req, res) => {
    try {
        const creds = await (0, nextcloud_creds_1.getNCCred)(req);
        if (!creds)
            return res.status(401).json({ error: 'Nextcloud-Zugangsdaten nicht konfiguriert' });
        const filePath = req.query.path;
        if (!filePath)
            return res.status(400).json({ error: 'path required' });
        const ncRes = await (0, nextcloud_1.ncDownload)(creds, filePath);
        const contentType = ncRes.headers.get('content-type') || 'application/octet-stream';
        const disposition = req.query.view === '1' ? 'inline' : 'attachment';
        const fileName = filePath.split('/').pop() || 'download';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(fileName)}"`);
        const buf = Buffer.from(await ncRes.arrayBuffer());
        res.send(buf);
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err) });
    }
});
router.post('/nextcloud/upload', upload.single('file'), async (req, res) => {
    const tmpPath = req.file?.path;
    try {
        const creds = await (0, nextcloud_creds_1.getNCCred)(req);
        if (!creds)
            return res.status(401).json({ error: 'Nextcloud-Zugangsdaten nicht konfiguriert' });
        if (!req.file)
            throw new Error('No file received');
        const folderPath = req.body.path || '/';
        const originalName = req.file.originalname;
        const targetPath = folderPath.replace(/\/$/, '') + '/' + originalName;
        const buf = await promises_1.default.readFile(tmpPath);
        await (0, nextcloud_1.ncUpload)(creds, targetPath, buf, req.file.mimetype || 'application/octet-stream');
        res.json({ ok: true, path: targetPath });
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err) });
    }
    finally {
        if (tmpPath)
            await promises_1.default.unlink(tmpPath).catch(() => { });
    }
});
router.post('/nextcloud/delete', async (req, res) => {
    try {
        const creds = await (0, nextcloud_creds_1.getNCCred)(req);
        if (!creds)
            return res.status(401).json({ error: 'Nextcloud-Zugangsdaten nicht konfiguriert' });
        const { paths } = req.body;
        for (const p of paths)
            await (0, nextcloud_1.ncDelete)(creds, p);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err) });
    }
});
router.post('/nextcloud/mkcol', async (req, res) => {
    try {
        const creds = await (0, nextcloud_creds_1.getNCCred)(req);
        if (!creds)
            return res.status(401).json({ error: 'Nextcloud-Zugangsdaten nicht konfiguriert' });
        const { path: folderPath } = req.body;
        await (0, nextcloud_1.ncMkcol)(creds, folderPath);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err) });
    }
});
router.post('/nextcloud/move', async (req, res) => {
    try {
        const creds = await (0, nextcloud_creds_1.getNCCred)(req);
        if (!creds)
            return res.status(401).json({ error: 'Nextcloud-Zugangsdaten nicht konfiguriert' });
        const { from, to } = req.body;
        await (0, nextcloud_1.ncMove)(creds, from, to);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err) });
    }
});
router.post('/nextcloud/rename', async (req, res) => {
    try {
        const creds = await (0, nextcloud_creds_1.getNCCred)(req);
        if (!creds)
            return res.status(401).json({ error: 'Nextcloud-Zugangsdaten nicht konfiguriert' });
        const { path: filePath, newName } = req.body;
        const parent = filePath.substring(0, filePath.lastIndexOf('/')) || '/';
        const newPath = parent.replace(/\/$/, '') + '/' + newName;
        await (0, nextcloud_1.ncMove)(creds, filePath, newPath);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err) });
    }
});
router.post('/nextcloud/share', async (req, res) => {
    try {
        const creds = await (0, nextcloud_creds_1.getNCCred)(req);
        if (!creds)
            return res.status(401).json({ error: 'Nextcloud-Zugangsdaten nicht konfiguriert' });
        const { path: filePath, password, permissions } = req.body;
        const result = await (0, nextcloud_1.ncCreateShare)(creds, filePath, password, permissions);
        res.json(result);
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err) });
    }
});
router.get('/nextcloud/quota', async (req, res) => {
    try {
        const creds = await (0, nextcloud_creds_1.getNCCred)(req);
        if (!creds)
            return res.status(401).json({ error: 'Nextcloud-Zugangsdaten nicht konfiguriert' });
        const quota = await (0, nextcloud_1.ncQuota)(creds);
        res.json(quota);
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err) });
    }
});
exports.default = router;
