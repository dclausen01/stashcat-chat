import { useState, useRef, useCallback, useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TiptapLink from '@tiptap/extension-link';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from 'tiptap-markdown';

function getMd(editor: Editor): string {
  return (editor.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown();
}
import {
  Send, Paperclip, Bold, Italic, Strikethrough, Code, List, ListOrdered,
  Heading2, Quote, Link as LinkIcon, ListTodo, Code2,
  X, Loader2, Reply, BarChart3, CalendarPlus, Presentation, FilePlus,
} from 'lucide-react';
import EmojiPicker, { type EmojiClickData, Theme } from 'emoji-picker-react';
import { clsx } from 'clsx';
import { useTheme } from '../context/ThemeContext';
import { useSettings } from '../context/SettingsContext';

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
  onCreateWhiteboard?: () => void;
  onCreateNCDocument?: () => void;
  droppedFiles?: File[];
  onDroppedFilesConsumed?: () => void;
}

interface FormatButton {
  icon: React.ReactNode;
  label: string;
  command: (editor: Editor) => void;
  isActive?: (editor: Editor) => boolean;
}

interface LinkDialogState {
  url: string;
  text: string;
  hasSelection: boolean;
}

export default function MessageInput({
  onSend, onUpload, onTyping, chatId, chatName,
  replyTo, onCancelReply, onCreatePoll, onCreateEvent, onCreateWhiteboard, onCreateNCDocument,
  droppedFiles, onDroppedFilesConsumed,
}: MessageInputProps) {
  const { theme } = useTheme();
  const { enterSendsMessage } = useSettings();

  const [sending, setSending] = useState(false);
  const [focused, setFocused] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [linkDialog, setLinkDialog] = useState<LinkDialogState | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const emojiRef = useRef<HTMLDivElement>(null);
  const linkUrlInputRef = useRef<HTMLInputElement>(null);
  const typingThrottle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftsRef = useRef<Map<string, string>>(new Map());
  const prevChatIdRef = useRef(chatId);

  // Refs read inside Tiptap extension — capture latest values without recreating the extension
  const enterSendsRef = useRef(enterSendsMessage);
  const handleSendRef = useRef<() => void>(() => {});
  const pendingFilesRef = useRef(pendingFiles);

  useEffect(() => { enterSendsRef.current = enterSendsMessage; }, [enterSendsMessage]);
  useEffect(() => { pendingFilesRef.current = pendingFiles; }, [pendingFiles]);

  // Dynamic placeholder — ref so the Placeholder extension reads the current value on each render
  const placeholderRef = useRef('');
  placeholderRef.current = pendingFiles.length > 0
    ? 'Optionale Nachricht zu den Dateien...'
    : replyTo
    ? 'Antwort schreiben...'
    : `Nachricht an ${chatName}...`;

  // Custom extension — created once on mount; reads from refs to avoid stale closures
  const EnterBehaviorExtension = useRef(
    Extension.create({
      name: 'enterBehavior',
      addKeyboardShortcuts() {
        return {
          Enter: ({ editor }) => {
            // Let list/codeBlock extensions manage Enter themselves
            if (
              editor.isActive('codeBlock') ||
              editor.isActive('bulletList') ||
              editor.isActive('orderedList') ||
              editor.isActive('taskList')
            ) return false;
            if (enterSendsRef.current) {
              handleSendRef.current();
              return true;
            }
            return false; // default: create new paragraph
          },
          'Shift-Enter': ({ editor }) => {
            if (editor.isActive('codeBlock')) return false;
            if (!enterSendsRef.current) {
              handleSendRef.current();
              return true;
            }
            return false; // default: HardBreak extension inserts <br>
          },
        };
      },
    })
  ).current;

  const editor = useEditor({
    extensions: [
      StarterKit,
      TiptapLink.configure({
        openOnClick: false,
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
      TaskList,
      TaskItem.configure({ nested: false }),
      Placeholder.configure({ placeholder: () => placeholderRef.current }),
      Markdown.configure({
        html: false,
        tightLists: true,
        linkify: true,
        breaks: false,
        transformPastedText: true,
      }),
      EnterBehaviorExtension,
    ],
    editorProps: {
      handlePaste: (_view, event) => {
        const items = event.clipboardData?.items;
        if (!items) return false;
        for (const item of items) {
          if (item.type.startsWith('image/')) {
            event.preventDefault();
            const blob = item.getAsFile();
            if (blob) {
              const ext = item.type.split('/')[1] || 'png';
              setPendingFiles([new File([blob], `Eingefügtes Bild.${ext}`, { type: item.type })]);
            }
            return true;
          }
        }
        return false;
      },
    },
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    onUpdate: ({ editor: ed }) => {
      // Keep draft in sync so chat-switch saves the latest content
      draftsRef.current.set(chatId, getMd(ed));
      if (onTyping && !typingThrottle.current) {
        onTyping();
        typingThrottle.current = setTimeout(() => { typingThrottle.current = null; }, 2000);
      }
    },
    onCreate: ({ editor: ed }) => {
      const saved = draftsRef.current.get(chatId) ?? '';
      if (saved) ed.commands.setContent(saved);
    },
  });

  const handleSend = useCallback(async () => {
    if (sending) return;
    const currentFiles = pendingFilesRef.current;
    if (currentFiles.length > 0) {
      setSending(true);
      const msgText = (editor ? getMd(editor) : '').trim();
      const filesToSend = [...currentFiles];
      let failCount = 0;
      for (let i = 0; i < filesToSend.length; i++) {
        try {
          const label = i === 0
            ? `${msgText} 1/${filesToSend.length}`.trim()
            : `${i + 1}/${filesToSend.length}`;
          await onUpload(filesToSend[i], label);
        } catch {
          failCount++;
        }
      }
      if (failCount > 0) {
        alert(failCount === 1
          ? '1 Datei konnte nicht hochgeladen werden.'
          : `${failCount} Dateien konnten nicht hochgeladen werden.`);
      }
      setPendingFiles([]);
      editor?.commands.clearContent();
      draftsRef.current.delete(chatId);
      setSending(false);
    } else {
      const md = (editor ? getMd(editor) : '').trim();
      if (!md) return;
      setSending(true);
      try {
        await onSend(md);
        editor?.commands.clearContent();
        draftsRef.current.delete(chatId);
      } finally {
        setSending(false);
      }
    }
  }, [sending, editor, onSend, onUpload, chatId]);

  // Keep handleSendRef current so the Tiptap extension always calls the latest version
  handleSendRef.current = handleSend;

  // Save/restore draft on chat switch
  useEffect(() => {
    if (!editor || prevChatIdRef.current === chatId) return;
    draftsRef.current.set(prevChatIdRef.current, getMd(editor));
    editor.commands.setContent(draftsRef.current.get(chatId) ?? '');
    prevChatIdRef.current = chatId;
  }, [chatId, editor]);

  // Focus editor when reply activates
  useEffect(() => {
    if (replyTo) editor?.commands.focus();
  }, [replyTo, editor]);

  // Consume files dropped from parent
  useEffect(() => {
    if (droppedFiles && droppedFiles.length > 0) {
      setPendingFiles((prev) => [...prev, ...droppedFiles]);
      onDroppedFilesConsumed?.();
      editor?.commands.focus();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [droppedFiles]);

  // Close attach menu on outside click
  useEffect(() => {
    if (!showAttachMenu) return;
    const handler = (e: MouseEvent) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node))
        setShowAttachMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showAttachMenu]);

  // Close emoji picker on outside click
  useEffect(() => {
    if (!showEmoji) return;
    const handler = (e: MouseEvent) => {
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node))
        setShowEmoji(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showEmoji]);

  // Focus URL input when link dialog opens
  useEffect(() => {
    if (linkDialog !== null) requestAnimationFrame(() => linkUrlInputRef.current?.focus());
  }, [linkDialog]);

  const onEmojiClick = useCallback((emojiData: EmojiClickData) => {
    editor?.chain().focus().insertContent(emojiData.emoji).run();
    setShowEmoji(false);
  }, [editor]);

  const onFilesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) setPendingFiles((prev) => [...prev, ...files]);
    e.target.value = '';
  };

  const openLinkDialog = useCallback(() => {
    if (!editor) return;
    const { from, to, empty } = editor.state.selection;
    const selectedText = empty ? '' : editor.state.doc.textBetween(from, to, '');
    setLinkDialog({
      url: editor.getAttributes('link').href ?? '',
      text: selectedText,
      hasSelection: !empty,
    });
  }, [editor]);

  const applyLink = useCallback(() => {
    if (!editor || !linkDialog) return;
    const url = linkDialog.url.trim();
    if (!url) {
      editor.chain().focus().unsetLink().run();
      setLinkDialog(null);
      return;
    }
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    if (linkDialog.hasSelection) {
      editor.chain().focus().setLink({ href }).run();
    } else {
      const displayText = linkDialog.text.trim() || href;
      editor.chain().focus().insertContent({
        type: 'text',
        marks: [{ type: 'link', attrs: { href } }],
        text: displayText,
      }).run();
    }
    setLinkDialog(null);
  }, [editor, linkDialog]);

  const FORMAT_BUTTONS: FormatButton[] = [
    {
      icon: <Bold size={15} />,
      label: 'Fett',
      command: (ed) => ed.chain().focus().toggleBold().run(),
      isActive: (ed) => ed.isActive('bold'),
    },
    {
      icon: <Italic size={15} />,
      label: 'Kursiv',
      command: (ed) => ed.chain().focus().toggleItalic().run(),
      isActive: (ed) => ed.isActive('italic'),
    },
    {
      icon: <Strikethrough size={15} />,
      label: 'Durchgestrichen',
      command: (ed) => ed.chain().focus().toggleStrike().run(),
      isActive: (ed) => ed.isActive('strike'),
    },
    {
      icon: <Code size={15} />,
      label: 'Code (inline)',
      command: (ed) => ed.chain().focus().toggleCode().run(),
      isActive: (ed) => ed.isActive('code'),
    },
    {
      icon: <LinkIcon size={15} />,
      label: 'Link',
      command: () => openLinkDialog(),
      isActive: (ed) => ed.isActive('link'),
    },
    {
      icon: <Heading2 size={15} />,
      label: 'Überschrift',
      command: (ed) => ed.chain().focus().toggleHeading({ level: 2 }).run(),
      isActive: (ed) => ed.isActive('heading', { level: 2 }),
    },
    {
      icon: <List size={15} />,
      label: 'Liste',
      command: (ed) => ed.chain().focus().toggleBulletList().run(),
      isActive: (ed) => ed.isActive('bulletList'),
    },
    {
      icon: <ListOrdered size={15} />,
      label: 'Nummerierte Liste',
      command: (ed) => ed.chain().focus().toggleOrderedList().run(),
      isActive: (ed) => ed.isActive('orderedList'),
    },
    {
      icon: <ListTodo size={15} />,
      label: 'Aufgabenliste',
      command: (ed) => ed.chain().focus().toggleTaskList().run(),
      isActive: (ed) => ed.isActive('taskList'),
    },
    {
      icon: <Quote size={15} />,
      label: 'Zitat',
      command: (ed) => ed.chain().focus().toggleBlockquote().run(),
      isActive: (ed) => ed.isActive('blockquote'),
    },
    {
      icon: <Code2 size={15} />,
      label: 'Codeblock',
      command: (ed) => ed.chain().focus().toggleCodeBlock().run(),
      isActive: (ed) => ed.isActive('codeBlock'),
    },
  ];

  const isEmpty = editor?.isEmpty ?? true;
  const canSend = !sending && (pendingFiles.length > 0 || !isEmpty);
  const toolbarVisible = focused || !isEmpty || pendingFiles.length > 0;

  return (
    <div className="shrink-0 border-t border-surface-200 p-3 dark:border-surface-700">
      {/* Reply preview */}
      {replyTo && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border-l-3 border-primary-500 bg-primary-50 px-3 py-2 text-sm dark:bg-primary-950/30">
          <Reply size={14} className="shrink-0 text-primary-500" />
          <div className="min-w-0 flex-1">
            <span className="text-xs font-semibold text-primary-700 dark:text-primary-400">
              {replyTo.sender
                ? `${replyTo.sender.first_name ?? ''} ${replyTo.sender.last_name ?? ''}`.trim()
                : 'Nachricht'}
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
              <span className="min-w-0 flex-1 truncate text-surface-700 dark:text-surface-300">{file.name}</span>
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

      {/* Formatting toolbar */}
      <div className={clsx('mb-2 flex flex-wrap items-center gap-0.5', !toolbarVisible && 'hidden')}>
        {FORMAT_BUTTONS.map((btn) => (
          <button
            key={btn.label}
            type="button"
            title={btn.label}
            onMouseDown={(e) => {
              e.preventDefault();
              if (editor) btn.command(editor);
            }}
            className={clsx(
              'flex min-h-[44px] min-w-[44px] items-center justify-center rounded p-1.5 text-surface-500 hover:bg-surface-200 hover:text-surface-700 dark:hover:bg-surface-800 dark:hover:text-surface-300 sm:min-h-7 sm:min-w-7',
              editor && btn.isActive?.(editor) && 'bg-surface-200 text-surface-800 dark:bg-surface-700 dark:text-surface-100',
            )}
          >
            {btn.icon}
          </button>
        ))}
        <div className="ml-auto shrink-0 whitespace-nowrap text-xs text-surface-600 dark:text-surface-400">
          {enterSendsMessage ? (
            <>
              <kbd className="rounded bg-surface-100 px-1.5 py-0.5 font-mono text-[11px] dark:bg-surface-800">Enter</kbd>{' '}Senden{' · '}
              <kbd className="rounded bg-surface-100 px-1.5 py-0.5 font-mono text-[11px] dark:bg-surface-800">Shift+Enter</kbd>{' '}Neue Zeile
            </>
          ) : (
            <>
              <kbd className="rounded bg-surface-100 px-1.5 py-0.5 font-mono text-[11px] dark:bg-surface-800">Shift+Enter</kbd>{' '}Senden{' · '}
              <kbd className="rounded bg-surface-100 px-1.5 py-0.5 font-mono text-[11px] dark:bg-surface-800">Enter</kbd>{' '}Neue Zeile
            </>
          )}
        </div>
      </div>

      {/* Link insertion dialog */}
      {linkDialog !== null && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-surface-200 bg-white px-3 py-2 shadow-sm dark:border-surface-700 dark:bg-surface-800">
          <input
            ref={linkUrlInputRef}
            type="url"
            placeholder="https://..."
            value={linkDialog.url}
            onChange={(e) => setLinkDialog((d) => d && { ...d, url: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); applyLink(); }
              if (e.key === 'Escape') setLinkDialog(null);
            }}
            className="min-w-0 flex-1 bg-transparent text-sm text-surface-900 outline-none placeholder:text-surface-400 dark:text-white"
          />
          {!linkDialog.hasSelection && (
            <input
              type="text"
              placeholder="Link-Text (optional)"
              value={linkDialog.text}
              onChange={(e) => setLinkDialog((d) => d && { ...d, text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); applyLink(); }
                if (e.key === 'Escape') setLinkDialog(null);
              }}
              className="min-w-0 flex-1 bg-transparent text-sm text-surface-900 outline-none placeholder:text-surface-400 dark:text-white"
            />
          )}
          <button
            onClick={applyLink}
            className="shrink-0 rounded-md bg-primary-600 px-3 py-1 text-xs font-medium text-white hover:bg-primary-700"
          >
            Einfügen
          </button>
          <button
            onClick={() => setLinkDialog(null)}
            className="shrink-0 rounded p-1 text-surface-500 hover:text-surface-700"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Input area */}
      <div className={clsx(
        'relative flex items-end gap-2 rounded-xl border bg-surface-50 px-3 py-1.5 transition',
        'border-surface-200 focus-within:border-primary-400 focus-within:ring-2 focus-within:ring-primary-500/20',
        'dark:border-surface-600 dark:bg-surface-800',
      )}>
        {/* Attach / poll / event dropdown */}
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={onFilesChange} />
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
            <div className="absolute bottom-10 left-0 z-50 min-w-[240px] whitespace-nowrap overflow-hidden rounded-xl border border-surface-200 bg-white shadow-lg dark:border-surface-700 dark:bg-surface-800">
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
              {onCreateWhiteboard && (
                <button
                  type="button"
                  onClick={() => { setShowAttachMenu(false); onCreateWhiteboard(); }}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-surface-700 hover:bg-surface-50 dark:text-surface-200 dark:hover:bg-surface-700"
                >
                  <Presentation size={15} className="text-purple-500" />
                  Kollaboratives Whiteboard erstellen
                </button>
              )}
              {onCreateNCDocument && (
                <button
                  type="button"
                  onClick={() => { setShowAttachMenu(false); onCreateNCDocument(); }}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-surface-700 hover:bg-surface-50 dark:text-surface-200 dark:hover:bg-surface-700"
                >
                  <FilePlus size={15} className="text-primary-500" />
                  Neues Dokument
                </button>
              )}
            </div>
          )}
        </div>

        {/* Tiptap WYSIWYG editor */}
        <div className="max-h-[200px] min-h-[1.5rem] flex-1 overflow-y-auto py-1">
          <EditorContent editor={editor} />
        </div>

        {/* Emoji picker — desktop only; on mobile, the OS keyboard provides emojis */}
        <div ref={emojiRef} className="relative hidden shrink-0 md:block">
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
          aria-label="Senden"
          className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lg bg-ci-red-500 p-1.5 text-white transition hover:bg-ci-red-600 disabled:opacity-40 sm:min-h-[34px] sm:min-w-[34px]"
        >
          {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
        </button>
      </div>
    </div>
  );
}
