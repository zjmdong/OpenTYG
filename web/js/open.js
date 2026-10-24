/**
 * open.js — 开门流程（首页 / 全部门禁共用）
 *
 * 契约依据：docs/api.md POST /api/doors/open
 *  - 业务失败：HTTP 200 + { success:false, message } → 红色弹窗展示后端 message
 *  - 服务端自动恢复尚未发送的连接失败；不要求用户为了重连再按一次
 *  - WS_TIMEOUT / OPEN_RESULT_UNKNOWN → 明确提示“结果未知”，绝不自动重发
 *  - OPEN_COOLDOWN / BUSY → 轻提示，不弹窗
 */

import { api } from './api.js';
import { loadDoors, store } from './store.js';
import { showResult, toast } from './ui.js';
import { withDoorConnection } from './doorConnection.js';

const RESULT_UNKNOWN = new Set(['WS_TIMEOUT', 'OPEN_RESULT_UNKNOWN']);

/**
 * @param {string|{id:string,name?:string}} door
 * @returns {Promise<{ok:boolean, cooldown?:boolean, error?:Error, data?:object}>}
 */
export async function openDoor(door) {
  const doorId = typeof door === 'string' ? door : (door && door.id);
  if (!doorId) return { ok: false, error: new Error('缺少门禁 id') };

  const name = typeof door === 'object' && door ? door.name : '';
  const label = name || (store.findDoor(doorId) || {}).name || '门禁';
  const generation = store.generation;
  let commandRequested = false;

  try {
    const data = await withDoorConnection(async () => {
      commandRequested = true;
      try { return await api.openDoor(doorId); }
      catch (error) {
        // STALE_DIRECTORY is rejected by the server before any command is
        // queued. Refresh this intent once while retaining the one-tap guard.
        if (error.code !== 'STALE_DIRECTORY') throw error;
        commandRequested = false;
        const householdId = store.state.selectedHouseholdId;
        await loadDoors(false, { silent: true });
        if (store.generation !== generation || !store.state.authenticated || store.state.selectedHouseholdId !== householdId || !store.findDoor(doorId)) {
          throw new Error('门禁或登录状态已变化，请重新选择');
        }
        commandRequested = true;
        return api.openDoor(doorId);
      }
    });
    if (store.generation === generation) store.applyDoorConnection(data);

    if (data && data.success) {
      // 只有「开门成功」是 1 秒自动隐藏；其余结果提示保持默认 3 秒（需更长的阅读时间）
      showResult({ success: true, title: '开门成功', message: data.message || '门禁已开启', duration: 1000 });
      return { ok: true, data };
    }
    showResult({
      success: false,
      title: '开门失败',
      message: (data && data.message) || '门禁未响应，请重试',
    });
    return { ok: false, data };
  } catch (err) {
    const code = err && err.code;

    /* 结果未知：禁止自动重发 */
    if (RESULT_UNKNOWN.has(code) || (commandRequested && ['REQUEST_TIMEOUT', 'NETWORK_ERROR', 'BAD_RESPONSE'].includes(code))) {
      showResult({
        success: false,
        title: '结果未知',
        message: '结果未知，请核实门锁状态',
        duration: 4000,
      });
      return { ok: false, error: err, unknown: true };
    }

    if (code === 'OPEN_COOLDOWN') {
      toast(err.message || '操作过于频繁，请稍后再试', 'warn');
      return { ok: false, error: err, cooldown: true };
    }

    if (code === 'BUSY') {
      toast(err.message || '正在处理上一个请求，请稍后重试', 'warn');
      return { ok: false, error: err };
    }

    if (code === 'HOUSEHOLD_UNAVAILABLE') {
      showResult({
        success: false,
        title: '开门失败',
        message: err.message || '房产权限已失效，请联系物业',
      });
      return { ok: false, error: err };
    }

    if (code === 'NOT_LOGGED_IN' || code === 'SESSION_EXPIRED') {
      toast('登录状态已失效，请重新登录', 'warn');
      return { ok: false, error: err };
    }

    if (code === 'NETWORK_ERROR') {
      showResult({ success: false, title: '开门失败', message: '网络异常，请检查网络后重试' });
      return { ok: false, error: err };
    }

    showResult({
      success: false,
      title: '开门失败',
      message: (err && err.message) || `${label} 开门失败，请重试`,
    });
    return { ok: false, error: err };
  }
}

export default openDoor;
