export interface StorageQuotaSnapshot {
  usage: number;
  quota: number;
  percent: number;
}

export async function getStorageQuota(): Promise<StorageQuotaSnapshot> {
  const estimate = await navigator.storage?.estimate?.();
  const usage = estimate?.usage ?? 0;
  const quota = estimate?.quota ?? 0;
  return { usage, quota, percent: quota ? Math.round((usage / quota) * 100) : 0 };
}

export async function clearCachedScans() {
  const names = await caches.keys();
  await Promise.all(
    names.filter((name) => /scan|image|asset/i.test(name) && !/outbox|draft/i.test(name)).map((name) => caches.delete(name)),
  );
  for (const key of Object.keys(localStorage)) {
    if (/scan|image|asset|cache/i.test(key) && !/outbox|draft/i.test(key)) localStorage.removeItem(key);
  }
}
