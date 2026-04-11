export interface User {
  id: string;
  first_name: string;
  last_name: string;
  email?: string;
  image?: string;
  status?: string;
  online?: boolean;
  socket_id?: string;
}

export interface Channel {
  id: string;
  name: string;
  description?: string;
  image?: string;
  encrypted?: boolean;
  unread_count?: number;
  last_message?: Message;
  member_count?: number;
  favorite?: boolean;
  company_id?: string;
  /** Channel type from API info endpoint (e.g. 'open', 'closed') */
  type?: string;
  /** Encryption type label (e.g. 'AES') — returned by channel info */
  encryption?: string;
  /** Total user count — returned by channel info */
  user_count?: number;
  /** Unix timestamp (seconds) of channel creation */
  created_at?: number;
  /** Unix timestamp (seconds) of last activity */
  last_activity?: number;
}

export interface Conversation {
  id: string;
  members: User[];
  encrypted?: boolean;
  unread_count?: number;
  last_message?: Message;
  favorite?: boolean;
  is_favorite?: boolean;
  last_action?: number;
  last_activity?: number;
  name?: string;
}

export interface MessageFile {
  id: string;
  name: string;
  size_string?: string;
  size_byte?: string;
  mime?: string;
  ext?: string;
  encrypted?: boolean;
  e2e_iv?: string | null;
}

export interface MessageReplyTo {
  message_id: number;
  message_hash: string;
  message_verification?: string | null;
}

export interface Message {
  id: string;
  text: string;
  sender: User;
  time?: number;
  micro_time?: number;
  encrypted?: boolean;
  iv?: string;
  files?: MessageFile[];
  likes?: number;
  liked?: boolean;
  flagged?: boolean;
  edited?: boolean;
  reply_to_id?: string;
  reply_to?: MessageReplyTo | null;
  is_forwarded?: boolean;
  kind?: string;
  type?: string;
  conversation_id?: number;
  channel_id?: number;
  seen_by_others?: boolean;
  unread?: boolean;
  /** Stashcat may include a poll_id reference in poll invite messages */
  poll_id?: string;
  /** Or target_id could reference the poll */
  target_id?: string;
  /** Message was deleted by the user */
  deleted?: boolean;
  /** Message was deleted by a manager/admin */
  is_deleted_by_manager?: boolean;
}

export interface Company {
  id: string;
  name: string;
}

export interface LoginDevice {
  device_id: string;
  app_name: string;
  name?: string;
  last_login?: number;
  last_request?: number;
}

export interface ChannelMember {
  id: string;
  user_id: string;
  channel_id: string;
  role: string; // 'moderator' | 'member' | ...
  joined_at: string;
}

export type ChatType = 'channel' | 'conversation';

export interface ChatTarget {
  type: ChatType;
  id: string;
  name: string;
  description?: string;
  image?: string;
  encrypted?: boolean;
  unread_count?: number;
  favorite?: boolean;
  /** Unix timestamp (seconds) of last message — used for sorting */
  lastActivity?: number;
  /** Company this channel belongs to (channels only) */
  company_id?: string;
}
