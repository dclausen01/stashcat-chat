export function fileIcon(mime?: string, ext?: string): string {
  const m = mime?.toLowerCase() ?? '';
  const e = ext?.toLowerCase() ?? '';

  if (m.startsWith('image/')) return '🖼️';
  if (m.startsWith('video/')) return '🎬';
  if (m.startsWith('audio/')) return '🎵';
  if (m.includes('pdf') || e === 'pdf') return '📄';
  if (m.includes('zip') || m.includes('tar') || m.includes('gzip') || ['zip','tar','gz','7z','rar'].includes(e)) return '🗜️';
  if (m.includes('word') || ['doc','docx'].includes(e)) return '📝';
  if (m.includes('excel') || m.includes('spreadsheet') || ['xls','xlsx','csv'].includes(e)) return '📊';
  if (m.includes('presentation') || ['ppt','pptx'].includes(e)) return '📋';
  if (m.includes('text') || ['txt','md','log'].includes(e)) return '📃';
  if (['js','ts','py','java','html','css','json','xml','sh'].includes(e)) return '💻';
  return '📎';
}
