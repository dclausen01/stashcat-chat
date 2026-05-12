"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const token_crypto_1 = require("../token-crypto");
const get_client_1 = require("../lib/get-client");
const state_1 = require("../lib/state");
const logging_1 = require("../lib/logging");
const router = (0, express_1.Router)();
router.post('/call/get_turn_server', async (req, res) => {
    try {
        const client = req.client;
        const data = client.api.createAuthenticatedRequestData({});
        const result = await client.api.post('/call/get_turn_server', data);
        res.json(result.turn_server);
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err, 'TURN server request failed') });
    }
});
router.post('/call/create', async (req, res) => {
    try {
        const client = req.client;
        const { callee_id, target_id, target, type, verification } = req.body;
        const data = client.api.createAuthenticatedRequestData({
            callee_id,
            target_id: String(target_id),
            target: target || 'conversation',
            type: type || 'audio',
            verification,
        });
        const result = await client.api.post('/call/create', data);
        res.json(result.call);
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err, 'Call creation failed') });
    }
});
router.post('/call/signal', async (req, res) => {
    try {
        const token = (0, get_client_1.extractToken)(req);
        const sessionPayload = (0, token_crypto_1.decryptSession)(token);
        const { clientKey, deviceId } = sessionPayload;
        const conn = state_1.activeSSE.get(clientKey);
        if (!conn?.realtime) {
            return res.status(503).json({ error: 'Not connected to realtime' });
        }
        const socket = conn.realtime.socket;
        if (!socket) {
            return res.status(503).json({ error: 'Socket not available' });
        }
        const signalData = { ...req.body, deviceId };
        socket.emit('signal', signalData);
        (0, logging_1.serverLog)(`[Call] Signal emitted: signalType=${req.body.signalType}, call_id=${req.body.call_id}`);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err, 'Signal send failed') });
    }
});
router.post('/call/end', async (req, res) => {
    try {
        const client = req.client;
        const { call_id } = req.body;
        const data = client.api.createAuthenticatedRequestData({ call_id: String(call_id) });
        await client.api.post('/call/end', data);
        res.json({ ok: true });
    }
    catch {
        res.json({ ok: true });
    }
});
exports.default = router;
