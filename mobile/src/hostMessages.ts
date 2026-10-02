import { Dimensions, Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

// Messages the bundled PWA posts to the shell (see src/lib/nativeHost.ts in the
// PWA). Keep the two in sync.
type HostMessage = {
  type: 'shareFile';
  filename: string;
  mimeType: string;
  text: string;
};

function parse(data: string): HostMessage | null {
  try {
    const msg = JSON.parse(data) as Partial<HostMessage>;
    if (
      msg?.type === 'shareFile' &&
      typeof msg.filename === 'string' &&
      typeof msg.mimeType === 'string' &&
      typeof msg.text === 'string'
    ) {
      return msg as HostMessage;
    }
  } catch {
    /* not ours */
  }
  return null;
}

export async function handleHostMessage(data: string): Promise<void> {
  const msg = parse(data);
  if (!msg) return;
  // Exports like the .mat match file: write to cache, open the share sheet
  // (Save to Files, AirDrop, Drive...). A browser would download it instead.
  const safeName = msg.filename.replace(/[^\w.-]+/g, '_') || 'export.txt';
  const file = new File(Paths.cache, safeName);
  file.create({ overwrite: true });
  file.write(msg.text);
  const { width, height } = Dimensions.get('window');
  await Sharing.shareAsync(file.uri, {
    mimeType: msg.mimeType,
    UTI: 'public.plain-text',
    dialogTitle: safeName,
    // iPad presents the share sheet as a popover and needs an anchor.
    ...(Platform.OS === 'ios' ? { anchor: { x: width / 2, y: height / 2, width: 1, height: 1 } } : {}),
  });
}
