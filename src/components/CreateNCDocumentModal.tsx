import { useState, useEffect, useCallback } from 'react';
import {
  X, FileText, Table2, Presentation, FolderOpen, ChevronRight, Home,
  Loader2, Search, CheckCircle, AlertCircle, ExternalLink,
} from 'lucide-react';
import * as api from '../api';
import { DOCX_TEMPLATE, XLSX_TEMPLATE, PPTX_TEMPLATE } from '../utils/documentTemplates';
import { clsx } from 'clsx';
import type { Channel, Conversation } from '../types';

interface Crumb {
  id: string | null;
  name: string;
}

interface CreateNCDocumentModalProps {
  chatId: string;
  chatType: 'channel' | 'conversation';
  onClose: () => void;
  onCreated: (filePath: string, fileName: string) => void;
}

type OfficeType = 'docx' | 'xlsx' | 'pptx';
type ShareMode = 'none' | 'link' | 'attach' | 'both';

const OFFICE_TYPES: { type: OfficeType; label: string; icon: React.FC<{ size: number; className?: string }>; defaultName: string }[] = [
  { type: 'docx', label: 'Dokument', icon: FileText, defaultName: 'Neues Dokument' },
  { type: 'xlsx', label: 'Tabelle', icon: Table2, defaultName: 'Neue Tabelle' },
  { type: 'pptx', label: 'Präsentation', icon: Presentation, defaultName: 'Neue Präsentation' },
];

const MimeByType: Record<OfficeType, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

const TemplateByType: Record<OfficeType, string> = {
  docx: DOCX_TEMPLATE,
  xlsx: XLSX_TEMPLATE,
  pptx: PPTX_TEMPLATE,
};

interface ChatOption {
  type: 'channel' | 'conversation';
  id: string;
  name: string;
}

