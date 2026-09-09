// ==========================================================
// HCMIS — Admissions
// ==========================================================

let meAd = null;
let selectedAdPatient = null;

(async function init() {
  meAd = await requireAuth();
  if (!meAd) return;

  document.getElementById('whoName').textContent = meAd.full_name;
  document.getElementById('whoRole').textContent = meAd.role;
  document.getElementById('facilityName').textContent =
    (meAd.facilities && meAd.facilities.name) ? meAd.facilities.name : 'No facility assigned';
  if (['SUPER_ADMIN', 'FACILITY_ADMIN'].includes(meAd.role)) {
    document.getElementById('adminNavGroup').style.display = 'block';
  }

  await loadWardOptions();
  await loadDoctorOptions();
  await loadInpatients();

  document.getElementById('ad_ward').addEventListener('change', () => loadAvailableBeds());
  document.getElementById('admitForm').addEventListener('submit', admitPatient);
  document.getElementById('transferForm').addEventListener('submit', doTransfer);
  document.getElementById('dischargeForm').addEventListener('submit', doDischarge);
  document.getElementById('cancelTransferBtn').addEventListener('click', () => document.getElementById('transferOverlay').style.display = 'none');
  document.getElementById('cancelDischargeBtn').addEventListener('click', () => document.getElementById('dischargeOverlay').style.display = 'none');

  let searchTimer;
  document.getElementById('ad_patient_search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const term = e.target.value.trim();
    if (!term) { document.getElementById('ad_patientResults').innerHTML = ''; return; }
    searchTimer = setTimeout(() => searchAdPatients(term), 250);
  });

  await loadAvailableBeds();
})();

