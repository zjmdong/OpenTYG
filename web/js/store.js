/**
 * store.js — 内存状态（用户 / 房产 / 门禁列表 / 收藏）
 * 无持久化：刷新后通过 GET /api/auth/session 恢复。
 */

import { api, setDirectoryContext } from './api.js';
import { withConnectionProgress } from './connectionProgress.js';

const DEFAULT_MAX_FAVORITES = 5;
const DEFAULT_COOLDOWN_MS = 3000;

const state = {
  meta: null,                 // GET /api/meta
  authenticated: false,
  user: null,                 // { name, account, userAccount, loginType, maskedAccount }
  households: [],
  selectedHouseholdId: null,
  directoryId: null,
  doors: [],                  // 当前房产的完整门禁目录（按 order 排列）
  favorites: [],              // 由 doors 派生：favorite=true 且 priority 1..5
  doorsLoadedAt: 0,
  doorsLoading: false,
  doorsError: null,           // { code, message }
  me: null,                   // GET /api/me
};

const listeners = new Set();

export const store = {
  get state() { return state; },
  get generation() { return generation; },
  /** 当前门禁目录（按 order 排列） */
  get doors() { return state.doors; },
  /** 首页收藏（按 priority 升序，最多 maxFavorites 个） */
  get favorites() { return state.favorites; },

  subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  notify() {
    for (const fn of Array.from(listeners)) {
      try { fn(state); } catch (err) { console.error('[opentyg] store listener failed', err); }
    }
  },

  /* ------------------------------------------------------------ meta */
  setMeta(meta) {
    state.meta = meta && typeof meta === 'object' ? meta : null;
    this.notify();
  },
  get maxFavorites() {
    const n = state.meta && Number(state.meta.maxFavorites);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_FAVORITES;
  },
  get openCooldownMs() {
    const n = state.meta && Number(state.meta.openCooldownMs);
    return Number.isFinite(n) && n >= 0 ? n : DEFAULT_COOLDOWN_MS;
  },

  /* --------------------------------------------------------- session */
  applySession(data) {
    generation += 1;
    state.doorsLoading = false;
    state.doors = []; state.favorites = []; state.directoryId = null; state.doorsLoadedAt = 0;
    const d = data && typeof data === 'object' ? data : {};
    state.authenticated = !!d.authenticated;
    state.user = d.user || null;
    state.households = Array.isArray(d.households) ? d.households.slice() : [];
    state.selectedHouseholdId = d.selectedHouseholdId || null;
    if (!state.authenticated) {
      state.user = null;
      state.households = [];
      state.selectedHouseholdId = null;
      state.me = null;
      state.doors = [];
      state.favorites = [];
      state.doorsLoadedAt = 0;
      state.doorsError = null;
      state.directoryId = null;
    }
    this.notify();
  },

  clearSession() {
    generation += 1;
    state.authenticated = false;
    state.user = null;
    state.households = [];
    state.selectedHouseholdId = null;
    state.me = null;
    state.doors = [];
    state.favorites = [];
    state.doorsLoadedAt = 0;
    state.doorsError = null;
    state.doorsLoading = false;
    state.directoryId = null;
    this.notify();
  },

  setMe(me) { state.me = me || null; this.notify(); },

  /* ------------------------------------------------------ households */
  get household() {
    if (!state.selectedHouseholdId) return null;
    return state.households.find((h) => h && h.id === state.selectedHouseholdId) || null;
  },
  get householdName() {
    const hh = this.household;
    if (!hh) return '我的小区';
    return hh.areaName || hh.householdAddress || '我的小区';
  },
  setSelectedHousehold(id) {
    generation += 1;
    state.directoryId = null;
    state.selectedHouseholdId = id || null;
    this.notify();
  },

  /* ----------------------------------------------------------- doors */
  /** 用服务端返回的 door 对象列表覆盖本地同 id 项（保持原顺序，新项追加） */
  mergeDoors(list) {
    if (!Array.isArray(list) || !list.length) return;
    const byId = new Map(state.doors.map((d) => [d.id, d]));
    for (const incoming of list) {
      if (!incoming || !incoming.id) continue;
      const prev = byId.get(incoming.id);
      byId.set(incoming.id, prev ? Object.assign({}, prev, incoming) : incoming);
    }
    state.doors = state.doors.map((d) => byId.get(d.id) || d);
    for (const incoming of list) {
      if (incoming && incoming.id && !state.doors.some((d) => d.id === incoming.id)) {
        state.doors.push(incoming);
      }
    }
    state.favorites = deriveFavorites(state.doors, this.maxFavorites);
    this.notify();
  },

  /** GET /api/doors 的 data */
  setDoors(data) {
    const d = data && typeof data === 'object' ? data : {};
    let doors = Array.isArray(d.doors) ? d.doors.slice() : [];
    const favList = Array.isArray(d.favorites) ? d.favorites.filter((x) => x && x.id) : [];
    // 服务端 favorites 是位次权威来源，合并回 doors 防止交换后位次不同步
    if (favList.length) {
      const favById = new Map(favList.map((x) => [x.id, x]));
      doors = doors.map((door) => {
        const fav = favById.get(door && door.id);
        return fav ? Object.assign({}, door, fav) : door;
      });
    }
    state.doors = doors.filter(Boolean);
    if ('directoryId' in d) state.directoryId = d.directoryId || null;
    if (!state.doors.length) state.directoryId = null;
    // 契约：favorites 由后端给出「前 5 个」，其数组顺序即首页位次顺序。
    // 以后端数组顺序为准，缺失项按 priority 兜底补齐；后端未给时全部按 priority 派生。
    const max = this.maxFavorites;
    if (favList.length) {
      const head = favList.slice(0, max);
      const seen = new Set(head.map((f) => f.id));
      const rest = deriveFavorites(state.doors, max).filter((d) => !seen.has(d.id));
      state.favorites = head.concat(rest).slice(0, max);
    } else {
      state.favorites = deriveFavorites(state.doors, max);
    }
    state.doorsLoadedAt = Number(d.loadedAt) || Date.now();
    if (d.householdId) state.selectedHouseholdId = d.householdId;
    state.doorsError = null;
    this.notify();
  },

  setDoorsError(err) {
    state.doorsError = err
      ? { code: err.code || 'ERROR', message: err.message || '门禁加载失败' }
      : null;
    this.notify();
  },

  findDoor(id) { return state.doors.find((d) => d && d.id === id) || null; },
  applyDoorConnection(data) {
    if (state.authenticated && data?.householdId === state.selectedHouseholdId && typeof data.directoryId === 'string' && data.directoryId) {
      state.directoryId = data.directoryId;
    }
  },
};

