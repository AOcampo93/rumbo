import { notificationsNeedInstall, supports } from './platform.ts';

// Local notifications (PROJECT_PLAN §10.5): shown only while the app is in
// the background, through the service worker when there is one.

export type NotificationStatus = 'granted' | 'denied' | 'default' | 'unsupported';

export function notificationStatus(): NotificationStatus {
  if (!supports.notifications() || notificationsNeedInstall()) return 'unsupported';
  return Notification.permission;
}

export async function requestNotifications(): Promise<NotificationStatus> {
  if (notificationStatus() === 'unsupported') return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return notificationStatus();
  }
}

export interface LocalNotification {
  title: string;
  body: string;
  tag: string;
  url?: string;
}

/** Shows a notification if allowed and the page is hidden; true if shown. */
export async function showLocalNotification(notification: LocalNotification): Promise<boolean> {
  if (notificationStatus() !== 'granted' || document.visibilityState === 'visible') return false;
  const options: NotificationOptions = {
    body: notification.body,
    tag: notification.tag,
    icon: '/favicon.svg',
    data: { url: notification.url ?? '/run' },
  };
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) {
      await registration.showNotification(notification.title, options);
      return true;
    }
    const shown = new Notification(notification.title, options);
    shown.onclick = () => {
      globalThis.focus();
      if (notification.url) globalThis.location.assign(notification.url);
    };
    return true;
  } catch {
    return false;
  }
}
