/**
 * ui.js — 通用 UI 原语
 *  - toast：3 秒自动消失、可点击关闭
 *  - showResult：居中结果弹窗（成功绿勾 / 失败红叉），默认 3 秒自动消失、可点击关闭
 *    （「开门成功」由 open.js 显式传 1000ms，只有它 1 秒后隐藏）
 *  - confirmDialog：二次确认
 *  - openSheet：底部抽屉
 *  - bindLongPress：450ms 长按 / 位移 > 10px 取消 / 长按后抑制 click
 *  - bindTap：点击（与长按互斥）
 */

import { ICON } from './icons.js';

/* ------------------------------------------------------------------ 工具 */

export function esc(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function $(sel, root = document) { return root.querySelector(sel); }
export function $$(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

export function formatTime(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return '—';
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 事件回调包装：异常统一提示，避免未捕获的 Promise rejection */
export function guard(fn) {
  return function wrapped(...args) {
    try {
      const out = fn.apply(this, args);
      if (out && typeof out.then === 'function') {
        return out.catch((err) => reportError(err));
      }
      return out;
    } catch (err) {
      reportError(err);
      return undefined;
    }
  };
}

export function reportError(err) {
  const code = err && err.code;
  if (code === 'NOT_LOGGED_IN' || code === 'SESSION_EXPIRED') return; // 全局已跳登录页
  console.error('[opentyg]', err);
  toast((err && err.message) || '操作失败，请重试', 'err');
}

/* ----------------------------------------------------------------- Toast */

const TOAST_ICON = {
  ok: ICON.check,
  err: ICON.cross,
  warn: ICON.warn,
  info: ICON.info,
};

export function toast(message, type = 'info', duration = 3000) {
  const root = document.getElementById('toast-root');
  if (!root) return () => {};

  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.innerHTML = `<span class="toast__icon">${TOAST_ICON[type] || TOAST_ICON.info}</span>` +
    `<span class="toast__text">${esc(message)}</span>`;
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-in'));

  let closed = false;
  let timer = null;
  const close = () => {
    if (closed) return;
    closed = true;
    if (timer) clearTimeout(timer);
    el.classList.remove('is-in');
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 220);
  };

  timer = setTimeout(close, Math.max(600, Number(duration) || 3000));
  el.addEventListener('click', close);

  // 同时存在的 toast 不超过 3 条
  while (root.children.length > 3) root.firstElementChild.remove();

  return close;
}

/* --------------------------------------------------- 居中结果弹窗（开门） */

let activeResult = null;

export function showResult(options = {}) {
  const success = !!options.success;
  const title = options.title || (success ? '开门成功' : '开门失败');
  const message = options.message && options.message !== title ? options.message : '';
  const root = document.getElementById('modal-root');
  if (!root) return () => {};

  hideResult();

  const wrap = document.createElement('div');
  wrap.className = 'modal';
  wrap.innerHTML =
    '<div class="modal__backdrop"></div>' +
    '<div class="result-card" role="alertdialog" aria-live="assertive">' +
      `<div class="result-card__icon ${success ? 'is-ok' : 'is-err'}">${success ? ICON.check : ICON.cross}</div>` +
      `<div class="result-card__title">${esc(title)}</div>` +
      (message ? `<div class="result-card__msg">${esc(message)}</div>` : '') +
      '<div class="result-card__tip">点击关闭</div>' +
    '</div>';

  root.appendChild(wrap);
  wrap.addEventListener('click', closeResult);

  // 默认 3 秒（保持既有行为）；调用方可用 options.duration 覆盖。
  // 「开门成功」在 open.js 里显式传 1000 —— 只有它需要 1 秒自动隐藏；
  // 失败 / 连接断开 / 结果未知等提示需要更长的阅读时间，保持各自现值。
  const duration = Number.isFinite(Number(options.duration)) ? Number(options.duration) : 3000;
  const timer = setTimeout(closeResult, Math.max(800, duration));

  function closeResult() {
    clearTimeout(timer);
    wrap.remove();
    if (activeResult && activeResult.wrap === wrap) activeResult = null;
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape' || e.key === 'Enter') closeResult(); }

  document.addEventListener('keydown', onKey);
  activeResult = { wrap, close: closeResult };
  return closeResult;
}

export function hideResult() {
  if (activeResult) activeResult.close();
  const root = document.getElementById('modal-root');
  if (root) root.innerHTML = '';
  activeResult = null;
}

/* ------------------------------------------------------------ 确认弹窗 */

export function confirmDialog(options = {}) {
  const {
    title = '确认操作',
    message = '',
    okText = '确定',
    cancelText = '取消',
    danger = false,
  } = options;

  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    if (!root) { resolve(false); return; }

    const wrap = document.createElement('div');
    wrap.className = 'modal';
    wrap.innerHTML =
      '<div class="modal__backdrop"></div>' +
      '<div class="confirm-card" role="dialog" aria-modal="true">' +
        `<div class="confirm-card__title">${esc(title)}</div>` +
        (message ? `<div class="confirm-card__msg">${esc(message)}</div>` : '') +
        '<div class="confirm-card__actions">' +
          (cancelText ? `<button type="button" class="btn btn--ghost" data-act="cancel">${esc(cancelText)}</button>` : '') +
          `<button type="button" class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-act="ok">${esc(okText)}</button>` +
        '</div>' +
      '</div>';

    root.appendChild(wrap);

    let done = false;
    function finish(value) {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey);
      wrap.remove();
      resolve(value);
    }
    function onKey(e) {
      if (e.key === 'Escape') finish(false);
      if (e.key === 'Enter') finish(true);
    }

    wrap.addEventListener('click', (e) => {
      const act = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
      if (act) { finish(act.dataset.act === 'ok'); return; }
      if (e.target.classList && e.target.classList.contains('modal__backdrop')) finish(false);
    });
    document.addEventListener('keydown', onKey);

    const okBtn = wrap.querySelector('[data-act="ok"]');
    if (okBtn) okBtn.focus();
  });
}

