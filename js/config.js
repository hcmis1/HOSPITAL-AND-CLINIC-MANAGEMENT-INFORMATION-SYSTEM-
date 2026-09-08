// ==========================================================
// HCMIS — Supabase configuration
// ==========================================================

const SUPABASE_URL = "https://dymyfdwfwpqmufqelbic.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR5bXlmZHdmd3BxbXVmcWVsYmljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4OTU4NjIsImV4cCI6MjEwNDQ3MTg2Mn0.wdHcpBaTV-NoOyeu-IoVsKGq1RbSfYowlNeoJoQIEpw";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
