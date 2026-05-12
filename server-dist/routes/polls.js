"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const logging_1 = require("../lib/logging");
const router = (0, express_1.Router)();
/** List polls — live-verified constraint values (2026-03-27):
 *  'created_by_and_not_archived' = eigene, aktive Umfragen
 *  'invited_and_not_archived'    = eingeladene, aktive Umfragen
 *  'archived_or_over'            = archivierte / abgelaufene Umfragen */
router.get('/polls', async (req, res) => {
    try {
        const client = req.client;
        const constraint = req.query.constraint || 'invited_and_not_archived';
        let companyId = req.query.company_id;
        if (!companyId) {
            const companies = await client.getCompanies();
            const c = companies[0];
            companyId = c?.id ? String(c.id) : undefined;
            if (!companyId)
                return res.status(500).json({ error: 'Kein Unternehmen gefunden' });
        }
        const polls = await client.listPolls(constraint, companyId);
        res.json(polls);
    }
    catch (err) {
        res.status(500).json({ error: String(err) });
    }
});
router.get('/polls/:id', async (req, res) => {
    try {
        const client = req.client;
        const companyId = req.query.company_id;
        const poll = await client.getPollDetails(req.params.id, companyId || '');
        if (poll.questions && poll.questions.length > 0) {
            const questionsWithAnswers = await Promise.all(poll.questions.map(async (q) => {
                const rawAnswers = await client.listPollAnswers(String(q.id)).catch(() => []);
                const answers = rawAnswers.map((a) => ({
                    ...a,
                    votes: Number(a.answer_count ?? 0),
                }));
                return { ...q, answers };
            }));
            poll.questions = questionsWithAnswers;
        }
        res.json(poll);
    }
    catch (err) {
        res.status(500).json({ error: String(err) });
    }
});
router.post('/polls', async (req, res) => {
    try {
        const client = req.client;
        const companies = await client.getCompanies();
        const companyId = String(companies[0]?.id ?? '');
        if (!companyId)
            throw new Error('Kein Unternehmen gefunden');
        const { name, description, start_time, end_time, privacy_type, hidden_results, questions = [], invite_channel_ids = [], invite_conversation_ids = [], notify_chat_id, notify_chat_type } = req.body;
        const poll = await client.createPoll({
            company_id: companyId, name,
            ...(description ? { description } : {}),
            ...(hidden_results !== undefined ? { hidden_results } : {}),
            ...(privacy_type ? { privacy_type: privacy_type } : {}),
            start_time, end_time,
        });
        const pollId = String(poll.id);
        for (let qi = 0; qi < questions.length; qi++) {
            const q = questions[qi];
            const question = await client.createPollQuestion({
                company_id: companyId, poll_id: pollId,
                name: q.name, type: 'text',
                ...(q.answer_limit !== undefined ? { answer_limit: q.answer_limit } : {}),
                position: qi,
            });
            for (let ai = 0; ai < q.answers.length; ai++) {
                await client.createPollAnswer({
                    company_id: companyId, question_id: String(question.id),
                    type: 'text', answer_text: q.answers[ai], position: ai,
                });
            }
        }
        if (invite_channel_ids.length > 0) {
            await client.inviteToPoll(pollId, companyId, 'channels', invite_channel_ids).catch((e) => {
                console.warn(`[Poll] inviteToPoll channels failed:`, (0, logging_1.errorMessage)(e));
            });
        }
        if (invite_conversation_ids.length > 0) {
            const userIds = new Set();
            for (const convId of invite_conversation_ids) {
                const conv = await client.getConversation(convId).catch(() => null);
                if (conv) {
                    const members = conv.members;
                    (members ?? []).forEach((m) => { if (m.id)
                        userIds.add(String(m.id)); });
                }
            }
            if (userIds.size > 0) {
                await client.inviteToPoll(pollId, companyId, 'users', [...userIds]).catch(() => { });
            }
        }
        const published = await client.publishPoll(pollId);
        if (!published) {
            await new Promise((r) => setTimeout(r, 800));
            const retry = await client.publishPoll(pollId).catch(() => false);
            if (!retry)
                console.warn(`[Poll] publishPoll returned false for poll ${pollId} — poll may remain as draft`);
        }
        const startDate = new Date(start_time * 1000).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const endDate = new Date(end_time * 1000).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const msgText = `📊 **Neue Umfrage: „${name}"**\n${description ? description + '\n' : ''}Zeitraum: ${startDate} – ${endDate}\n\nKlicke hier, um teilzunehmen. [%poll:${pollId}%]`;
        const notifyTargets = [];
        for (const id of invite_channel_ids)
            notifyTargets.push({ id, type: 'channel' });
        for (const id of invite_conversation_ids)
            notifyTargets.push({ id, type: 'conversation' });
        if (notify_chat_id && notify_chat_type && !notifyTargets.some((t) => t.id === notify_chat_id)) {
            notifyTargets.push({ id: notify_chat_id, type: notify_chat_type });
        }
        for (const target of notifyTargets) {
            await client.sendMessage({ target: target.id, target_type: target.type, text: msgText }).catch(() => { });
        }
        res.json({ id: pollId });
    }
    catch (err) {
        res.status(500).json({ error: String(err) });
    }
});
router.delete('/polls/:id', async (req, res) => {
    try {
        const client = req.client;
        await client.deletePoll(req.params.id);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: String(err) });
    }
});
router.post('/polls/:id/archive', async (req, res) => {
    try {
        const client = req.client;
        const archive = req.body.archive !== false;
        await client.archivePoll(req.params.id, archive);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: String(err) });
    }
});
router.post('/polls/:id/close', async (req, res) => {
    try {
        const client = req.client;
        const { name, company_id, start_time } = req.body;
        await client.editPoll({
            poll_id: req.params.id,
            company_id,
            name,
            start_time,
            end_time: Math.floor(Date.now() / 1000),
        });
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err) });
    }
});
router.post('/polls/:id/answer', async (req, res) => {
    try {
        const client = req.client;
        const { question_id, answer_ids } = req.body;
        await client.storePollUserAnswers(question_id, answer_ids);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: String(err) });
    }
});
exports.default = router;