export function deriveFavorites(doors, max = DEFAULT_MAX_FAVORITES) {
  return (doors || [])
    .filter((d) => d && d.favorite && Number.isFinite(Number(d.priority)))
    .sort((a, b) => Number(a.priority) - Number(b.priority))
    .slice(0, max);
}

/** 供 /api/me 使用 */
export function maskAccount(account) {
  const acc = String(account || '');
  if (!acc) return '—';
  if (/^\d{11}$/.test(acc)) return `${acc.slice(0, 3)}****${acc.slice(7)}`;
  if (acc.length <= 4) return acc;
  return `${acc.slice(0, 2)}****${acc.slice(-2)}`;
}

let inflightDoors = null;
let generation = 0;

/**
 * 拉取当前房产的门禁目录（同一时刻只允许一个请求）
 * @param {boolean} refresh true = 强制重建连接与目录
 */
export function loadDoors(refresh = false, { silent = false } = {}) {
  if (inflightDoors?.generation === generation) return inflightDoors.promise;
  const currentGeneration = generation;
  if (!silent) {
    state.doorsLoading = true;
    state.doorsError = null;
    store.notify();
  }

  const request = withConnectionProgress('connecting', () => api.getDoors(refresh))
    .then((data) => {
      if (currentGeneration === generation && state.authenticated) store.setDoors(data);
      return data;
    })
    .catch((err) => {
      if (!silent && currentGeneration === generation && state.authenticated) store.setDoorsError(err);
      throw err;
    })
    .finally(() => {
      if (currentGeneration === generation) {
        if (!silent) state.doorsLoading = false;
        inflightDoors = null;
        if (!silent) store.notify();
      }
    });
  inflightDoors = { generation: currentGeneration, promise: request };
  return request;
}

export default store;
setDirectoryContext(() => ({ householdId: state.selectedHouseholdId, directoryId: state.directoryId }));
