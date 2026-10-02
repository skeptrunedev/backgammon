import { IS_NATIVE } from '../lib/api';
import { postToNativeHost } from '../lib/nativeHost';

export function downloadText(filename: string, text: string) {
  // WebViews can't save anchor/blob downloads; the native shell shows the share sheet.
  if (IS_NATIVE && postToNativeHost({ type: 'shareFile', filename, mimeType: 'text/plain', text })) {
    return;
  }
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(url);
  a.remove();
}

export function matFilename(startedAt: number): string {
  const d = new Date(startedAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `backgammon-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.mat`;
}
