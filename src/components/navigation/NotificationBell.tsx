'use client';

import { Bell } from 'lucide-react';
import { useNotifications } from '@/hooks/useNotifications';
import { useWalletStore } from '@/store/useWalletStore';
import { useToast } from '@/hooks/useToast';
import { type NotificationEvent } from '@/hooks/useNotifications';

export default function NotificationBell() {
  const { publicKey } = useWalletStore();
  const { toast } = useToast();

  const handleNotification = (event: NotificationEvent) => {
    const typeToKind = {
      access_request: 'info',
      appointment_confirmed: 'success',
      record_shared: 'info',
      queue_position_update: 'info',
      doctor_ready: 'success',
    } as const;
    toast(event.message, typeToKind[event.type] ?? 'info');
  };

  const { unreadCount, clearUnread } = useNotifications({
    address: publicKey,
    onNotification: handleNotification,
  });

  return (
    <button
      className="btn-icon rounded-[9px] relative"
      aria-label="Notifications"
      onClick={clearUnread}
    >
      <Bell className="w-4 h-4" />
      {unreadCount > 0 && (
        <span
          className="absolute -top-1 -right-1 min-w-[16px] h-4 flex items-center justify-center rounded-full text-[10px] font-bold text-white px-0.5"
          style={{ background: '#EF4444' }}
        >
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      )}
    </button>
  );
}
