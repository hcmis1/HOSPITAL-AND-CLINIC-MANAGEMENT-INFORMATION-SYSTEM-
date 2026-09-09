// ==========================================================
// HCMIS — Clinical Workspace (Encounter)
// ==========================================================

let meC = null;
let patient = null;
let encounter = null;
let prescriptionId = null;
let labOrderId = null;
let imagingOrderId = null;
let isReadOnly = false;

(async function init() {
  meC = await requireAuth();
  if (!meC) return;

  document.getElementById('whoName').textContent = meC.full_name;
  document.getElementById('whoRole').textContent = meC.role;
  document.getElementById('facilityName').textContent =
    (meC.facilities && meC.facilities.name) ? meC.facilities.name : 'No facility assigned';
  if (['SUPER_ADMIN', 'FACILITY_ADMIN'].includes(meC.role)) {
    document.getElementById('adminNavGroup').style.display = 'block';
  }

  const params = new URLSearchParams(window.location.search);
  const patientId = params.get('patient');
  const encounterId = params.get('encounter');
  const appointmentId = params.get('appointment');

  if (!patientId) {
    document.getElementById('patientHeader').textContent = 'No patient specified. Open this page from a patient profile.';
    return;
  }

  const { data: p } = await supabaseClient.from('patients').select('*').eq('id', patientId).single();
  if (!p) { document.getElementById('patientHeader').textContent = 'Patient not found.'; return; }
  patient = p;
  renderPatientHeader();

  encounter = await ensureEncounter(encounterId, appointmentId);
  history.replaceState(null, '', `encounter.html?patient=${patient.id}&encounter=${encounter.id}`);

  isReadOnly = encounter.status === 'COMPLETED' || encounter.status === 'CANCELLED';
  document.getElementById('encounterNumber').textContent = encounter.encounter_number;
  document.getElementById('encounterStatusPill').textContent = encounter.status;
  document.getElementById('encounterStatusPill').className = 'pill ' + (isReadOnly ? 'inactive' : 'active');

  if (isReadOnly) {
    ['triageFieldset', 'noteFieldset', 'diagFieldset', 'rxFieldset', 'labFieldset', 'imgFieldset', 'referralFieldset'].forEach(id => document.getElementById(id).disabled = true);
    document.getElementById('savePrescriptionBtn').disabled = true;
  }

  await loadTriage();
  await loadNote();
  await loadDiagnoses();
  await loadPrescription();
  await loadLabOrders();
  await loadImagingOrders();
  await loadTimeline();

  document.getElementById('saveTriageBtn').addEventListener('click', saveTriage);
  document.getElementById('saveNoteBtn').addEventListener('click', () => saveNote(false));
  document.getElementById('signNoteBtn').addEventListener('click', () => saveNote(true));
  document.getElementById('addDiagBtn').addEventListener('click', addDiagnosis);
  document.getElementById('addRxItemBtn').addEventListener('click', addRxItem);
  document.getElementById('addLabTestBtn').addEventListener('click', addLabTest);
  document.getElementById('addImgServiceBtn').addEventListener('click', addImagingService);
  document.getElementById('createReferralBtn').addEventListener('click', createReferral);

  await loadCatalogueDatalists();
  await loadReferrals();
  document.getElementById('savePrescriptionBtn').addEventListener('click', () => {
    if (!prescriptionId) { alert('Add at least one medicine first.'); return; }
    alert('Prescription sent to pharmacy.');
  });
})();

function calcAgeC(dob) {
  if (!dob) return '—';
  return Math.floor((new Date() - new Date(dob)) / (365.25 * 24 * 3600 * 1000));
}

function renderPatientHeader() {
  document.getElementById('patientHeader').innerHTML = `
    <div>
      <div class="name">${patient.first_name} ${patient.last_name}</div>
      <div class="meta">${patient.mrn} · ${patient.sex} · ${calcAgeC(patient.date_of_birth)} yrs</div>
    </div>
    ${patient.allergies ? `<div class="allergy-flag">⚠ ${patient.allergies}</div>` : ''}
  `;
}

