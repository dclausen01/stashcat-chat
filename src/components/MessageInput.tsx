import { useState, useRef, useCallback, useEffect, type KeyboardEvent } from 'react';
import { Send, Paperclip, Bold, Italic, Strikethrough, Code, List, Heading2, X, Loader2, Reply, BarChart3, CalendarPlus } from 'lucide-react';
import EmojiPicker, { type EmojiClickData, Theme } from 'emoji-picker-react';
import { clsx } from 'clsx';
import { useTheme } from '../context/ThemeContext';

interface ReplyTarget {
  id: string;
  text?: string;
  sender?: { first_name?: string; last_name?: string };
}

interface MessageInputProps {
  onSend: (text: string) => Promise<void>;
  onUpload: (file: File, text: string) => Promise<void>;
  onTyping?: () => void;
  chatId: string;
  chatName: string;
  replyTo?: ReplyTarget | null;
  onCancelReply?: () => void;
  onCreatePoll?: () => void;
  onCreateEvent?: () => void;
  droppedFiles?: File[];
  onDroppedFilesConsumed?: () => void;
}

interface FormatButton {
  icon: React.ReactNode;
  label: string;
  action: (text: string, sel: { start: number; end: number }) => { text: string; cursor: number };
}

function wrap(before: string, after: string, placeholder: string) {
  return (text: string, sel: { start: number; end: number }) => {
    const selected = text.slice(sel.start, sel.end) || placeholder;
    const newText = text.slice(0, sel.start) + before + selected + after + text.slice(sel.end);
    return { text: newText, cursor: sel.start + before.length + selected.length + after.length };
  };
}

function linePrefix(prefix: string, placeholder: string) {
  return (text: string, sel: { start: number; end: number }) => {
    const lineStart = text.lastIndexOf('\n', sel.start - 1) + 1;
    const selected = text.slice(sel.start, sel.end) || placeholder;
    const newText = text.slice(0, lineStart) + prefix + text.slice(lineStart, sel.start) + selected + text.slice(sel.end);
    return { text: newText, cursor: lineStart + prefix.length + (sel.end - lineStart) + (selected === placeholder ? placeholder.length : 0) };
  };
}

const FORMAT_BUTTONS: FormatButton[] = [
  { icon: <Bold size={15} />, label: 'Fett', action: wrap('**', '**', 'Fetter Text') },
  { icon: <Italic size={15} />, label: 'Kursiv', action: wrap('_', '_', 'Kursiver Text') },
  { icon: <Strikethrough size={15} />, label: 'Durchgestrichen', action: wrap('~~', '~~', 'Durchgestrichener Text') },
  { icon: <Code size={15} />, label: 'Code', action: wrap('`', '`', 'code') },
  { icon: <Heading2 size={15} />, label: 'Überschrift', action: linePrefix('## ', 'Überschrift') },
  { icon: <List size={15} />, label: 'Liste', action: linePrefix('- ', 'Listenpunkt') },
];

