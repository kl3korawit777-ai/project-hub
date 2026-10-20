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

export async function listProjectOverview() {
  const { data, error } = await need().from('hub_project_overview').select('*').order('updated_at', { ascending: false });
  if (error) throw error;
  return data;
}
