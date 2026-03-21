import { useState, useRef, type KeyboardEvent } from 'react';
import { Send, Paperclip, Smile } from 'lucide-react';

interface MessageInputProps {
  onSend: (text: string) => Promise<void>;
  chatName: string;
}

export default function MessageInput({ onSend, chatName }: MessageInputProps) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      await onSend(trimmed);
      setText('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
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
  };

  return (
    <div className="border-t border-surface-200 p-4 dark:border-surface-700">
      <div className="flex items-end gap-2 rounded-xl border border-surface-200 bg-surface-50 px-3 py-2 focus-within:border-primary-400 focus-within:ring-2 focus-within:ring-primary-500/20 dark:border-surface-600 dark:bg-surface-800">
        <button className="shrink-0 rounded-lg p-1.5 text-surface-400 hover:bg-surface-200 hover:text-surface-600 dark:hover:bg-surface-700">
          <Paperclip size={20} />
        </button>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          placeholder={`Nachricht an ${chatName}...`}
          rows={1}
          className="max-h-[200px] flex-1 resize-none bg-transparent text-sm text-surface-900 outline-none placeholder:text-surface-400 dark:text-white"
        />
        <button className="shrink-0 rounded-lg p-1.5 text-surface-400 hover:bg-surface-200 hover:text-surface-600 dark:hover:bg-surface-700">
          <Smile size={20} />
        </button>
        <button
          onClick={handleSend}
          disabled={!text.trim() || sending}
          className="shrink-0 rounded-lg bg-primary-600 p-1.5 text-white transition hover:bg-primary-700 disabled:opacity-40 disabled:hover:bg-primary-600"
        >
          <Send size={20} />
        </button>
      </div>
      <div className="mt-1 text-xs text-surface-400">
        <kbd className="rounded bg-surface-200 px-1 py-0.5 font-mono dark:bg-surface-700">Enter</kbd> zum Senden,{' '}
        <kbd className="rounded bg-surface-200 px-1 py-0.5 font-mono dark:bg-surface-700">Shift+Enter</kbd> für neue Zeile
      </div>
    </div>
  );
}
