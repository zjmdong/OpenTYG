/**
 * pages/home.js — 首页
 * 契约：docs/api.md
 *  标题 = 当前小区名；最多 5 个圆形门禁按钮
 *  单击 = 开门（旋转态 → 成功后有环绕倒计时进度环）
 *  长按 = 该门禁的设置（改名 / 恢复默认名 / 收藏位次）
 */

import { store, loadDoors } from '../store.js';
import { openDoor } from '../open.js';
import { openDoorSheet } from '../doorSheet.js';
import { ICON } from '../icons.js';
import { esc, toast, confirmDialog, bindLongPress, guard } from '../ui.js';
import { api } from '../api.js';
import { connectionLoadingHtml } from '../connectionProgress.js';

/** 倒计时进度环：SVG 圆周长（r=54 → 2πr ≈ 339.29），用 stroke-dashoffset 平滑推进 */
const RING_R = 54;
const RING_C = 2 * Math.PI * RING_R;

export default {
  path: '/home',
  tabbar: true,

  render(ctx) {
    const root = ctx.root;
    const life = { destroyed: false, raf: 0 };
    const open = new Map(); // doorId -> { busy, cooldownUntil, total }

    root.innerHTML = `
      <div class="page page--home">
        <header class="page-head">
          <div class="page-head__left"></div>
          <h1 class="page-head__title" id="home-title">${esc(store.householdName)}</h1>
          <div class="page-head__actions">
            <button type="button" class="icon-btn" id="home-refresh" aria-label="刷新门禁列表">${ICON.refresh}</button>
            <button type="button" class="icon-btn" id="home-logout" aria-label="退出登录">${ICON.logout}</button>
          </div>
        </header>
        <div class="page-body" id="home-body"></div>
      </div>`;

    const bodyEl = root.querySelector('#home-body');
    const titleEl = root.querySelector('#home-title');
    const el = (id) => root.querySelector(id);

    /* -------------------------------------------------------- 门禁列表 */
    function rowHtml(door) {
      return `
        <section class="door-card" data-door-id="${esc(door.id)}">
          <button type="button" class="door-orb" data-door-id="${esc(door.id)}"
                  aria-label="开门：${esc(door.name)}">
            <svg class="door-orb__ring" viewBox="0 0 120 120" aria-hidden="true">
              <circle class="door-orb__ring-track" cx="60" cy="60" r="${RING_R}"></circle>
              <circle class="door-orb__ring-bar" cx="60" cy="60" r="${RING_R}"
                      stroke-dasharray="${RING_C.toFixed(2)}" stroke-dashoffset="0"></circle>
            </svg>
            <span class="door-orb__icon">${ICON.lock}</span>
            <span class="door-orb__state" data-state></span>
          </button>
          <h2 class="door-card__name">${esc(door.name)}</h2>
        </section>`;
    }

    function emptyHtml() {
      const hasDoors = store.state.doors.length > 0;
      return `
        <div class="empty">
          <div class="empty__icon">${hasDoors ? ICON.starOutline : ICON.door}</div>
          <div class="empty__title">${hasDoors ? '还没有收藏门禁' : '暂无可用门禁'}</div>
          <div class="empty__text">
            ${hasDoors
              ? '去「门禁」长按门禁图标，即可收藏到首页，最多 5 个。'
              : '当前房产下没有查询到门禁，可切换房产或重新加载。'}
          </div>
          <button type="button" class="btn btn--primary" data-act="${hasDoors ? 'go-doors' : 'reload'}">
            ${hasDoors ? '去门禁' : '重新加载'}
          </button>
        </div>`;
    }

    function loadingHtml() {
      return connectionLoadingHtml();
    }

    function errorHtml(err) {
      const notSelected = err && err.code === 'HOUSEHOLD_NOT_SELECTED';
      return `
        <div class="error-box">
          <div>${esc((err && err.message) || '门禁加载失败')}</div>
          <button type="button" class="btn btn--primary btn--sm" data-act="${notSelected ? 'go-profile' : 'reload'}">
            ${notSelected ? '去选择房产' : '重试'}
          </button>
        </div>`;
    }

    /* ---------------------------------------------------- 开门 / 倒计时 */
    function orbOf(doorId) {
      return bodyEl.querySelector(`.door-orb[data-door-id="${doorId}"]`);
    }

    function applyOrbState(doorId) {
      const orb = orbOf(doorId);
      if (!orb) return;
      const st = open.get(doorId) || {};
      const cooling = !st.busy && st.cooldownUntil > Date.now();
      orb.classList.toggle('is-opening', !!st.busy);
      orb.classList.toggle('is-cooldown', cooling);

      const label = orb.querySelector('[data-state]');
      if (label) {
        if (st.busy) label.textContent = '开门中';
        else if (cooling) label.textContent = `${Math.max(1, Math.ceil((st.cooldownUntil - Date.now()) / 1000))} 秒`;
        else label.textContent = '点按开门';
      }
      const bar = orb.querySelector('.door-orb__ring-bar');
      if (bar && !cooling) bar.style.strokeDashoffset = '0';
    }

    /** 用 requestAnimationFrame 逐帧推进进度环：比 100ms 定时器 + conic-gradient 明显更顺滑 */
    function tick() {
      life.raf = 0;
      if (life.destroyed) return;
      const now = Date.now();
      let alive = false;
      open.forEach((st, doorId) => {
        if (!st.cooldownUntil) return;
        const orb = orbOf(doorId);
        if (st.cooldownUntil <= now) {
          st.cooldownUntil = 0;
          applyOrbState(doorId);
          return;
        }
        alive = true;
        if (!orb) return;
        const total = st.total || store.openCooldownMs || 3000;
        // 剩余比例 → dashoffset（1 = 空环，0 = 满环）；保留小数以获得亚像素平滑
        const ratio = Math.min(1, Math.max(0, (st.cooldownUntil - now) / total));
        const bar = orb.querySelector('.door-orb__ring-bar');
        if (bar) bar.style.strokeDashoffset = (RING_C * (1 - ratio)).toFixed(2);
        const label = orb.querySelector('[data-state]');
        if (label) label.textContent = `${Math.max(1, Math.ceil((st.cooldownUntil - now) / 1000))} 秒`;
      });
      if (alive) life.raf = requestAnimationFrame(tick);
    }

    function ensureTicker() {
      if (life.raf) return;
      life.raf = requestAnimationFrame(tick);
    }

    function startCooldown(doorId) {
      const total = Math.max(0, store.openCooldownMs);
      if (total <= 0) return;
      const st = open.get(doorId) || {};
      st.busy = false;
      st.cooldownUntil = Date.now() + total;
      st.total = total;
      open.set(doorId, st);
      applyOrbState(doorId);
      ensureTicker();
    }

    async function handleOpen(doorId) {
      const st = open.get(doorId) || {};
      if (st.busy) return;
      if (st.cooldownUntil > Date.now()) return;

      st.busy = true;
      open.set(doorId, st);
      applyOrbState(doorId);

      let result = null;
      try {
        result = await openDoor(doorId);
      } catch (err) {
        console.error('[opentyg] open failed', err);
      }

      st.busy = false;
      open.set(doorId, st);
      applyOrbState(doorId);

      if (result && (result.ok || result.cooldown)) startCooldown(doorId);
      if (result && result.reconnected) renderAll(); // 重连后目录可能已变化
    }

    /* ------------------------------------------------------ 渲染总入口 */
    function bindList() {
      bodyEl.querySelectorAll('.door-orb').forEach((orb) => {
        const doorId = orb.dataset.doorId;
        // 单击 = 开门；长按 = 该门禁的设置
        bindLongPress(orb, {
          onTap: () => { handleOpen(doorId); },
          onLongPress: () => { openDoorSheet(doorId, { showPriority: true, onChanged: renderAll }); },
          skipWhen: () => {
            const st = open.get(doorId);
            return !!(st && st.busy);
          },
        });
        applyOrbState(doorId);
      });

      const actBtn = bodyEl.querySelector('[data-act]');
      if (actBtn) {
        actBtn.addEventListener('click', guard(async () => {
          const act = actBtn.dataset.act;
          if (act === 'go-doors') ctx.navigate('/doors');
          else if (act === 'go-profile') ctx.navigate('/profile');
          else if (act === 'reload') await reload(false);
        }));
      }
    }

    function renderList() {
      const list = store.favorites;
      if (!list.length) {
        bodyEl.innerHTML = emptyHtml();
        bindList();
        return;
      }
      bodyEl.innerHTML = `<div class="door-list">${list.map(rowHtml).join('')}</div>`;
      bindList();
    }

    function renderBody() {
      const s = store.state;
      titleEl.textContent = store.householdName;

      if (s.doorsError && !s.doors.length) { bodyEl.innerHTML = errorHtml(s.doorsError); bindList(); return; }
      if (s.doorsLoading && !s.doors.length) { bodyEl.innerHTML = loadingHtml(); return; }
      renderList();
    }

    function renderAll() { renderBody(); }

    /* -------------------------------------------------------- 数据加载 */
    async function reload(force) {
      const btn = el('#home-refresh');
      if (btn) btn.disabled = true;
      try {
        await loadDoors(!!force);
        if (!life.destroyed) renderAll();
      } catch (err) {
        if (!life.destroyed) {
          toast(err.message || '门禁列表加载失败', 'err');
          renderAll();
        }
      } finally {
        if (btn) btn.disabled = false;
      }
    }

    /* ---------------------------------------------------------- 事件 */
    el('#home-refresh').addEventListener('click', guard(() => reload(false)));
    el('#home-logout').addEventListener('click', guard(async () => {
      const ok = await confirmDialog({
        title: '退出登录',
        message: '退出后需要重新登录才能开门，确定退出吗？',
        okText: '退出登录',
        danger: true,
      });
      if (!ok) return;
      try {
        await api.logout();
      } catch (err) {
        console.error('[opentyg] logout failed', err);
      }
      store.clearSession();
      toast('已退出登录', 'ok');
      ctx.navigate('/login', { replace: true });
    }));

    /* ---------------------------------------------------------- 启动 */
    renderAll();
    if (!store.state.doors.length && !store.state.doorsError) {
      reload(false);
    }

    return function destroy() {
      life.destroyed = true;
      if (life.raf) { cancelAnimationFrame(life.raf); life.raf = 0; }
    };
  },
};
