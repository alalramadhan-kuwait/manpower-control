// Download or share a generated file: the device's own share sheet where it can share files, a download otherwise.
export function download(bytes: Uint8Array, name: string, type = 'application/pdf') {
  const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
export const canShareFiles = () => typeof navigator !== 'undefined' && typeof navigator.canShare === 'function' &&
  navigator.canShare({ files: [new File([new Uint8Array(1)], 'x.pdf', { type: 'application/pdf' })] });
/** true when shared, false when downloaded instead. */
export async function shareOrDownload(bytes: Uint8Array, name: string, title: string): Promise<boolean> {
  const file = new File([bytes as unknown as BlobPart], name, { type: 'application/pdf' });
  if (canShareFiles() && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title }); return true; } catch (e) { if ((e as Error).name === 'AbortError') return true; }
  }
  download(bytes, name); return false;
}