/* ------------------------------------------------------------ 底部抽屉 */

let activeSheet = null;

export function openSheet(options = {}) {
  const {
    title = '',
    sub = '',
    body = '',
    onMount = null,
    dismissible = true,
  } = options;

  closeSheet();

  const root = document.getElementById('sheet-root');
  if (!root) return null;

  root.innerHTML =
    '<div class="sheet__backdrop" data-close="1"></div>' +
    '<div class="sheet" role="dialog" aria-modal="true">' +
      '<div class="sheet__grab"></div>' +
      (title ? `<div class="sheet__title">${esc(title)}</div>` : '') +
      (sub ? `<div class="sheet__sub">${esc(sub)}</div>` : '') +
      body +
    '</div>';

  root.classList.add('is-open');
  const sheetEl = root.querySelector('.sheet');

  function onKey(e) { if (e.key === 'Escape') closeSheet(); }
  document.addEventListener('keydown', onKey);

  if (dismissible) {
    root.querySelector('.sheet__backdrop').addEventListener('click', () => closeSheet());
  }

  activeSheet = {
    el: sheetEl,
    close: () => closeSheet(),
    onKey,
  };

  if (typeof onMount === 'function') onMount(sheetEl);
  return activeSheet;
}

export function closeSheet() {
  const root = document.getElementById('sheet-root');
  if (!root) return;
  if (activeSheet && activeSheet.onKey) document.removeEventListener('keydown', activeSheet.onKey);
  root.classList.remove('is-open');
  root.innerHTML = '';
  activeSheet = null;
}

/** 路由切换时清理所有浮层 */
export function closeAllOverlays() {
  closeSheet();
  hideResult();
  const root = document.getElementById('modal-root');
  if (root) root.innerHTML = '';
}

/* -------------------------------------------------------------- 手势 */

/**
 * 长按 / 点击手势
 * @param {HTMLElement} el
 * @param {{onLongPress?:Function,onTap?:Function,delay?:number,tolerance?:number,skipWhen?:Function}} options
 * @returns {Function} 解绑
 */
export function bindLongPress(el, options = {}) {
  if (!el) return () => {};
  const delay = Number.isFinite(options.delay) ? options.delay : 450;
  const tolerance = Number.isFinite(options.tolerance) ? options.tolerance : 10;

  let timer = null;
  let active = false;
  let fired = false;
  let moved = false;
  let startX = 0;
  let startY = 0;
  let suppressUntil = 0;

  const clearTimer = () => { if (timer !== null) { clearTimeout(timer); timer = null; } };

  function onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (typeof options.skipWhen === 'function' && options.skipWhen()) return;
    active = true; fired = false; moved = false;
    startX = e.clientX; startY = e.clientY;
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      if (!active) return;
      fired = true;
      suppressUntil = Date.now() + 800; // 抑制长按后紧跟的 click
      if (typeof options.onLongPress === 'function') options.onLongPress(e);
    }, delay);
  }

  function onMove(e) {
    if (!active || fired) return;
    if (Math.abs(e.clientX - startX) > tolerance || Math.abs(e.clientY - startY) > tolerance) {
      moved = true; active = false; clearTimer();
    }
  }

  function onUp(e) {
    if (!active) { clearTimer(); return; }
    active = false;
    clearTimer();
    if (!fired && !moved && typeof options.onTap === 'function') options.onTap(e);
  }

  function onCancel() { active = false; fired = false; moved = false; clearTimer(); }

  function onClickCapture(e) {
    if (Date.now() < suppressUntil) { e.stopPropagation(); e.preventDefault(); }
  }

  function onContextMenu(e) { if (fired || active) e.preventDefault(); }

  function onKeyDown(e) {
    if ((e.key === 'Enter' || e.key === ' ') && typeof options.onTap === 'function') {
      e.preventDefault();
      options.onTap(e);
    }
  }

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onCancel);
  el.addEventListener('contextmenu', onContextMenu);
  el.addEventListener('click', onClickCapture, true);
  el.addEventListener('keydown', onKeyDown);

  return function destroy() {
    clearTimer();
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onCancel);
    el.removeEventListener('contextmenu', onContextMenu);
    el.removeEventListener('click', onClickCapture, true);
    el.removeEventListener('keydown', onKeyDown);
  };
}

export default {
  esc, $, $$, formatTime, guard, reportError,
  toast, showResult, hideResult, confirmDialog,
  openSheet, closeSheet, closeAllOverlays, bindLongPress,
};
