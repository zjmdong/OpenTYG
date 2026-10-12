const retry = document.getElementById('offline-retry');
retry?.addEventListener('click', () => location.reload());
// Reconnect only the page, never a queued login, SMS or door command.
window.addEventListener('online', () => location.reload());
