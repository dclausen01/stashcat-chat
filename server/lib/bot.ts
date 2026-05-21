import type { StashcatClient } from 'stashcat-api';
import { botCache, type BotInfo } from './state';

/** Returns true if a member object looks like the Stashcat Chat Bot */
export function looksLikeChatBot(member: Record<string, unknown>): boolean {
  if (Boolean(member.is_bot)) return true;
  const first = String(member.first_name || '').trim().toLowerCase();
  const last  = String(member.last_name  || '').trim().toLowerCase();
  const full  = `${first} ${last}`;
  return full === 'chat bot' || first === 'chat bot' || last === 'chat bot';
}

export async function findChatBot(client: StashcatClient, clientKey: string): Promise<BotInfo | null> {
  const cached = botCache.get(clientKey);
  if (cached) return cached;

  try {
    for (const offset of [0, 100]) {
      const conversations = await client.getConversations({ limit: 100, offset }) as unknown as Array<Record<string, unknown>>;
      console.log(`[Video] Scanning ${conversations.length} conversations at offset ${offset}`);

      for (const conv of conversations) {
        const rawMembers = (conv.members ?? conv.participants ?? []) as Array<Record<string, unknown>>;

        let members = rawMembers;
        if (members.length > 0 && !members[0].first_name) {
          try {
            const full = await client.getConversation(String(conv.id)) as unknown as Record<string, unknown>;
            members = ((full.members ?? full.participants ?? []) as Array<Record<string, unknown>>);
          } catch { /* ignore */ }
        }

        for (const member of members) {
          if (looksLikeChatBot(member)) {
            const info: BotInfo = { botUserId: String(member.id ?? member.user_id), botConvId: String(conv.id) };
            botCache.set(clientKey, info);
            console.log(`[Video] Found Chat Bot: userId=${info.botUserId}, convId=${info.botConvId}`);
            return info;
          }
        }
      }

      if (conversations.length < 100) break;
    }

    console.warn('[Video] Chat Bot not found in conversations. Searching company members by name...');
    try {
      const companies = await client.getCompanies() as unknown as Array<Record<string, unknown>>;
      for (const company of companies) {
        const companyId = String(company.id);

        const searchResult = await client.listManagedUsers(companyId, { search: 'Chat Bot', limit: 20 }) as unknown as { users: Array<Record<string, unknown>> };
        const candidates = searchResult?.users ?? [];

        let allMembers: Array<Record<string, unknown>> = candidates;
        if (candidates.length === 0) {
          const allResult = await client.listManagedUsers(companyId, { limit: 500 }) as unknown as { users: Array<Record<string, unknown>> };
          allMembers = allResult?.users ?? [];
        }

        for (const member of allMembers) {
          if (looksLikeChatBot(member)) {
            const botUserId = String(member.id ?? member.user_id);
            console.log(`[Video] Found Chat Bot via company search: userId=${botUserId}, creating conversation...`);
            const conv = await client.createConversation([botUserId]) as unknown as Record<string, unknown>;
            const botConvId = String(conv.id);
            const info: BotInfo = { botUserId, botConvId };
            botCache.set(clientKey, info);
            console.log(`[Video] Bot conversation created/found: convId=${botConvId}`);
            return info;
          }
        }
      }
    } catch (fallbackErr) {
      console.warn('[Video] Company member fallback failed:', fallbackErr);
    }
  } catch (err) {
    console.warn('[Video] Failed to search for Chat Bot:', err);
  }

  return null;
}

export function isBotConversation(convId: string, clientKey: string): boolean {
  const bot = botCache.get(clientKey);
  return bot ? bot.botConvId === convId : false;
}

export function extractSenderId(msg: Record<string, unknown>): string {
  const sender = msg.sender;
  if (typeof sender === 'string') return sender;
  if (sender && typeof sender === 'object') {
    const s = sender as Record<string, unknown>;
    return String(s.id ?? s.user_id ?? '');
  }
  return '';
}

export function extractMeetingLinks(text: string): string[] {
  const re = /https?:\/\/stash\.cat\/l\/([a-zA-Z0-9]+)/g;
  const links: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    links.push(`https://stash.cat/l/${m[1]}`);
  }
  return links;
}
