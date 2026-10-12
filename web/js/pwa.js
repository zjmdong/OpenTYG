import { confirmDialog, toast } from './ui.js';

const DISMISSED_KEY = 'opentyg.pwa.dismissedAt';
const DISMISS_MS = 7 * 86400_000;
let deferredPrompt = null, installed = false, banner = null, ready = false, prompting = false, accepted = false;
const standalone = () => installed || window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const ios = () => /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const mobile = () => ios() || /Android/i.test(navigator.userAgent) || window.matchMedia('(max-width: 600px)').matches;
function dismissed() {
  try { const at = Number(localStorage.getItem(DISMISSED_KEY)); return at > 0 && Date.now() - at < DISMISS_MS; }
  catch { return false; }
}
function postpone() {
  try { localStorage.setItem(DISMISSED_KEY, String(Date.now())); } catch { /* optional preference */ }
  if (banner) banner.hidden = true;
}
export function pwaInstallLabel() { return standalone() ? '应用模式' : '添加到桌面'; }
function sync() {
  if (banner) {
    banner.hidden = standalone() || accepted || dismissed() || !navigator.onLine;
    banner.querySelector('[data-pwa-install]').textContent = deferredPrompt ? '安装' : '添加到桌面';
  }
  for (const node of document.querySelectorAll('[data-pwa-label]')) node.textContent = pwaInstallLabel();
}
export async function installApp() {
  if (prompting) return;
  if (standalone()) { toast('当前已在应用模式运行', 'info'); return; }
  if (!window.isSecureContext) {
    await confirmDialog({ title: '安装应用', message: '请使用本站 HTTPS 地址打开后再安装。', cancelText: '', okText: '知道了' }); return;
  }
  if (deferredPrompt) {
    const prompt = deferredPrompt; deferredPrompt = null; prompting = true; sync();
    try {
      // Invoke during the click's user activation; no asynchronous work before it.
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === 'accepted') { accepted = true; if (banner) banner.hidden = true; }
      else postpone();
    } catch { toast('请使用浏览器菜单中的“安装应用”或“添加到主屏幕”', 'info'); }
    finally { prompting = false; }
    return;
  }
  const message = ios()
    ? '点击浏览器“分享”，选择“添加到主屏幕”，再点击“添加”。若没有此选项，请使用 Safari 打开本站。'
    : '打开浏览器菜单，选择“安装应用”或“添加到主屏幕”。若没有此选项，请使用系统浏览器打开本站。';
  await confirmDialog({ title: '添加 OpenTYG 到手机', message, cancelText: '', okText: '知道了' });
}
export function initPwa() {
  if (ready) return; ready = true;
  const screen = document.querySelector('#app .screen');
  if (!screen) return;
  const connection = document.createElement('div');
  connection.className = 'pwa-connection'; connection.setAttribute('role', 'status');
  connection.textContent = '当前离线，无法登录、获取验证码或开门';
  connection.hidden = navigator.onLine; screen.prepend(connection);
  if (window.isSecureContext && mobile() && !standalone() && !dismissed()) {
    banner = document.createElement('section'); banner.className = 'pwa-banner';
    banner.setAttribute('aria-label', '安装 OpenTYG');
    banner.innerHTML = '<img src="/icons/icon-192.png" width="40" height="40" alt="">'
      + '<div class="pwa-banner__body"><div class="pwa-banner__title">安装 OpenTYG</div>'
      + '<p class="pwa-banner__text">添加到手机桌面，打开更方便</p>'
      + '<button type="button" class="btn btn--primary btn--sm pwa-banner__install" data-pwa-install>添加到桌面</button></div>'
      + '<button type="button" class="icon-btn pwa-banner__close" aria-label="暂不提示安装">×</button>';
    banner.querySelector('.pwa-banner__close').addEventListener('click', postpone);
    screen.prepend(banner);
  }
  document.addEventListener('click', event => {
    if (!event.target.closest?.('[data-pwa-install]')) return;
    installApp().catch(() => toast('安装提示暂不可用，请使用浏览器菜单', 'info'));
  });
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); deferredPrompt = event; accepted = false; sync();
  });
  window.addEventListener('appinstalled', () => { installed = true; deferredPrompt = null; sync(); });
  const online = () => { connection.hidden = navigator.onLine; sync(); };
  window.addEventListener('online', online); window.addEventListener('offline', online);
  window.matchMedia('(display-mode: standalone)').addEventListener?.('change', sync);
  sync();
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then(registration => {
        document.addEventListener('visibilitychange', () => {
          if (!document.hidden && navigator.onLine) registration.update().catch(() => {});
        });
      }).catch(() => { /* The site stays usable; browser installation can be retried later. */ });
  }
}
