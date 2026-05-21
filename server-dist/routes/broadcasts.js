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
const logging_1 = require("../lib/logging");
const router = (0, express_1.Router)();
const upload = (0, multer_1.default)({ dest: os_1.default.tmpdir() });
router.get('/broadcasts', async (req, res) => {
    try {
        const client = req.client;
        res.json(await client.listBroadcasts());
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err) });
    }
});
router.post('/broadcasts', async (req, res) => {
    try {
        const client = req.client;
        const { name, memberIds } = req.body;
        res.json(await client.createBroadcast(name, memberIds));
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err) });
    }
});
router.delete('/broadcasts/:id', async (req, res) => {
    try {
        const client = req.client;
        await client.deleteBroadcast(req.params.id);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err) });
    }
});
router.patch('/broadcasts/:id', async (req, res) => {
    try {
        const client = req.client;
        const { name } = req.body;
        await client.renameBroadcast(req.params.id, name);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err) });
    }
});
router.get('/broadcasts/:id/messages', async (req, res) => {
    try {
        const client = req.client;
        const limit = Number(req.query.limit) || 50;
        const offset = Number(req.query.offset) || 0;
        const messages = await client.getBroadcastContent({
            list_id: req.params.id,
            limit,
            offset,
        });
        res.json(messages);
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err) });
    }
});
router.post('/broadcasts/:id/messages', async (req, res) => {
    try {
        const client = req.client;
        const { text } = req.body;
        const msg = await client.sendBroadcastMessage({ list_id: req.params.id, text });
        res.json(msg);
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err) });
    }
});
router.get('/broadcasts/:id/members', async (req, res) => {
    try {
        const client = req.client;
        const PAGE = 200;
        const all = [];
        let offset = 0;
        while (true) {
            const page = await client.listBroadcastMembers(req.params.id, { limit: PAGE, offset });
            all.push(...page);
            if (page.length < PAGE)
                break;
            offset += PAGE;
        }
        res.json(all);
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err) });
    }
});
router.post('/broadcasts/:id/members', async (req, res) => {
    try {
        const client = req.client;
        const { memberIds } = req.body;
        await client.addBroadcastMembers(req.params.id, memberIds);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err) });
    }
});
router.post('/broadcasts/:listId/upload', upload.single('file'), async (req, res) => {
    let currentPath = req.file?.path;
    try {
        const client = req.client;
        if (!req.file)
            throw new Error('No file received');
        const me = await client.getMe();
        const userId = String(me.id);
        const originalName = req.file.originalname;
        const ext = path_1.default.extname(originalName);
        const namedPath = currentPath + ext;
        await promises_1.default.rename(currentPath, namedPath);
        currentPath = namedPath;
        const fileInfo = await client.uploadFile(namedPath, {
            type: 'personal',
            type_id: userId,
            filename: originalName,
        });
        const fileId = String(fileInfo.id);
        const msg = await client.sendBroadcastMessage({
            list_id: String(req.params.listId),
            text: typeof req.body.text === 'string' ? req.body.text : '',
            files: JSON.stringify([Number(fileId)]),
            metainfo: { v: 1, style: 'md' },
        });
        res.json({ ok: true, message: msg, file: fileInfo });
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err, 'Upload failed') });
    }
    finally {
        if (currentPath)
            await promises_1.default.unlink(currentPath).catch(() => { });
    }
});
router.delete('/broadcasts/:id/members', async (req, res) => {
    try {
        const client = req.client;
        const { memberIds } = req.body;
        await client.removeBroadcastMembers(req.params.id, memberIds);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err) });
    }
});
exports.default = router;
