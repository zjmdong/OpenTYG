/**
 * pages/doors.js — 全部门禁
 * 契约：docs/api.md
 *  3 列网格；单击 = 开门；长按 = 编辑抽屉（改名 / 恢复默认名 / 收藏到首页含位次 1–5 / 取消收藏）
 *  右上角「编辑顺序」→ 拖动排序模式（Pointer Events，长按 450ms 才进入拖动）→「完成」提交
 *  POST /api/doors/reorder { doorIds: 完整排列 }
 */

import { store, loadDoors } from '../store.js';
import { openDoor } from '../open.js';
import { openDoorSheet } from '../doorSheet.js';
import { api } from '../api.js';
import { connectionLoadingHtml } from '../connectionProgress.js';
import { ICON } from '../icons.js';
import { esc, toast, bindLongPress, guard } from '../ui.js';

const DRAG_MARK = '__dragging__';
const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE = 10;

export default {
  path: '/doors',
  tabbar: true,

  render(ctx) {
    const root = ctx.root;
    const life = { destroyed: false, editing: false, ticker: null, dirty: false };
    const open = new Map(); // doorId -> { busy, cooldownUntil, total }
    const dragCleanups = new Set();
    let orderIds = [];

    root.innerHTML = `
      <div class="page page--doors">
        <header class="page-head">
          <div class="page-head__left">
            <button type="button" class="icon-btn" id="doors-back" aria-label="返回首页">${ICON.back}</button>
          </div>
          <h1 class="page-head__title" id="doors-title">全部门禁</h1>
          <div class="page-head__actions">
            <button type="button" class="text-btn" id="doors-edit">编辑顺序</button>
          </div>
        </header>
        <div class="page-body" id="doors-body"></div>
      </div>`;

    const bodyEl = root.querySelector('#doors-body');
    const titleEl = root.querySelector('#doors-title');
    const editBtn = root.querySelector('#doors-edit');
    let grid = null;

    /* ------------------------------------------------------------ 排序 */
    function orderedFromStore() {
      const list = store.state.doors.slice();
      if (list.length && list.every((d) => Number.isFinite(Number(d.order)))) {
        list.sort((a, b) => Number(a.order) - Number(b.order));
      }
      return list.map((d) => d.id);
    }

    function doorsInOrder() {
      const byId = new Map(store.state.doors.map((d) => [d.id, d]));
      const list = [];
      for (const id of orderIds) {
        const door = byId.get(id);
        if (door) { list.push(door); byId.delete(id); }
      }
      byId.forEach((door, id) => {
        list.push(door);
        if (!orderIds.includes(id)) orderIds.push(id);
      });
      return list;
    }

    /* ------------------------------------------------------------ 渲染 */
    function avatarHtml(door) {
      const fav = !!door.favorite;
      const st = open.get(door.id) || {};
      const cooling = !st.busy && st.cooldownUntil > Date.now();
      const secs = cooling ? Math.max(1, Math.ceil((st.cooldownUntil - Date.now()) / 1000)) : 0;
      return `
        <span class="door-cell__avatar">
          ${ICON.door}
          ${cooling ? `<span class="door-cell__cd">${secs}</span>` : ''}
          ${fav ? `<span class="door-cell__star" aria-label="已收藏到首页">${ICON.star}</span>` : ''}
        </span>`;
    }

    function cellHtml(door) {
      const st = open.get(door.id) || {};
      const busy = !!st.busy;
      const cooling = !busy && st.cooldownUntil > Date.now();
      const cls = ['door-cell'];
      if (busy) cls.push('is-opening');
      if (cooling) cls.push('is-cooldown');
      return `
        <button type="button" class="${cls.join(' ')}" data-door-id="${esc(door.id)}"
                data-door-name="${esc(door.name)}"
                aria-label="${esc(door.name)}，单击开门，长按编辑">
          ${avatarHtml(door)}
          <span class="door-cell__name">${esc(door.name)}</span>
        </button>`;
    }

    function emptyHtml() {
      return `
        <div class="empty">
          <div class="empty__icon">${ICON.door}</div>
          <div class="empty__title">暂无门禁</div>
          <div class="empty__text">当前房产下没有可用门禁，可切换房产或重新加载。</div>
          <button type="button" class="btn btn--primary" data-act="reload">重新加载</button>
        </div>`;
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

    function renderBody() {
      for (const cleanup of dragCleanups) cleanup();
      dragCleanups.clear();
      const s = store.state;

      if (s.doorsError && !s.doors.length) { bodyEl.innerHTML = errorHtml(s.doorsError); bindStatic(); return; }
      if (s.doorsLoading && !s.doors.length) {
        bodyEl.innerHTML = connectionLoadingHtml();
        return;
      }

      const doors = doorsInOrder();
      if (!doors.length) { bodyEl.innerHTML = emptyHtml(); bindStatic(); return; }

      bodyEl.innerHTML =
        `<div class="grid-hint${life.editing ? '' : ' is-hidden'}">长按图标 0.5 秒后拖动调整顺序，点击右上角「完成」保存</div>` +
        `<div class="grid${life.editing ? ' is-editing' : ''}" id="door-grid">${doors.map(cellHtml).join('')}</div>`;

      grid = bodyEl.querySelector('#door-grid');
      grid.querySelectorAll('.door-cell').forEach((cell) => {
        if (life.editing) attachDrag(cell);
        else attachCellGestures(cell);
      });
      applyAllOpenStates();
    }

    function bindStatic() {
      const btn = bodyEl.querySelector('[data-act]');
      if (!btn) return;
      btn.addEventListener('click', guard(async () => {
        if (btn.dataset.act === 'go-profile') ctx.navigate('/profile');
        else await reload(false);
      }));
    }

    function updateHeader() {
      titleEl.textContent = life.editing ? '拖动调整顺序' : '全部门禁';
      editBtn.textContent = life.editing ? '完成' : '编辑顺序';
      editBtn.classList.toggle('text-btn--dirty', life.dirty);
    }

    /* -------------------------------------------------------- 开门状态 */
    function cellOf(doorId) {
      return bodyEl.querySelector(`.door-cell[data-door-id="${doorId}"]`);
    }

    function applyOpenState(doorId) {
      const cell = cellOf(doorId);
      if (!cell) return;
      const st = open.get(doorId) || {};
      const cooling = !st.busy && st.cooldownUntil > Date.now();
      const secs = cooling ? Math.max(1, Math.ceil((st.cooldownUntil - Date.now()) / 1000)) : 0;
      cell.classList.toggle('is-opening', !!st.busy);
      cell.classList.toggle('is-cooldown', cooling);
      // 冷却时图标已被 CSS 完全隐藏、只剩数字，读屏用户拿不到倒计时，这里同步进 aria-label
      const name = cell.dataset.doorName || '门禁';
      if (st.busy) cell.setAttribute('aria-label', `${name}，正在开门`);
      else if (cooling) cell.setAttribute('aria-label', `${name}，冷却中，剩余 ${secs} 秒`);
      else cell.setAttribute('aria-label', `${name}，单击开门，长按编辑`);
      const avatar = cell.querySelector('.door-cell__avatar');
      if (!avatar) return;
      let cd = avatar.querySelector('.door-cell__cd');
      if (cooling) {
        const text = String(secs);
        if (!cd) {
          cd = document.createElement('span');
          cd.className = 'door-cell__cd';
          avatar.appendChild(cd);
        }
        if (cd.textContent !== text) cd.textContent = text;
      } else if (cd) {
        cd.remove();
      }
    }

    function applyAllOpenStates() {
      open.forEach((_st, doorId) => applyOpenState(doorId));
    }

    function ensureTicker() {
      if (life.ticker) return;
      // 用 rAF 而不是 200ms 定时器：秒数切换更准时，也不会与渲染抢帧
      const step = () => {
        life.ticker = 0;
        if (life.destroyed) return;
        const now = Date.now();
        let alive = false;
        open.forEach((st, doorId) => {
          if (!st.cooldownUntil) return;
          if (st.cooldownUntil <= now) { st.cooldownUntil = 0; applyOpenState(doorId); return; }
          alive = true;
          applyOpenState(doorId);
        });
        if (alive) life.ticker = requestAnimationFrame(step);
      };
      life.ticker = requestAnimationFrame(step);
    }

    function startCooldown(doorId) {
      const total = Math.max(0, store.openCooldownMs);
      if (total <= 0) return;
      const st = open.get(doorId) || {};
      st.busy = false;
      st.cooldownUntil = Date.now() + total;
      st.total = total;
      open.set(doorId, st);
      applyOpenState(doorId);
      ensureTicker();
    }

    async function handleOpen(doorId) {
      const st = open.get(doorId) || {};
      if (st.busy || st.cooldownUntil > Date.now()) return;
      st.busy = true;
      open.set(doorId, st);
      applyOpenState(doorId);

      let result = null;
      try {
        result = await openDoor(doorId);
      } catch (err) {
        console.error('[opentyg] open failed', err);
      }

      st.busy = false;
      open.set(doorId, st);
      applyOpenState(doorId);

      if (result && (result.ok || result.cooldown)) startCooldown(doorId);
      if (result && result.reconnected) {
        orderIds = orderedFromStore();
        renderBody();
      }
    }

    /* -------------------------------------------------------- 单元格手势 */
    function attachCellGestures(cell) {
      const doorId = cell.dataset.doorId;
      bindLongPress(cell, {
        onTap: () => { handleOpen(doorId); },
        onLongPress: () => { openDoorSheet(doorId, { showPriority: true, onChanged: renderBody }); },
        skipWhen: () => {
          const st = open.get(doorId);
          return !!(st && st.busy);
        },
      });
    }

    /* ---------------------------------------------------------- 拖动排序 */
    function attachDrag(cell) {
      let pressTimer = null;
      let dragging = false;
      let startX = 0;
      let startY = 0;
      let placeholder = null;
      let rafId = 0;
      let lastX = 0;
      let lastY = 0;
      let lastHitAt = 0;
      let pointerId = null;

      function detach() {
        clearTimeout(pressTimer);
        pressTimer = null;
        cell.removeEventListener('pointermove', onMove);
        cell.removeEventListener('pointerup', onUp);
        cell.removeEventListener('pointercancel', onCancel);
      }

      function onDown(e) {
        if (!life.editing) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (dragging) return;
        startX = e.clientX;
        startY = e.clientY;
        pointerId = e.pointerId;
        try { cell.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
        cell.addEventListener('pointermove', onMove);
        cell.addEventListener('pointerup', onUp);
        cell.addEventListener('pointercancel', onCancel);
        clearTimeout(pressTimer);
        // 长按 450ms 后才进入拖动，避免与滚动/点击冲突
        pressTimer = setTimeout(() => { pressTimer = null; beginDrag(); }, LONG_PRESS_MS);
      }

      function onMove(e) {
        if (!dragging) {
          if (Math.abs(e.clientX - startX) > MOVE_TOLERANCE || Math.abs(e.clientY - startY) > MOVE_TOLERANCE) {
            clearTimeout(pressTimer);
            pressTimer = null;
            cell.removeEventListener('pointermove', onMove);
          }
          return;
        }
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        cell.style.transform = `translate(${dx}px, ${dy}px) scale(1.06)`;
        scheduleHitTest(e.clientX, e.clientY);
      }

      function beginDrag() {
        if (!life.editing || !cell.isConnected) return;
        const rect = cell.getBoundingClientRect();
        if (!rect.width) return;

        dragging = true;
        placeholder = document.createElement('div');
        placeholder.className = 'door-cell door-cell--placeholder';
        placeholder.style.width = `${rect.width}px`;
        placeholder.style.height = `${rect.height}px`;
        grid.insertBefore(placeholder, cell);

        // A fixed child of the animated/scrolling page uses that ancestor's
        // coordinate system. Portal the actual card to the viewport instead.
        document.body.appendChild(cell);
        try { cell.setPointerCapture(pointerId); } catch { /* unsupported capture */ }

        cell.classList.add('is-dragging');
        cell.style.left = `${rect.left}px`;
        cell.style.top = `${rect.top}px`;
        cell.style.width = `${rect.width}px`;
        cell.style.height = `${rect.height}px`;
        cell.style.transform = 'translate(0px, 0px) scale(1.06)';

        if (navigator.vibrate) { try { navigator.vibrate(10); } catch (err) { /* 忽略 */ } }
      }

      function scheduleHitTest(x, y) {
        lastX = x; lastY = y;
        const now = Date.now();
        // 稀疏的 pointermove 直接同步命中测试（首个移动立即生效），
        // 密集事件用 rAF 合并，避免每帧多次布局。
        if (now - lastHitAt >= 16) {
          lastHitAt = now;
          hitTest(x, y);
          return;
        }
        if (rafId) return;
        rafId = requestAnimationFrame(() => {
          rafId = 0;
          lastHitAt = Date.now();
          hitTest(lastX, lastY);
        });
      }

      function hitTest(px, py) {
        if (!placeholder) return;
        const others = Array.from(grid.querySelectorAll('.door-cell'))
          .filter((node) => node !== cell && node !== placeholder);
        let ref = null;
        for (const node of others) {
          const r = node.getBoundingClientRect();
          if (py < r.top) { ref = node; break; }
          if (py <= r.bottom && px < r.left + r.width / 2) { ref = node; break; }
        }
        if (placeholder.nextElementSibling !== ref) grid.insertBefore(placeholder, ref);
      }

      function onUp(e) {
        if (!dragging) { detach(); return; }
        // 兜底：以最终落点做一次命中测试，确保松手顺序与落点一致
        if (placeholder && typeof e.clientX === 'number') hitTest(e.clientX, e.clientY);
        dragging = false;
        if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }

        const ids = [];
        Array.from(grid.children).forEach((node) => {
          if (node === cell) return;
          if (node === placeholder) { ids.push(DRAG_MARK); return; }
          if (node.dataset && node.dataset.doorId) ids.push(node.dataset.doorId);
        });
        const at = ids.indexOf(DRAG_MARK);
        if (at >= 0) ids[at] = cell.dataset.doorId;

        if (placeholder) placeholder.replaceWith(cell);
        placeholder = null;
        cell.classList.remove('is-dragging');
        cell.removeAttribute('style');
        detach();

        const changed = ids.length && ids.join('|') !== orderIds.join('|');
        if (changed) {
          orderIds = ids;
          life.dirty = true;
          renderBody();
        }
        updateHeader();
      }

      function onCancel() {
        dragging = false;
        if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
        if (placeholder) { placeholder.replaceWith(cell); placeholder = null; }
        cell.classList.remove('is-dragging');
        cell.removeAttribute('style');
        detach();
      }

      cell.addEventListener('pointerdown', onDown);
      dragCleanups.add(() => { onCancel(); cell.removeEventListener('pointerdown', onDown); });
    }

    /* ------------------------------------------------------------ 数据 */
    async function reload(force) {
      editBtn.disabled = true;
      try {
        await loadDoors(!!force);
        orderIds = orderedFromStore();
        if (!life.destroyed) renderBody();
      } catch (err) {
        if (!life.destroyed) { toast(err.message || '门禁列表加载失败', 'err'); renderBody(); }
      } finally {
        editBtn.disabled = false;
      }
    }

    /* ---------------------------------------------------------- 编辑顺序 */
    async function submitOrder() {
      const ids = orderIds.slice();
      if (!ids.length) { life.editing = false; life.dirty = false; updateHeader(); renderBody(); return; }
      editBtn.disabled = true;
      editBtn.textContent = '保存中…';
      try {
        const data = await api.reorderDoors(ids);
        if (data && Array.isArray(data.doors) && data.doors.length) {
          store.setDoors({ doors: data.doors });
          orderIds = orderedFromStore();
        }
        life.dirty = false;
        toast('顺序已保存', 'ok');
        life.editing = false;
      } catch (err) {
        // 提交失败：回退到服务端顺序，避免界面与实际不一致
        orderIds = orderedFromStore();
        life.dirty = false;
        toast(err.message || '顺序保存失败，请重试', 'err');
      } finally {
        editBtn.disabled = false;
        updateHeader();
        renderBody();
      }
    }

    editBtn.addEventListener('click', guard(async () => {
      if (life.editing) { await submitOrder(); return; }
      life.editing = true;
      life.dirty = false;
      updateHeader();
      renderBody();
    }));

    root.querySelector('#doors-back').addEventListener('click', () => {
      ctx.navigate('/home');
    });

    /* ---------------------------------------------------------- 启动 */
    orderIds = orderedFromStore();
    updateHeader();
    renderBody();
    if ((!store.state.doors.length || store.state.doorsPreview) && !store.state.doorsError) reload(false);

    return function destroy() {
      life.destroyed = true;
      for (const cleanup of dragCleanups) cleanup();
      dragCleanups.clear();
      if (life.ticker) { cancelAnimationFrame(life.ticker); life.ticker = 0; }
    };
  },
};
