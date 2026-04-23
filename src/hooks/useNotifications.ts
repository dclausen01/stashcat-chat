import { useCallback } from 'react';
import { useSettings } from '../context/SettingsContext';

/**
 * Hook that provides browser OS notification support.
 * - Shows notifications whenever the setting is enabled (tab visibility is not checked)
 * - Uses a shared tag so rapid successive notifications replace each other instead of stacking
 * - Permission is requested via the Settings panel toggle (user gesture required)
 */
export function useNotifications() {
  const { notificationsEnabled } = useSettings();

  const notify = useCallback((title: string, body: string) => {
    if (typeof Notification === 'undefined') return;
    if (!notificationsEnabled) return;
    if (Notification.permission !== 'granted') return;

    const notification = new Notification(title, {
      body,
      icon: '/bbz-logo-neu.png',
      tag: 'stashcat-msg',
    });

    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  }, [notificationsEnabled]);

  return { notify };
}
