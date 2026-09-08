// ==========================================================
// HCMIS — Appointments
// ==========================================================

let meA = null;

(async function init() {
  meA = await requireAuth();
  if (!meA) return;

  document.getElementById('whoName').textContent = meA.full_name;
  document.getElementById('whoRole').textContent = meA.role;
  document.getElementById('facilityName').textContent =
    (meA.facilities && meA.facilities.name) ? meA.facilities.name : 'No facility assigned';

  if (['SUPER_ADMIN', 'FACILITY_ADMIN'].includes(meA.role)) {
    document.getElementById('adminNavGroup').style.display = 'block';
  }

  document.getElementById('a_date').value = new Date().toISOString().slice(0, 10);

  await loadDepartmentOptions();
  await loadProviderOptions();
  await loadQueue();
  await loadUpcoming();

  const params = new URLSearchParams(window.location.search);
  const preselectId = params.get('patient');
  if (preselectId) await preselectPatient(preselectId);

  let searchTimer;
  document.getElementById('a_patient_search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const term = e.target.value.trim();
    if (!term) { document.getElementById('patientResults').innerHTML = ''; return; }
    searchTimer = setTimeout(() => searchPatients(term), 250);
  });

  document.getElementById('apptForm').addEventListener('submit', bookAppointment);
})();

async function loadDepartmentOptions() {
  let query = supabaseClient.from('departments').select('id, name').order('name');
  if (meA.facility_id) query = query.eq('facility_id', meA.facility_id);
  const { data } = await query;
  const sel = document.getElementById('a_department');
  sel.innerHTML = '<option value="">— none —</option>' + (data || []).map(d => `<option value="${d.id}">${d.name}</option>`).join('');
}

async function loadProviderOptions() {
  let query = supabaseClient.from('app_users').select('id, full_name, role')
    .in('role', ['DOCTOR', 'CLINICAL_OFFICER', 'MEDICAL_DIRECTOR'])
    .eq('status', 'ACTIVE');
  if (meA.facility_id) query = query.eq('facility_id', meA.facility_id);
  const { data } = await query;
  const sel = document.getElementById('a_provider');
  sel.innerHTML = '<option value="">— none —</option>' + (data || []).map(p => `<option value="${p.id}">${p.full_name}</option>`).join('');
}