async function searchAdPatients(term) {
  const { data } = await supabaseClient.from('patients').select('*')
    .or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,phone.ilike.%${term}%,mrn.ilike.%${term}%`).limit(8);
  const box = document.getElementById('ad_patientResults');
  if (!data || data.length === 0) { box.innerHTML = '<div class="empty">No matches</div>'; return; }
  box.innerHTML = data.map(p => `
    <div class="link-btn" style="display:block; padding:6px 0;" onclick='selectAdPatient(${JSON.stringify(p).replace(/'/g, "&apos;")})'>
      ${p.first_name} ${p.last_name} · ${p.mrn}
    </div>
  `).join('');
}

function selectAdPatient(p) {
  selectedAdPatient = p;
  document.getElementById('ad_patient_id').value = p.id;
  document.getElementById('ad_selectedPatient').innerHTML = `<span class="pill active">${p.first_name} ${p.last_name} · ${p.mrn}</span>`;
  document.getElementById('ad_patientResults').innerHTML = '';
  document.getElementById('ad_patient_search').value = '';
}

async function loadWardOptions() {
  const { data } = await supabaseClient.from('wards').select('id, name').order('name');
  document.getElementById('ad_ward').innerHTML = (data || []).map(w => `<option value="${w.id}">${w.name}</option>`).join('') || '<option value="">Set up a ward first</option>';
}

async function loadDoctorOptions() {
  const { data } = await supabaseClient.from('app_users').select('id, full_name')
    .in('role', ['DOCTOR', 'CLINICAL_OFFICER', 'MEDICAL_DIRECTOR']).eq('status', 'ACTIVE');
  document.getElementById('ad_doctor').innerHTML = '<option value="">— none —</option>' + (data || []).map(d => `<option value="${d.id}">${d.full_name}</option>`).join('');
}

async function loadAvailableBeds(targetSelectId) {
  const wardId = document.getElementById('ad_ward').value;
  const sel = document.getElementById(targetSelectId || 'ad_bed');
  if (!wardId) { sel.innerHTML = '<option value="">Select a ward first</option>'; return; }
  const { data: rooms } = await supabaseClient.from('rooms').select('id, room_number').eq('ward_id', wardId);
  const roomIds = (rooms || []).map(r => r.id);
  if (roomIds.length === 0) { sel.innerHTML = '<option value="">No rooms in this ward</option>'; return; }
  const { data: beds } = await supabaseClient.from('beds').select('*').in('room_id', roomIds).eq('status', 'AVAILABLE');
  sel.innerHTML = (beds || []).map(b => {
    const room = rooms.find(r => r.id === b.room_id);
    return `<option value="${b.id}">${room ? room.room_number : ''}-${b.bed_number}</option>`;
  }).join('') || '<option value="">No available beds</option>';
}

async function admitPatient(e) {
  e.preventDefault();
  const patientId = document.getElementById('ad_patient_id').value;
  const bedId = document.getElementById('ad_bed').value;
  if (!patientId) { alert('Search for and select a patient first.'); return; }
  if (!bedId) { alert('Select an available bed.'); return; }

  const { data: encounter, error: encErr } = await supabaseClient.from('encounters').insert({
    patient_id: patientId, facility_id: meAd.facility_id || null, provider_id: document.getElementById('ad_doctor').value || null,
    encounter_type: 'INPATIENT', status: 'IN_PROGRESS', created_by: meAd.id
  }).select().single();
  if (encErr) { alert(encErr.message); return; }

  const payload = {
    patient_id: patientId,
    encounter_id: encounter.id,
    ward_id: document.getElementById('ad_ward').value,
    bed_id: bedId,
    admitting_doctor_id: document.getElementById('ad_doctor').value || null,
    admission_diagnosis: document.getElementById('ad_diagnosis').value.trim(),
    admission_type: document.getElementById('ad_type').value,
    status: 'ADMITTED'
  };
  const { data, error } = await supabaseClient.from('admissions').insert(payload).select().single();
  if (error) { alert(error.message); return; }

  await supabaseClient.from('beds').update({ status: 'OCCUPIED' }).eq('id', bedId);
  await logAudit('CREATE', 'HOSPITAL', 'admissions', data.id, null, payload);

  document.getElementById('admitForm').reset();
  document.getElementById('ad_patient_id').value = '';
  document.getElementById('ad_selectedPatient').innerHTML = '';
  await loadAvailableBeds();
  await loadInpatients();
}

async function loadInpatients() {
  const { data } = await supabaseClient
    .from('admissions')
    .select('*, patients(first_name, last_name, mrn), beds(bed_number, rooms(room_number, wards(name)))')
    .eq('status', 'ADMITTED')
    .order('admission_date', { ascending: false });

  const tbody = document.getElementById('inpatientsTable');
  if (!data || data.length === 0) { tbody.innerHTML = '<tr><td colspan="6" class="empty">No current inpatients.</td></tr>'; return; }

  tbody.innerHTML = data.map(a => `
    <tr>
      <td class="mono">${a.admission_number}</td>
      <td>${a.patients.first_name} ${a.patients.last_name} · ${a.patients.mrn}</td>
      <td>${a.beds ? (a.beds.rooms.wards.name + ' · ' + a.beds.rooms.room_number + '-' + a.beds.bed_number) : '—'}</td>
      <td>${a.admission_diagnosis || '—'}</td>
      <td class="mono">${new Date(a.admission_date).toLocaleDateString('en-GB')}</td>
      <td>
        <button class="link-btn" onclick="openTransfer('${a.id}','${a.bed_id}')">Transfer</button> ·
        <button class="link-btn danger" onclick="openDischarge('${a.id}','${a.bed_id}')">Discharge</button>
      </td>
    </tr>
  `).join('');
}

async function openTransfer(admissionId, currentBedId) {
  document.getElementById('tr_admission_id').value = admissionId;
  document.getElementById('tr_from_bed_id').value = currentBedId;
  const { data: beds } = await supabaseClient.from('beds').select('*, rooms(room_number, wards(name))').eq('status', 'AVAILABLE');
  document.getElementById('tr_to_bed').innerHTML = (beds || []).map(b => `<option value="${b.id}">${b.rooms.wards.name} · ${b.rooms.room_number}-${b.bed_number}</option>`).join('') || '<option value="">No available beds</option>';
  document.getElementById('transferOverlay').style.display = 'flex';
}

async function doTransfer(e) {
  e.preventDefault();
  const admissionId = document.getElementById('tr_admission_id').value;
  const fromBed = document.getElementById('tr_from_bed_id').value;
  const toBed = document.getElementById('tr_to_bed').value;
  if (!toBed) { alert('No bed selected.'); return; }

  const { data, error } = await supabaseClient.from('bed_transfers').insert({
    admission_id: admissionId, from_bed_id: fromBed, to_bed_id: toBed,
    reason: document.getElementById('tr_reason').value.trim(), requested_by: meAd.id, approved_by: meAd.id
  }).select().single();
  if (error) { alert(error.message); return; }

  await supabaseClient.from('beds').update({ status: 'AVAILABLE' }).eq('id', fromBed);
  await supabaseClient.from('beds').update({ status: 'OCCUPIED' }).eq('id', toBed);
  await supabaseClient.from('admissions').update({ bed_id: toBed }).eq('id', admissionId);
  await logAudit('UPDATE', 'HOSPITAL', 'bed_transfers', data.id, null, { admission_id: admissionId, to_bed: toBed });

  document.getElementById('transferOverlay').style.display = 'none';
  await loadInpatients();
}

function openDischarge(admissionId, bedId) {
  document.getElementById('dc_admission_id').value = admissionId;
  document.getElementById('dc_bed_id').value = bedId;
  document.getElementById('dischargeOverlay').style.display = 'flex';
}

async function doDischarge(e) {
  e.preventDefault();
  const admissionId = document.getElementById('dc_admission_id').value;
  const bedId = document.getElementById('dc_bed_id').value;
  const disposition = document.getElementById('dc_disposition').value;

  await supabaseClient.from('admissions').update({
    status: 'DISCHARGED', discharge_date: new Date().toISOString(), discharge_disposition: disposition
  }).eq('id', admissionId);
  await supabaseClient.from('beds').update({ status: 'CLEANING' }).eq('id', bedId);
  await logAudit('UPDATE', 'HOSPITAL', 'admissions', admissionId, null, { status: 'DISCHARGED', discharge_disposition: disposition });

  document.getElementById('dischargeOverlay').style.display = 'none';
  await loadInpatients();
}
