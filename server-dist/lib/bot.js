"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.looksLikeChatBot = looksLikeChatBot;
exports.findChatBot = findChatBot;
exports.isBotConversation = isBotConversation;
exports.isBotMessage = isBotMessage;
exports.extractSenderId = extractSenderId;
exports.extractMeetingLinks = extractMeetingLinks;
const state_1 = require("./state");
/** Returns true if a member object looks like the Stashcat Chat Bot */
function looksLikeChatBot(member) {
    if (Boolean(member.is_bot))
        return true;
    const first = String(member.first_name || '').trim().toLowerCase();
    const last = String(member.last_name || '').trim().toLowerCase();
    const full = `${first} ${last}`;
    return full === 'chat bot' || first === 'chat bot' || last === 'chat bot';
}
async function findChatBot(client, clientKey) {
    const cached = state_1.botCache.get(clientKey);
    if (cached)
        return cached;
    try {
        for (const offset of [0, 100]) {
            const conversations = await client.getConversations({ limit: 100, offset });
            console.log(`[Video] Scanning ${conversations.length} conversations at offset ${offset}`);
            for (const conv of conversations) {
                const rawMembers = (conv.members ?? conv.participants ?? []);
                let members = rawMembers;
                if (members.length > 0 && !members[0].first_name) {
                    try {
                        const full = await client.getConversation(String(conv.id));
                        members = (full.members ?? full.participants ?? []);
                    }
                    catch { /* ignore */ }
                }
                for (const member of members) {
                    if (looksLikeChatBot(member)) {
                        const info = { botUserId: String(member.id ?? member.user_id), botConvId: String(conv.id) };
                        state_1.botCache.set(clientKey, info);
                        console.log(`[Video] Found Chat Bot: userId=${info.botUserId}, convId=${info.botConvId}`);
                        return info;
                    }
                }
            }
            if (conversations.length < 100)
                break;
        }
        console.warn('[Video] Chat Bot not found in conversations. Searching company members by name...');
        try {
            const companies = await client.getCompanies();
            for (const company of companies) {
                const companyId = String(company.id);
                const searchResult = await client.listManagedUsers(companyId, { search: 'Chat Bot', limit: 20 });
                const candidates = searchResult?.users ?? [];
                let allMembers = candidates;
                if (candidates.length === 0) {
                    const allResult = await client.listManagedUsers(companyId, { limit: 500 });
                    allMembers = allResult?.users ?? [];
                }
                for (const member of allMembers) {
                    if (looksLikeChatBot(member)) {
                        const botUserId = String(member.id ?? member.user_id);
                        console.log(`[Video] Found Chat Bot via company search: userId=${botUserId}, creating conversation...`);
                        const conv = await client.createConversation([botUserId]);
                        const botConvId = String(conv.id);
                        const info = { botUserId, botConvId };
                        state_1.botCache.set(clientKey, info);
                        console.log(`[Video] Bot conversation created/found: convId=${botConvId}`);
                        return info;
                    }
                }
            }
        }
        catch (fallbackErr) {
            console.warn('[Video] Company member fallback failed:', fallbackErr);
        }
    }
    catch (err) {
        console.warn('[Video] Failed to search for Chat Bot:', err);
    }
    return null;
}
function isBotConversation(convId, clientKey) {
    const bot = state_1.botCache.get(clientKey);
    return bot ? bot.botConvId === convId : false;
}
function isBotMessage(senderId, clientKey) {
    const bot = state_1.botCache.get(clientKey);
    return bot ? bot.botUserId === senderId : false;
}
function extractSenderId(msg) {
    const sender = msg.sender;
    if (typeof sender === 'string')
        return sender;
    if (sender && typeof sender === 'object') {
        const s = sender;
        return String(s.id ?? s.user_id ?? '');
    }
    return '';
}
function extractMeetingLinks(text) {
    const re = /https?:\/\/stash\.cat\/l\/([a-zA-Z0-9]+)/g;
    const links = [];
    let m;
    while ((m = re.exec(text)) !== null) {
        links.push(`https://stash.cat/l/${m[1]}`);
    }
    return links;
}
