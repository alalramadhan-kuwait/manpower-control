// Plan years (which year is the Active Plan).
import { supabase } from './supabase';
import type { PlanYear } from '@/core/plan';

export async function fetchPlanYears(): Promise<PlanYear[]> {
  const { data, error } = await supabase.from('plan_years').select('year,status').order('year');
  if (error) throw error;
  return data as PlanYear[];
}