async function searchPatients(term) {
  const { data } = await supabaseClient.from('patients').select('*')
    .or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,phone.ilike.%${term}%,mrn.ilike.%${term}%`)
    .limit(8);
  const box = document.getElementById('patientResults');
  if (!data || data.length === 0) { box.innerHTML = '<div class="empty">No matches</div>'; return; }
  box.innerHTML = data.map(p => `
    <div class="link-btn" style="display:block; padding:6px 0;" onclick='selectPatient(${JSON.stringify(p).replace(/'/g, "&apos;")})'>
      ${p.first_name} ${p.last_name} · ${p.mrn} ${p.phone ? '· ' + p.phone : ''}
    </div>
  `).join('');
}

function selectPatient(p) {
  document.getElementById('a_patient_id').value = p.id;
  document.getElementById('selectedPatient').innerHTML = `<span class="pill active">${p.first_name} ${p.last_name} · ${p.mrn}</span>`;
  document.getElementById('patientResults').innerHTML = '';
  document.getElementById('a_patient_search').value = '';
}

async function preselectPatient(id) {
  const { data } = await supabaseClient.from('patients').select('*').eq('id', id).single();
  if (data) selectPatient(data);
}

async function bookAppointment(e) {
  e.preventDefault();
  const patientId = document.getElementById('a_patient_id').value;
  if (!patientId) { alert('Search for and select a patient first.'); return; }

  const payload = {
    patient_id: patientId,
    facility_id: meA.facility_id || null,
    department_id: document.getElementById('a_department').value || null,
    provider_id: document.getElementById('a_provider').value || null,
    appointment_date: document.getElementById('a_date').value,
    appointment_time: document.getElementById('a_time').value || null,
    reason: document.getElementById('a_reason').value.trim(),
    status: 'SCHEDULED',
    created_by: meA.id
  };

  const { data, error } = await supabaseClient.from('appointments').insert(payload).select().single();
  if (error) { alert(error.message); return; }

  await logAudit('CREATE', 'APPOINTMENTS', 'appointments', data.id, null, payload);
  document.getElementById('apptForm').reset();
  document.getElementById('a_patient_id').value = '';
  document.getElementById('selectedPatient').innerHTML = '';
  document.getElementById('a_date').value = new Date().toISOString().slice(0, 10);

  await loadQueue();
  await loadUpcoming();
}

const STATUS_FLOW = {
  SCHEDULED: { next: 'CHECKED_IN', label: 'Check in' },
  CONFIRMED: { next: 'CHECKED_IN', label: 'Check in' },
  CHECKED_IN: { next: 'IN_CONSULTATION', label: 'Start consultation' },
  WAITING: { next: 'IN_CONSULTATION', label: 'Start consultation' },
  IN_CONSULTATION: { next: 'COMPLETED', label: 'Complete' }
};

async function loadQueue() {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabaseClient
    .from('appointments')
    .select('*, patients(first_name, last_name, mrn), departments(name)')
    .eq('appointment_date', today)
    .order('appointment_time', { ascending: true });

  const tbody = document.getElementById('queueTable');
  if (error || !data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">No appointments today.</td></tr>';
    return;
  }

  tbody.innerHTML = data.map(a => {
    const flow = STATUS_FLOW[a.status];
    const patientName = a.patients ? `${a.patients.first_name} ${a.patients.last_name} · ${a.patients.mrn}` : 'Unknown';
    const canCancel = !['COMPLETED', 'CANCELLED'].includes(a.status);
    return `
      <tr>
        <td class="mono">${a.appointment_time || '—'}</td>
        <td>${patientName}</td>
        <td>${a.departments ? a.departments.name : '—'}</td>
        <td>${a.reason || '—'}</td>
        <td><span class="pill ${a.status === 'COMPLETED' ? 'active' : (a.status === 'CANCELLED' ? 'inactive' : 'active')}">${a.status}</span></td>
        <td>
          ${flow ? `<button class="link-btn" onclick="advanceStatus('${a.id}','${flow.next}')">${flow.label}</button>` : ''}
          ${canCancel ? `<button class="link-btn danger" onclick="advanceStatus('${a.id}','CANCELLED')">Cancel</button>` : ''}
        </td>
      </tr>
    `;
  }).join('');
}

async function loadUpcoming() {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabaseClient
    .from('appointments')
    .select('*, patients(first_name, last_name, mrn), departments(name)')
    .gt('appointment_date', today)
    .in('status', ['SCHEDULED', 'CONFIRMED'])
    .order('appointment_date', { ascending: true })
    .limit(30);

  const tbody = document.getElementById('upcomingTable');
  if (error || !data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">No upcoming appointments.</td></tr>';
    return;
  }

  tbody.innerHTML = data.map(a => `
    <tr>
      <td class="mono">${a.appointment_date}</td>
      <td class="mono">${a.appointment_time || '—'}</td>
      <td>${a.patients ? a.patients.first_name + ' ' + a.patients.last_name + ' · ' + a.patients.mrn : 'Unknown'}</td>
      <td>${a.departments ? a.departments.name : '—'}</td>
      <td><button class="link-btn danger" onclick="advanceStatus('${a.id}','CANCELLED')">Cancel</button></td>
    </tr>
  `).join('');
}

async function advanceStatus(id, newStatus) {
  const { error } = await supabaseClient.from('appointments').update({ status: newStatus }).eq('id', id);
  if (error) { alert(error.message); return; }
  await logAudit('UPDATE', 'APPOINTMENTS', 'appointments', id, null, { status: newStatus });
  await loadQueue();
  await loadUpcoming();
}