// ---------------- ENCOUNTER ----------------
async function ensureEncounter(encounterId, appointmentId) {
  if (encounterId) {
    const { data } = await supabaseClient.from('encounters').select('*').eq('id', encounterId).single();
    if (data) return data;
  }
  const { data: open } = await supabaseClient.from('encounters').select('*')
    .eq('patient_id', patient.id).in('status', ['OPEN', 'IN_PROGRESS'])
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (open) return open;

  const payload = {
    patient_id: patient.id,
    facility_id: meC.facility_id || null,
    department_id: meC.department_id || null,
    appointment_id: appointmentId || null,
    provider_id: meC.id,
    encounter_type: 'OPD',
    status: 'OPEN',
    created_by: meC.id
  };
  const { data, error } = await supabaseClient.from('encounters').insert(payload).select().single();
  if (error) { alert(error.message); throw error; }
  await logAudit('CREATE', 'CLINICAL', 'encounters', data.id, null, payload);

  const consultService = await findCatalogueService('Consultation', 'CONSULTATION');
  if (consultService) {
    const inv = await findOrCreateInvoice(patient.id, data.id, meC.facility_id, meC.id);
    if (inv) await addInvoiceItem(inv.id, {
      description: consultService.service_name, quantity: 1, unit_price: consultService.standard_price,
      source_module: 'CONSULTATION', source_record_id: data.id
    });
  }

  return data;
}

// ---------------- TRIAGE ----------------
async function loadTriage() {
  const { data } = await supabaseClient.from('triage_records').select('*').eq('encounter_id', encounter.id).maybeSingle();
  if (!data) return;
  document.getElementById('t_temp').value = data.temperature || '';
  document.getElementById('t_pulse').value = data.pulse || '';
  document.getElementById('t_rr').value = data.respiratory_rate || '';
  document.getElementById('t_spo2').value = data.spo2 || '';
  document.getElementById('t_sys').value = data.bp_systolic || '';
  document.getElementById('t_dia').value = data.bp_diastolic || '';
  document.getElementById('t_weight').value = data.weight || '';
  document.getElementById('t_height').value = data.height || '';
  document.getElementById('t_pain').value = data.pain_score || '';
  document.getElementById('t_category').value = data.triage_category || '';
  document.getElementById('t_notes').value = data.notes || '';
}

async function saveTriage() {
  const weight = parseFloat(document.getElementById('t_weight').value) || null;
  const height = parseFloat(document.getElementById('t_height').value) || null;
  const bmi = (weight && height) ? +(weight / ((height / 100) ** 2)).toFixed(1) : null;

  const payload = {
    encounter_id: encounter.id,
    patient_id: patient.id,
    temperature: parseFloat(document.getElementById('t_temp').value) || null,
    pulse: parseInt(document.getElementById('t_pulse').value) || null,
    respiratory_rate: parseInt(document.getElementById('t_rr').value) || null,
    spo2: parseInt(document.getElementById('t_spo2').value) || null,
    bp_systolic: parseInt(document.getElementById('t_sys').value) || null,
    bp_diastolic: parseInt(document.getElementById('t_dia').value) || null,
    weight, height, bmi,
    pain_score: parseInt(document.getElementById('t_pain').value) || null,
    triage_category: document.getElementById('t_category').value || null,
    notes: document.getElementById('t_notes').value.trim(),
    triaged_by: meC.id
  };

  const { data: existing } = await supabaseClient.from('triage_records').select('id').eq('encounter_id', encounter.id).maybeSingle();
  if (existing) {
    await supabaseClient.from('triage_records').update(payload).eq('id', existing.id);
    await logAudit('UPDATE', 'CLINICAL', 'triage_records', existing.id, null, payload);
  } else {
    const { data } = await supabaseClient.from('triage_records').insert(payload).select().single();
    await logAudit('CREATE', 'CLINICAL', 'triage_records', data.id, null, payload);
  }
  alert('Triage saved.');
}

