# Dateibrowser-Verbesserungen - Design Spec

**Datum:** 2026-03-28
**Status:** Draft

## Übersicht

Drei Verbesserungen am Dateibrowser:
1. Sortierung nach Name, Datum, Größe in der Listenansicht
2. Persistenz von Einstellungen im SettingsContext
3. Ordner-Upload mit Progress-Bar und automatischer Ordnererstellung

## Architektur

**Ansatz:** Extrahierte Hooks & Komponenten (Ansatz B)

```
src/
├── hooks/
│   └── useFileSorting.ts        # Sortierlogik (neu)
├── components/
│   ├── FileBrowserPanel.tsx     # Hauptkomponente (angepasst)
│   └── FolderUploadProgress.tsx # Progress-Anzeige (neu)
└── context/
    └── SettingsContext.tsx      # Persistenz erweitern (angepasst)

stashcat-api/
└── src/files/
    └── files.ts                 # createFolder() hinzufügen (angepasst)

server/
└── index.ts                     # /api/files/folder/create Endpoint (angepasst)
```

---

## Feature 1: Sortierung

### UI

- Spaltenköpfe in der `ListView` werden klickbar
- Klick toggelt zwischen: aufsteigend → absteigend → Default
- Aktive Sortierung zeigt Pfeil-Icon (↑/↓)
- Sortierung gilt für Dateien und Ordner getrennt

### useFileSorting Hook

```typescript
type SortField = 'name' | 'date' | 'size';
type SortDirection = 'asc' | 'desc' | null;

interface UseFileSorting {
  sortField: SortField;
  sortDirection: SortDirection;
  setSort: (field: SortField) => void;
  sortedFolders: FolderEntry[];
  sortedFiles: FileEntry[];
}

function useFileSorting(folders: FolderEntry[], files: FileEntry[]): UseFileSorting;
```

### Sortierlogik

| Feld  | Ordner          | Dateien          |
|-------|-----------------|------------------|
| name  | `name.localeCompare()` | `name.localeCompare()` |
| date  | `created`       | `uploaded`       |
| size  | `size_byte`     | `size_byte`      |

### UI-Integration

- Klick auf Spaltenkopf in ListView: Name, Datum, Größe
- Pfeil-Icon zeigt aktuelle Richtung
- Grid-View: Keine Sortier-UI (visuelle Ansicht ohne Spalten)

---

## Feature 2: Einstellungen persistieren

### Neue Settings

```typescript
interface Settings {
  // Bestehend
  showImagesInline: boolean;
  bubbleView: boolean;
  ownBubbleColor: string;
  otherBubbleColor: string;
  homeView: 'info' | 'cards';

  // Neu
  fileBrowserViewMode: 'grid' | 'list';
  fileBrowserTab: 'context' | 'personal';
}
```

### Integration

- `FileBrowserPanel` nutzt `useSettings()` statt lokalem State für `viewMode` und `tab`
- Automatische Persistenz über localStorage (Key: `schulchat_settings`)

---

## Feature 3: Ordner-Upload

### Voraussetzung: createFolder API

**Endpunkt:** `POST /folder/create`

**Request-Parameter:**
```typescript
{
  folder_name: string,      // Name des neuen Ordners
  parent_id: string,        // '0' für Root, oder ID des Parent-Ordners
  type: 'channel' | 'conversation' | 'personal',
  type_id: string           // Channel/Conversation/User-ID
}
```

**Response:**
```typescript
{
  status: { value: 'OK' },
  payload: {
    folder_id: number,
    folder: {
      id: number,
      type: string,
      type_id: string,
      parent_id: string | null,
      name: string,
      permission: string,
      size_byte: number,
      created: number,      // Unix timestamp
      modified: number
    }
  }
}
```

**Implementation in stashcat-api:**
```typescript
async createFolder(name: string, parentId: string, type: string, typeId: string): Promise<FolderEntry>
```

### Upload-Flow

1. User dropped Ordner oder wählt via `webkitdirectory`
2. Dateien werden analysiert: Ordnerstruktur aus relativen Pfaden extrahieren
3. Für jeden eindeutigen Ordnerpfad:
   - API-Call `createFolder()`
   - Parent-ID merken für Unterordner
4. Dateien hochladen in korrekte Ordner
5. Progress-Bar zeigt Fortschritt

### Progress-Anzeige

```typescript
interface FolderUploadProgress {
  totalFiles: number;
  uploadedFiles: number;
  currentFile: string;
  status: 'uploading' | 'complete' | 'error';
  errors: { file: string; error: string }[];
}
```

**UI:** Modal oder Overlay mit:
- Progress-Bar (Balken mit Prozent)
- Aktuelle Datei
- Fehler-Liste am Ende

### Fehlerbehandlung

- Fehlerhafte Dateien werden übersprungen
- Am Ende Zusammenfassung mit Fehlern
- Kein Abbruch bei einzelnen Fehlern

### Mehrere Ordner

- Jeder gedroppte Ordner wird als separater Ordner am aktuellen Ort angelegt
- Unterordner werden rekursiv innerhalb erstellt

---

## Implementierungsreihenfolge

1. **API-Erweiterung** - `createFolder()` in stashcat-api + Server-Endpoint
2. **SettingsContext** - Neue Felder hinzufügen
3. **Sortierung** - Hook + UI-Integration
4. **Ordner-Upload** - Progress-Komponente + Upload-Logik
