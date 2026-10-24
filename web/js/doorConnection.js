/** Connection preparation only: this module never sends an opening command. */
import { loadDoors, store } from './store.js';
import { ApiError } from './api.js';

let initialized = false;
let opening = false;
let deferredWarmup = false;
let lastWarmupAt = -Infinity;

export async function warmDoorConnection() {
  if (!store.state.authenticated || !store.state.selectedHouseholdId || navigator.onLine === false || document.hidden) return;
  if (opening) { deferredWarmup = true; return; }
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
    await loadDoors(false, { silent: true });
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
