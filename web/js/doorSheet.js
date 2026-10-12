/**
 * doorSheet.js — 门禁设置底部抽屉（首页 / 门禁共用）
 *  - 重命名输入框（**不自动聚焦**：避免一进设置就弹输入法）/ 一键恢复默认名称
 *  - 收藏到首页 / 取消收藏
 *  - showPriority=true 时展示 5 个固定尺寸的位次方块，编号 1–5
 */

import { api } from './api.js';
import { store } from './store.js';
import { ICON } from './icons.js';
import { esc, openSheet, closeSheet, confirmDialog, toast, guard } from './ui.js';

/**
 * 5 个位次方块：固定大小，编号 1–5。
 *  - is-free    空闲
 *  - is-taken   已被其他门禁占用
 *  - is-current 当前门禁所在位次
 */
function chipsHtml(door) {
  const max = store.maxFavorites;
  const favs = store.favorites;
  let html = '<div class="chips">';
  for (let p = 1; p <= max; p += 1) {
    const occupant = favs.find((f) => Number(f.priority) === p) || null;
    const isCurrent = !!(occupant && occupant.id === door.id);
    const cls = isCurrent ? 'is-current' : (occupant ? 'is-taken' : 'is-free');
    const state = isCurrent ? '当前位次' : (occupant ? `已被「${occupant.name}」占用` : '空闲位次');
    const taken = occupant && !isCurrent ? ` data-taken="${esc(occupant.name)}"` : '';
    html += `<button type="button" class="chip ${cls}" data-p="${p}"${taken}`
      + ` aria-label="第 ${p} 位，${esc(state)}" title="第 ${p} 位 · ${esc(state)}">${p}</button>`;
  }
  return `${html}</div>`;
}

function applyFavoriteResult(data) {
  const list = [];
  if (data && data.door) list.push(data.door);
  if (data && Array.isArray(data.favorites)) list.push(...data.favorites);
  store.mergeDoors(list);
}

/**
 * @param {string} doorId
 * @param {{showPriority?:boolean, onChanged?:Function}} options
 */
export function openDoorSheet(doorId, options = {}) {
  const showPriority = !!options.showPriority;
  const onChanged = typeof options.onChanged === 'function' ? options.onChanged : null;
  const door = store.findDoor(doorId);
  if (!door) {
    toast('门禁不存在，请刷新后重试', 'err');
    return null;
  }

  const defaultName = door.defaultName || door.name || '';
  const favCount = store.favorites.length;
  const maxFav = store.maxFavorites;

  const body = `
    <div class="sheet__section">
      <label class="sheet__label" for="ds-name">重命名</label>
      <input class="input" id="ds-name" type="text" maxlength="20"
             value="${esc(door.name)}" placeholder="${esc(defaultName)}"
             autocomplete="off" spellcheck="false">
      <div class="field__hint">限1-20个字符</div>
    </div>

    <div class="sheet__actions">
      <button type="button" class="btn btn--primary btn--block" data-act="rename">
        ${ICON.pencil}保存名称
      </button>
      <button type="button" class="btn btn--ghost btn--block" data-act="reset">
        ${ICON.undo}恢复默认名称
      </button>
    </div>

    <div class="sheet__section">
      <span class="sheet__label">首页收藏</span>
      ${showPriority ? chipsHtml(door) : ''}
      <div class="sheet__hint" id="ds-hint">
        ${door.favorite
          ? `当前已收藏到首页第 ${esc(door.priority)} 位`
          : (favCount >= maxFav
              ? `首页 ${maxFav} 个位次已满，点击某个位次可与该门禁交换`
              : `点击一个位次即可收藏到首页（还有 ${maxFav - favCount} 个空位）`)}
      </div>
    </div>

    <div class="sheet__actions">
      ${door.favorite
        ? `<button type="button" class="btn btn--danger btn--block" data-act="unfav">${ICON.starOutline}取消收藏</button>`
        : `<button type="button" class="btn btn--outline btn--block" data-act="fav">${ICON.star}收藏到首页</button>`}
      <button type="button" class="btn btn--ghost btn--block" data-act="close">关闭</button>
    </div>`;

  return openSheet({
    title: door.name,
    sub: `默认名称：${defaultName}${door.groupName ? ` · ${door.groupName}` : ''}`,
    body,
    onMount(sheet) {
      const nameInput = sheet.querySelector('#ds-name');
      const hintEl = sheet.querySelector('#ds-hint');

      function setHint(text) { if (hintEl) hintEl.textContent = text; }

      function done(message) {
        closeSheet();
        if (message) toast(message, 'ok');
        if (onChanged) onChanged();
      }

      /* 重命名 */
      async function doRename() {
        const value = (nameInput.value || '').trim();
        const btn = sheet.querySelector('[data-act="rename"]');
        if (btn) btn.disabled = true;
        try {
          const updated = await api.renameDoor(door.id, value);
          store.mergeDoors([updated]);
          done('名称已更新');
        } catch (err) {
          if (btn) btn.disabled = false;
          toast(err.message || '重命名失败，请重试', 'err');
        }
      }

      /* 恢复默认名称 */
      async function doReset() {
        const btn = sheet.querySelector('[data-act="reset"]');
        if (btn) btn.disabled = true;
        try {
          const updated = await api.resetDoorName(door.id);
          store.mergeDoors([updated]);
          done('已恢复默认名称');
        } catch (err) {
          if (btn) btn.disabled = false;
          toast(err.message || '恢复默认名称失败，请重试', 'err');
        }
      }

      /* 收藏 / 取消收藏 */
      async function doFavorite(favorite, priority) {
        try {
          const data = await api.favoriteDoor({ doorId: door.id, favorite, priority });
          applyFavoriteResult(data);
          done(favorite ? '已收藏到首页' : '已取消收藏');
        } catch (err) {
          if (err && err.code === 'FAVORITES_FULL') {
            setHint(err.message || '首页收藏已满，请先取消一个收藏');
            toast(err.message || '首页收藏已满（最多 5 个）', 'warn');
          } else {
            toast(err.message || '操作失败，请重试', 'err');
          }
        }
      }

      sheet.addEventListener('click', guard(async (e) => {
        const btn = e.target.closest ? e.target.closest('[data-act], .chip') : null;
        if (!btn) return;

        if (btn.classList.contains('chip')) {
          const priority = Number(btn.dataset.p);
          if (btn.classList.contains('is-current')) {
            setHint(`已经是第 ${priority} 位`);
            return;
          }
          const taken = btn.dataset.taken;
          if (taken) {
            const ok = await confirmDialog({
              title: `交换第 ${priority} 位`,
              message: `第 ${priority} 位已被「${taken}」占用，确认后两者交换位次。`,
              okText: '交换位次',
            });
            if (!ok) return;
          }
          await doFavorite(true, priority);
          return;
        }

        switch (btn.dataset.act) {
          case 'rename': {
            const value = (nameInput.value || '').trim();
            if (value.length > 20) { toast('名称不能超过 20 个字符', 'warn'); return; }
            await doRename();
            break;
          }
          case 'reset': await doReset(); break;
          case 'fav': await doFavorite(true, undefined); break;
          case 'unfav': await doFavorite(false, undefined); break;
          case 'close': closeSheet(); break;
          default: break;
        }
      }));

      /* 输入框回车 = 保存名称（不自动聚焦，避免一进设置就弹出输入法） */
      if (nameInput) {
        nameInput.addEventListener('keydown', guard(async (e) => {
          if (e.key === 'Enter') { e.preventDefault(); await doRename(); }
        }));
      }
    },
  });
}

export default openDoorSheet;
