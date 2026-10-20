import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const configured = !SUPABASE_URL.includes('YOUR-PROJECT') && !SUPABASE_KEY.includes('YOUR-');

const sb = configured
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, detectSessionInUrl: true } })
  : null;

const need = () => {
  if (!sb) throw new Error('ยังไม่ได้ตั้งค่า js/config.js');
  return sb;
};

export async function getSession() {
  const { data, error } = await need().auth.getSession();
  if (error) throw error;
  return data.session;
}

export function onAuthChange(cb) {
  return need().auth.onAuthStateChange((_e, s) => cb(s));
}

export async function signInWithEmail(email) {
  const redirect = location.origin + location.pathname;
  const { error } = await need().auth.signInWithOtp({ email, options: { emailRedirectTo: redirect } });
  if (error) throw error;
}

export async function signOut() {
  const { error } = await need().auth.signOut();
  if (error) throw error;
}

export async function createProject(row) {
  const { error } = await need().from('hub_projects').insert(row);
  if (error) throw error;
}

export async function updateProject(id, row) {
  const { error } = await need().from('hub_projects').update(row).eq('id', id);
  if (error) throw error;
}

export async function deleteProject(id) {
  const { error } = await need().from('hub_projects').delete().eq('id', id);
  if (error) throw error;
}

export async function listMilestones(projectId) {
  const { data, error } = await need().from('hub_milestones').select('*').eq('project_id', projectId)
    .order('sort_order', { ascending: true }).order('id', { ascending: true });
  if (error) throw error;
  return data;
}

export async function addMilestone(row) {
  const { data, error } = await need().from('hub_milestones').insert(row).select().single();
  if (error) throw error;
  return data;
}

export async function updateMilestone(id, patch) {
  const { error } = await need().from('hub_milestones').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteMilestone(id) {
  const { error } = await need().from('hub_milestones').delete().eq('id', id);
  if (error) throw error;
}

export async function saveMilestoneOrder(items) {
  const results = await Promise.all(items.map((m) =>
    need().from('hub_milestones').update({ sort_order: m.sort_order }).eq('id', m.id)));
  const failed = results.find((r) => r.error);
  if (failed) throw failed.error;
}

export async function listUpdates(projectId) {
  const { data, error } = await need().from('hub_updates').select('*').eq('project_id', projectId)
    .order('date', { ascending: false }).order('id', { ascending: false });
  if (error) throw error;
  return data;
}

export async function addUpdate(row) {
  const { data, error } = await need().from('hub_updates').insert(row).select().single();
  if (error) throw error;
  return data;
}

export async function deleteUpdate(id) {
  const { error } = await need().from('hub_updates').delete().eq('id', id);
  if (error) throw error;
}

export async function listProjectLinks() {
  const { data, error } = await need().from('hub_projects').select('id,name,web_url').order('name');
  if (error) throw error;
  return data;
}

export async function listProjectOverview() {
  const { data, error } = await need().from('hub_project_overview').select('*').order('updated_at', { ascending: false });
  if (error) throw error;
  return data;
}
