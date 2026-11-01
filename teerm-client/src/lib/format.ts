const BINARY_UNITS = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];

/** Bytes as a short binary-unit string, e.g. `1.5 MiB`. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "—";
  }

  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BINARY_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }

  const digits = unit === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${BINARY_UNITS[unit]}`;
}

export function formatKiB(kib: number): string {
  return formatBytes(kib * 1024);
}

export function formatRate(bytesPerSecond: number | null): string {
  return bytesPerSecond === null ? "—" : `${formatBytes(bytesPerSecond)}/s`;
}

export function formatPercent(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "—" : `${Math.round(value)}%`;
}

/** Uptime such as `3d 4h` or `12m`. */
export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

/** Share of `total` that is `used`, as 0–100; 0 when there is no total. */
export function percentOf(used: number, total: number): number {
  return total > 0 ? Math.min(100, (used / total) * 100) : 0;
}
