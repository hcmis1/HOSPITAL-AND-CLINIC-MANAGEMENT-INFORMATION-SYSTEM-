// ==========================================================
// HCMIS — Staff self-registration
// ==========================================================

document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('formMsg');
  const btn = document.getElementById('registerBtn');
  msg.innerHTML = '';
  btn.disabled = true;
  btn.textContent = 'Submitting…';

  const fullName = document.getElementById('fullName').value.trim();
  const email = document.getElementById('email').value.trim();
  const phone = document.getElementById('phone').value.trim();
  const password = document.getElementById('password').value;

  const { data: signUpData, error: signUpError } = await supabaseClient.auth.signUp({ email, password });

  if (signUpError) {
    msg.innerHTML = `<div class="form-msg error">${signUpError.message}</div>`;
    btn.disabled = false;
    btn.textContent = 'Request access';
    return;
  }

  const authUserId = signUpData.user ? signUpData.user.id : null;

  if (!authUserId) {
    msg.innerHTML = `<div class="form-msg success">Check your email to confirm your account, then sign in to complete your request.</div>`;
    btn.disabled = false;
    btn.textContent = 'Request access';
    return;
  }

  const { error: profileError } = await supabaseClient.from('app_users').insert({
    auth_user_id: authUserId,
    full_name: fullName,
    email: email,
    phone: phone,
    role: 'RECEPTIONIST',
    status: 'PENDING'
  });

  if (profileError) {
    msg.innerHTML = `<div class="form-msg error">Account created, but the profile could not be saved: ${profileError.message}</div>`;
    btn.disabled = false;
    btn.textContent = 'Request access';
    return;
  }

  msg.innerHTML = `<div class="form-msg success">Request submitted. An administrator will review your account before you can sign in.</div>`;
  document.getElementById('registerForm').reset();
  btn.disabled = false;
  btn.textContent = 'Request access';
});