export default function CreateNCDocumentModal({ onClose, onCreated }: CreateNCDocumentModalProps) {
  const [officeType, setOfficeType] = useState<OfficeType>('docx');
  const [fileName, setFileName] = useState('Neues Dokument');

  // Folder picker state
  const [crumbs, setCrumbs] = useState<Crumb[]>([{ id: null, name: 'Alle Dateien' }]);
  const [currentEntries, setCurrentEntries] = useState<api.NCEntry[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);

  // Chat target state
  const [chatQuery, setChatQuery] = useState('');
  const [chatOptions, setChatOptions] = useState<ChatOption[]>([]);
  const [selectedChat, setSelectedChat] = useState<ChatOption | null>(null);
  const [loadingChats, setLoadingChats] = useState(true);
  const [shareMode, setShareMode] = useState<ShareMode>('link');

  // Share password
  const [sharePassword, setSharePassword] = useState(() => {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    let pw = '';
    for (let i = 0; i < 10; i++) pw += chars[Math.floor(Math.random() * chars.length)];
    return pw;
  });

  // Create state
  const [openInOO, setOpenInOO] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createdFilePath, setCreatedFilePath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentFolderPath = crumbs[crumbs.length - 1].id ?? '/';

  // Load folder contents
  const loadFolder = useCallback(async (path: string) => {
    setLoadingFolders(true);
    setFolderError(null);
    try {
      const entries = await api.ncList(path);
      setCurrentEntries(entries.filter(e => e.isFolder).sort((a, b) => a.name.localeCompare(b.name)));
    } catch (e) {
      setFolderError(e instanceof Error ? e.message : 'Ordner konnten nicht geladen werden');
    } finally {
      setLoadingFolders(false);
    }
  }, []);

  useEffect(() => {
    loadFolder(currentFolderPath);
  }, [currentFolderPath, loadFolder]);

  // Load chat targets
  useEffect(() => {
    async function loadChats() {
      try {
        const companies = await api.getCompanies();
        const companyId = companies[0]?.id ? String(companies[0].id) : '';
        const [channels, convs] = await Promise.all([
          companyId ? api.getChannels(companyId) : Promise.resolve([]),
          api.getConversations(),
        ]);
        const options: ChatOption[] = [
          ...channels.map((c: Channel) => ({ type: 'channel' as const, id: String(c.id), name: c.name ?? 'Unbenannter Kanal' })),
          ...convs.map((c: Conversation) => ({ type: 'conversation' as const, id: String(c.id), name: c.name ?? '' })),
        ];
        setChatOptions(options);
      } finally {
        setLoadingChats(false);
      }
    }
    loadChats();
  }, []);

  const navigateInto = (folder: api.NCEntry) => {
    setCrumbs(prev => [...prev, { id: folder.path, name: folder.name }]);
  };

  const navigateTo = (index: number) => {
    setCrumbs(prev => prev.slice(0, index + 1));
  };

  const filteredChats = chatOptions.filter(o =>
    o.name.toLowerCase().includes(chatQuery.toLowerCase())
  );

  const handleTypeChange = (type: OfficeType) => {
    setOfficeType(type);
    setFileName(OFFICE_TYPES.find(t => t.type === type)?.defaultName ?? '');
  };

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      // 1. Decode template to File object
      const template = TemplateByType[officeType];
      const binaryStr = atob(template);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

      const mime = MimeByType[officeType];
      const finalFileName = fileName.endsWith(`.${officeType}`) ? fileName : `${fileName}.${officeType}`;
      const file = new File([bytes], finalFileName, { type: mime });

      // 2. Upload to Nextcloud
      await api.ncUpload(currentFolderPath, file);

      const filePath = `${currentFolderPath}/${finalFileName}`.replace(/^\/+/, '/');

      setCreatedFilePath(filePath);

      // 3. Open in OnlyOffice
      if (openInOO) {
        await api.ncOpenInOnlyOffice(filePath, finalFileName);
      }

      // 4. Share to chat if selected
      if (selectedChat && shareMode !== 'none') {
        if (shareMode === 'link' || shareMode === 'both') {
          const share = await api.ncShare(filePath, sharePassword);
          const url = share.url ?? '';
          const passwordLine = sharePassword ? `\n🔑 ${sharePassword}` : '';
          await api.sendMessage(selectedChat.id, selectedChat.type, `📎 ${finalFileName}\n🔗 ${url}${passwordLine}`);
        }
        if (shareMode === 'attach' || shareMode === 'both') {
          await api.uploadFile(selectedChat.type, selectedChat.id, file);
        }
      }

      onCreated(filePath, finalFileName);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler beim Erstellen des Dokuments');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white dark:bg-surface-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-200 dark:border-surface-700 shrink-0">
          <h2 className="text-lg font-semibold text-surface-900 dark:text-white">
            Neues Dokument erstellen
          </h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors">
            <X size={18} className="text-surface-500" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* 1. Dokumenttyp */}
          <div>
            <label className="block text-sm font-medium text-surface-600 dark:text-surface-400 mb-2">
              Dokumenttyp
            </label>
            <div className="grid grid-cols-3 gap-3">
              {OFFICE_TYPES.map(({ type, label, icon: TypeIcon }) => (
                <button
                  key={type}
                  onClick={() => handleTypeChange(type)}
                  className={clsx(
                    'flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all',
                    officeType === type
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                      : 'border-surface-200 dark:border-surface-700 hover:border-surface-300 dark:hover:border-surface-600'
                  )}
                >
                  <TypeIcon size={28} className={officeType === type ? 'text-primary-500' : 'text-surface-500'} />
                  <span className={clsx('text-sm font-medium', officeType === type ? 'text-primary-600 dark:text-primary-400' : 'text-surface-600 dark:text-surface-400')}>
                    {label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* 2. Dateiname */}
          <div>
            <label className="block text-sm font-medium text-surface-600 dark:text-surface-400 mb-2">
              Dateiname
            </label>
            <input
              type="text"
              value={fileName}
              onChange={e => setFileName(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-surface-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="z.B. Neues Dokument"
            />
          </div>

          {/* 3. Ordner-Auswahl */}
          <div>
            <label className="block text-sm font-medium text-surface-600 dark:text-surface-400 mb-2">
              Ordner in Nextcloud
            </label>
            <div className="border border-surface-300 dark:border-surface-600 rounded-xl overflow-hidden">
              {/* Breadcrumb */}
              <div className="flex items-center gap-0.5 px-3 py-2 bg-surface-50 dark:bg-surface-700/50 border-b border-surface-200 dark:border-surface-700 text-sm overflow-x-auto">
                {crumbs.map((crumb, i) => (
                  <span key={i} className="flex items-center shrink-0">
                    {i > 0 && <ChevronRight size={11} className="text-surface-400 mx-0.5" />}
                    {i === crumbs.length - 1 ? (
                      <span className="flex items-center gap-1 text-primary-600 dark:text-primary-400 font-medium">
                        {i === 0 ? <Home size={13} /> : null}
                        {crumb.name}
                      </span>
                    ) : (
                      <button
                        onClick={() => navigateTo(i)}
                        className="text-surface-500 hover:text-surface-700 dark:hover:text-surface-300"
                      >
                        {crumb.name}
                      </button>
                    )}
                  </span>
                ))}
              </div>

              {/* Folder list */}
              <div className="max-h-48 overflow-y-auto p-2">
                {loadingFolders ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 size={20} className="animate-spin text-surface-400" />
                  </div>
                ) : folderError ? (
                  <div className="text-center py-4 text-red-500 text-sm">{folderError}</div>
                ) : currentEntries.length === 0 ? (
                  <div className="text-center py-4 text-surface-400 text-sm">Keine Unterordner</div>
                ) : (
                  <div className="grid grid-cols-2 gap-1">
                    {currentEntries.map(entry => (
                      <button
                        key={entry.path}
                        onClick={() => navigateInto(entry)}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-700 text-left"
                      >
                        <FolderOpen size={15} className="text-primary-500 shrink-0" />
                        <span className="text-sm text-surface-700 dark:text-surface-300 truncate">{entry.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 4. Im Chat teilen */}
          <div>
            <label className="block text-sm font-medium text-surface-600 dark:text-surface-400 mb-2">
              Im Chat teilen
            </label>

            {/* Share mode */}
            <div className="grid grid-cols-4 gap-2 mb-3">
              {([
                { value: 'none', label: 'Nicht' },
                { value: 'link', label: 'Nur Link' },
                { value: 'attach', label: 'Nur Datei' },
                { value: 'both', label: 'Beides' },
              ] as const).map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setShareMode(value)}
                  className={clsx(
                    'py-1.5 px-2 rounded-lg border text-xs font-medium transition-all',
                    shareMode === value
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400'
                      : 'border-surface-200 dark:border-surface-700 text-surface-500 hover:border-surface-300'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {shareMode !== 'none' && (
              <>
                {/* Chat search */}
                <div className="relative mb-2">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
                  <input
                    type="text"
                    value={chatQuery}
                    onChange={e => setChatQuery(e.target.value)}
                    placeholder="Chat suchen..."
                    className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-surface-900 dark:text-white text-sm focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </div>

                {/* Chat list */}
                <div className="border border-surface-300 dark:border-surface-600 rounded-xl max-h-32 overflow-y-auto">
                  {loadingChats ? (
                    <div className="flex items-center justify-center py-3">
                      <Loader2 size={16} className="animate-spin text-surface-400" />
                    </div>
                  ) : filteredChats.length === 0 ? (
                    <div className="text-center py-3 text-surface-400 text-xs">Keine Chats gefunden</div>
                  ) : (
                    filteredChats.map(opt => (
                      <button
                        key={opt.id}
                        onClick={() => setSelectedChat(opt)}
                        className={clsx(
                          'w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-surface-50 dark:hover:bg-surface-700',
                          selectedChat?.id === opt.id ? 'bg-primary-50 dark:bg-primary-900/20' : ''
                        )}
                      >
                        <div className={clsx('w-2 h-2 rounded-full shrink-0', opt.type === 'channel' ? 'bg-teal-500' : 'bg-primary-500')} />
                        <span className="text-sm text-surface-700 dark:text-surface-300 truncate">{opt.name}</span>
                        {selectedChat?.id === opt.id && <CheckCircle size={14} className="text-primary-500 ml-auto shrink-0" />}
                      </button>
                    ))
                  )}
                </div>

                {shareMode === 'link' || shareMode === 'both' ? (
                  <div className="mt-2">
                    <label className="block text-xs text-surface-500 dark:text-surface-400 mb-1">
                      Link-Passwort <span className="text-surface-400">(optional)</span>
                    </label>
                    <input
                      type="text"
                      value={sharePassword}
                      onChange={e => setSharePassword(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-surface-900 dark:text-white text-sm focus:outline-none focus:ring-1 focus:ring-primary-500"
                    />
                  </div>
                ) : null}
              </>
            )}
          </div>

          {/* 5. OnlyOffice öffnen */}
          <div className="flex items-center gap-3">
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={openInOO}
                onChange={e => setOpenInOO(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-surface-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary-300 rounded-full peer dark:bg-surface-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-surface-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-surface-600 peer-checked:bg-primary-500" />
            </label>
            <span className="text-sm text-surface-700 dark:text-surface-300">Dokument in OnlyOffice öffnen</span>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
              <AlertCircle size={16} className="shrink-0" />
              {error}
            </div>
          )}

          {/* Success hint */}
          {createdFilePath && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 text-sm">
              <CheckCircle size={16} className="shrink-0" />
              Dokument erstellt: {createdFilePath}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-surface-200 dark:border-surface-700 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-medium text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
          >
            Abbrechen
          </button>
          <button
            onClick={handleCreate}
            disabled={creating || !fileName.trim()}
            className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-medium text-white bg-primary-500 hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {creating ? <Loader2 size={16} className="animate-spin" /> : <ExternalLink size={15} />}
            {creating ? 'Erstelle...' : 'Erstellen & Teilen'}
          </button>
        </div>
      </div>
    </div>
  );
}
