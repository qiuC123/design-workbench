interface IdCrypto {
  randomUUID?: () => string;
  getRandomValues?: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>;
}

/** WebView / LAN HTTP may expose getRandomValues without randomUUID. */
export function createRecordId(prefix: string, source: IdCrypto | undefined = globalThis.crypto): string {
  if (typeof source?.randomUUID === 'function') return `${prefix}-${source.randomUUID()}`;
  if (typeof source?.getRandomValues !== 'function') {
    throw new Error('当前浏览器缺少安全随机数能力，无法保存新记录，请更新浏览器或客户端后重试');
  }

  const bytes = source.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${prefix}-${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
