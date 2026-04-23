# Stashcat API: Unread- und Activity-Felder

**Datum:** 23.04.2026
**Kontext:** Untersuchung warum Channel-Badges nie angezeigt wurden

## Entdeckung

Die Stashcat-API liefert Unread-Counts und Activity-Timestamps in anderen Feldern als vom `stashcat-api` TypeScript-Typ deklariert.

## Unread-Count

| Feld | Typ | Wert | Verwendung |
|------|-----|------|------------|
| `unread` | `number` (top-level) | **Tatsächliche Unread-Anzahl** | ✅ Verwenden |
| `unread_count` | `number` (top-level) | **Immer 0** | ❌ Nicht verwenden |

Beispiel:
```json
{
  "unread": 4,
  "unread_count": 0
}
```

Gilt für **Channels und Conversations** gleichermaßen.

## lastActivity

| Typ | Feld | Verfügbarkeit |
|-----|------|--------------|
| **Channel** | `last_action` / `last_activity` (String) | ✅ Immer befüllt |
| **Channel** | `last_message.time` | ❌ Nicht zuverlässig |
| **Conversation** | `last_action` / `last_activity` | ✅ Immer befüllt |

Beispiel Channel:
```json
{
  "last_action": "1776939286",
  "last_activity": "1776939286",
  "last_message": null
}
```

## Weitere relevante Felder

| Feld | Ort | Beschreibung |
|------|-----|-------------|
| `membership.is_marked_as_unread` | `membership`-Sub-Objekt | Manuell als ungelesen markiert (derzeit immer `false` beobachtet) |
| `muted` | top-level | `null` oder `"2147483647"` (stummgeschaltet) |
| `favorite` | top-level | `true`/`false` für Favoriten-Sortierung |

## Typ-Problem im stashcat-api-Paket

Die TypeScript-Typen in `stashcat-api` deklarieren `unread_count` aber nicht `unread` (top-level), und `last_message` aber nicht `last_action`/`last_activity` für Channels. Die Felder müssen daher per `(ch as any).unread` zugegriffen werden, bis die Typen aktualisiert sind.

## Siehe auch

- `docs/2026-04-22 Unread-Signale-Fix.md` — Fix-Dokumentation
