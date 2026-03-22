import { useState, useRef, useCallback, useEffect, type KeyboardEvent } from 'react';
import { Send, Paperclip, Bold, Italic, Strikethrough, Code, List, Heading2, X, Loader2 } from 'lucide-react';
import EmojiPicker, { type EmojiClickData, Theme } from 'emoji-picker-react';
import { clsx } from 'clsx';
import { useTheme } from '../context/ThemeContext';

interface MessageInputProps {
  onSend: (text: string) => Promise<void>;
  onUpload: (file: File, text: string) => Promise<void>;
  onTyping?: () => void;
  chatName: string;
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

export default function MessageInput({ onSend, onUpload, onTyping, chatName }: MessageInputProps) {
  const { theme } = useTheme();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const emojiRef = useRef<HTMLDivElement>(null);
  const typingThrottle = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close emoji picker on outside click
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
    setSending(true);
    try {
      if (pendingFile) {
        await onUpload(pendingFile, text.trim());
        setPendingFile(null);
        setText('');
      } else {
        const trimmed = text.trim();
        if (!trimmed) return;
        await onSend(trimmed);
        setText('');
      }
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
    } finally {
      setSending(false);
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

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setPendingFile(file);
    e.target.value = '';
  };

  const canSend = !sending && (pendingFile !== null || text.trim().length > 0);

  return (
    <div className="shrink-0 border-t border-surface-200 p-3 dark:border-surface-700">
      {/* Pending file preview */}
      {pendingFile && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-surface-100 px-3 py-2 text-sm dark:bg-surface-800">
          <Paperclip size={14} className="shrink-0 text-surface-400" />
          <span className="min-w-0 flex-1 truncate text-surface-700 dark:text-surface-300">{pendingFile.name}</span>
          <span className="shrink-0 text-xs text-surface-400">
            {(pendingFile.size / 1024).toFixed(0)} KB
          </span>
          <button onClick={() => setPendingFile(null)} className="shrink-0 text-surface-400 hover:text-surface-600">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Formatting toolbar */}
      <div className="mb-2 flex items-center gap-0.5">
        {FORMAT_BUTTONS.map((btn) => (
          <button
            key={btn.label}
            type="button"
            title={btn.label}
            onMouseDown={(e) => { e.preventDefault(); applyFormat(btn); }}
            className="rounded p-1.5 text-surface-400 hover:bg-surface-100 hover:text-surface-700 dark:hover:bg-surface-800 dark:hover:text-surface-300"
          >
            {btn.icon}
          </button>
        ))}
        <div className="ml-auto text-xs text-surface-400">
          <kbd className="rounded bg-surface-100 px-1 py-0.5 font-mono text-[10px] dark:bg-surface-800">Enter</kbd> Senden{' · '}
          <kbd className="rounded bg-surface-100 px-1 py-0.5 font-mono text-[10px] dark:bg-surface-800">⇧Enter</kbd> Neue Zeile
        </div>
      </div>

      {/* Input area */}
      <div className={clsx(
        'relative flex items-end gap-2 rounded-xl border bg-surface-50 px-3 py-2 transition',
        'border-surface-200 focus-within:border-primary-400 focus-within:ring-2 focus-within:ring-primary-500/20',
        'dark:border-surface-600 dark:bg-surface-800',
      )}>
        {/* File attach */}
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={onFileChange}
        />
        <button
          type="button"
          title="Datei anhängen"
          onClick={() => fileInputRef.current?.click()}
          className="shrink-0 rounded-lg p-1.5 text-surface-400 hover:bg-surface-200 hover:text-surface-600 dark:hover:bg-surface-700"
        >
          <Paperclip size={18} />
        </button>

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          placeholder={pendingFile ? 'Optionale Nachricht zur Datei...' : `Nachricht an ${chatName}...`}
          rows={1}
          className="max-h-[200px] flex-1 resize-none bg-transparent font-mono text-sm text-surface-900 outline-none placeholder:font-sans placeholder:text-surface-400 dark:text-white"
        />

        {/* Emoji picker toggle */}
        <div ref={emojiRef} className="relative shrink-0">
          <button
            type="button"
            title="Emoji"
            onClick={() => setShowEmoji((v) => !v)}
            className="rounded-lg p-1.5 text-surface-400 hover:bg-surface-200 hover:text-surface-600 dark:hover:bg-surface-700"
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
          className="shrink-0 rounded-lg bg-primary-600 p-1.5 text-white transition hover:bg-primary-700 disabled:opacity-40"
        >
          {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
        </button>
      </div>
    </div>
  );
}
