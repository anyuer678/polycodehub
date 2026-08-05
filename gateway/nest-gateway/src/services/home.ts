import { dbPool } from '../db';

export interface HomeModuleDef {
  key: string;
  label: string;
  defaultEnabled: boolean;
}

export const HOME_MODULES: HomeModuleDef[] = [
  { key: 'hero', label: '顶部横幅', defaultEnabled: true },
  { key: 'daily', label: '每日一题', defaultEnabled: true },
  { key: 'features', label: '功能入口', defaultEnabled: true },
  { key: 'stats', label: '平台统计', defaultEnabled: false },
  { key: 'badges', label: '技术栈徽章', defaultEnabled: false },
  { key: 'flow', label: '判题流程', defaultEnabled: false }
];

export function moduleDefaults(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const m of HOME_MODULES) out[m.key] = m.defaultEnabled;
  return out;
}

/** 读取已保存的模块开关；未保存过用默认值 */
export async function loadHomeModules(): Promise<Record<string, boolean>> {
  const result = await dbPool.query(`SELECT value FROM settings WHERE key = 'homepage_modules'`);
  const defaults = moduleDefaults();
  if (result.rows.length === 0) return defaults;
  try {
    const saved = JSON.parse(String(result.rows[0].value)) as Record<string, boolean>;
    const merged: Record<string, boolean> = { ...defaults, ...saved };
    return merged;
  } catch {
    return defaults;
  }
}

/** 保存开关（合并进已有配置，未知 key 忽略） */
export async function saveHomeModules(enabled: Record<string, boolean>): Promise<Record<string, boolean>> {
  const defaults = moduleDefaults();
  for (const key of Object.keys(enabled)) {
    if (key in defaults) defaults[key] = Boolean(enabled[key]);
  }
  await dbPool.query(
    `INSERT INTO settings(key, value, updated_at) VALUES ('homepage_modules', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [JSON.stringify(defaults)]
  );
  return defaults;
}