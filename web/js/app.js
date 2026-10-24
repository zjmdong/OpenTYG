/**
 * app.js — 启动引导
 *  1. GET /api/meta         （无需登录）
 *  2. GET /api/auth/session （恢复登录态；未登录一律跳 #/login）
 *  3. 启动 hash 路由 + 底部三页签导航
 *  401 / SESSION_EXPIRED 统一清状态并跳登录页
 */

import { api, setUnauthorizedHandler } from './api.js';
import { store } from './store.js';
import { startRouter, navigate } from './router.js';
import { ICON } from './icons.js';
import { initTheme } from './theme.js';
import { esc, toast } from './ui.js';
import { initPwa } from './pwa.js';
import { initDoorConnection, warmDoorConnection } from './doorConnection.js';
import { connectionLoadingHtml, withConnectionProgress } from './connectionProgress.js';

const view = document.getElementById('view');
const tabbar = document.getElementById('tabbar');

/* 底部导航：首页（房子）/ 门禁（钥匙）/ 设置（齿轮） */
const TABS = [
  { path: '/home', label: '首页', icon: ICON.house },
  { path: '/doors', label: '门禁', icon: ICON.keychain },
  { path: '/profile', label: '设置', icon: ICON.gear },
];

/* ------------------------------------------------------------- 启动画面 */

function renderBoot() {
  view.innerHTML = `
    <div class="page">
      ${connectionLoadingHtml()}
    </div>`;
}

function renderFatal(err) {
  const message = (err && err.message) || '无法连接到服务，请确认后端已启动后重试';
  view.innerHTML = `
    <div class="page">
      <div class="error-box" style="margin-top:auto;margin-bottom:auto">
        <div>${esc(message)}</div>
        <button type="button" class="btn btn--primary btn--sm" id="boot-retry">重新加载</button>
      </div>
    </div>`;
  const btn = view.querySelector('#boot-retry');
  if (btn) btn.addEventListener('click', () => window.location.reload());
  tabbar.classList.add('is-hidden');
}

/* --------------------------------------------------------------- 页签 */

function renderTabbar(activePath, page) {
  const show = !page || page.tabbar !== false;
  tabbar.classList.toggle('is-hidden', !show);
  if (!show) {
    tabbar.innerHTML = '';
    return;
  }
  tabbar.innerHTML = TABS.map((tab) => `
    <button type="button" class="tab${tab.path === activePath ? ' is-active' : ''}"
            data-path="${tab.path}" aria-current="${tab.path === activePath ? 'page' : 'false'}">
      ${tab.icon}
      <span>${esc(tab.label)}</span>
    </button>`).join('');
}

tabbar.addEventListener('click', (event) => {
  const btn = event.target.closest ? event.target.closest('[data-path]') : null;
  if (!btn) return;
  navigate(btn.dataset.path);
});

/* --------------------------------------------------------------- 引导 */

async function boot() {
  initTheme();
  initPwa();
  renderBoot();

  // 1) meta（无需登录）
  try {
    const meta = await withConnectionProgress('service', () => api.getMeta());
    store.setMeta(meta);
  } catch (err) {
    console.error('[opentyg] /api/meta 失败', err);
    renderFatal(err);
    return;
  }

  // 2) 会话恢复
  try {
    const session = await withConnectionProgress('restoring', () => api.getSession());
    store.applySession(session);
  } catch (err) {
    if (!['SESSION_EXPIRED','SAVED_LOGIN_INVALID','NOT_LOGGED_IN'].includes(err?.code)) {
      console.error('[opentyg] /api/auth/session 失败', err);
      renderFatal(err);
      return;
    }
    store.clearSession();
  }

  // 3) 会话失效统一处理
  setUnauthorizedHandler(() => {
    const wasAuthed = store.state.authenticated;
    store.clearSession();
    if (wasAuthed) toast('登录状态已失效，请重新登录', 'warn');
    navigate('/login', { replace: true });
  });

  // Start preparation before mounting (loadDoors coalesces the page's read),
  // but render the home/navigation immediately instead of blocking behind WS.
  initDoorConnection();
  void warmDoorConnection();

  // 4) 路由
  startRouter({
    onChange(path, page) {
      renderTabbar(path, page);
    },
  });

  if (!store.state.authenticated) navigate('/login', { replace: true });
}

boot().catch((err) => {
  console.error('[opentyg] 启动失败', err);
  renderFatal(err);
});