export default function MessageInput({ onSend, onUpload, onTyping, chatId, chatName, replyTo, onCancelReply, onCreatePoll, onCreateEvent, droppedFiles, onDroppedFilesConsumed }: MessageInputProps) {
  const { theme } = useTheme();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const emojiRef = useRef<HTMLDivElement>(null);
  const typingThrottle = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Per-chat draft storage: preserve text when switching chats
  const draftsRef = useRef<Map<string, string>>(new Map());
  const prevChatIdRef = useRef(chatId);

  useEffect(() => {
    if (prevChatIdRef.current !== chatId) {
      // Save current text for the previous chat
      draftsRef.current.set(prevChatIdRef.current, text);
      // Restore saved text for the new chat (or empty)
      const saved = draftsRef.current.get(chatId) || '';
      setText(saved);
      // Reset textarea height
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
      prevChatIdRef.current = chatId;
    }
  }, [chatId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus textarea when reply is activated
  useEffect(() => {
    if (replyTo) textareaRef.current?.focus();
  }, [replyTo]);

  // Consume files dropped from the parent (system file drag & drop)
  useEffect(() => {
    if (droppedFiles && droppedFiles.length > 0) {
      setPendingFiles((prev) => [...prev, ...droppedFiles]);
      onDroppedFilesConsumed?.();
      textareaRef.current?.focus();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [droppedFiles]);

  useEffect(() => {
    if (!showAttachMenu) return;
    const handler = (e: MouseEvent) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) {
        setShowAttachMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showAttachMenu]);

  useEffect(() => {
    if (!showEmoji) return;
    const handler = (e: MouseEvent) => {
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) {
        setShowEmoji(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showEmoji]);

  const handleSend = async () => {
    if (sending) return;
    if (pendingFiles.length > 0) {
      setSending(true);
      const total = pendingFiles.length;
      const filesToSend = [...pendingFiles];
      let failCount = 0;
      for (let i = 0; i < filesToSend.length; i++) {
        try {
          await onUpload(filesToSend[i], i === 0 ? `${text.trim()} 1/${total}` : `${i + 1}/${total}`);
        } catch {
          failCount++;
        }
      }
      if (failCount > 0) {
        const msg = failCount === 1
          ? '1 Datei konnte nicht hochgeladen werden.'
          : `${failCount} Dateien konnten nicht hochgeladen werden.`;
        alert(msg);
      }
      setPendingFiles([]);
      setText('');
      draftsRef.current.delete(chatId);
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
      setSending(false);
    } else {
      const trimmed = text.trim();
      if (!trimmed) return;
      setSending(true);
      try {
        await onSend(trimmed);
        setText('');
        draftsRef.current.delete(chatId);
      } finally {
        setSending(false);
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
      }
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
    }
    if (onTyping && !typingThrottle.current) {
      onTyping();
      typingThrottle.current = setTimeout(() => { typingThrottle.current = null; }, 2000);
    }
  };

  const applyFormat = useCallback((btn: FormatButton) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const sel = { start: ta.selectionStart, end: ta.selectionEnd };
    const result = btn.action(text, sel);
    setText(result.text);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(result.cursor, result.cursor);
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
    });
  }, [text]);

  const onEmojiClick = useCallback((emojiData: EmojiClickData) => {
    const ta = textareaRef.current;
    const emoji = emojiData.emoji;
    if (ta) {
      const pos = ta.selectionStart;
      setText((prev) => prev.slice(0, pos) + emoji + prev.slice(pos));
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(pos + emoji.length, pos + emoji.length);
      });
    } else {
      setText((prev) => prev + emoji);
    }
    setShowEmoji(false);
  }, []);

  const onFilesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) {
      setPendingFiles((prev) => [...prev, ...files]);
    }
    e.target.value = '';
  };

  const canSend = !sending && (pendingFiles.length > 0 || text.trim().length > 0);

  return (
    <div className="shrink-0 border-t border-surface-200 p-3 dark:border-surface-700">
      {/* Reply preview */}
      {replyTo && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border-l-3 border-primary-500 bg-primary-50 px-3 py-2 text-sm dark:bg-primary-950/30">
          <Reply size={14} className="shrink-0 text-primary-500" />
          <div className="min-w-0 flex-1">
            <span className="text-xs font-semibold text-primary-700 dark:text-primary-400">
              {replyTo.sender ? `${replyTo.sender.first_name ?? ''} ${replyTo.sender.last_name ?? ''}`.trim() : 'Nachricht'}
            </span>
            <p className="truncate text-xs text-surface-500">{replyTo.text?.slice(0, 100) || 'Nachricht'}</p>
          </div>
          <button onClick={onCancelReply} className="shrink-0 text-surface-500 hover:text-surface-600">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Pending files preview */}
      {pendingFiles.length > 0 && (
        <div className="mb-2 flex flex-col gap-1">
          {pendingFiles.map((file, idx) => (
            <div key={idx} className="flex items-center gap-2 rounded-lg bg-surface-100 px-3 py-2 text-sm dark:bg-surface-800">
              <Paperclip size={14} className="shrink-0 text-surface-500" />
              <span className="min-w-0 flex-1 truncate text-surface-700 dark:text-surface-300">
                {file.name}
              </span>
              <span className="shrink-0 text-xs text-surface-500">
                {file.size >= 1024 * 1024
                  ? `${(file.size / 1024 / 1024).toFixed(1)} MB`
                  : `${(file.size / 1024).toFixed(0)} KB`}
              </span>
              <button
                onClick={() => setPendingFiles((prev) => prev.filter((_, i) => i !== idx))}
                className="shrink-0 text-surface-500 hover:text-surface-600"
                title="Entfernen"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Formatting toolbar — only visible when focused or text present */}
      <div className={clsx('mb-2 flex items-center gap-0.5', !focused && !text && pendingFiles.length === 0 && 'hidden')}>
        {FORMAT_BUTTONS.map((btn) => (
          <button
            key={btn.label}
            type="button"
            title={btn.label}
            onMouseDown={(e) => { e.preventDefault(); applyFormat(btn); }}
            className="rounded p-1.5 text-surface-500 hover:bg-surface-200 hover:text-surface-700 dark:hover:bg-surface-800 dark:hover:text-surface-300"
          >
            {btn.icon}
          </button>
        ))}
        <div className="ml-auto shrink-0 whitespace-nowrap text-xs text-surface-600 dark:text-surface-400">
          <kbd className="rounded bg-surface-100 px-1.5 py-0.5 font-mono text-[11px] dark:bg-surface-800">Enter</kbd> Senden{' · '}
          <kbd className="rounded bg-surface-100 px-1.5 py-0.5 font-mono text-[11px] dark:bg-surface-800">Shift+Enter</kbd> Neue Zeile
        </div>
      </div>

      {/* Input area */}
      <div className={clsx(
        'relative flex items-end gap-2 rounded-xl border bg-surface-50 px-3 py-1.5 transition',
        'border-surface-200 focus-within:border-primary-400 focus-within:ring-2 focus-within:ring-primary-500/20',
        'dark:border-surface-600 dark:bg-surface-800',
      )}>
        {/* File attach / poll dropdown */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={onFilesChange}
        />
        <div ref={attachMenuRef} className="relative shrink-0">
          <button
            type="button"
            title="Anhang"
            onClick={() => setShowAttachMenu((v) => !v)}
            className="rounded-lg p-1.5 text-surface-500 hover:bg-surface-200 hover:text-surface-600 dark:hover:bg-surface-700"
          >
            <Paperclip size={18} />
          </button>
          {showAttachMenu && (
            <div className="absolute bottom-10 left-0 z-50 min-w-[180px] overflow-hidden rounded-xl border border-surface-200 bg-white shadow-lg dark:border-surface-700 dark:bg-surface-800">
              <button
                type="button"
                onClick={() => { setShowAttachMenu(false); fileInputRef.current?.click(); }}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-surface-700 hover:bg-surface-50 dark:text-surface-200 dark:hover:bg-surface-700"
              >
                <Paperclip size={15} className="text-surface-500" />
                Datei(en) anhängen
              </button>
              {onCreatePoll && (
                <button
                  type="button"
                  onClick={() => { setShowAttachMenu(false); onCreatePoll(); }}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-surface-700 hover:bg-surface-50 dark:text-surface-200 dark:hover:bg-surface-700"
                >
                  <BarChart3 size={15} className="text-primary-500" />
                  Umfrage erstellen
                </button>
              )}
              {onCreateEvent && (
                <button
                  type="button"
                  onClick={() => { setShowAttachMenu(false); onCreateEvent(); }}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-surface-700 hover:bg-surface-50 dark:text-surface-200 dark:hover:bg-surface-700"
                >
                  <CalendarPlus size={15} className="text-green-500" />
                  Neuer Termin
                </button>
              )}
            </div>
          )}
        </div>

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onPaste={(e) => {
            const items = e.clipboardData?.items;
            if (!items) return;
            for (const item of items) {
              if (item.type.startsWith('image/')) {
                e.preventDefault();
                const blob = item.getAsFile();
                if (blob) {
                  const ext = item.type.split('/')[1] || 'png';
                  const file = new File([blob], `Eingefügtes Bild.${ext}`, { type: item.type });
                  setPendingFiles([file]);
                }
                return;
              }
            }
          }}
          placeholder={pendingFiles.length > 0 ? 'Optionale Nachricht zu den Dateien...' : replyTo ? 'Antwort schreiben...' : `Nachricht an ${chatName}...`}
          rows={1}
          className="max-h-[200px] flex-1 resize-none bg-transparent font-mono text-sm text-surface-900 outline-none placeholder:font-sans placeholder:text-surface-500 dark:text-white"
        />

        {/* Emoji picker toggle */}
        <div ref={emojiRef} className="relative shrink-0">
          <button
            type="button"
            title="Emoji"
            onClick={() => setShowEmoji((v) => !v)}
            className="rounded-lg p-1.5 text-surface-500 hover:bg-surface-200 hover:text-surface-600 dark:hover:bg-surface-700"
          >
            😊
          </button>
          {showEmoji && (
            <div className="absolute bottom-10 right-0 z-50">
              <EmojiPicker
                onEmojiClick={onEmojiClick}
                theme={theme === 'dark' ? Theme.DARK : Theme.LIGHT}
                lazyLoadEmojis
                searchPlaceholder="Emoji suchen..."
              />
            </div>
          )}
        </div>

        <button
          onClick={handleSend}
          disabled={!canSend}
          title="Senden"
          className="shrink-0 rounded-lg bg-ci-red-500 p-1.5 text-white transition hover:bg-ci-red-600 disabled:opacity-40"
        >
          {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
        </button>
      </div>
    </div>
  );
}
