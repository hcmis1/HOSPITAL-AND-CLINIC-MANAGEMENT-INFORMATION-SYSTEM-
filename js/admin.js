// ==========================================================
// HCMIS — Administration console
// ==========================================================

const ROLE_OPTIONS = [
  'SUPER_ADMIN','FACILITY_ADMIN','MEDICAL_DIRECTOR','DOCTOR','CLINICAL_OFFICER',
  'NURSE','MIDWIFE','LAB_TECH','RADIOGRAPHER','PHARMACIST','CASHIER',
  'ACCOUNTANT','HR_OFFICER','RECEPTIONIST'
];

let currentAdmin = null;
let facilitiesCache = [];

(async function init() {
  currentAdmin = await requireAdmin();
  if (!currentAdmin) return;

  document.getElementById('whoName').textContent = currentAdmin.full_name;
  document.getElementById('whoRole').textContent = currentAdmin.role;
  document.getElementById('facilityName').textContent =
    (currentAdmin.facilities && currentAdmin.facilities.name) ? currentAdmin.facilities.name : 'All facilities';

  setupTabs();
  await loadFacilities();
  await loadDepartments();
  await loadUsers();
  await loadAuditLogs();

  document.getElementById('facilityForm').addEventListener('submit', addFacility);
  document.getElementById('departmentForm').addEventListener('submit', addDepartment);
  document.getElementById('editUserForm').addEventListener('submit', saveUserEdit);
  document.getElementById('cancelEditUser').addEventListener('click', closeEditUser);

  const hash = window.location.hash.replace('#', '');
  if (hash) activateTab(hash);
})();

