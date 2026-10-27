export function sceneFilename(name: string, now = new Date()): string {
  const safe = name.normalize('NFC').trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, '-').replace(/^[. -]+|[. -]+$/g, '').slice(0, 120);
  return `${safe || `fieldlab-${now.toISOString().replace(/[:.]/g, '-')}`}.fieldlab.json`;
}

export function downloadText(data: string, filename: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
