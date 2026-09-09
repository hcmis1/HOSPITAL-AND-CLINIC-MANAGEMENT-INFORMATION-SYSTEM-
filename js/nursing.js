// ==========================================================
// HCMIS — Nursing
// ==========================================================

let meN = null;
let currentPatientId = null;
let currentEncounterId = null;

(async function init() {
  meN = await requireAuth();
  if (!meN) return;

  document.getElementById('whoName').textContent = meN.full_name;
  document.getElementById('whoRole').textContent = meN.role;
  document.getElementById('facilityName').textContent =
    (meN.facilities && meN.facilities.name) ? meN.facilities.name : 'No facility assigned';

  document.getElementById('addVitalsBtn').addEventListener('click', addVitals);
  document.getElementById('addFluidBtn').addEventListener('click', addFluid);
  document.getElementById('addCarePlanBtn').addEventListener('click', addCarePlan);
  document.getElementById('addNoteBtn').addEventListener('click', addNote);

  await loadPatientList();
})();

async function loadPatientList() {
  const { data } = await supabaseClient
    .from('admissions')
    .select('*, patients(first_name, last_name, mrn), beds(bed_number, rooms(room_number, wards(name)))')
    .eq('status', 'ADMITTED');

  const box = document.getElementById('patientListBody');
  if (!data || data.length === 0) { box.innerHTML = '<p class="empty">No current inpatients.</p>'; return; }

  box.innerHTML = data.map(a => `
    <div class="panel" style="margin-bottom:8px;">
      <div class="panel-body" style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <strong>${a.patients.first_name} ${a.patients.last_name} · ${a.patients.mrn}</strong>
          <br><span style="color:var(--hc-ink-soft); font-size:.85rem;">${a.beds ? a.beds.rooms.wards.name + ' · ' + a.beds.rooms.room_number + '-' + a.beds.bed_number : '—'}</span>
        </div>
        <button class="btn btn-secondary" onclick="openChart('${a.patient_id}','${a.encounter_id}')">Open chart</button>
      </div>
    </div>
  `).join('');
}

async function openChart(patientId, encounterId) {
  currentPatientId = patientId;
  currentEncounterId = encounterId;

  const { data: p } = await supabaseClient.from('patients').select('first_name, last_name, mrn').eq('id', patientId).single();
  document.getElementById('chartTitle').textContent = p ? `${p.first_name} ${p.last_name} · ${p.mrn}` : 'Nursing chart';

  await loadVitals();
  await loadMar();
  await loadFluid();
  await loadCarePlans();
  await loadNotes();

  document.getElementById('chartPanel').style.display = 'block';
  document.getElementById('chartPanel').scrollIntoView({ behavior: 'smooth' });
}

function closeChart() {
  document.getElementById('chartPanel').style.display = 'none';
  currentPatientId = null;
  currentEncounterId = null;
}

// ---------------- VITALS ----------------
async function loadVitals() {
  const { data } = await supabaseClient.from('vital_signs').select('*').eq('encounter_id', currentEncounterId).order('recorded_at', { ascending: false }).limit(10);
  const box = document.getElementById('vitalsList');
  if (!data || data.length === 0) { box.innerHTML = '<span class="empty">No vitals recorded yet.</span>'; return; }
  box.innerHTML = data.map(v => `
    <div class="panel" style="margin-bottom:6px;"><div class="panel-body" style="padding:8px 12px; font-size:.88rem;">
      <span class="mono" style="color:var(--hc-ink-soft);">${new Date(v.recorded_at).toLocaleTimeString('en-GB')}</span> —
      Temp ${v.temperature ?? '—'}°C, Pulse ${v.pulse ?? '—'}, RR ${v.respiratory_rate ?? '—'}, SpO₂ ${v.spo2 ?? '—'}%, BP ${v.systolic_bp ?? '—'}/${v.diastolic_bp ?? '—'}
    </div></div>
  `).join('');
}

