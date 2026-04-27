import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from 'react';

type Politeness = 'polite' | 'assertive';

interface AnnounceFn {
  (message: string, politeness?: Politeness): void;
}

const AnnouncerContext = createContext<AnnounceFn | null>(null);

export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const [politeMsg, setPoliteMsg] = useState('');
  const [assertiveMsg, setAssertiveMsg] = useState('');
  const clearPoliteRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearAssertiveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const announce = useCallback<AnnounceFn>((message, politeness = 'polite') => {
    if (politeness === 'assertive') {
      setAssertiveMsg(message);
      if (clearAssertiveRef.current) clearTimeout(clearAssertiveRef.current);
      clearAssertiveRef.current = setTimeout(() => setAssertiveMsg(''), 1500);
    } else {
      setPoliteMsg(message);
      if (clearPoliteRef.current) clearTimeout(clearPoliteRef.current);
      clearPoliteRef.current = setTimeout(() => setPoliteMsg(''), 1500);
    }
  }, []);

  useEffect(() => () => {
    if (clearPoliteRef.current) clearTimeout(clearPoliteRef.current);
    if (clearAssertiveRef.current) clearTimeout(clearAssertiveRef.current);
  }, []);

  return (
    <AnnouncerContext.Provider value={announce}>
      {children}
      {/* Visually hidden live regions */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        style={{ position: 'absolute', left: '-10000px', width: '1px', height: '1px', overflow: 'hidden' }}
      >
        {politeMsg}
      </div>
      <div
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        className="sr-only"
        style={{ position: 'absolute', left: '-10000px', width: '1px', height: '1px', overflow: 'hidden' }}
      >
        {assertiveMsg}
      </div>
    </AnnouncerContext.Provider>
  );
}

export function useAnnouncer(): AnnounceFn {
  const fn = useContext(AnnouncerContext);
  if (!fn) throw new Error('useAnnouncer must be used within AnnouncerProvider');
  return fn;
}