function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
  });
}
function activateTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${name}`));
}

// ---------------- FACILITIES ----------------
async function loadFacilities() {
  const { data, error } = await supabaseClient.from('facilities').select('*').order('name');
  const tbody = document.getElementById('facilitiesTable');
  const deptSelect = document.getElementById('dept_facility');

  if (error || !data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">No facilities yet. Add one above.</td></tr>';
    deptSelect.innerHTML = '<option value="">No facilities yet</option>';
    facilitiesCache = [];
    return;
  }

  facilitiesCache = data;

  tbody.innerHTML = data.map(f => `
    <tr>
      <td class="mono">${f.facility_code}</td>
      <td>${f.name}</td>
      <td>${f.facility_type}</td>
      <td>${f.district || '—'}</td>
      <td><span class="pill ${f.status === 'ACTIVE' ? 'active' : 'inactive'}">${f.status}</span></td>
    </tr>
  `).join('');

  deptSelect.innerHTML = data.map(f => `<option value="${f.id}">${f.name}</option>`).join('');
  refreshUserFacilityDropdown();
}

async function addFacility(e) {
  e.preventDefault();
  const payload = {
    facility_code: document.getElementById('fac_code').value.trim(),
    name: document.getElementById('fac_name').value.trim(),
    facility_type: document.getElementById('fac_type').value,
    ownership: document.getElementById('fac_ownership').value.trim(),
    district: document.getElementById('fac_district').value.trim(),
    phone: document.getElementById('fac_phone').value.trim(),
    status: 'ACTIVE'
  };
  const { data, error } = await supabaseClient.from('facilities').insert(payload).select().single();
  if (error) { alert(error.message); return; }
  await logAudit('CREATE', 'ADMIN', 'facilities', data.id, null, payload);
  document.getElementById('facilityForm').reset();
  await loadFacilities();
}

// ---------------- DEPARTMENTS ----------------
async function loadDepartments() {
  const { data, error } = await supabaseClient
    .from('departments')
    .select('*, facilities(name)')
    .order('name');
  const tbody = document.getElementById('departmentsTable');

  if (error || !data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty">No departments yet. Add one above.</td></tr>';
    return;
  }

  tbody.innerHTML = data.map(d => `
    <tr>
      <td class="mono">${d.department_code}</td>
      <td>${d.name}</td>
      <td>${d.facilities ? d.facilities.name : '—'}</td>
      <td><span class="pill ${d.status === 'ACTIVE' ? 'active' : 'inactive'}">${d.status}</span></td>
    </tr>
  `).join('');
}

async function addDepartment(e) {
  e.preventDefault();
  const payload = {
    facility_id: document.getElementById('dept_facility').value,
    department_code: document.getElementById('dept_code').value.trim(),
    name: document.getElementById('dept_name').value.trim(),
    department_type: document.getElementById('dept_type').value.trim(),
    status: 'ACTIVE'
  };
  if (!payload.facility_id) { alert('Add a facility first.'); return; }
  const { data, error } = await supabaseClient.from('departments').insert(payload).select().single();
  if (error) { alert(error.message); return; }
  await logAudit('CREATE', 'ADMIN', 'departments', data.id, null, payload);
  document.getElementById('departmentForm').reset();
  await loadDepartments();
}

// ---------------- USERS ----------------
async function loadUsers() {
  const { data, error } = await supabaseClient
    .from('app_users')
    .select('*, facilities(name), departments(name)')
    .order('created_at', { ascending: false });
  const tbody = document.getElementById('usersTable');

  if (error || !data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty">No staff accounts yet.</td></tr>';
    return;
  }

  tbody.innerHTML = data.map(u => `
    <tr>
      <td>${u.full_name}</td>
      <td>${u.email || '—'}</td>
      <td>${u.role}</td>
      <td>${u.facilities ? u.facilities.name : '—'}</td>
      <td>${u.departments ? u.departments.name : '—'}</td>
      <td><span class="pill ${u.status === 'ACTIVE' ? 'active' : 'inactive'}">${u.status}</span></td>
      <td><button class="link-btn" onclick="openEditUser('${u.id}')">Edit</button></td>
    </tr>
  `).join('');

  window._usersCache = data;
}

function refreshUserFacilityDropdown() {
  const sel = document.getElementById('eu_facility');
  sel.innerHTML = '<option value="">— none —</option>' +
    facilitiesCache.map(f => `<option value="${f.id}">${f.name}</option>`).join('');
}

async function openEditUser(id) {
  const user = (window._usersCache || []).find(u => u.id === id);
  if (!user) return;

  document.getElementById('eu_id').value = user.id;
  document.getElementById('eu_name').value = user.full_name;
  document.getElementById('eu_role').innerHTML = ROLE_OPTIONS.map(r =>
    `<option value="${r}" ${r === user.role ? 'selected' : ''}>${r}</option>`).join('');

  refreshUserFacilityDropdown();
  document.getElementById('eu_facility').value = user.facility_id || '';

  await populateDeptDropdownForUser(user.facility_id, user.department_id);

  document.getElementById('eu_status').value = user.status;
  document.getElementById('editUserOverlay').style.display = 'flex';

  document.getElementById('eu_facility').onchange = (e) => populateDeptDropdownForUser(e.target.value, null);
}

async function populateDeptDropdownForUser(facilityId, selectedDeptId) {
  const sel = document.getElementById('eu_department');
  if (!facilityId) { sel.innerHTML = '<option value="">— none —</option>'; return; }
  const { data } = await supabaseClient.from('departments').select('id, name').eq('facility_id', facilityId).order('name');
  sel.innerHTML = '<option value="">— none —</option>' +
    (data || []).map(d => `<option value="${d.id}" ${d.id === selectedDeptId ? 'selected' : ''}>${d.name}</option>`).join('');
}

function closeEditUser() {
  document.getElementById('editUserOverlay').style.display = 'none';
}

async function saveUserEdit(e) {
  e.preventDefault();
  const id = document.getElementById('eu_id').value;
  const before = (window._usersCache || []).find(u => u.id === id);

  const payload = {
    full_name: document.getElementById('eu_name').value.trim(),
    role: document.getElementById('eu_role').value,
    facility_id: document.getElementById('eu_facility').value || null,
    department_id: document.getElementById('eu_department').value || null,
    status: document.getElementById('eu_status').value
  };

  const { error } = await supabaseClient.from('app_users').update(payload).eq('id', id);
  if (error) { alert(error.message); return; }

  await logAudit('UPDATE', 'ADMIN', 'app_users', id, before || null, payload);
  closeEditUser();
  await loadUsers();
}

// ---------------- AUDIT LOGS ----------------
async function loadAuditLogs() {
  const { data, error } = await supabaseClient
    .from('audit_logs')
    .select('*, app_users(full_name)')
    .order('created_at', { ascending: false })
    .limit(100);
  const tbody = document.getElementById('auditTable');

  if (error || !data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">No audit activity yet.</td></tr>';
    return;
  }

  tbody.innerHTML = data.map(a => `
    <tr>
      <td class="mono">${new Date(a.created_at).toLocaleString('en-GB')}</td>
      <td>${a.app_users ? a.app_users.full_name : 'System'}</td>
      <td>${a.action}</td>
      <td>${a.module}</td>
      <td class="mono">${a.table_name || '—'}${a.record_id ? ' · ' + a.record_id.slice(0, 8) : ''}</td>
    </tr>
  `).join('');
}
