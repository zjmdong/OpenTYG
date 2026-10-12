/**
 * icons.js — 全部图标（内联 SVG，零外部依赖）
 * 统一 24x24 viewBox、currentColor 描边，尺寸由 CSS 控制。
 */

const STROKE = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';

function svg(inner, attrs = '') {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" ${attrs}>${inner}</svg>`;
}

/** 统一描边包裹 */
function line(inner) {
  return svg(`<g ${STROKE}>${inner}</g>`);
}

export const ICON = {
  /* 挂锁：门禁圆钮主图标（实心锁体 + 镂空锁孔）
     锁孔用 CSS 变量而不是写死颜色：深色主题下锁体颜色会变，锁孔必须跟着变。 */
  lock: svg(
    '<path d="M7.7 10.3V7.7a4.3 4.3 0 0 1 8.6 0v2.6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>' +
    '<rect x="4.9" y="10.3" width="14.2" height="10.1" rx="2.8" fill="currentColor"/>' +
    '<circle class="lock-hole" cx="12" cy="15.4" r="1.5"/>'
  ),

  /* 首页（房子） */
  house: line(
    '<path d="M4.2 10.4 12 4.3l7.8 6.1"/>' +
    '<path d="M6.2 11.6v7.1a1.6 1.6 0 0 0 1.6 1.6h8.4a1.6 1.6 0 0 0 1.6-1.6v-7.1"/>' +
    '<path d="M10.2 20.3v-4.6h3.6v4.6"/>'
  ),

  /* 钥匙串 */
  keychain: line(
    '<circle cx="8.6" cy="8.4" r="4.4"/>' +
    '<path d="M11.7 11.5 19.6 19.4"/>' +
    '<path d="M17.2 17 15 19.2"/>' +
    '<path d="M19.6 19.4 21.2 17.8"/>'
  ),

  /* 全部门禁（九宫格） */
  grid: line(
    '<rect x="3.6" y="3.6" width="7" height="7" rx="2.1"/>' +
    '<rect x="13.4" y="3.6" width="7" height="7" rx="2.1"/>' +
    '<rect x="3.6" y="13.4" width="7" height="7" rx="2.1"/>' +
    '<rect x="13.4" y="13.4" width="7" height="7" rx="2.1"/>'
  ),

  /* 设置 */
  gear: line(
    '<circle cx="12" cy="12" r="3.1"/>' +
    '<path d="M19.5 14.2a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.55V21a2 2 0 1 1-4 0v-.11a1.7 1.7 0 0 0-1.11-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1.03H3a2 2 0 1 1 0-4h.11A1.7 1.7 0 0 0 4.66 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1.03-1.55V3a2 2 0 1 1 4 0v.11a1.7 1.7 0 0 0 1.03 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.55 1.03H21a2 2 0 1 1 0 4h-.11a1.7 1.7 0 0 0-1.39 1.17Z"/>'
  ),

  /* 搜索 */
  search: line('<circle cx="11" cy="11" r="6.3"/><path d="m15.7 15.7 4.3 4.3"/>'),

  /* 刷新 */
  refresh: line('<path d="M19.6 12a7.6 7.6 0 1 1-2.2-5.4"/><path d="M19.9 4.4v4.3h-4.3"/>'),

  /* 退出登录 */
  logout: line(
    '<path d="M14.8 4.6h2.7a2.4 2.4 0 0 1 2.4 2.4v10a2.4 2.4 0 0 1-2.4 2.4h-2.7"/>' +
    '<path d="M10.3 8 6.3 12l4 4"/>' +
    '<path d="M6.3 12h8.4"/>'
  ),

  /* 关闭 */
  close: line('<path d="m6.4 6.4 11.2 11.2M17.6 6.4 6.4 17.6"/>'),

  /* 成功 */
  check: line('<circle cx="12" cy="12" r="9.2"/><path d="m7.9 12.4 2.9 2.9 5.4-6.1"/>'),

  /* 失败 */
  cross: line('<circle cx="12" cy="12" r="9.2"/><path d="m9.1 9.1 5.8 5.8M14.9 9.1l-5.8 5.8"/>'),

  /* 提示 */
  warn: line('<path d="M12 3.9 21 19.5H3z"/><path d="M12 9.7v4.1M12 16.8h.01"/>'),

  /* 信息 */
  info: line('<circle cx="12" cy="12" r="9"/><path d="M12 11v5.2M12 7.9h.01"/>'),

  /* 星标（实心） */
  star: svg('<path d="M12 3.5l2.7 5.5 6 .87-4.35 4.24 1.03 5.99L12 17.28 6.62 20.1l1.03-5.99L3.3 9.87l6-.87z" fill="currentColor"/>'),

  /* 星标（空心） */
  starOutline: line('<path d="M12 3.5l2.7 5.5 6 .87-4.35 4.24 1.03 5.99L12 17.28 6.62 20.1l1.03-5.99L3.3 9.87l6-.87z"/>'),

  /* 重命名 */
  pencil: line('<path d="M4.5 19.5h3.3L19.1 8.2a2.2 2.2 0 0 0-3.1-3.1L4.5 16.4z"/><path d="M14.9 6.6 17.9 9.6"/>'),

  /* 恢复默认 */
  undo: line('<path d="M4.4 12a7.6 7.6 0 1 0 2.2-5.4"/><path d="M4.1 4.4v4.3h4.3"/>'),

  /* 返回 */
  back: line('<path d="M14.6 5.4 8 12l6.6 6.6"/>'),

  /* 门 */
  door: line(
    '<path d="M6.7 20.4V5.2c0-.9.7-1.6 1.6-1.6h7.4c.9 0 1.6.7 1.6 1.6v15.2"/>' +
    '<path d="M4.3 20.4h15.4"/>' +
    '<circle cx="14.1" cy="12.1" r="1" fill="currentColor" stroke="none"/>'
  ),

  /* 拖动把手 */
  grip: svg(
    '<g fill="currentColor">' +
    '<circle cx="9" cy="6.5" r="1.4"/><circle cx="15" cy="6.5" r="1.4"/>' +
    '<circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/>' +
    '<circle cx="9" cy="17.5" r="1.4"/><circle cx="15" cy="17.5" r="1.4"/>' +
    '</g>'
  ),

  /* 图片占位（图形码加载失败） */
  image: line('<rect x="3.6" y="4.6" width="16.8" height="14.8" rx="2.4"/><path d="m4.6 17 4.5-4.4 3.2 3 2.6-2.4 4.5 4.2"/><circle cx="9" cy="9.4" r="1.3"/>'),

  /* 手机短信 */
  phone: line('<rect x="6.6" y="2.8" width="10.8" height="18.4" rx="2.6"/><path d="M10.7 18.4h2.6"/>'),
};

export default ICON;