// ---------------- CONSULTATION NOTE ----------------
async function loadNote() {
  const { data } = await supabaseClient.from('clinical_notes').select('*').eq('encounter_id', encounter.id).maybeSingle();
  if (!data) return;
  document.getElementById('n_chief').value = data.chief_complaint || '';
  document.getElementById('n_history').value = data.history || '';
  document.getElementById('n_exam').value = data.examination || '';
  document.getElementById('n_assessment').value = data.assessment || '';
  document.getElementById('n_plan').value = data.plan || '';
}

async function saveNote(sign) {
  const payload = {
    encounter_id: encounter.id,
    patient_id: patient.id,
    author_id: meC.id,
    chief_complaint: document.getElementById('n_chief').value.trim(),
    history: document.getElementById('n_history').value.trim(),
    examination: document.getElementById('n_exam').value.trim(),
    assessment: document.getElementById('n_assessment').value.trim(),
    plan: document.getElementById('n_plan').value.trim()
  };
  if (sign) {
    payload.status = 'SIGNED';
    payload.signed_at = new Date().toISOString();
    payload.signed_by = meC.id;
  }

  const { data: existing } = await supabaseClient.from('clinical_notes').select('id').eq('encounter_id', encounter.id).maybeSingle();
  if (existing) {
    await supabaseClient.from('clinical_notes').update(payload).eq('id', existing.id);
    await logAudit('UPDATE', 'CLINICAL', 'clinical_notes', existing.id, null, payload);
  } else {
    const { data } = await supabaseClient.from('clinical_notes').insert(payload).select().single();
    await logAudit('CREATE', 'CLINICAL', 'clinical_notes', data.id, null, payload);
  }

  if (sign) {
    await supabaseClient.from('encounters').update({
      status: 'COMPLETED', closed_at: new Date().toISOString(), chief_complaint: payload.chief_complaint
    }).eq('id', encounter.id);
    await logAudit('UPDATE', 'CLINICAL', 'encounters', encounter.id, null, { status: 'COMPLETED' });
    alert('Encounter signed and completed.');
    window.location.reload();
  } else {
    alert('Draft saved.');
  }
}

// ---------------- DIAGNOSES ----------------
async function loadDiagnoses() {
  const { data } = await supabaseClient.from('diagnoses').select('*').eq('encounter_id', encounter.id).order('created_at');
  const box = document.getElementById('diagList');
  if (!data || data.length === 0) { box.innerHTML = '<span class="empty">No diagnoses recorded yet.</span>'; return; }
  box.innerHTML = data.map(d => `
    <span class="diag-chip">
      ${d.diagnosis_name}${d.diagnosis_code ? ' (' + d.diagnosis_code + ')' : ''} <span style="opacity:.7;">(${d.diagnosis_type.toLowerCase()}, ${d.certainty.toLowerCase()})</span>
      ${!isReadOnly ? `<button onclick="deleteDiagnosis('${d.id}')">×</button>` : ''}
    </span>
  `).join('');
}

async function addDiagnosis() {
  const name = document.getElementById('d_name').value.trim();
  if (!name) return;
  const payload = {
    encounter_id: encounter.id,
    patient_id: patient.id,
    diagnosis_name: name,
    diagnosis_type: document.getElementById('d_type').value,
    certainty: document.getElementById('d_certainty').value,
    diagnosis_code: document.getElementById('d_code').value.trim() || null,
    recorded_by: meC.id
  };
  const { data, error } = await supabaseClient.from('diagnoses').insert(payload).select().single();
  if (error) { alert(error.message); return; }
  await logAudit('CREATE', 'CLINICAL', 'diagnoses', data.id, null, payload);
  document.getElementById('d_name').value = '';
  await loadDiagnoses();
}

async function deleteDiagnosis(id) {
  await supabaseClient.from('diagnoses').delete().eq('id', id);
  await logAudit('DELETE', 'CLINICAL', 'diagnoses', id, null, null);
  await loadDiagnoses();
}

// ---------------- PRESCRIPTION ----------------
async function loadPrescription() {
  const { data: rx } = await supabaseClient.from('prescriptions').select('*').eq('encounter_id', encounter.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!rx) { renderRxItems([]); return; }
  prescriptionId = rx.id;
  const { data: items } = await supabaseClient.from('prescription_items').select('*').eq('prescription_id', rx.id);
  renderRxItems(items || [], rx.prescription_number);
}

