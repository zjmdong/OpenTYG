/**
 * server/prefs.mjs — 用户偏好的数据模型与纯函数
 *
 * 分两层：
 *  - 账号级：`displayName`（本应用内的显示名）、`selectedHouseholdId`（上次选的房产）
 *  - **房产级**：`households[<householdId>] = { customNames, favorites, order }`
 *
 * 为什么房产级必须分桶：不同房产的门禁集合可能完全一样（同一小区不同楼栋很常见），
 * 若共享一份 favorites/自定义名称，在 A 房产收藏的门禁到 B 房产也会显示"已收藏"，
 * 反之亦然——用户会认为"设置没保存"。
 *
 * 抽成独立模块的另一个原因：这些是纯函数，可以脱离 HTTP/上游直接单测
 * （见 test/security.test.mjs）。
 */

export const MAX_FAVORITES = 5;

/** 偏好文件格式版本。1 = 旧版（房产级字段在顶层）；2 = 按序号房产分桶；3 = 稳定物理身份分桶并归档旧序号偏好。 */
export const PREFS_SCHEMA_VERSION = 3;

/** 判断是否为「旧版格式」：顶层带房产级字段且没有 households 分桶。 */
export function isLegacyPrefs(raw) {
  if (!raw || typeof raw !== 'object') return false;
  const hasBuckets = raw.households && typeof raw.households === 'object' && Object.keys(raw.households).length > 0;
  if (hasBuckets) return false;
  return Boolean((raw.favorites && raw.favorites.length)
    || (raw.order && raw.order.length)
    || (raw.customNames && Object.keys(raw.customNames).length));
}

export const emptyHouseholdPrefs = () => ({ customNames: {}, favorites: [], order: [] });

export const emptyPrefs = () => ({ schemaVersion: PREFS_SCHEMA_VERSION, selectedHouseholdId: null, displayName: '', households: {}, legacy: null });

/** 取某个房产的偏好桶（不存在则返回空桶，不落盘）。 */
export function householdPrefs(prefs, householdId) {
  if (!householdId) return emptyHouseholdPrefs();
  const bucket = prefs?.households?.[householdId];
  if (!bucket) return emptyHouseholdPrefs();
  return {
    customNames: { ...(bucket.customNames || {}) },
    favorites: Array.isArray(bucket.favorites) ? bucket.favorites : [],
    order: Array.isArray(bucket.order) ? bucket.order : [],
  };
}

/** 写回某个房产的偏好桶（就地修改 prefs）。 */
export function setHouseholdPrefs(prefs, householdId, next) {
  if (!householdId) return prefs;
  prefs.households = prefs.households || {};
  prefs.households[householdId] = {
    customNames: { ...(next.customNames || {}) },
    favorites: Array.isArray(next.favorites) ? next.favorites : [],
    order: Array.isArray(next.order) ? next.order : [],
  };
  return prefs;
}

/**
 * 归一化偏好对象。
 *
 * 旧版（房产级字段放在顶层）的处理原则是**绝不丢数据**：
 *  - 有 `selectedHouseholdId` → 迁进该房产的桶（旧数据确实属于它）
 *  - 没有 `selectedHouseholdId` → **不猜归属**，原样保留在 `legacy` 字段里，
 *    等用户下次选定房产时再迁入。宁可暂时不生效，也不能把数据搬错地方或丢掉。
 *
 * 返回值上的 `migrated: true` 表示发生了迁移、调用方应写回一次；它不是持久化字段。
 */
export function normalizePrefs(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const prefs = {
    schemaVersion: PREFS_SCHEMA_VERSION,
    selectedHouseholdId: typeof value.selectedHouseholdId === 'string' ? value.selectedHouseholdId : null,
    displayName: typeof value.displayName === 'string' ? value.displayName : '',
    households: {},
    legacy: null,
    archivedOrdinalPrefs: value.archivedOrdinalPrefs || null,
  };
  for (const [id, bucket] of Object.entries(value.households || {})) {
    if (!id || !bucket || typeof bucket !== 'object') continue;
    prefs.households[id] = {
      customNames: { ...(bucket.customNames || {}) },
      favorites: Array.isArray(bucket.favorites) ? bucket.favorites : [],
      order: Array.isArray(bucket.order) ? bucket.order : [],
    };
  }

  // 未被迁移的旧数据（上一轮保留下来、或本次新发现但无归属）原样带着走
  if (value.legacy && typeof value.legacy === 'object') {
    prefs.legacy = {
      customNames: { ...(value.legacy.customNames || {}) },
      favorites: Array.isArray(value.legacy.favorites) ? value.legacy.favorites : [],
      order: Array.isArray(value.legacy.order) ? value.legacy.order : [],
    };
  }

  if (isLegacyPrefs(value)) {
    const target = prefs.selectedHouseholdId;
    if (target && !prefs.households[target]) {
      prefs.households[target] = {
        customNames: { ...(value.customNames || {}) },
        favorites: Array.isArray(value.favorites) ? value.favorites : [],
        order: Array.isArray(value.order) ? value.order : [],
      };
      prefs.migrated = true;
    } else if (!target && !prefs.legacy) {
      // 没有归属信息：保留下来而不是丢掉。用户下次选定房产时会自动迁入。
      prefs.legacy = {
        customNames: { ...(value.customNames || {}) },
        favorites: Array.isArray(value.favorites) ? value.favorites : [],
        order: Array.isArray(value.order) ? value.order : [],
      };
      prefs.migrated = true;
    }
  }
  // Original IDs were array positions. Never guess their physical addresses after reordering.
  if (Number(value.schemaVersion || 1) < 3) {
    prefs.archivedOrdinalPrefs = structuredClone(value);
    prefs.households = {}; prefs.legacy = null; prefs.selectedHouseholdId = null;
    prefs.migrated = true;
  }
  return prefs;
}

