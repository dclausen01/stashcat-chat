"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const logging_1 = require("../lib/logging");
const router = (0, express_1.Router)();
router.get('/notifications', async (req, res) => {
    try {
        const client = req.client;
        const limit = Number(req.query.limit) || 50;
        const offset = Number(req.query.offset) || 0;
        const notifications = await client.getNotifications(limit, offset);
        (0, logging_1.serverLog)(`[notifications] GET limit=${limit} offset=${offset} → ${Array.isArray(notifications) ? notifications.length : 0} notifications`);
        res.json(notifications);
    }
    catch (err) {
        (0, logging_1.serverLog)(`[notifications] GET error: ${(0, logging_1.errorMessage)(err)}`);
        res.status(500).json({ error: (0, logging_1.errorMessage)(err) });
    }
});
router.get('/notifications/count', async (req, res) => {
    try {
        const client = req.client;
        const count = await client.getNotificationCount();
        res.json({ count });
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err) });
    }
});
router.delete('/notifications/:notificationId', async (req, res) => {
    try {
        const client = req.client;
        const notificationId = req.params.notificationId;
        (0, logging_1.serverLog)(`[notifications] DELETE id=${notificationId}`);
        await client.deleteNotification(notificationId);
        (0, logging_1.serverLog)(`[notifications] DELETE id=${notificationId} — success`);
        res.json({ ok: true });
    }
    catch (err) {
        (0, logging_1.serverLog)(`[notifications] DELETE id=${req.params.notificationId} — FAILED: ${(0, logging_1.errorMessage)(err)}`);
        res.status(500).json({ error: (0, logging_1.errorMessage)(err) });
    }
});
router.delete('/notifications', async (req, res) => {
    try {
        const client = req.client;
        (0, logging_1.serverLog)(`[notifications] DELETE ALL (serial)`);
        const notifications = await client.getNotifications(200, 0);
        const items = Array.isArray(notifications) ? notifications : [];
        (0, logging_1.serverLog)(`[notifications] DELETE ALL — found ${items.length} notifications`);
        let deleted = 0;
        let errors = 0;
        for (const n of items) {
            const id = String(n.id ?? '');
            if (!id)
                continue;
            try {
                await client.deleteNotification(id);
                deleted++;
            }
            catch (err) {
                errors++;
                (0, logging_1.serverLog)(`[notifications] DELETE ALL — failed for id=${id}: ${(0, logging_1.errorMessage)(err)}`);
            }
        }
        (0, logging_1.serverLog)(`[notifications] DELETE ALL — done: ${deleted} deleted, ${errors} errors`);
        res.json({ ok: true, deleted, errors });
    }
    catch (err) {
        (0, logging_1.serverLog)(`[notifications] DELETE ALL — FAILED: ${(0, logging_1.errorMessage)(err)}`);
        res.status(500).json({ error: (0, logging_1.errorMessage)(err) });
    }
});
exports.default = router;
