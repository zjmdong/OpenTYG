/** Actual preparation stages and elapsed time; no invented percentage or ETA. */
import { api } from './api.js';
import { esc } from './ui.js';

const PHASES = {
  bootstrap: { step: 0, label: '正在连接应用服务' },
  service: { step: 0, label: '正在连接应用服务' },
  restoring: { step: 1, label: '正在恢复登录' },
  connecting: { step: 2, label: '正在连接门禁' },
  directory: { step: 3, label: '正在获取门禁列表' },
  retrying: { step: 2, label: '正在连接门禁' },
};
let active = null;

function description() {
  const phase = PHASES[active?.phase] || PHASES.service;
  const seconds = active ? Math.max(0, Math.floor((Date.now() - active.startedAt) / 1000)) : 0;
  return { ...phase, step: active?.step || phase.step, seconds,
    detail: seconds >= 5 ? `已等待 ${seconds} 秒 · 连接较慢，超时后可重试` : `已等待 ${seconds} 秒` };
}

export function connectionLoadingHtml() {
  const value = description();
  return `<div class="state-loading connection-progress" data-connection-progress aria-busy="true">
    <span class="spinner" aria-hidden="true"></span>
    <span data-connection-label role="status" aria-live="polite">${esc(value.label)}</span>
    <ol class="connection-progress__steps" aria-label="连接进度">
      ${['恢复登录','连接门禁','获取列表'].map((label, index) => `<li data-connection-step="${index + 1}"${value.step === index + 1 ? ' aria-current="step"' : ''}>${index + 1}. ${label}</li>`).join('')}
    </ol>
    <span class="connection-progress__detail" data-connection-elapsed>${esc(value.detail)}</span>
  </div>`;
}

function paint() {
  const value = description();
  for (const root of document.querySelectorAll('[data-connection-progress]')) {
    const label = root.querySelector('[data-connection-label]');
    if (label && label.textContent !== value.label) label.textContent = value.label;
    const elapsed = root.querySelector('[data-connection-elapsed]');
    if (elapsed) elapsed.textContent = value.detail;
    for (const step of root.querySelectorAll('[data-connection-step]')) {
      if (Number(step.dataset.connectionStep) === value.step) step.setAttribute('aria-current', 'step');
      else step.removeAttribute('aria-current');
    }
  }
}

export async function withConnectionProgress(phase, action) {
  const run = { phase, step: PHASES[phase]?.step, startedAt: Date.now(), polling: false };
  active = run;
  const tick = async () => {
    if (active !== run) return;
    paint();
    if (run.polling || run.phase === 'service' || document.hidden || Date.now() - run.startedAt < 500) return;
    run.polling = true;
    try {
      const status = await api.getConnectionStatus();
      if (active === run && PHASES[status.phase]) {
        run.phase = status.phase;
        run.step = [1,2,3].includes(status.step) ? status.step : PHASES[status.phase].step;
        paint();
      }
    } catch { /* The main request owns error handling; status is optional. */ }
    finally { run.polling = false; }
  };
  const timer = setInterval(tick, 1000);
  paint();
  try { return await action(); }
  finally { clearInterval(timer); if (active === run) active = null; }
}
