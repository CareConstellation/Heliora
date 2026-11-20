export type AppEventMap = {
  'appointment:booked': { appointmentId: string; doctorName: string; datetime: string };
};

const bus = typeof window === 'undefined' ? null : new EventTarget();

export function emitAppEvent<K extends keyof AppEventMap>(type: K, detail: AppEventMap[K]) {
  bus?.dispatchEvent(new CustomEvent(type, { detail }));
}

export function onAppEvent<K extends keyof AppEventMap>(type: K, listener: (detail: AppEventMap[K]) => void) {
  if (!bus) return () => undefined;
  const handler = (event: Event) => listener((event as CustomEvent<AppEventMap[K]>).detail);
  bus.addEventListener(type, handler);
  return () => bus.removeEventListener(type, handler);
}
