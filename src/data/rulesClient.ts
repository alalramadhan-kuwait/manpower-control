// The app's side of the rules: the values last seen on this device are applied at start, the database's at sign-in.
import { applyRuleValues, type RuleValue } from '@/core/rules';
import { loadAppRules, setRule } from './rules';

const CACHE = 'app-rules-v1';
const keep = (values: Record<string, RuleValue | null>) => { try { if (Object.keys(values).length) localStorage.setItem(CACHE, JSON.stringify(values)); } catch { /* storage blocked */ } };

/** Apply the last rules seen on this device straight away (the app starts with them). */
export function applyCachedRules() {
  try { const c = localStorage.getItem(CACHE); if (c) applyRuleValues(JSON.parse(c)); } catch { /* storage blocked or old */ }
}

let loaded: Promise<unknown> | null = null;
/** Once per signed-in session: the rules from the database before the first screen computes. */
export function ensureAppRules(): Promise<unknown> {
  if (!loaded) loaded = loadAppRules().then(keep).catch(() => undefined);
  return loaded;
}

/** The Section Head changes a rule; this device follows straight away. */
export async function changeRule(key: string, value: RuleValue, reason: string) { keep(await setRule(key, value, reason)); }
