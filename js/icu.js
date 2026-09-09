// ==========================================================
// HCMIS — ICU
// ==========================================================

let meI = null;

(async function init() {
  meI = await requireAuth();
  if (!meI) return;

  document.getElementById('whoName').textContent = meI.full_name;
  document.getElementById('whoRole').textContent = meI.role;
  document.getElementById('facilityName').textContent =
    (meI.facilities && meI.facilities.name) ? meI.facilities.name : 'No facility assigned';
  if (['SUPER_ADMIN', 'FACILITY_ADMIN'].includes(meI.role)) {
    document.getElementById('adminNavGroup').style.display = 'block';
  }

  document.getElementById('obsForm').addEventListener('submit', saveObservation);
  document.getElementById('cancelObsBtn').addEventListener('click', () => document.getElementById('obsOverlay').style.display = 'none');

  await loadAlerts();
  await loadIcuPatients();
})();

async function loadIcuPatients() {
  const { data } = await supabaseClient
    .from('admissions')
    .select('*, patients(first_name, last_name, mrn), beds(bed_number, rooms(room_number, wards(name, ward_type)))')
    .eq('status', 'ADMITTED');

  const icuAdmissions = (data || []).filter(a =>
    a.beds && a.beds.rooms && a.beds.rooms.wards && (a.beds.rooms.wards.ward_type || '').toLowerCase().includes('icu')
  );

  const box = document.getElementById('icuBody');
  if (icuAdmissions.length === 0) { box.innerHTML = '<p class="empty">No patients currently admitted to an ICU ward. (Set a ward\'s type to "ICU" in Wards &amp; Beds.)</p>'; return; }

  let html = '';
  for (const a of icuAdmissions) {
    const { data: latest } = await supabaseClient.from('icu_records').select('*').eq('admission_id', a.id).order('recorded_at', { ascending: false }).limit(1).maybeSingle();
    html += `
      <div class="panel" style="margin-bottom:10px;">
        <div class="panel-body">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
            <div>
              <strong>${a.patients.first_name} ${a.patients.last_name} · ${a.patients.mrn}</strong>
              <br><span style="color:var(--hc-ink-soft); font-size:.85rem;">${a.beds.rooms.wards.name} · ${a.beds.rooms.room_number}-${a.beds.bed_number}</span>
            </div>
            <button class="btn btn-secondary" onclick="openObs('${a.id}','${a.patient_id}')">Record observation</button>
          </div>
          ${latest ? `
            <div style="margin-top:10px; font-size:.88rem; color:var(--hc-ink-soft);">
              Last recorded ${new Date(latest.recorded_at).toLocaleString('en-GB')}: ${latest.vital_signs_note || 'no vitals note'}
              ${latest.critical_alert ? ' <span class="pill inactive">CRITICAL</span>' : ''}
            </div>` : '<p class="empty" style="margin-top:8px;">No observations recorded yet.</p>'}
        </div>
      </div>
    `;
  }
  box.innerHTML = html;
}

function openObs(admissionId, patientId) {
  document.getElementById('obsForm').reset();
  document.getElementById('o_admission_id').value = admissionId;
  document.getElementById('o_patient_id').value = patientId;
  document.getElementById('obsOverlay').style.display = 'flex';
}

async function saveObservation(e) {
  e.preventDefault();
  const payload = {
    admission_id: document.getElementById('o_admission_id').value,
    patient_id: document.getElementById('o_patient_id').value,
    ventilator_status: document.getElementById('o_vent').value.trim(),
    vital_signs_note: document.getElementById('o_vitals').value.trim(),
    fluid_balance: document.getElementById('o_fluid').value.trim(),
    medication_notes: document.getElementById('o_meds').value.trim(),
    daily_review: document.getElementById('o_review').value.trim(),
    critical_alert: document.getElementById('o_critical').checked,
    recorded_by: meI.id
  };
  const { data, error } = await supabaseClient.from('icu_records').insert(payload).select().single();
  if (error) { alert(error.message); return; }
  await logAudit('CREATE', 'ICU', 'icu_records', data.id, null, payload);

  document.getElementById('obsOverlay').style.display = 'none';
  await loadAlerts();
  await loadIcuPatients();
}

async function loadAlerts() {
  const { data } = await supabaseClient
    .from('icu_records')
    .select('*, admissions(patients(first_name, last_name, mrn))')
    .eq('critical_alert', true)
    .order('recorded_at', { ascending: false })
    .limit(10);

  const panel = document.getElementById('alertsPanel');
  if (!data || data.length === 0) { panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  document.getElementById('alertsList').innerHTML = data.map(r => `
    <div class="panel" style="margin-bottom:6px;">
      <div class="panel-body" style="padding:10px 14px;">
        <strong>${r.admissions && r.admissions.patients ? r.admissions.patients.first_name + ' ' + r.admissions.patients.last_name : 'Patient'}</strong> —
        ${r.vital_signs_note || r.daily_review || 'Critical observation flagged'}
        <span style="color:var(--hc-ink-soft); font-size:.82rem;"> · ${new Date(r.recorded_at).toLocaleString('en-GB')}</span>
      </div>
    </div>
  `).join('');
}
