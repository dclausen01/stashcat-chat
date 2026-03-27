# Channel-Dropdown Feature — Design Spec

## Überblick

Ein ⋮ (Drei-Punkte) Dropdown im Chat-Header für Manager, das schnellen Zugriff auf Channel-Management-Funktionen bietet.

## Placement

- **Ort:** Chat-Header, rechts neben dem Channel-Namen bzw. Video-Call-Button
- **Sichtbarkeit:** Nur für Manager (`isManager === true`)
- **Toggle:** `MoreVertical` Icon (lucide-react) — 24px, hover:bg-surface-100/dark:hover:bg-surface-800

## Dropdown-Menü (4 Items)

| Item | Icon | Farbe | Aktion |
|------|------|--------|--------|
| Channel-Mitglieder | `Users` | default | Öffnet `ChannelMembersPanel` |
| Beschreibung bearbeiten | `Pencil` | default | Öffnet `ChannelDescriptionEditor` |
| Als Markdown exportieren | `Download` | default | Triggert `.md`-Download |
| Channel löschen | `Trash2` | `text-red-500` | Öffnet Lösch-Bestätigungsdialog |

## Lösch-Bestätigungsdialog

- **Art:** Modal-Overlay (zentriert, `bg-black/60`)
- **Layout:** Icon (Trash2, 48px, rot), Titel, Warntext, zwei Buttons
- **Anti-Unfall-Schutz:** "Löschen"-Button startet einen 3-Sekunden-Countdown. Nach Ablauf wird er aktiv und der Text wechselt zu "Jet löschen".
- **API:** `DELETE /api/channels/:channelId`

## Markdown-Export

### Format

```markdown
# Channel-Name

*Exportiert am DD.MM.YYYY von hh:mm bis hh:mm*

---

### DD.MM.YYYY

**[hh:mm] Autor Name**
Nachrichtentext

> @VorherigerAutor Vorherige Nachricht (Reply-Zitat)

Reactions: 👍 3 | ❤️ 1

---

*[Systemnachricht: Benutzer ist dem Channel beigetreten]*
```

### Regeln
- Messages chronologisch sortiert
- Tages-Trenner nur zwischen verschiedenen Tagen
- Replies werden als `> @Autor Text` Blockquotes dargestellt
- Reactions als `Reactions: 👍 3 | ❤️ 1` am Ende der Nachricht
- Systemnachrichten (joined/left/removed) als kursiver Footer-Block zwischen Tagen
- Dateianhänge als `[📎 Dateiname](Download-URL)` angehängt

### Implementierung
- `GET /api/messages/:type/:targetId` mit `limit=9999` (alle Nachrichten laden)
- Client-seitiges Formatieren in Markdown-String
- `Blob` + `URL.createObjectURL` für Download
- Dateiname: `{channel-name}-{datum}.md`

## Komponenten

- `ChannelDropdownMenu.tsx` — Dropdown + DeleteConfirmModal (alles in einer Datei, da eng verwandt)
- Export-Funktion `exportChatAsMarkdown()` in `src/utils/` oder inline

## Technische Hinweise

- Bestehende `ChannelMembersPanel` und `ChannelDescriptionEditor` werden weitergenutzt (keine Duplikation)
- `ChatView` bekommt eine neue State-Variable `dropdownOpen` und rendered das `ChannelDropdownMenu`
- Keine Backend-Änderungen nötig außer dem DELETE-Endpoint (der existiert bereits)
