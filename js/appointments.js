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

  let rcSearchTimer;
  document.getElementById('rc_patient_search').addEventListener('input', (e) => {
    clearTimeout(rcSearchTimer);
    const term = e.target.value.trim();
    if (!term) { document.getElementById('rcPatientResults').innerHTML = ''; return; }
    rcSearchTimer = setTimeout(() => searchRecallPatients(term), 250);
  });
  document.getElementById('rcEnrollBtn').addEventListener('click', enrollRecall);

  let imSearchTimer;
  document.getElementById('im_patient_search').addEventListener('input', (e) => {
    clearTimeout(imSearchTimer);
    const term = e.target.value.trim();
    if (!term) { document.getElementById('imPatientResults').innerHTML = ''; return; }
    imSearchTimer = setTimeout(() => searchImmunizationPatients(term), 250);
  });
  document.getElementById('imRecordBtn').addEventListener('click', recordImmunization);
  document.getElementById('im_date').value = new Date().toISOString().slice(0, 10);

  await loadRecallList();
  await loadRecentImmunizations();
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
          <a class="link-btn" href="encounter.html?patient=${a.patient_id}&appointment=${a.id}">Open chart</a>
          ${flow ? ` · <button class="link-btn" onclick="advanceStatus('${a.id}','${flow.next}')">${flow.label}</button>` : ''}
          ${canCancel ? ` · <button class="link-btn danger" onclick="advanceStatus('${a.id}','CANCELLED')">Cancel</button>` : ''}
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

// ---------------- CHRONIC CARE RECALL ----------------
async function searchRecallPatients(term) {
  const { data } = await supabaseClient.from('patients').select('*')
    .or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,phone.ilike.%${term}%,mrn.ilike.%${term}%`)
    .limit(8);
  const box = document.getElementById('rcPatientResults');
  if (!data || data.length === 0) { box.innerHTML = '<div class="empty">No matches</div>'; return; }
  box.innerHTML = data.map(p => `
    <div class="link-btn" style="display:block; padding:6px 0;" onclick='selectRecallPatient(${JSON.stringify(p).replace(/'/g, "&apos;")})'>
      ${p.first_name} ${p.last_name} · ${p.mrn} ${p.phone ? '· ' + p.phone : ''}
    </div>
  `).join('');
}

function selectRecallPatient(p) {
  document.getElementById('rc_patient_id').value = p.id;
  document.getElementById('rcSelectedPatient').innerHTML = `<span class="pill active">${p.first_name} ${p.last_name} · ${p.mrn}</span>`;
  document.getElementById('rcPatientResults').innerHTML = '';
  document.getElementById('rc_patient_search').value = '';
}

async function enrollRecall() {
  const patientId = document.getElementById('rc_patient_id').value;
  const condition = document.getElementById('rc_condition').value.trim();
  const nextDate = document.getElementById('rc_next_date').value;
  if (!patientId) { alert('Search for and select a patient first.'); return; }
  if (!condition || !nextDate) { alert('Enter a condition and a next review date.'); return; }

  const payload = {
    patient_id: patientId, condition_name: condition, next_review_date: nextDate,
    notes: document.getElementById('rc_notes').value.trim(), created_by: meA.id
  };
  const { data, error } = await supabaseClient.from('chronic_care_followups').insert(payload).select().single();
  if (error) { alert(error.message); return; }
  await logAudit('CREATE', 'APPOINTMENTS', 'chronic_care_followups', data.id, null, payload);

  document.getElementById('rc_patient_id').value = '';
  document.getElementById('rcSelectedPatient').innerHTML = '';
  document.getElementById('rc_condition').value = '';
  document.getElementById('rc_next_date').value = '';
  document.getElementById('rc_notes').value = '';
  await loadRecallList();
}

async function loadRecallList() {
  const { data } = await supabaseClient
    .from('chronic_care_followups')
    .select('*, patients(first_name, last_name, mrn, phone)')
    .eq('status', 'ACTIVE')
    .order('next_review_date', { ascending: true });

  const tbody = document.getElementById('recallTable');
  if (!data || data.length === 0) { tbody.innerHTML = '<tr><td colspan="5" class="empty">No one currently on the recall list.</td></tr>'; return; }

  const today = new Date().toISOString().slice(0, 10);
  tbody.innerHTML = data.map(r => {
    const overdue = r.next_review_date < today;
    return `
    <tr ${overdue ? 'style="background:#FDECEC;"' : ''}>
      <td class="mono">${r.next_review_date}${overdue ? ' <strong>(overdue)</strong>' : ''}</td>
      <td>${r.patients ? r.patients.first_name + ' ' + r.patients.last_name + ' · ' + r.patients.mrn + (r.patients.phone ? ' · ' + r.patients.phone : '') : 'Unknown'}</td>
      <td>${r.condition_name}${r.notes ? '<br><span style="font-size:.8rem; color:var(--hc-ink-soft);">' + r.notes + '</span>' : ''}</td>
      <td class="mono">${r.last_review_date || '—'}</td>
      <td>
        <button class="link-btn" onclick="markReviewed('${r.id}')">Mark reviewed</button>
        · <button class="link-btn danger" onclick="removeFromRecall('${r.id}')">Remove</button>
      </td>
    </tr>
  `;
  }).join('');
}

async function markReviewed(id) {
  const daysAhead = prompt('Reviewed today. Days until next review? (e.g. 30, 90)', '30');
  if (!daysAhead || isNaN(parseInt(daysAhead))) return;
  const next = new Date();
  next.setDate(next.getDate() + parseInt(daysAhead));
  const payload = { last_review_date: new Date().toISOString().slice(0, 10), next_review_date: next.toISOString().slice(0, 10) };
  await supabaseClient.from('chronic_care_followups').update(payload).eq('id', id);
  await logAudit('UPDATE', 'APPOINTMENTS', 'chronic_care_followups', id, null, payload);
  await loadRecallList();
}

async function removeFromRecall(id) {
  if (!confirm('Remove this patient from the chronic care recall list?')) return;
  await supabaseClient.from('chronic_care_followups').update({ status: 'COMPLETED' }).eq('id', id);
  await logAudit('UPDATE', 'APPOINTMENTS', 'chronic_care_followups', id, null, { status: 'COMPLETED' });
  await loadRecallList();
}

// ---------------- IMMUNIZATION / EPI REGISTER ----------------
async function searchImmunizationPatients(term) {
  const { data } = await supabaseClient.from('patients').select('*')
    .or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,phone.ilike.%${term}%,mrn.ilike.%${term}%`)
    .limit(8);
  const box = document.getElementById('imPatientResults');
  if (!data || data.length === 0) { box.innerHTML = '<div class="empty">No matches</div>'; return; }
  box.innerHTML = data.map(p => `
    <div class="link-btn" style="display:block; padding:6px 0;" onclick='selectImmunizationPatient(${JSON.stringify(p).replace(/'/g, "&apos;")})'>
      ${p.first_name} ${p.last_name} · ${p.mrn} ${p.date_of_birth ? '· DOB ' + p.date_of_birth : ''}
    </div>
  `).join('');
}