function renderRxItems(items, rxNumber) {
  const box = document.getElementById('rxItemsList');
  if (!items || items.length === 0) { box.innerHTML = '<span class="empty">No medicines added yet.</span>'; return; }
  box.innerHTML = (rxNumber ? `<p class="mono" style="color:var(--hc-ink-soft); font-size:.85rem;">${rxNumber}</p>` : '') +
    items.map(i => `
      <div class="panel" style="margin-bottom:6px;">
        <div class="panel-body" style="padding:10px 14px;">
          <strong>${i.medicine_name}</strong> — ${i.dose || ''} ${i.route || ''} ${i.frequency || ''} for ${i.duration || ''} (${i.quantity || '—'})
          ${i.instructions ? `<br><span style="color:var(--hc-ink-soft); font-size:.85rem;">${i.instructions}</span>` : ''}
        </div>
      </div>
    `).join('');
}

async function addRxItem() {
  const name = document.getElementById('rx_name').value.trim();
  if (!name) return;

  if (patient.allergies && patient.allergies.trim()) {
    const allergyWords = patient.allergies.toLowerCase().split(/[,;]+/).map(s => s.trim()).filter(Boolean);
    const nameLower = name.toLowerCase();
    const hit = allergyWords.find(a => a && (nameLower.includes(a) || a.includes(nameLower)));
    if (hit) {
      const proceed = confirm(`⚠ Patient has a recorded allergy to "${hit}". Continue prescribing "${name}" anyway?`);
      if (!proceed) return;
    }
  }

  if (!prescriptionId) {
    const { data, error } = await supabaseClient.from('prescriptions').insert({
      encounter_id: encounter.id, patient_id: patient.id, prescriber_id: meC.id, status: 'PENDING'
    }).select().single();
    if (error) { alert(error.message); return; }
    prescriptionId = data.id;
    await logAudit('CREATE', 'PHARMACY', 'prescriptions', data.id, null, { encounter_id: encounter.id });
  }

  const payload = {
    prescription_id: prescriptionId,
    medicine_name: name,
    dose: document.getElementById('rx_dose').value.trim(),
    route: document.getElementById('rx_route').value.trim(),
    frequency: document.getElementById('rx_freq').value.trim(),
    duration: document.getElementById('rx_duration').value.trim(),
    quantity: document.getElementById('rx_qty').value.trim(),
    instructions: document.getElementById('rx_instructions').value.trim()
  };
  const { data, error } = await supabaseClient.from('prescription_items').insert(payload).select().single();
  if (error) { alert(error.message); return; }
  await logAudit('CREATE', 'PHARMACY', 'prescription_items', data.id, null, payload);

  ['rx_name', 'rx_dose', 'rx_route', 'rx_freq', 'rx_duration', 'rx_qty', 'rx_instructions'].forEach(id => document.getElementById(id).value = '');
  await loadPrescription();
}

// ---------------- LABORATORY ----------------

async function loadLabOrders() {
  const { data: orders } = await supabaseClient.from('lab_orders').select('*').eq('encounter_id', encounter.id).order('ordered_at', { ascending: false });
  const box = document.getElementById('labOrdersList');
  if (!orders || orders.length === 0) { box.innerHTML = '<span class="empty">No laboratory tests ordered yet.</span>'; return; }

  labOrderId = orders[0].id;
  let html = '';
  for (const o of orders) {
    const { data: items } = await supabaseClient.from('lab_order_items').select('*, lab_results(*)').eq('lab_order_id', o.id);
    html += `<p class="mono" style="color:var(--hc-ink-soft); font-size:.85rem;">${o.order_number} · ${o.priority}</p>`;
    (items || []).forEach(i => {
      const r = i.lab_results && i.lab_results[0];
      html += `
        <div class="panel" style="margin-bottom:6px;">
          <div class="panel-body" style="padding:10px 14px;">
            <strong>${i.test_name}</strong> — <span class="pill ${i.status === 'VALIDATED' ? 'active' : 'inactive'}">${i.status}</span>
            ${r ? `<br>Result: ${r.result_value || r.numeric_result || '—'} ${r.unit || ''} ${r.flag ? '(' + r.flag + ')' : ''}` : ''}
          </div>
        </div>`;
    });
  }
  box.innerHTML = html;
}

