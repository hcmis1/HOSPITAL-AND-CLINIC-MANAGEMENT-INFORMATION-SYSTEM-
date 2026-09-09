// ==========================================================
// HCMIS — HR
// ==========================================================

let meHR = null;
let currentStaffUserId = null;
let staffCache = [];

(async function init() {
  meHR = await requireAuth();
  if (!meHR) return;

  document.getElementById('whoName').textContent = meHR.full_name;
  document.getElementById('whoRole').textContent = meHR.role;
  document.getElementById('facilityName').textContent =
    (meHR.facilities && meHR.facilities.name) ? meHR.facilities.name : 'No facility assigned';

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${btn.dataset.tab}`));
    });
  });

  document.getElementById('profileForm').addEventListener('submit', saveProfile);
  document.getElementById('addLicenceBtn').addEventListener('click', addLicence);
  document.getElementById('uploadStaffDocBtn').addEventListener('click', uploadStaffDocument);
  document.getElementById('leaveForm').addEventListener('submit', submitLeave);
  document.getElementById('trainingForm').addEventListener('submit', submitTraining);

  await loadStaff();
  await loadExpiryAlerts();
  await loadUserDropdowns();
  await loadLeaveList();
  await loadAttendanceToday();
  await loadTrainingList();
})();

async function loadStaff() {
  const { data } = await supabaseClient.from('app_users').select('*, staff_profiles(*)').eq('status', 'ACTIVE').order('full_name');
  staffCache = data || [];
  const tbody = document.getElementById('staffTable');
  if (staffCache.length === 0) { tbody.innerHTML = '<tr><td colspan="5" class="empty">No active staff.</td></tr>'; return; }
  tbody.innerHTML = staffCache.map(u => {
    const p = u.staff_profiles && u.staff_profiles[0];
    return `
    <tr>
      <td>${u.full_name}</td>
      <td>${u.role}</td>
      <td>${p ? p.designation || '—' : '—'}</td>
      <td>${p ? p.employment_status : 'ACTIVE'}</td>
      <td><button class="link-btn" onclick="openStaffDetail('${u.id}')">Open</button></td>
    </tr>`;
  }).join('');
}

async function loadUserDropdowns() {
  const opts = staffCache.map(u => `<option value="${u.id}">${u.full_name}</option>`).join('');
  document.getElementById('lv_user').innerHTML = opts;
  document.getElementById('tr_user').innerHTML = opts;
}

async function openStaffDetail(userId) {
  currentStaffUserId = userId;
  const u = staffCache.find(x => x.id === userId);
  if (!u) return;
  const p = u.staff_profiles && u.staff_profiles[0];

  document.getElementById('staffDetailTitle').textContent = u.full_name;
  document.getElementById('p_designation').value = p ? p.designation || '' : '';
  document.getElementById('p_category').value = p ? p.professional_category || '' : '';
  document.getElementById('p_speciality').value = p ? p.speciality || '' : '';
  document.getElementById('p_regnum').value = p ? p.registration_number || '' : '';
  document.getElementById('p_joined').value = p ? p.date_joined || '' : '';
  document.getElementById('p_empstatus').value = p ? p.employment_status : 'ACTIVE';

  await loadLicences(userId);
  await loadStaffDocuments(userId);
  document.getElementById('staffDetail').style.display = 'block';
  document.getElementById('staffDetail').scrollIntoView({ behavior: 'smooth' });
}

function closeStaffDetail() {
  document.getElementById('staffDetail').style.display = 'none';
  currentStaffUserId = null;
}

async function saveProfile(e) {
  e.preventDefault();
  if (!currentStaffUserId) return;
  const payload = {
    user_id: currentStaffUserId,
    designation: document.getElementById('p_designation').value.trim(),
    professional_category: document.getElementById('p_category').value.trim(),
    speciality: document.getElementById('p_speciality').value.trim(),
    registration_number: document.getElementById('p_regnum').value.trim(),
    date_joined: document.getElementById('p_joined').value || null,
    employment_status: document.getElementById('p_empstatus').value,
    updated_at: new Date().toISOString()
  };

  const { data: existing } = await supabaseClient.from('staff_profiles').select('id').eq('user_id', currentStaffUserId).maybeSingle();
  if (existing) {
    await supabaseClient.from('staff_profiles').update(payload).eq('id', existing.id);
    await logAudit('UPDATE', 'HR', 'staff_profiles', existing.id, null, payload);
  } else {
    const { data } = await supabaseClient.from('staff_profiles').insert(payload).select().single();
    await logAudit('CREATE', 'HR', 'staff_profiles', data.id, null, payload);
  }
  alert('Profile saved.');
  await loadStaff();
}

async function loadLicences(userId) {
  const { data } = await supabaseClient.from('professional_licenses').select('*').eq('user_id', userId).order('expiry_date');
  const box = document.getElementById('licenceList');
  if (!data || data.length === 0) { box.innerHTML = '<span class="empty">No licences on file.</span>'; return; }
  const today = new Date();
  box.innerHTML = data.map(l => {
    const expired = new Date(l.expiry_date) < today;
    return `<div class="panel" style="margin-bottom:6px;"><div class="panel-body" style="padding:10px 14px;">
      ${l.professional_body || 'Licence'} ${l.licence_number ? '· ' + l.licence_number : ''} — expires ${l.expiry_date}
      <span class="pill ${expired ? 'inactive' : 'active'}">${expired ? 'EXPIRED' : 'VALID'}</span>
    </div></div>`;
  }).join('');
}

async function addLicence() {
  if (!currentStaffUserId) return;
  const expiry = document.getElementById('l_expiry').value;
  if (!expiry) { alert('Expiry date is required.'); return; }
  const payload = {
    user_id: currentStaffUserId,
    professional_body: document.getElementById('l_body').value.trim(),
    registration_number: document.getElementById('p_regnum').value.trim(),
    licence_number: document.getElementById('l_number').value.trim(),
    issue_date: document.getElementById('l_issue').value || null,
    expiry_date: expiry
  };
  const { data, error } = await supabaseClient.from('professional_licenses').insert(payload).select().single();
  if (error) { alert(error.message); return; }
  await logAudit('CREATE', 'HR', 'professional_licenses', data.id, null, payload);

  ['l_body', 'l_number', 'l_issue', 'l_expiry'].forEach(id => document.getElementById(id).value = '');
  await loadLicences(currentStaffUserId);
  await loadExpiryAlerts();
}

async function loadExpiryAlerts() {
  const in60 = new Date(); in60.setDate(in60.getDate() + 60);
  const { data } = await supabaseClient.from('professional_licenses').select('*, app_users(full_name)').lte('expiry_date', in60.toISOString().slice(0, 10)).order('expiry_date');
  const panel = document.getElementById('expiryPanel');
  if (!data || data.length === 0) { panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  const today = new Date();
  document.getElementById('expiryList').innerHTML = data.map(l => {
    const expired = new Date(l.expiry_date) < today;
    return `<div class="panel" style="margin-bottom:6px;"><div class="panel-body" style="padding:10px 14px;">
      ${expired ? '🔴' : '🟠'} <strong>${l.app_users ? l.app_users.full_name : 'Staff'}</strong> — ${l.professional_body || 'licence'} ${expired ? 'expired' : 'expires'} ${l.expiry_date}
    </div></div>`;
  }).join('');
}

// ---------------- DOCUMENTS ----------------
async function loadStaffDocuments(userId) {
  const { data } = await supabaseClient.from('documents').select('*').eq('entity_type', 'STAFF').eq('entity_id', userId).eq('status', 'ACTIVE').order('uploaded_at', { ascending: false });
  const box = document.getElementById('staffDocumentsList');
  if (!data || data.length === 0) { box.innerHTML = '<span class="empty">No documents uploaded.</span>'; return; }
  box.innerHTML = data.map(d => `
    <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--hc-line);">
      <span>${d.document_type || d.file_name} — <span style="color:var(--hc-ink-soft); font-size:.85rem;">${new Date(d.uploaded_at).toLocaleDateString('en-GB')}</span></span>
      <button class="link-btn" onclick="viewStaffDocument('${d.storage_path}')">View</button>
    </div>
  `).join('');
}

async function uploadStaffDocument() {
  if (!currentStaffUserId) return;
  const fileInput = document.getElementById('staffDocFile');
  const file = fileInput.files[0];
  if (!file) { alert('Choose a file first.'); return; }
  const docType = document.getElementById('staffDocType').value.trim() || file.name;

  const path = `staff/${currentStaffUserId}/${Date.now()}_${file.name}`;
  const { error: uploadError } = await supabaseClient.storage.from('documents').upload(path, file);
  if (uploadError) { alert(uploadError.message); return; }

  const payload = {
    entity_type: 'STAFF', entity_id: currentStaffUserId, document_type: docType,
    file_name: file.name, storage_path: path, uploaded_by: meHR.id
  };
  const { data, error } = await supabaseClient.from('documents').insert(payload).select().single();
  if (error) { alert(error.message); return; }
  await logAudit('CREATE', 'DOCUMENTS', 'documents', data.id, null, payload);

  document.getElementById('staffDocType').value = '';
  fileInput.value = '';
  await loadStaffDocuments(currentStaffUserId);
}

async function viewStaffDocument(path) {
  const { data, error } = await supabaseClient.storage.from('documents').createSignedUrl(path, 3600);
  if (error) { alert(error.message); return; }
  window.open(data.signedUrl, '_blank');
}
// ---------------- LEAVE ----------------
async function submitLeave(e) {
  e.preventDefault();
  const payload = {
    user_id: document.getElementById('lv_user').value,
    leave_type: document.getElementById('lv_type').value,
    start_date: document.getElementById('lv_start').value,
    end_date: document.getElementById('lv_end').value,
    reason: document.getElementById('lv_reason').value.trim()
  };
  const { data, error } = await supabaseClient.from('leave_requests').insert(payload).select().single();
  if (error) { alert(error.message); return; }
  await logAudit('CREATE', 'HR', 'leave_requests', data.id, null, payload);
  document.getElementById('leaveForm').reset();
  await loadLeaveList();
}

async function loadLeaveList() {
  const { data } = await supabaseClient.from('leave_requests').select('*, app_users(full_name)').order('created_at', { ascending: false }).limit(50);
  const tbody = document.getElementById('leaveTable');
  if (!data || data.length === 0) { tbody.innerHTML = '<tr><td colspan="5" class="empty">No leave requests yet.</td></tr>'; return; }
  tbody.innerHTML = data.map(l => `
    <tr>
      <td>${l.app_users ? l.app_users.full_name : '—'}</td>
      <td>${l.leave_type}</td>
      <td class="mono">${l.start_date} → ${l.end_date}</td>
      <td><span class="pill ${l.status === 'APPROVED' ? 'active' : (l.status === 'REJECTED' ? 'inactive' : 'inactive')}">${l.status}</span></td>
      <td>${l.status === 'PENDING' ? `
        <button class="link-btn" onclick="decideLeave('${l.id}','APPROVED')">Approve</button> ·
        <button class="link-btn danger" onclick="decideLeave('${l.id}','REJECTED')">Reject</button>` : ''}</td>
    </tr>
  `).join('');
}

async function decideLeave(id, status) {
  await supabaseClient.from('leave_requests').update({ status, approved_by: meHR.id }).eq('id', id);
  await logAudit('UPDATE', 'HR', 'leave_requests', id, null, { status });
  await loadLeaveList();
}

// ---------------- ATTENDANCE ----------------
async function loadAttendanceToday() {
  const today = new Date().toISOString().slice(0, 10);
  const { data: existing } = await supabaseClient.from('hr_attendance').select('*').eq('attendance_date', today);
  const tbody = document.getElementById('attendanceTable');
  if (staffCache.length === 0) { tbody.innerHTML = '<tr><td colspan="2" class="empty">No staff to display.</td></tr>'; return; }

  tbody.innerHTML = staffCache.map(u => {
    const rec = (existing || []).find(a => a.user_id === u.id);
    return `
      <tr>
        <td>${u.full_name}</td>
        <td>
          <select onchange="markAttendance('${u.id}', this.value)">
            <option value="PRESENT" ${!rec || rec.status === 'PRESENT' ? 'selected' : ''}>Present</option>
            <option value="ABSENT" ${rec && rec.status === 'ABSENT' ? 'selected' : ''}>Absent</option>
            <option value="LEAVE" ${rec && rec.status === 'LEAVE' ? 'selected' : ''}>Leave</option>
            <option value="HOLIDAY" ${rec && rec.status === 'HOLIDAY' ? 'selected' : ''}>Holiday</option>
          </select>
        </td>
      </tr>`;
  }).join('');
}

async function markAttendance(userId, status) {
  const today = new Date().toISOString().slice(0, 10);
  const { error } = await supabaseClient.from('hr_attendance').upsert({
    user_id: userId, attendance_date: today, status, recorded_by: meHR.id
  }, { onConflict: 'user_id,attendance_date' });
  if (error) { alert(error.message); return; }
  await logAudit('UPDATE', 'HR', 'hr_attendance', userId, null, { status, date: today });
}

// ---------------- TRAINING ----------------
async function submitTraining(e) {
  e.preventDefault();
  const payload = {
    user_id: document.getElementById('tr_user').value,
    training_name: document.getElementById('tr_name').value.trim(),
    provider: document.getElementById('tr_provider').value.trim(),
    start_date: document.getElementById('tr_start').value || null,
    end_date: document.getElementById('tr_end').value || null
  };
  const { data, error } = await supabaseClient.from('hr_training').insert(payload).select().single();
  if (error) { alert(error.message); return; }
  await logAudit('CREATE', 'HR', 'hr_training', data.id, null, payload);
  document.getElementById('trainingForm').reset();
  await loadTrainingList();
}

async function loadTrainingList() {
  const { data } = await supabaseClient.from('hr_training').select('*, app_users(full_name)').order('created_at', { ascending: false }).limit(50);
  const tbody = document.getElementById('trainingTable');
  if (!data || data.length === 0) { tbody.innerHTML = '<tr><td colspan="4" class="empty">No training records yet.</td></tr>'; return; }
  tbody.innerHTML = data.map(t => `
    <tr>
      <td>${t.app_users ? t.app_users.full_name : '—'}</td>
      <td>${t.training_name}</td>
      <td>${t.provider || '—'}</td>
      <td class="mono">${t.start_date || '—'} → ${t.end_date || '—'}</td>
    </tr>
  `).join('');
}
