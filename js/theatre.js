// ==========================================================
// HCMIS — Theatre
// ==========================================================

let meT = null;

(async function init() {
  meT = await requireAuth();
  if (!meT) return;

  document.getElementById('whoName').textContent = meT.full_name;
  document.getElementById('whoRole').textContent = meT.role;
  document.getElementById('facilityName').textContent =
    (meT.facilities && meT.facilities.name) ? meT.facilities.name : 'No facility assigned';
  if (['SUPER_ADMIN', 'FACILITY_ADMIN'].includes(meT.role)) {
    document.getElementById('adminNavGroup').style.display = 'block';
  }

  await loadStaffOptions();
  await loadCases();

  document.getElementById('bookForm').addEventListener('submit', bookCase);
  document.getElementById('completeForm').addEventListener('submit', completeCase);
  document.getElementById('cancelCompleteBtn').addEventListener('click', () => document.getElementById('completeOverlay').style.display = 'none');

  let searchTimer;
  document.getElementById('th_patient_search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const term = e.target.value.trim();
    if (!term) { document.getElementById('th_patientResults').innerHTML = ''; return; }
    searchTimer = setTimeout(() => searchThPatients(term), 250);
  });
})();

async function searchThPatients(term) {
  const { data } = await supabaseClient.from('patients').select('*')
    .or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,phone.ilike.%${term}%,mrn.ilike.%${term}%`).limit(8);
  const box = document.getElementById('th_patientResults');
  if (!data || data.length === 0) { box.innerHTML = '<div class="empty">No matches</div>'; return; }
  box.innerHTML = data.map(p => `
    <div class="link-btn" style="display:block; padding:6px 0;" onclick='selectThPatient(${JSON.stringify(p).replace(/'/g, "&apos;")})'>
      ${p.first_name} ${p.last_name} · ${p.mrn}
    </div>
  `).join('');
}

function selectThPatient(p) {
  document.getElementById('th_patient_id').value = p.id;
  document.getElementById('th_selectedPatient').innerHTML = `<span class="pill active">${p.first_name} ${p.last_name} · ${p.mrn}</span>`;
  document.getElementById('th_patientResults').innerHTML = '';
  document.getElementById('th_patient_search').value = '';
}

async function loadStaffOptions() {
  const { data } = await supabaseClient.from('app_users').select('id, full_name, role').eq('status', 'ACTIVE');
  const opts = (data || []).map(u => `<option value="${u.id}">${u.full_name} (${u.role})</option>`).join('');
  document.getElementById('th_surgeon').innerHTML = '<option value="">— none —</option>' + opts;
  document.getElementById('th_assistant').innerHTML = '<option value="">— none —</option>' + opts;
  document.getElementById('th_anaesthetist').innerHTML = '<option value="">— none —</option>' + opts;
}

async function bookCase(e) {
  e.preventDefault();
  const patientId = document.getElementById('th_patient_id').value;
  if (!patientId) { alert('Search for and select a patient first.'); return; }

  const payload = {
    patient_id: patientId,
    procedure_name: document.getElementById('th_procedure').value.trim(),
    indication: document.getElementById('th_indication').value.trim(),
    surgeon_id: document.getElementById('th_surgeon').value || null,
    assistant_id: document.getElementById('th_assistant').value || null,
    anaesthetist_id: document.getElementById('th_anaesthetist').value || null,
    scheduled_time: document.getElementById('th_time').value || null,
    created_by: meT.id
  };
  const { data, error } = await supabaseClient.from('theatre_cases').insert(payload).select().single();
  if (error) { alert(error.message); return; }
  await logAudit('CREATE', 'THEATRE', 'theatre_cases', data.id, null, payload);

  document.getElementById('bookForm').reset();
  document.getElementById('th_patient_id').value = '';
  document.getElementById('th_selectedPatient').innerHTML = '';
  await loadCases();
}

async function loadCases() {
  const { data } = await supabaseClient.from('theatre_cases').select('*, patients(first_name, last_name, mrn)')
    .neq('status', 'CANCELLED').order('scheduled_time', { ascending: true });

  const box = document.getElementById('casesBody');
  if (!data || data.length === 0) { box.innerHTML = '<p class="empty">No theatre cases booked.</p>'; return; }

  box.innerHTML = data.map(c => `
    <div class="panel" style="margin-bottom:10px;">
      <div class="panel-body">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <div>
            <strong>${c.patients.first_name} ${c.patients.last_name} · ${c.patients.mrn}</strong> — ${c.procedure_name}
            <br><span class="mono" style="color:var(--hc-ink-soft); font-size:.82rem;">${c.case_number} ${c.scheduled_time ? '· ' + new Date(c.scheduled_time).toLocaleString('en-GB') : ''}</span>
          </div>
          <span class="pill ${c.status === 'COMPLETED' ? 'active' : 'inactive'}">${c.status}</span>
        </div>
        ${c.status === 'BOOKED' ? `
          <div style="margin-top:10px;">
            <label style="font-size:.85rem;"><input type="checkbox" ${c.consent_confirmed ? 'checked' : ''} onchange="toggleConsent('${c.id}', this.checked)"> Consent confirmed</label>
            <button class="link-btn" style="margin-left:14px;" onclick="startCase('${c.id}')" ${!c.consent_confirmed ? 'disabled' : ''}>Start</button>
            <button class="link-btn danger" style="margin-left:10px;" onclick="cancelCase('${c.id}')">Cancel</button>
          </div>` : ''}
        ${c.status === 'IN_PROGRESS' ? `<div style="margin-top:10px;"><button class="link-btn" onclick="openComplete('${c.id}')">Complete case</button></div>` : ''}
        ${c.status === 'COMPLETED' ? `<div style="margin-top:10px; font-size:.9rem; color:var(--hc-ink-soft);">Findings: ${c.findings || '—'} ${c.complications ? '· Complications: ' + c.complications : ''}</div>` : ''}
      </div>
    </div>
  `).join('');
}

async function toggleConsent(id, checked) {
  await supabaseClient.from('theatre_cases').update({ consent_confirmed: checked }).eq('id', id);
  await logAudit('UPDATE', 'THEATRE', 'theatre_cases', id, null, { consent_confirmed: checked });
  await loadCases();
}

async function startCase(id) {
  await supabaseClient.from('theatre_cases').update({ status: 'IN_PROGRESS' }).eq('id', id);
  await logAudit('UPDATE', 'THEATRE', 'theatre_cases', id, null, { status: 'IN_PROGRESS' });
  await loadCases();
}

async function cancelCase(id) {
  await supabaseClient.from('theatre_cases').update({ status: 'CANCELLED' }).eq('id', id);
  await logAudit('UPDATE', 'THEATRE', 'theatre_cases', id, null, { status: 'CANCELLED' });
  await loadCases();
}

function openComplete(id) {
  document.getElementById('cc_case_id').value = id;
  document.getElementById('completeForm').reset();
  document.getElementById('completeOverlay').style.display = 'flex';
}

async function completeCase(e) {
  e.preventDefault();
  const id = document.getElementById('cc_case_id').value;
  const payload = {
    status: 'COMPLETED',
    findings: document.getElementById('cc_findings').value.trim(),
    complications: document.getElementById('cc_complications').value.trim(),
    completed_at: new Date().toISOString()
  };
  await supabaseClient.from('theatre_cases').update(payload).eq('id', id);
  await logAudit('UPDATE', 'THEATRE', 'theatre_cases', id, null, payload);

  document.getElementById('completeOverlay').style.display = 'none';
  await loadCases();
}
