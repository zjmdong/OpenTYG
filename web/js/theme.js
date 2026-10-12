/**
 * theme.js — 应用自己的主题（浅色 / 深色 / 跟随系统）
 *
 * 为什么需要它：手机浏览器的「强制深色」会自动反色，效果不可控（深色圆钮会被反成脏色）。
 * 应用自己声明 `color-scheme` 并按主题切换 CSS 令牌后，浏览器就不会再自作主张。
 *
 * 存储：localStorage（每台设备各自选择，更符合直觉；服务端不再保存主题）。
 * 首屏：index.html 的 <head> 内联脚本会在 CSS 之前应用一次，避免闪白/闪黑。
 */

const STORAGE_KEY = 'opentyg.theme';
export const THEMES = ['auto', 'light', 'dark'];

/** @returns {'auto'|'light'|'dark'} */
export function getTheme() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (THEMES.includes(saved)) return saved;
  } catch { /* 隐私模式等场景下 localStorage 不可用 */ }
  return 'auto';
}

/** 应用主题；auto 表示交给 CSS 的 prefers-color-scheme 决定 */
export function applyTheme(mode) {
  const root = document.documentElement;
  if (mode === 'light' || mode === 'dark') root.setAttribute('data-theme', mode);
  else root.removeAttribute('data-theme');
  // 地址栏配色：index.html 的两个带 media 的 theme-color 负责首屏与跟随系统；
  // 这里更新**不带 media** 的那个，用于用户手动切换主题（含与系统相反）的场景。
  const meta = document.querySelector('meta[name="theme-color"]:not([media])');
  if (meta) {
    const dark = mode === 'dark'
      || (mode === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    // 与 css/style.css 的 --chrome 保持一致（index.html 的 media 版 meta 同值）
    meta.setAttribute('content', dark ? '#0E1016' : '#EEF0F4');
  }
  return mode;
}

export function setTheme(mode) {
  const next = THEMES.includes(mode) ? mode : 'auto';
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* 忽略 */ }
  return applyTheme(next);
}

/** 当前实际生效的是深色还是浅色（用于展示与状态判断） */
export function isDarkActive() {
  const mode = getTheme();
  if (mode === 'dark') return true;
  if (mode === 'light') return false;
  return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

/** 启动时调用一次；系统主题变化时保持同步（仅 auto 模式需要） */
export function initTheme() {
  applyTheme(getTheme());
  if (!window.matchMedia) return;
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => { if (getTheme() === 'auto') applyTheme('auto'); };
  if (query.addEventListener) query.addEventListener('change', onChange);
  else if (query.addListener) query.addListener(onChange);
}

export const THEME_LABELS = { auto: '跟随系统', light: '浅色', dark: '深色' };
