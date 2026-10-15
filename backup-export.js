// Researcher tool: download every session record backed up on this device
// (localStorage keys written by backupLocally() in app.js) as one JSON file.
// Use at the end of each pilot day, or whenever the save dot was red.
function exportLocalBackups() {
  const records = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k.startsWith('sense_backup_')) continue;
    try { records.push(JSON.parse(localStorage.getItem(k))); } catch (_) {}
  }
  const status = document.getElementById('backup-status');
  if (!records.length) {
    if (status) status.textContent = '本机没有备份记录';
    return;
  }
  records.sort((a, b) => (a.sessionId - b.sessionId) || String(a.exportStage).localeCompare(b.exportStage));
  const blob = new Blob([JSON.stringify(records, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `sense-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  if (status) status.textContent = `已导出 ${records.length} 条记录`;
}