/** 把 legacy 里保留的旧数据迁入指定房产（用户在迁移后被选中时调用）。返回是否有变化。 */
export function adoptLegacy(prefs, householdId) {
  if (!householdId || !prefs?.legacy) return false;
  const legacy = prefs.legacy;
  const hasData = (legacy.favorites?.length) || (legacy.order?.length) || Object.keys(legacy.customNames || {}).length;
  prefs.legacy = null;
  if (!hasData) return false;                     // 空 legacy 直接丢弃
  if (prefs.households?.[householdId]) {
    // 该房产已有自己的数据：不覆盖，把 legacy 的收藏按空闲位次补进去
    const bucket = prefs.households[householdId];
    const used = new Set((bucket.favorites || []).map(f => f.doorId));
    for (const item of legacy.favorites || []) {
      if (used.has(item.doorId)) continue;
      if ((bucket.favorites || []).length >= MAX_FAVORITES) break;
      bucket.favorites = [...(bucket.favorites || []), item];
      used.add(item.doorId);
    }
    bucket.favorites = normalizeFavorites(bucket.favorites);
    for (const [id, name] of Object.entries(legacy.customNames || {})) {
      if (!bucket.customNames[id]) bucket.customNames[id] = name;
    }
    return true;
  }
  setHouseholdPrefs(prefs, householdId, legacy);
  return true;
}

/** 收藏位次规范化：始终 1..n 连续。 */
export const normalizeFavorites = entries => [...(entries || [])]
  .sort((a, b) => a.priority - b.priority)
  .map((item, index) => ({ doorId: item.doorId, priority: index + 1 }));

/**
 * 收藏/取消收藏。
 *
 * 位次规则（契约，见 docs/api.md）：
 *  - 不指定位次：占用最小空闲位次；没有空闲位次则拒绝（FAVORITES_FULL）
 *  - 指定位次且该位次空闲：直接占用
 *  - 指定位次且该位次已被别的门占用：**目标门拿到该位次，原占位门移到目标门原来的位次**
 *    （两门互换）。若目标门原本没有位次（新收藏），原占位门顺延到最近的空闲位次。
 *    任何情况下都不丢失收藏。
 *
 * 入参是**某个房产的收藏数组**（不是整个 prefs）。
 * 抛出带 `code` 的 Error（FAVORITES_FULL / INVALID_INPUT），由调用方翻译成 HTTP 错误。
 */
export function addFavorite(entries, doorId, priority) {
  const factory = error => {
    const e = new Error(error.code);
    e.code = error.code;
    e.message = error.message || error.code;
    return e;
  };
  const current = normalizeFavorites(entries);
  const existing = current.find(item => item.doorId === doorId);
  const without = current.filter(item => item.doorId !== doorId);
  if (existing && priority === undefined) return current;
  if (!existing && without.length >= MAX_FAVORITES) throw factory({ code: 'FAVORITES_FULL' });
  if (priority === undefined) {
    const used = new Set(without.map(item => item.priority));
    let slot = MAX_FAVORITES;
    for (let index = 1; index <= MAX_FAVORITES; index += 1) if (!used.has(index)) { slot = index; break; }
    return normalizeFavorites([...without, { doorId, priority: slot }]);
  }
  const slot = Number(priority);
  if (!Number.isInteger(slot) || slot < 1 || slot > MAX_FAVORITES) {
    throw factory({ code: 'INVALID_INPUT', message: '首页优先级需为 1-5' });
  }
  const kept = without.map(item => ({ ...item }));
  const occupant = kept.find(item => item.priority === slot);
  if (occupant) {
    if (existing) {
      // 两门互换：目标门拿 slot，原占位门去目标门原来的位次
      occupant.priority = existing.priority;
    } else {
      // 目标门是新收藏：原占位门顺延到最近的空闲位次，避免与 slot 冲突
      const used = new Set(kept.filter(item => item !== occupant).map(item => item.priority));
      used.add(slot);
      let free = 1;
      while (used.has(free) && free <= MAX_FAVORITES) free += 1;
      occupant.priority = free;
    }
  }
  kept.push({ doorId, priority: slot });
  return normalizeFavorites(kept);
}

export const removeFavorite = (entries, doorId) =>
  normalizeFavorites((entries || []).filter(item => item.doorId !== doorId));

/**
 * 把「服务端目录 + 该房产的偏好桶」合成前端直接可渲染的门禁对象。
 * `doors` 为该房产的门禁目录（已按服务端顺序排好）。
 */
export function buildDoors(doors, prefs, householdId) {
  const known = new Set(doors.map(door => door.id));
  const bucket = householdPrefs(prefs, householdId);
  const stored = Array.isArray(bucket.order) ? bucket.order.filter(id => known.has(id)) : [];
  const ordered = [...stored, ...doors.map(door => door.id).filter(id => !stored.includes(id))];
  const priorityOf = new Map((bucket.favorites || []).map(item => [item.doorId, item.priority]));
  return ordered.map((id, index) => {
    const door = doors.find(item => item.id === id);
    const customName = typeof bucket.customNames?.[id] === 'string' ? bucket.customNames[id] : '';
    return {
      id: door.id,
      name: customName || door.name,
      defaultName: door.name,
      customName,
      groupName: door.groupName || '',
      source: door.source === 'group' ? 'group' : 'independent',
      favorite: priorityOf.has(door.id),
      priority: priorityOf.get(door.id) ?? null,
      order: index,
      displayId: door.displayId || '',
      isExit: door.isExit === '1',
    };
  });
}

export const favoritesOf = (doors, max = MAX_FAVORITES) =>
  doors.filter(door => door.favorite).sort((a, b) => a.priority - b.priority).slice(0, max);