async function addLabTest() {
  const name = document.getElementById('lab_test_name').value.trim();
  if (!name) return;

  if (!labOrderId) {
    const payload = {
      patient_id: patient.id, encounter_id: encounter.id, ordered_by: meC.id,
      priority: document.getElementById('lab_priority').value,
      clinical_information: document.getElementById('lab_clinical_info').value.trim()
    };
    const { data, error } = await supabaseClient.from('lab_orders').insert(payload).select().single();
    if (error) { alert(error.message); return; }
    labOrderId = data.id;
    await logAudit('CREATE', 'LABORATORY', 'lab_orders', data.id, null, payload);
  }

  const { data, error } = await supabaseClient.from('lab_order_items').insert({ lab_order_id: labOrderId, test_name: name }).select().single();
  if (error) { alert(error.message); return; }
  await logAudit('CREATE', 'LABORATORY', 'lab_order_items', data.id, null, { test_name: name });

  const service = await findCatalogueService(name, 'LABORATORY');
  if (service) {
    const inv = await findOrCreateInvoice(patient.id, encounter.id, meC.facility_id, meC.id);
    if (inv) await addInvoiceItem(inv.id, {
      description: service.service_name, quantity: 1, unit_price: service.standard_price,
      source_module: 'LABORATORY', source_record_id: data.id
    });
  }

  document.getElementById('lab_test_name').value = '';
  await loadLabOrders();
}

// ---------------- RADIOLOGY ----------------

async function loadImagingOrders() {
  const { data: orders } = await supabaseClient.from('imaging_orders').select('*').eq('encounter_id', encounter.id).order('ordered_at', { ascending: false });
  const box = document.getElementById('imgOrdersList');
  if (!orders || orders.length === 0) { box.innerHTML = '<span class="empty">No imaging ordered yet.</span>'; return; }

  imagingOrderId = orders[0].id;
  let html = '';
  for (const o of orders) {
    const { data: items } = await supabaseClient.from('imaging_order_items').select('*, imaging_reports(*)').eq('imaging_order_id', o.id);
    html += `<p class="mono" style="color:var(--hc-ink-soft); font-size:.85rem;">${o.order_number} · ${o.priority}</p>`;
    (items || []).forEach(i => {
      const r = i.imaging_reports && i.imaging_reports[0];
      html += `
        <div class="panel" style="margin-bottom:6px;">
          <div class="panel-body" style="padding:10px 14px;">
            <strong>${i.service_name}</strong> ${i.modality ? '(' + i.modality + ')' : ''} — <span class="pill ${i.status === 'COMPLETED' ? 'active' : 'inactive'}">${i.status}</span>
            ${r && r.reported_at ? `<br><strong>Findings:</strong> ${r.findings || '—'}<br><strong>Impression:</strong> ${r.impression || '—'}` : ''}
          </div>
        </div>`;
    });
  }
  box.innerHTML = html;
}

async function addImagingService() {
  const name = document.getElementById('img_service_name').value.trim();
  if (!name) return;

  if (!imagingOrderId) {
    const payload = {
      patient_id: patient.id, encounter_id: encounter.id, requested_by: meC.id,
      priority: document.getElementById('img_priority').value,
      clinical_indication: document.getElementById('img_indication').value.trim()
    };
    const { data, error } = await supabaseClient.from('imaging_orders').insert(payload).select().single();
    if (error) { alert(error.message); return; }
    imagingOrderId = data.id;
    await logAudit('CREATE', 'RADIOLOGY', 'imaging_orders', data.id, null, payload);
  }

  const modality = document.getElementById('img_modality').value.trim();
  const { data, error } = await supabaseClient.from('imaging_order_items').insert({
    imaging_order_id: imagingOrderId, service_name: name, modality
  }).select().single();
  if (error) { alert(error.message); return; }
  await logAudit('CREATE', 'RADIOLOGY', 'imaging_order_items', data.id, null, { service_name: name, modality });

  const service = await findCatalogueService(name, 'RADIOLOGY');
  if (service) {
    const inv = await findOrCreateInvoice(patient.id, encounter.id, meC.facility_id, meC.id);
    if (inv) await addInvoiceItem(inv.id, {
      description: service.service_name, quantity: 1, unit_price: service.standard_price,
      source_module: 'RADIOLOGY', source_record_id: data.id
    });
  }

  document.getElementById('img_service_name').value = '';
  document.getElementById('img_modality').value = '';
  await loadImagingOrders();
}

