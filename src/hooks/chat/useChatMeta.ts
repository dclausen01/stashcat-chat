import { useEffect, useState } from 'react';
import * as api from '../../api';
import type { ChatTarget } from '../../types';
import { getCleanName } from '../../utils/subchannels';

/**
 * Encapsulates the per-chat metadata that ChatView keeps mirrored as local
 * state so inline editors (rename, image, description, mute toggle) can
 * reflect their saves immediately without waiting for an upstream refresh.
 *
 * - `name`, `description`, `image`, `muted` mirror the incoming chat target
 *   and are auto-resynced whenever the corresponding `chat.*` prop changes.
 * - `isManager` is fetched from the channel-members API on chat change and
 *   only ever true for channels where the current user has manager rights.
 * - The returned `set*` callbacks let consumers apply local saves before
 *   the next sidebar refresh propagates the change.
 */
export interface ChatMeta {
  name: string;
  description: string;
  image: string;
  muted: boolean;
  isManager: boolean;
  setName: (name: string) => void;
  setDescription: (description: string) => void;
  setImage: (image: string) => void;
  setMuted: (muted: boolean) => void;
}

export function useChatMeta(chat: ChatTarget, userId: string): ChatMeta {
  const [name, setNameRaw] = useState(() => getCleanName(chat.name));
  const [description, setDescription] = useState(chat.description || '');
  const [image, setImage] = useState(chat.image || '');
  const [muted, setMuted] = useState(chat.muted === true);
  const [isManager, setIsManager] = useState(false);

  useEffect(() => {
    setNameRaw(getCleanName(chat.name));
  }, [chat.name, chat.id]);

  useEffect(() => {
    setDescription(chat.description || '');
  }, [chat.description, chat.id]);

  useEffect(() => {
    setImage(chat.image || '');
  }, [chat.image, chat.id]);

  useEffect(() => {
    setMuted(chat.muted === true);
  }, [chat.muted, chat.id]);

  useEffect(() => {
    setIsManager(false);
    if (chat.type !== 'channel') return;
    // Cancel-Flag verhindert, dass das Promise eines abgewaehlten Channels
    // den Manager-Status des aktuell aktiven Channels ueberschreibt, wenn der
    // User schnell durch mehrere Channels klickt.
    let cancelled = false;
    api.getChannelMembers(chat.id)
      .then((members) => {
        if (cancelled) return;
        const raw = members as Array<Record<string, unknown>>;
        const me = raw.find((m) => String(m.user_id ?? m.id) === userId);
        const isMgr = me?.manager === true || (me?.role !== undefined && me?.role !== 'member');
        setIsManager(!!me && isMgr);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [chat.id, chat.type, userId]);

  return {
    name,
    description,
    image,
    muted,
    isManager,
    setName: (next) => setNameRaw(getCleanName(next)),
    setDescription,
    setImage,
    setMuted,
  };
}
