// ==========================================================
// HCMIS — Authentication
// ==========================================================

async function getSession() {
  const { data } = await supabaseClient.auth.getSession();
  return data.session;
}

async function getCurrentAppUser() {
  const session = await getSession();
  if (!session) return null;
  const { data, error } = await supabaseClient
    .from('app_users')
    .select('*, facilities(name), departments(name)')
    .eq('auth_user_id', session.user.id)
    .single();
  if (error) {
    window._lastAuthError = error;
    return null;
  }
  return data;
}

async function requireAuth() {
  const session = await getSession();
  if (!session) {
    window.location.href = 'index.html';
    return null;
  }
  const appUser = await getCurrentAppUser();
  if (!appUser) {
    const err = window._lastAuthError;
    document.body.innerHTML = `
      <div style="padding:32px;font-family:sans-serif;max-width:560px;">
        <h2>Debug — profile not found</h2>
        <p><strong>Signed in as:</strong> ${session.user.email}</p>
        <p><strong>auth_user_id:</strong><br><code>${session.user.id}</code></p>
        <p><strong>Lookup error:</strong><br><code>${err ? JSON.stringify(err) : 'none — zero rows matched'}</code></p>
        <p>Check that <code>app_users</code> has a row with this exact <code>auth_user_id</code>, and that its RLS select policy allows it.</p>
        <button onclick="supabaseClient.auth.signOut().then(()=>window.location.href='index.html')" style="margin-top:16px;padding:10px 16px;">Sign out and try again</button>
      </div>`;
    return null;
  }
  if (appUser.status !== 'ACTIVE') {
    document.body.innerHTML = '<p style="padding:40px;font-family:sans-serif;">Your account is not active. Contact your administrator.</p>';
    return null;
  }
  startIdleTimer(appUser.role);
  return appUser;
}

// ----------------------------------------------------------------
// Session idle timeout. Per security review: clinical roles get 15
// minutes of inactivity before automatic logout, admin/management
// roles get 30 -- an unattended, still-logged-in terminal is a real
// exposure for patient data. Runs once per page load (guarded by
// _idleTimerStarted) since every page's init() calls requireAuth().
// ----------------------------------------------------------------
let _idleTimerStarted = false;
let _idleTimeoutHandle = null;
let _idleWarningHandle = null;

function startIdleTimer(role) {
  if (_idleTimerStarted) return;
  _idleTimerStarted = true;

  const adminRoles = ['SUPER_ADMIN', 'FACILITY_ADMIN'];
  const timeoutMinutes = adminRoles.includes(role) ? 30 : 15;
  const timeoutMs = timeoutMinutes * 60 * 1000;
  const warningMs = timeoutMs - 60 * 1000; // warn 1 minute before

  function resetTimer() {
    clearTimeout(_idleTimeoutHandle);
    clearTimeout(_idleWarningHandle);
    _idleWarningHandle = setTimeout(() => {
      if (!confirm('You will be signed out in 1 minute due to inactivity. Click OK to stay signed in.')) return;
      resetTimer();
    }, warningMs);
    _idleTimeoutHandle = setTimeout(async () => {
      alert('You have been signed out due to inactivity.');
      await logout();
    }, timeoutMs);
  }

  ['mousedown', 'keydown', 'touchstart', 'scroll'].forEach(evt =>
    document.addEventListener(evt, resetTimer, { passive: true })
  );
  resetTimer();
}

// Shows a generic, safe message to the user instead of a raw
// database/API error (which can reveal table names, constraints,
// or internal structure). The real error still goes to the
// browser console for whoever's debugging.
// Usage: replace `alert(error.message)` with `showError(error)`,
// or `showError(error, 'Could not save this prescription')` for a
// more specific-but-still-safe message.
function showError(error, friendlyMessage) {
  console.error('HCMIS error:', error);
  alert(friendlyMessage || 'Something went wrong. Please try again, and contact IT support if it continues.');
}

async function requireAdmin() {
  const appUser = await requireAuth();
  if (!appUser) return null;
  if (!['SUPER_ADMIN', 'FACILITY_ADMIN'].includes(appUser.role)) {
    window.location.href = 'dashboard.html';
    return null;
  }
  return appUser;
}

async function logAudit(action, module, tableName, recordId, oldValues, newValues) {
  try {
    const appUser = await getCurrentAppUser();
    await supabaseClient.from('audit_logs').insert({
      user_id: appUser ? appUser.id : null,
      facility_id: appUser ? appUser.facility_id : null,
      department_id: appUser ? appUser.department_id : null,
      action, module, table_name: tableName, record_id: recordId,
      old_values: oldValues || null, new_values: newValues || null
    });
  } catch (e) { /* audit logging never blocks the user's action */ }
}

async function logout() {
  await logAudit('LOGOUT', 'AUTH', 'app_users', null, null, null);
  await supabaseClient.auth.signOut();
  window.location.href = 'index.html';
}

// ---- Login form (only present on index.html) ----
const loginForm = document.getElementById('loginForm');
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('formMsg');
    const btn = document.getElementById('loginBtn');
    msg.innerHTML = '';
    btn.disabled = true;
    btn.textContent = 'Signing in…';

    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });

    if (error) {
      msg.innerHTML = `<div class="form-msg error">${error.message}</div>`;
      btn.disabled = false;
      btn.textContent = 'Sign in';
      return;
    }

    const appUser = await getCurrentAppUser();
    if (!appUser) {
      msg.innerHTML = `<div class="form-msg error">This account has no HCMIS profile yet. Ask your administrator to create one for you.</div>`;
      await supabaseClient.auth.signOut();
      btn.disabled = false;
      btn.textContent = 'Sign in';
      return;
    }

    await supabaseClient.from('app_users').update({ last_login_at: new Date().toISOString() }).eq('id', appUser.id);
    await logAudit('LOGIN', 'AUTH', 'app_users', appUser.id, null, null);

    window.location.href = 'dashboard.html';
  });

  // if already signed in, skip straight to dashboard
  getSession().then((s) => { if (s) window.location.href = 'dashboard.html'; });
}