async function selectImmunizationPatient(p) {
  document.getElementById('im_patient_id').value = p.id;
  document.getElementById('imSelectedPatient').innerHTML = `<span class="pill active">${p.first_name} ${p.last_name} · ${p.mrn}${p.date_of_birth ? ' · DOB ' + p.date_of_birth : ''}</span>`;
  document.getElementById('imPatientResults').innerHTML = '';
  document.getElementById('im_patient_search').value = '';
  await loadPatientImmunizationHistory(p.id);
}

async function loadPatientImmunizationHistory(patientId) {
  const { data } = await supabaseClient.from('immunizations_given').select('*').eq('patient_id', patientId).order('date_given');
  const box = document.getElementById('imHistory');
  if (!data || data.length === 0) { box.innerHTML = '<p class="empty">No immunizations recorded yet for this patient.</p>'; return; }
  box.innerHTML = `<p style="font-weight:600; margin-bottom:4px;">Already given:</p>` +
    data.map(im => `<span class="pill active" style="margin:2px;">${im.vaccine_name} (${im.date_given})</span>`).join(' ');
}

async function recordImmunization() {
  const patientId = document.getElementById('im_patient_id').value;
  const vaccine = document.getElementById('im_vaccine').value.trim();
  const dateGiven = document.getElementById('im_date').value;
  if (!patientId) { alert('Search for and select a patient first.'); return; }
  if (!vaccine || !dateGiven) { alert('Enter a vaccine name and date given.'); return; }

  const payload = {
    patient_id: patientId, vaccine_name: vaccine, date_given: dateGiven,
    batch_number: document.getElementById('im_batch').value.trim(),
    site: document.getElementById('im_site').value.trim(),
    notes: document.getElementById('im_notes').value.trim(),
    given_by: meA.id
  };
  const { data, error } = await supabaseClient.from('immunizations_given').insert(payload).select().single();
  if (error) { alert(error.message); return; }
  await logAudit('CREATE', 'APPOINTMENTS', 'immunizations_given', data.id, null, payload);

  document.getElementById('im_vaccine').value = '';
  document.getElementById('im_batch').value = '';
  document.getElementById('im_site').value = '';
  document.getElementById('im_notes').value = '';
  await loadPatientImmunizationHistory(patientId);
  await loadRecentImmunizations();
}

async function loadRecentImmunizations() {
  const { data } = await supabaseClient
    .from('immunizations_given')
    .select('*, patients(first_name, last_name, mrn)')
    .order('created_at', { ascending: false })
    .limit(30);

  const tbody = document.getElementById('imRecentTable');
  if (!data || data.length === 0) { tbody.innerHTML = '<tr><td colspan="4" class="empty">No immunizations recorded yet.</td></tr>'; return; }

  tbody.innerHTML = data.map(im => `
    <tr>
      <td class="mono">${im.date_given}</td>
      <td>${im.patients ? im.patients.first_name + ' ' + im.patients.last_name + ' · ' + im.patients.mrn : 'Unknown'}</td>
      <td>${im.vaccine_name}</td>
      <td>${im.batch_number || '—'}</td>
    </tr>
  `).join('');
}