async function addVitals() {
  const payload = {
    patient_id: currentPatientId, encounter_id: currentEncounterId, recorded_by: meN.id,
    temperature: parseFloat(document.getElementById('v_temp').value) || null,
    pulse: parseInt(document.getElementById('v_pulse').value) || null,
    respiratory_rate: parseInt(document.getElementById('v_rr').value) || null,
    spo2: parseInt(document.getElementById('v_spo2').value) || null,
    systolic_bp: parseInt(document.getElementById('v_sys').value) || null,
    diastolic_bp: parseInt(document.getElementById('v_dia').value) || null
  };
  const { data, error } = await supabaseClient.from('vital_signs').insert(payload).select().single();
  if (error) { alert(error.message); return; }
  await logAudit('CREATE', 'NURSING', 'vital_signs', data.id, null, payload);
  ['v_temp', 'v_pulse', 'v_rr', 'v_spo2', 'v_sys', 'v_dia'].forEach(id => document.getElementById(id).value = '');
  await loadVitals();
}

// ---------------- MEDICATION ADMINISTRATION ----------------
async function loadMar() {
  const { data: prescriptions } = await supabaseClient.from('prescriptions').select('id').eq('encounter_id', currentEncounterId);
  const box = document.getElementById('marList');
  if (!prescriptions || prescriptions.length === 0) { box.innerHTML = '<span class="empty">No prescriptions on this encounter.</span>'; return; }

  const prescriptionIds = prescriptions.map(p => p.id);
  const { data: items } = await supabaseClient.from('prescription_items').select('*').in('prescription_id', prescriptionIds);
  if (!items || items.length === 0) { box.innerHTML = '<span class="empty">No medicines prescribed yet.</span>'; return; }

  let html = '';
  for (const item of items) {
    const { data: history } = await supabaseClient.from('medication_administration').select('*').eq('prescription_item_id', item.id).order('administered_at', { ascending: false }).limit(3);
    html += `
      <div class="panel" style="margin-bottom:8px;">
        <div class="panel-body">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div><strong>${item.medicine_name}</strong> — ${item.dose || ''} ${item.route || ''} ${item.frequency || ''}</div>
            <button class="link-btn" onclick="giveDose('${item.id}','${(item.dose || '').replace(/'/g, "\\'")}','${(item.route || '').replace(/'/g, "\\'")}')">Give dose</button>
          </div>
          ${(history && history.length > 0) ? `<div style="margin-top:6px; font-size:.82rem; color:var(--hc-ink-soft);">
            ${history.map(h => new Date(h.administered_at).toLocaleString('en-GB') + ' — ' + h.status).join('<br>')}
          </div>` : ''}
        </div>
      </div>`;
  }
  box.innerHTML = html;
}

async function giveDose(itemId, dose, route) {
  const payload = {
    prescription_item_id: itemId, patient_id: currentPatientId, encounter_id: currentEncounterId,
    administered_by: meN.id, dose_given: dose, route, status: 'GIVEN'
  };
  const { data, error } = await supabaseClient.from('medication_administration').insert(payload).select().single();
  if (error) { alert(error.message); return; }
  await logAudit('CREATE', 'NURSING', 'medication_administration', data.id, null, payload);
  await loadMar();
}

// ---------------- FLUID BALANCE ----------------
async function loadFluid() {
  const { data } = await supabaseClient.from('fluid_balance').select('*').eq('encounter_id', currentEncounterId).order('recorded_at', { ascending: false }).limit(10);
  const box = document.getElementById('fluidList');
  if (!data || data.length === 0) { box.innerHTML = '<span class="empty">No fluid balance recorded yet.</span>'; return; }
  box.innerHTML = data.map(f => `
    <div class="panel" style="margin-bottom:6px;"><div class="panel-body" style="padding:8px 12px; font-size:.88rem;">
      <span class="mono" style="color:var(--hc-ink-soft);">${new Date(f.recorded_at).toLocaleTimeString('en-GB')}</span> —
      In: ${(f.intake_oral || 0) + (f.intake_iv || 0)}ml, Out: ${(f.output_urine || 0) + (f.output_other || 0)}ml
    </div></div>
  `).join('');
}

