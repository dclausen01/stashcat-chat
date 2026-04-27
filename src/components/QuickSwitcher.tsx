import { useState, useEffect, useRef, useMemo } from 'react';
import { Search, Hash, Users, X } from 'lucide-react';
import { FocusTrap } from 'focus-trap-react';
import { clsx } from 'clsx';
import { useEscapeKey } from '../hooks/useEscapeKey';
import Avatar from './Avatar';
import type { ChatTarget } from '../types';

interface QuickSwitcherProps {
  channels: ChatTarget[];
  conversations: ChatTarget[];
  onSelect: (chat: ChatTarget) => void;
  onClose: () => void;
}

export default function QuickSwitcher({ channels, conversations, onSelect, onClose }: QuickSwitcherProps) {
  useEscapeKey(onClose);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const allChats = useMemo(() => [...channels, ...conversations], [channels, conversations]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allChats.slice(0, 30);
    return allChats.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 30);
  }, [query, allChats]);

  // Reset selection when filter changes
  useEffect(() => { setActiveIdx(0); }, [query]);

  // Keep active item in view
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const chat = filtered[activeIdx];
      if (chat) {
        onSelect(chat);
        onClose();
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 p-4 pt-[10vh]"
      onClick={onClose}
    >
      <FocusTrap focusTrapOptions={{ escapeDeactivates: false, allowOutsideClick: true }}>
      <div
        className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-surface-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-surface-200 px-4 py-3 dark:border-surface-700">
          <Search size={18} className="shrink-0 text-surface-500" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Chat suchen..."
            className="flex-1 bg-transparent text-sm text-surface-900 outline-none placeholder:text-surface-400 dark:text-white"
          />
          <button
            onClick={onClose}
            aria-label="Schließen"
            className="rounded-lg p-1 text-surface-500 hover:bg-surface-200 dark:hover:bg-surface-700"
          >
            <X size={16} />
          </button>
        </div>
        {/* Results */}
        <div ref={listRef} className="max-h-[60vh] overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-surface-500">
              Keine Chats gefunden
            </div>
          ) : (
            filtered.map((chat, idx) => (
              <button
                key={`${chat.type}-${chat.id}`}
                data-idx={idx}
                onClick={() => { onSelect(chat); onClose(); }}
                onMouseEnter={() => setActiveIdx(idx)}
                className={clsx(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition',
                  idx === activeIdx
                    ? 'bg-primary-100 text-primary-900 dark:bg-primary-900/30 dark:text-primary-200'
                    : 'text-surface-700 hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-800',
                )}
              >
                {chat.type === 'channel' ? (
                  chat.image
                    ? <Avatar name={chat.name} image={chat.image} size="sm" />
                    : <Hash size={17} className="shrink-0 text-surface-500" />
                ) : (
                  <Avatar name={chat.name} image={chat.image} size="sm" />
                )}
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{chat.name}</span>
                <span className="shrink-0 text-[11px] uppercase tracking-wider text-surface-500">
                  {chat.type === 'channel' ? 'Channel' : <Users size={11} className="inline" />}
                </span>
              </button>
            ))
          )}
        </div>
        {/* Footer with hotkey hints */}
        <div className="flex items-center justify-between border-t border-surface-200 px-4 py-2 text-[11px] text-surface-500 dark:border-surface-700">
          <div className="flex gap-3">
            <span><kbd className="rounded bg-surface-100 px-1.5 py-0.5 font-mono dark:bg-surface-800">↑↓</kbd> Navigieren</span>
            <span><kbd className="rounded bg-surface-100 px-1.5 py-0.5 font-mono dark:bg-surface-800">↵</kbd> Öffnen</span>
            <span><kbd className="rounded bg-surface-100 px-1.5 py-0.5 font-mono dark:bg-surface-800">Esc</kbd> Schließen</span>
          </div>
        </div>
      </div>
      </FocusTrap>
    </div>
  );
}
