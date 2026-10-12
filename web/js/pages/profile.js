/**
 * pages/profile.js — 设置（原「我的」）
 * 契约：docs/api.md GET /api/me、POST /api/me/name、§3.3 POST /api/households/select
 *  一级页：头像 + 可编辑显示名 + 脱敏账号 + 外观（浅色/深色/跟随系统）
 *          + 我的房产（单选切换）+ 账号信息（二级页）+ 退出登录
 *  二级页：账号信息详情（账号、登录方式、登录时间、门禁数量、本应用显示名）
 */

import { api } from '../api.js';
import { store, loadDoors, maskAccount } from '../store.js';
import { ICON } from '../icons.js';
import { esc, toast, confirmDialog, formatTime, guard } from '../ui.js';
import { getTheme, setTheme, THEMES, THEME_LABELS } from '../theme.js';
import { pwaInstallLabel } from '../pwa.js';

export default {
  path: '/profile',
  tabbar: true,

  render(ctx) {
    const root = ctx.root;
    const life = { destroyed: false, selecting: null, me: store.state.me || null, view: 'main', editing: false };

    root.innerHTML = `
      <div class="page page--profile">
        <header class="page-head">
          <div class="page-head__left">
            <button type="button" class="icon-btn is-hidden" id="me-back" aria-label="返回">${ICON.back}</button>
          </div>
          <h1 class="page-head__title" id="me-title">设置</h1>
          <div class="page-head__actions">
            <button type="button" class="icon-btn" id="me-refresh" aria-label="刷新">${ICON.refresh}</button>
          </div>
        </header>
        <div class="page-body" id="me-body"></div>
      </div>`;

    const bodyEl = root.querySelector('#me-body');
    const titleEl = root.querySelector('#me-title');
    const backBtn = root.querySelector('#me-back');

    /* ------------------------------------------------------------ 工具 */
    function user() { return life.me && life.me.user ? life.me.user : (store.state.user || {}); }

    function loginTypeText(type) {
      if (type === 'sms') return '短信验证码登录';
      if (type === 'password') return '账号密码登录';
      return type ? String(type) : '—';
    }

    function avatarChar() {
      const u = user();
      const name = String(u.name || '').trim();
      if (name) return Array.from(name)[0];
      const acc = String(u.account || u.maskedAccount || '').trim();
      return acc ? acc[0] : '用';
    }

    function householdLabel(h) {
      return h.areaName || h.householdAddress || '未命名房产';
    }

    /* ------------------------------------------------------------ 渲染 */
    function renderMain() {
      const u = user();
      const me = life.me || {};
      const households = (me.households && me.households.length ? me.households : store.state.households) || [];
      const theme = getTheme();

      bodyEl.innerHTML = `
        <section class="profile-card">
          <div class="avatar">${esc(avatarChar())}</div>
          <div class="profile-card__meta">
            ${life.editing ? `
              <div class="name-edit">
                <input class="input input--inline" id="me-name-input" type="text" maxlength="20"
                       value="${esc(u.hasCustomName ? u.name : '')}"
                       placeholder="${esc(u.upstreamName || '未命名用户')}"
                       autocomplete="off" spellcheck="false">
                <button type="button" class="btn btn--primary btn--sm" id="me-name-save">保存</button>
                <button type="button" class="btn btn--ghost btn--sm" id="me-name-cancel">取消</button>
              </div>
              <div class="field__hint">1–20 个字符，留空保存即恢复默认显示名。</div>
            ` : `
              <button type="button" class="name-btn" id="me-name-edit" aria-label="修改显示名称">
                <span class="profile-card__name">${esc(u.name || '未命名用户')}</span>
                <span class="name-btn__icon">${ICON.pencil}</span>
              </button>
            `}
            <div class="profile-card__acc">${esc(u.maskedAccount || maskAccount(u.account))}</div>
            <div class="profile-card__tags">
              <span class="tag">${esc(loginTypeText(u.loginType))}</span>
              ${me.remembered === true ? '<span class="tag">记住登录</span>' : ''}
            </div>
          </div>
        </section>

        <section class="panel">
          <div class="panel__title">外观</div>
          <div class="seg" role="group" aria-label="外观主题">
            ${THEMES.map((mode) => `
              <button type="button" class="seg__item${theme === mode ? ' is-active' : ''}"
                      data-theme-mode="${mode}" aria-pressed="${theme === mode ? 'true' : 'false'}">
                ${esc(THEME_LABELS[mode])}
              </button>`).join('')}
          </div>
        </section>

        <section class="panel">
          <div class="panel__title">我的房产（单选）</div>
          <div class="hh-list">
            ${households.length ? households.map(hhHtml).join('') : '<div class="empty__text" style="padding:10px 0">暂无房产信息</div>'}
          </div>
        </section>

        <section class="panel panel--list">
          <button type="button" class="row" id="me-account-entry">
            <span class="row__label">账号信息</span>
            <span class="row__value">${esc(u.maskedAccount || maskAccount(u.account))}</span>
            <span class="row__chev">${ICON.back}</span>
          </button>
        </section>

        <section class="panel panel--list">
          <button type="button" class="row" data-pwa-install>
            <span class="row__label">安装应用</span>
            <span class="row__value" data-pwa-label>${esc(pwaInstallLabel())}</span>
            <span class="row__chev">${ICON.back}</span>
          </button>
        </section>

        <div class="page-foot">
          <button type="button" class="btn btn--danger btn--block" id="me-logout">${ICON.logout}退出登录</button>
        </div>`;
    }

    function renderAccount() {
      const u = user();
      const me = life.me || {};
      const doorCount = Number.isFinite(Number(me.doorCount)) ? Number(me.doorCount) : store.state.doors.length;
      bodyEl.innerHTML = `
        <section class="panel">
          <div class="panel__title">账号信息</div>
          <div class="kv"><span class="kv__k">显示名称</span><span class="kv__v">${esc(u.name || '未命名用户')}</span></div>
          ${u.upstreamName ? `<div class="kv"><span class="kv__k">账号姓名</span><span class="kv__v">${esc(u.upstreamName)}</span></div>` : ''}
          <div class="kv"><span class="kv__k">账号</span><span class="kv__v">${esc(u.maskedAccount || maskAccount(u.account))}</span></div>
          <div class="kv"><span class="kv__k">登录方式</span><span class="kv__v">${esc(loginTypeText(u.loginType))}</span></div>
          <div class="kv"><span class="kv__k">登录时间</span><span class="kv__v">${esc(formatTime(me.loginAt))}</span></div>
          <div class="kv"><span class="kv__k">门禁数量</span><span class="kv__v">${doorCount} 个</span></div>
        </section>`;
    }

    function render() {
      const accountView = life.view === 'account';
      backBtn.classList.toggle('is-hidden', !accountView);
      titleEl.textContent = accountView ? '账号信息' : '设置';
      if (accountView) renderAccount();
      else renderMain();
    }

    function hhHtml(h) {
      const selectedId = (life.me && life.me.selectedHouseholdId) || store.state.selectedHouseholdId;
      const selected = h.id === selectedId;
      const available = h.available !== false && String(h.valid === undefined ? '1' : h.valid) === '1';
      const busy = life.selecting === h.id;
      return `
        <button type="button" class="hh${selected ? ' is-selected' : ''}" data-hh="${esc(h.id)}"
                ${available ? '' : 'disabled'} aria-pressed="${selected ? 'true' : 'false'}">
          <span class="hh__radio" aria-hidden="true"></span>
          <span class="hh__main">
            <span class="hh__name">${esc(householdLabel(h))}${busy ? ' · 切换中…' : ''}</span>
            <span class="hh__addr">${esc(h.householdAddress || '')}</span>
            <span class="hh__meta">
              ${selected ? '<span class="pill pill--ok">当前房产</span>' : ''}
              ${available ? '' : '<span class="pill pill--warn">不可用</span>'}
              ${h.validityDescription ? `<span class="pill">${esc(h.validityDescription)}</span>` : ''}
            </span>
          </span>
        </button>`;
    }

    /* ------------------------------------------------------------ 名称 */
    function beginEditName() {
      life.editing = true;
      render();
      const input = bodyEl.querySelector('#me-name-input');
      // 只有用户主动点「改名」时才聚焦并唤起输入法
      if (input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    }

    async function saveName() {
      const input = bodyEl.querySelector('#me-name-input');
      if (!input) return;
      const value = (input.value || '').trim();
      if ([...value].length > 20) { toast('名称不能超过 20 个字符', 'warn'); return; }
      const btn = bodyEl.querySelector('#me-name-save');
      if (btn) btn.disabled = true;
      try {
        const data = await api.setDisplayName(value);
        if (life.me && life.me.user) {
          life.me.user.name = data.name;
          life.me.user.hasCustomName = data.hasCustomName;
        }
        if (store.state.user) {
          store.state.user.name = data.name;
          store.state.user.hasCustomName = data.hasCustomName;
        }
        life.editing = false;
        render();
        toast('名称已更新', 'ok');
      } catch (err) {
        if (btn) btn.disabled = false;
        toast(err.message || '名称保存失败，请重试', 'err');
      }
    }

    /* ------------------------------------------------------------ 事件 */
    async function selectHousehold(householdId, name) {
      if (life.selecting) return;
      if (householdId === (life.me && life.me.selectedHouseholdId) ||
          householdId === store.state.selectedHouseholdId) {
        toast('已经是当前房产', 'info');
        return;
      }
      life.selecting = householdId;
      render();
      try {
        await api.selectHousehold(householdId);
        store.setSelectedHousehold(householdId);
        // 切换房产会作废旧目录：先清空再重新加载
        store.setDoors({ doors: [], favorites: [] });
        if (life.me) { life.me.selectedHouseholdId = householdId; }
        await loadDoors(false);
        toast(`已切换到 ${name || '新房产'}`, 'ok');
        ctx.navigate('/home');
      } catch (err) {
        toast(err.message || '切换房产失败，请重试', 'err');
        life.selecting = null;
        if (!life.destroyed) render();
      }
    }

    bodyEl.addEventListener('click', guard(async (e) => {
      const target = e.target;
      const hhBtn = target.closest ? target.closest('[data-hh]') : null;
      if (hhBtn && !hhBtn.disabled) {
        const households = (life.me && life.me.households) || store.state.households;
        const h = households.find((x) => x.id === hhBtn.dataset.hh);
        await selectHousehold(hhBtn.dataset.hh, h ? householdLabel(h) : '');
        return;
      }

      const themeBtn = target.closest ? target.closest('[data-theme-mode]') : null;
      if (themeBtn) {
        setTheme(themeBtn.dataset.themeMode);
        render();
        return;
      }

      if (target.closest && target.closest('#me-name-edit')) { beginEditName(); return; }
      if (target.closest && target.closest('#me-name-save')) { await saveName(); return; }
      if (target.closest && target.closest('#me-name-cancel')) { life.editing = false; render(); return; }
      if (target.closest && target.closest('#me-account-entry')) { life.view = 'account'; render(); return; }

      const logoutBtn = target.closest ? target.closest('#me-logout') : null;
      if (logoutBtn) {
        const ok = await confirmDialog({
          title: '退出登录',
          message: '退出后需要重新登录才能开门，确定退出吗？',
          okText: '退出登录',
          danger: true,
        });
        if (!ok) return;
        logoutBtn.disabled = true;
        try {
          await api.logout();
        } catch (err) {
          console.error('[opentyg] logout failed', err);
        }
        store.clearSession();
        toast('已退出登录', 'ok');
        ctx.navigate('/login', { replace: true });
      }
    }));

    // 名称输入框回车保存 / Esc 取消
    bodyEl.addEventListener('keydown', guard(async (e) => {
      if (!e.target || e.target.id !== 'me-name-input') return;
      if (e.key === 'Enter') { e.preventDefault(); await saveName(); }
      else if (e.key === 'Escape') { life.editing = false; render(); }
    }));

    backBtn.addEventListener('click', () => { life.view = 'main'; render(); });

    root.querySelector('#me-refresh').addEventListener('click', guard(async () => {
      const btn = root.querySelector('#me-refresh');
      btn.disabled = true;
      try { await fetchMe(); } catch (err) { toast(err.message || '刷新失败', 'err'); }
      finally { btn.disabled = false; }
    }));

    /* ------------------------------------------------------------ 数据 */
    async function fetchMe() {
      const me = await api.getMe();
      if (life.destroyed) return;
      life.me = me;
      store.setMe(me);
      if (me && me.user) {
        store.state.user = me.user;
        store.state.authenticated = true;
      }
      if (Array.isArray(me && me.households) && me.households.length) {
        store.state.households = me.households.slice();
      }
      if (me && me.selectedHouseholdId) store.state.selectedHouseholdId = me.selectedHouseholdId;
      render();
    }

    render();
    fetchMe().catch((err) => {
      if (life.destroyed) return;
      toast(err.message || '账号信息加载失败', 'err');
    });

    return function destroy() { life.destroyed = true; };
  },
};