async function addFluid() {
  const payload = {
    encounter_id: currentEncounterId, patient_id: currentPatientId, recorded_by: meN.id,
    intake_oral: parseFloat(document.getElementById('f_oral').value) || null,
    intake_iv: parseFloat(document.getElementById('f_iv').value) || null,
    output_urine: parseFloat(document.getElementById('f_urine').value) || null,
    output_other: parseFloat(document.getElementById('f_other').value) || null
  };
  const { data, error } = await supabaseClient.from('fluid_balance').insert(payload).select().single();
  if (error) { alert(error.message); return; }
  await logAudit('CREATE', 'NURSING', 'fluid_balance', data.id, null, payload);
  ['f_oral', 'f_iv', 'f_urine', 'f_other'].forEach(id => document.getElementById(id).value = '');
  await loadFluid();
}

// ---------------- CARE PLANS ----------------
async function loadCarePlans() {
  const { data } = await supabaseClient.from('nursing_care_plans').select('*').eq('encounter_id', currentEncounterId).order('created_at', { ascending: false });
  const box = document.getElementById('carePlanList');
  if (!data || data.length === 0) { box.innerHTML = '<span class="empty">No care plans yet.</span>'; return; }
  box.innerHTML = data.map(c => `
    <div class="panel" style="margin-bottom:6px;"><div class="panel-body" style="padding:10px 14px; font-size:.88rem;">
      <strong>${c.problem}</strong> ${c.goal ? '— Goal: ' + c.goal : ''} ${c.intervention ? '— ' + c.intervention : ''}
      <span class="pill ${c.status === 'RESOLVED' ? 'active' : 'inactive'}" style="margin-left:8px;">${c.status}</span>
      ${c.status === 'ACTIVE' ? `<button class="link-btn" style="margin-left:8px;" onclick="resolveCarePlan('${c.id}')">Resolve</button>` : ''}
    </div></div>
  `).join('');
}

async function addCarePlan() {
  const problem = document.getElementById('cp_problem').value.trim();
  if (!problem) return;
  const payload = {
    encounter_id: currentEncounterId, patient_id: currentPatientId,
    problem, goal: document.getElementById('cp_goal').value.trim(),
    intervention: document.getElementById('cp_intervention').value.trim(), created_by: meN.id
  };
  const { data, error } = await supabaseClient.from('nursing_care_plans').insert(payload).select().single();
  if (error) { alert(error.message); return; }
  await logAudit('CREATE', 'NURSING', 'nursing_care_plans', data.id, null, payload);
  ['cp_problem', 'cp_goal', 'cp_intervention'].forEach(id => document.getElementById(id).value = '');
  await loadCarePlans();
}

async function resolveCarePlan(id) {
  await supabaseClient.from('nursing_care_plans').update({ status: 'RESOLVED' }).eq('id', id);
  await logAudit('UPDATE', 'NURSING', 'nursing_care_plans', id, null, { status: 'RESOLVED' });
  await loadCarePlans();
}

// ---------------- NOTES ----------------
async function loadNotes() {
  const { data } = await supabaseClient.from('nursing_notes').select('*, app_users(full_name)').eq('encounter_id', currentEncounterId).order('created_at', { ascending: false }).limit(10);
  const box = document.getElementById('notesList');
  if (!data || data.length === 0) { box.innerHTML = '<span class="empty">No notes yet.</span>'; return; }
  box.innerHTML = data.map(n => `
    <div class="panel" style="margin-bottom:6px;"><div class="panel-body" style="padding:10px 14px; font-size:.88rem;">
      <span class="mono" style="color:var(--hc-ink-soft);">${new Date(n.created_at).toLocaleString('en-GB')}</span> —
      ${n.note_text} <span style="color:var(--hc-ink-soft);">(${n.app_users ? n.app_users.full_name : 'Nurse'})</span>
    </div></div>
  `).join('');
}

async function addNote() {
  const text = document.getElementById('nn_text').value.trim();
  if (!text) return;
  const payload = { encounter_id: currentEncounterId, patient_id: currentPatientId, author_id: meN.id, note_text: text };
  const { data, error } = await supabaseClient.from('nursing_notes').insert(payload).select().single();
  if (error) { alert(error.message); return; }
  await logAudit('CREATE', 'NURSING', 'nursing_notes', data.id, null, payload);
  document.getElementById('nn_text').value = '';
  await loadNotes();
}
