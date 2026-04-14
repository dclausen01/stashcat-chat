# SSE-Handler-Stabilität: Signalisierungsausfall-Fix

**Datum:** 13.04.2026
**Betroffene Dateien:** `src/hooks/useRealtimeEvents.ts`, `src/components/Sidebar.tsx`, `src/components/ChatView.tsx`

## Problem

Nachrichten kommen im ChatView an (SSE funktioniert), aber die **Signalisierung** für den Benutzer funktioniert nicht zuverlässig:

- **Sidebar unread counter** zählt nicht hoch
- **Title Badge** `(X) BBZ Chat` aktualisiert nicht
- **OS Notifications** werden nicht angezeigt
- Der 3-Minuten-Sync in der Sidebar holt es irgendwann nach, aber dazwischen ist der User im Ungewissen

## Ursachenanalyse

### 🔴 1. Handler-Replacement-Race-Condition in `updateConsumerHandlers`

**Datei:** `src/hooks/useRealtimeEvents.ts`

Der Handler-Swap in `updateConsumerHandlers` hatte eine **Lücke**:

```js
// Vorher (problematisch)
// Phase 1: Alten Handler löschen
handlerSet.delete(existingHandler);  // ← JETZT ist das Set leer!
// ← SSE Event kommt an → niemand behandelt es!
// Phase 2: Neuen Handler hinzufügen
handlerSet.add(newHandler);
```

Zwischen `delete` und `add` konnte ein SSE-Event eintreffen und **verloren gehen**. Da sowohl Sidebar als auch ChatView bei jedem Render neue Handler-Funktionen erzeugen (inline Arrow Functions), passierte dieser Swap sehr häufig — bei **jedem Re-Render**.

### 🟠 2. Inline Handler-Funktionen in Sidebar und ChatView

**Dateien:** `src/components/Sidebar.tsx`, `src/components/ChatView.tsx`

Beide Komponenten definierten ihre `useRealtimeEvents`-Handler **inline**:

```tsx
// Problematisch: neue Function-Ref bei JEDEM Render
useRealtimeEvents({
  message_sync: (data) => { ... },  // ← neue Referenz!
  reconnect: () => { ... },
}, true);
```

Der Hook hat einen **dependency-losen useEffect**, der bei **jedem Render** `updateConsumerHandlers` aufruft:

```js
useEffect(() => {
  if (!consumerIdRef.current) return;
  updateConsumerHandlers(consumerIdRef.current, handlersRef.current);
}); // ← keine deps → feuert bei JEDEM Render
```

**Folge:** Bei jedem Re-Render (Chat-Wechsel, Unread-Count-Update, sortChats, etc.) wurden die Handler ersetzt → Race-Condition-Fenster öffnete sich.

## Durchgeführte Änderungen

### Fix 1: `updateConsumerHandlers` — Atomarer Handler-Swap

**Prinzip:** Neuen Handler **zuerst** hinzufügen, dann alten entfernen. Kein Gap mehr.

```js
// Phase 1: Neue Handler ZUERST hinzufügen (kein Gap)
for (const [eventName, newHandler] of Object.entries(newHandlers)) {
  sharedHandlers.get(eventName)!.add(newHandler);  // ← zuerst add
  oldHandlers.set(eventName, newHandler);
}

// Phase 2: Alte Handler DANACH entfernen
for (const eventName of toRemove) {
  handlerSet.delete(oldHandler);  // ← erst jetzt delete
}
```

### Fix 2: Sidebar handler stabilisieren

Handler in `useCallback` gewrapped — nur `user?.id` und `notify` als Dependencies:

```tsx
const handleMessageSync = useCallback((data: unknown) => {
  // ... same logic, aber stable ref ...
}, [user?.id, notify]);

const handleReconnect = useCallback(() => {
  loadData();
}, []);

const handleStatusChange = useCallback((data: unknown) => {
  // ... stable ref ...
}, []);

useRealtimeEvents({
  message_sync: handleMessageSync,
  reconnect: handleReconnect,
  online_status_change: handleStatusChange,
}, loggedIn);
```

### Fix 3: ChatView handler stabilisieren

Gleiches Pattern:

```tsx
const handleMessageSync = useCallback((data: unknown) => {
  // ... same logic ...
}, []); // empty deps — nutzt refs für chatRef, containerRef, etc.

const handleTypingEvent = useCallback((data: unknown) => {
  // ... stable ref ...
}, [userId]);

const handleReconnect = useCallback(() => {
  silentRefreshRef.current();
}, []); // nutzt ref, keine deps nötig

useRealtimeEvents({
  message_sync: handleMessageSync,
  typing: handleTypingEvent,
  reconnect: handleReconnect,
}, true);
```

## Zusammenfassung

| # | Problem | Lösung |
|---|---------|--------|
| 1 | Handler-Swap hatte Gap (delete → add) | Atomar: add → delete |
| 2 | Inline Handler → Swap bei jedem Render | `useCallback` für stable refs |
| 3 | ChatView gleiche Problematik | `useCallback` für stable refs |

## Verifikation

- ✅ TypeScript-Type-Check (`tsc -b --noEmit`) ohne Fehler durchgelaufen
- ✅ Keine neuen Dependencies eingeführt
- ✅ Bestehende Architektur beibehalten (Multi-Consumer Registry)
