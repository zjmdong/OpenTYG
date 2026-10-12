/**
 * router.js — hash 路由：#/login #/home #/doors #/profile
 *  - 未登录一律解析为 #/login（守卫）
 *  - 已登录访问 #/login 时回到 #/home
 *  - 页面模块契约：{ path, tabbar:boolean, render(ctx) => cleanup? }
 */

import { store } from './store.js';
import { closeAllOverlays, esc } from './ui.js';
import loginPage from './pages/login.js';
import homePage from './pages/home.js';
import doorsPage from './pages/doors.js';
import profilePage from './pages/profile.js';

const ROUTES = {
  '/login': loginPage,
  '/home': homePage,
  '/doors': doorsPage,
  '/profile': profilePage,
};

const DEFAULT_AUTHED = '/home';
const DEFAULT_GUEST = '/login';

let activePath = null;
let activeCleanup = null;
let onChange = null;
let started = false;
let rendering = false;

export function currentPath() { return activePath; }
export function routes() { return Object.keys(ROUTES); }

/** 解析并应用登录守卫 */
export function resolvePath(raw) {
  let path = String(raw === undefined || raw === null ? '' : raw).replace(/^#/, '').trim();
  if (!path) path = DEFAULT_AUTHED;
  if (path[0] !== '/') path = `/${path}`;
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  if (!ROUTES[path]) path = DEFAULT_AUTHED;

  if (!store.state.authenticated) return DEFAULT_GUEST;
  if (path === '/login') return DEFAULT_AUTHED;
  return path;
}

function readHash() {
  return typeof location === 'undefined' ? '' : (location.hash || '');
}

function writeHash(canonical, replace) {
  if (typeof location === 'undefined') return;
  const url = `${location.pathname}${location.search}${canonical}`;
  if (replace && typeof history !== 'undefined' && history.replaceState) {
    try { history.replaceState(null, '', url); return; } catch (err) { /* 降级到 hash 赋值 */ }
  }
  location.hash = canonical;
}

function render(target) {
  if (rendering) return;
  const page = ROUTES[target];
  const view = document.getElementById('view');
  if (!page || !view) return;

  if (activePath === target && view.querySelector(`[data-page="${target}"]`)) {
    if (onChange) onChange(target, page);
    return;
  }

  rendering = true;
  closeAllOverlays();
  if (typeof activeCleanup === 'function') {
    try { activeCleanup(); } catch (err) { console.error('[opentyg] 页面清理失败', err); }
  }
  activeCleanup = null;
  activePath = target;
  view.innerHTML = '';

  try {
    const cleanup = page.render({ root: view, path: target, navigate });
    if (typeof cleanup === 'function') activeCleanup = cleanup;
  } catch (err) {
    console.error('[opentyg] 页面渲染失败', err);
    view.innerHTML = `<div class="error-box">页面渲染失败：${esc(err && err.message)}</div>`;
  }

  const pageEl = view.firstElementChild;
  if (pageEl) pageEl.setAttribute('data-page', target);

  rendering = false;
  if (onChange) onChange(target, page);
  window.scrollTo(0, 0);
}

/** 处理当前地址：规范化 hash（守卫）后渲染 */
export function handleRoute() {
  const raw = readHash();
  const target = resolvePath(raw);
  const canonical = `#${target}`;
  if (raw !== canonical) writeHash(canonical, true);
  render(target);
}

/** 主动跳转 */
export function navigate(path, options = {}) {
  const target = resolvePath(path);
  const canonical = `#${target}`;
  if (readHash() !== canonical) writeHash(canonical, !!options.replace);
  render(target);
}

export function startRouter(options = {}) {
  onChange = typeof options.onChange === 'function' ? options.onChange : null;
  if (!started) {
    window.addEventListener('hashchange', handleRoute);
    started = true;
  }
  handleRoute();
}

export default { navigate, handleRoute, startRouter, resolvePath, currentPath, routes };
