// ==========================================================
// HCMIS — Supabase configuration
//
// Replace the two values below with your own Supabase project's
// URL and anon (public) key. Find them in your Supabase project:
// Settings > API.
// ==========================================================

const SUPABASE_URL = "YOUR_SUPABASE_PROJECT_URL";
const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