// ---------------- CATALOGUE DATALISTS ----------------
async function loadCatalogueDatalists() {
  const { data: tests } = await supabaseClient.from('lab_tests').select('test_name').eq('status', 'ACTIVE');
  document.getElementById('labTestsDatalist').innerHTML = (tests || []).map(t => `<option value="${t.test_name}">`).join('');

  const { data: services } = await supabaseClient.from('imaging_services').select('name').eq('status', 'ACTIVE');
  document.getElementById('imgServicesDatalist').innerHTML = (services || []).map(s => `<option value="${s.name}">`).join('');
}

// ---------------- REFERRAL ----------------
async function loadReferrals() {
  const { data } = await supabaseClient.from('referrals').select('*').eq('encounter_id', encounter.id).order('created_at', { ascending: false });
  const box = document.getElementById('referralList');
  if (!data || data.length === 0) { box.innerHTML = '<span class="empty">No referrals for this encounter.</span>'; return; }
  box.innerHTML = data.map(r => `
    <div class="panel" style="margin-bottom:6px;"><div class="panel-body" style="padding:10px 14px;">
      <strong class="mono">${r.referral_number}</strong> — ${r.receiving_facility} (${r.urgency})
      <span class="pill ${r.status === 'COMPLETED' ? 'active' : 'inactive'}" style="margin-left:8px;">${r.status}</span>
      ${r.reason ? '<br>' + r.reason : ''}
    </div></div>
  `).join('');
}

async function createReferral() {
  const facility = document.getElementById('ref_facility').value.trim();
  if (!facility) { alert('Enter the receiving facility.'); return; }
  const payload = {
    patient_id: patient.id, encounter_id: encounter.id, referring_provider_id: meC.id,
    receiving_facility: facility, urgency: document.getElementById('ref_urgency').value,
    reason: document.getElementById('ref_reason').value.trim(),
    clinical_summary: document.getElementById('ref_summary').value.trim(),
    created_by: meC.id
  };
  const { data, error } = await supabaseClient.from('referrals').insert(payload).select().single();
  if (error) { alert(error.message); return; }
  await logAudit('CREATE', 'CLINICAL', 'referrals', data.id, null, payload);

  document.getElementById('ref_facility').value = '';
  document.getElementById('ref_reason').value = '';
  document.getElementById('ref_summary').value = '';
  await loadReferrals();
}

// ---------------- TIMELINE ----------------
async function loadTimeline() {
  const { data } = await supabaseClient.from('encounters').select('*')
    .eq('patient_id', patient.id).neq('id', encounter.id)
    .order('visit_date', { ascending: false }).limit(20);
  const box = document.getElementById('timeline');
  if (!data || data.length === 0) { box.innerHTML = '<span class="empty">No previous encounters.</span>'; return; }
  box.innerHTML = data.map(e => `
    <div class="panel" style="margin-bottom:8px;">
      <div class="panel-body" style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <strong>${e.visit_date}</strong> · ${e.encounter_type} · ${e.chief_complaint || 'No chief complaint recorded'}
        </div>
        <div style="display:flex; align-items:center; gap:10px;">
          <span class="pill ${e.status === 'COMPLETED' ? 'active' : 'inactive'}">${e.status}</span>
          <a class="link-btn" href="encounter.html?patient=${patient.id}&encounter=${e.id}">Open</a>
        </div>
      </div>
    </div>
  `).join('');
}
