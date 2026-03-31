import { useCallback, useRef } from 'react';
import { useSettings } from '../context/SettingsContext';

/**
 * Hook that provides browser OS notification support.
 * - Requests permission when needed
 * - Shows notifications only when the tab is hidden and the setting is enabled
 * - Uses a tag to replace rapid successive notifications instead of stacking
 */
export function useNotifications() {
  const { notificationsEnabled } = useSettings();
  const permissionRequested = useRef(false);

  const requestPermission = useCallback(() => {
    if (
      typeof Notification !== 'undefined' &&
      Notification.permission === 'default' &&
      !permissionRequested.current
    ) {
      permissionRequested.current = true;
      Notification.requestPermission().catch(() => {});
    }
  }, []);

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

  return { notify, requestPermission };
}
