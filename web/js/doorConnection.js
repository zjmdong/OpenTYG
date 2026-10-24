/** Connection preparation only: this module never sends an opening command. */
import { loadDoors, pendingDoors, store } from './store.js';
import { ApiError } from './api.js';

let initialized = false;
let opening = false;
let deferredWarmup = false;
let lastWarmupAt = -Infinity;

export async function warmDoorConnection() {
  if (!store.state.authenticated || !store.state.selectedHouseholdId || navigator.onLine === false || document.hidden) return;
  if (opening) { deferredWarmup = true; return; }
  if (!store.state.doorsPreview && store.state.directoryId && Date.now() - store.state.doorsLoadedAt < 2000) return;
  // visibilitychange, pageshow and online can describe the same foreground entry.
  if (Date.now() - lastWarmupAt < 2000) return;
  lastWarmupAt = Date.now();
  try { await loadDoors(false, { silent: store.state.doors.length > 0 }); }
  catch (error) {
    // Background preparation must not show a success/error dialog or log secrets.
    console.warn('[opentyg] 门禁连接预热未完成', error.code || 'NETWORK_ERROR');
  }
}

export function initDoorConnection() {
  if (initialized) return;
  initialized = true;
  let wasHidden = document.hidden;
  document.addEventListener('visibilitychange', () => {
    const resumed = wasHidden && !document.hidden;
    wasHidden = document.hidden;
    if (resumed) void warmDoorConnection();
  });
  window.addEventListener('pageshow', event => { if (event.persisted) void warmDoorConnection(); });
  window.addEventListener('online', () => { void warmDoorConnection(); });
}

/** A tap waits for preparation and uses its refreshed directory; action runs once. */
export async function withDoorConnection(action) {
  if (opening) throw new ApiError('BUSY', '正在处理上一个开门请求，请稍后重试', {}, 409);
  const generation = store.generation;
  const householdId = store.state.selectedHouseholdId;
  opening = true;
  try {
    // Share an existing warmup, but never add a GET in front of every hot tap.
    // The server validates and, if necessary, recovers before sending once.
    const pending = pendingDoors();
    if (pending) await pending;
    else if (!store.state.directoryId) await loadDoors(false, { silent: true });
    await Promise.resolve();
    if (navigator.onLine === false) throw new ApiError('NETWORK_ERROR', '当前处于离线状态，请联网后重试', {}, 0);
    if (store.generation !== generation || !store.state.authenticated || store.state.selectedHouseholdId !== householdId) {
      throw new ApiError('STALE_DIRECTORY', '房产或登录状态已变化，请重新选择门禁', {}, 409);
    }
    return await action();
  } finally {
    opening = false;
    if (deferredWarmup) {
      deferredWarmup = false;
      void warmDoorConnection();
    }
  }
}
