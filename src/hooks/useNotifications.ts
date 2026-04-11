import { useCallback } from 'react';
import { useSettings } from '../context/SettingsContext';

/**
 * Hook that provides browser OS notification support.
 * - Shows notifications only when the tab is hidden and the setting is enabled
 * - Uses a tag to replace rapid successive notifications instead of stacking
 * - Permission is requested via the Settings panel toggle (user gesture required)
 */
export function useNotifications() {
  const { notificationsEnabled } = useSettings();

  const notify = useCallback((title: string, body: string) => {
    if (typeof Notification === 'undefined') return;
    if (!notificationsEnabled) return;
    if (!document.hidden) return;
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
