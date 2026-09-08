// ==========================================================
// HCMIS — Patients
// ==========================================================

let me = null;
let pendingPatientPayload = null;
let patientsCache = [];

(async function init() {
  me = await requireAuth();
  if (!me) return;

  document.getElementById('whoName').textContent = me.full_name;
  document.getElementById('whoRole').textContent = me.role;
  document.getElementById('facilityName').textContent =
    (me.facilities && me.facilities.name) ? me.facilities.name : 'No facility assigned';

  if (['SUPER_ADMIN', 'FACILITY_ADMIN'].includes(me.role)) {
    document.getElementById('adminNavGroup').style.display = 'block';
  }

  await loadPatients();

  document.getElementById('newPatientBtn').addEventListener('click', () => openRegistration());
  document.getElementById('patientForm').addEventListener('submit', handlePatientFormSubmit);
  document.getElementById('continueAnywayBtn').addEventListener('click', saveNewPatientAnyway);
  document.getElementById('backToFormBtn').addEventListener('click', backToForm);

  let searchTimer;
  document.getElementById('searchBox').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const term = e.target.value.trim();
    searchTimer = setTimeout(() => loadPatients(term), 300);
  });
})();

function calcAge(dob) {
  if (!dob) return '—';
  const b = new Date(dob);
  const diff = new Date() - b;
  return Math.floor(diff / (365.25 * 24 * 3600 * 1000));
}

// ---------------- LIST / SEARCH ----------------
async function loadPatients(term) {
  const tbody = document.getElementById('patientsTable');
  let query = supabaseClient.from('patients').select('*').order('created_at', { ascending: false }).limit(50);

  if (term) {
    query = supabaseClient.from('patients').select('*')
      .or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,phone.ilike.%${term}%,national_id.ilike.%${term}%,mrn.ilike.%${term}%`)
      .order('created_at', { ascending: false })
      .limit(50);
  }

  const { data, error } = await query;

  if (error || !data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty">${term ? 'No matching patients.' : 'No patients registered yet.'}</td></tr>`;
    patientsCache = [];
    return;
  }

  patientsCache = data;
  tbody.innerHTML = data.map(p => `
    <tr>
      <td class="mono">${p.mrn || '—'}</td>
      <td>${p.first_name} ${p.middle_name || ''} ${p.last_name}</td>
      <td>${p.sex}</td>
      <td>${calcAge(p.date_of_birth)}</td>
      <td>${p.phone || '—'}</td>
      <td><button class="link-btn" onclick="openProfile('${p.id}')">View</button></td>
    </tr>
  `).join('');
}

// ---------------- PROFILE ----------------
function openProfile(id) {
  const p = patientsCache.find(x => x.id === id) ;
  if (!p) return;
  document.getElementById('profileTitle').textContent = `${p.first_name} ${p.last_name} · ${p.mrn}`;
  document.getElementById('profileBody').innerHTML = `
    <div class="grid-2">
      <div><strong>Sex:</strong> ${p.sex}</div>
      <div><strong>Age:</strong> ${calcAge(p.date_of_birth)} ${p.date_of_birth ? '(' + p.date_of_birth + ')' : ''}</div>
      <div><strong>Phone:</strong> ${p.phone || '—'}</div>
      <div><strong>National ID:</strong> ${p.national_id || '—'}</div>
      <div><strong>Blood group:</strong> ${p.blood_group || 'Unknown'}</div>
      <div><strong>District / Village:</strong> ${p.district || '—'} / ${p.village || '—'}</div>
      <div><strong>Next of kin:</strong> ${p.next_of_kin_name || '—'} ${p.next_of_kin_phone ? '(' + p.next_of_kin_phone + ')' : ''}</div>
      <div><strong>Allergies:</strong> ${p.allergies || 'None recorded'}</div>
    </div>
    <div style="margin-top:18px; display:flex; gap:10px;">
      <button class="btn btn-secondary" onclick="editPatient('${p.id}')">Edit details</button>
      <a class="btn btn-secondary" href="appointments.html?patient=${p.id}">Book appointment</a>
    </div>
    <p class="empty" style="margin-top:18px;">Clinical, laboratory, pharmacy and billing history will appear here as those modules are built.</p>
  `;
  document.getElementById('profilePanel').style.display = 'block';
  document.getElementById('profilePanel').scrollIntoView({ behavior: 'smooth' });
}

function closeProfile() {
  document.getElementById('profilePanel').style.display = 'none';
}

function editPatient(id) {
  const p = patientsCache.find(x => x.id === id);
  if (!p) return;
  openRegistration(p);
}

// ---------------- REGISTRATION / EDIT ----------------
function openRegistration(existing) {
  document.getElementById('regTitle').textContent = existing ? 'Edit patient' : 'Register new patient';
  document.getElementById('patientFormBtn').textContent = existing ? 'Save changes' : 'Check & save';
  document.getElementById('dupCheckArea').style.display = 'none';
  document.getElementById('patientForm').style.display = 'block';
  document.getElementById('patientForm').reset();
  document.getElementById('p_id').value = existing ? existing.id : '';

  if (existing) {
    document.getElementById('p_first').value = existing.first_name || '';
    document.getElementById('p_middle').value = existing.middle_name || '';
    document.getElementById('p_last').value = existing.last_name || '';
    document.getElementById('p_sex').value = existing.sex || '';
    document.getElementById('p_dob').value = existing.date_of_birth || '';
    document.getElementById('p_phone').value = existing.phone || '';
    document.getElementById('p_nin').value = existing.national_id || '';
    document.getElementById('p_blood').value = existing.blood_group || '';
    document.getElementById('p_district').value = existing.district || '';
    document.getElementById('p_village').value = existing.village || '';
    document.getElementById('p_nok_name').value = existing.next_of_kin_name || '';
    document.getElementById('p_nok_phone').value = existing.next_of_kin_phone || '';
    document.getElementById('p_allergies').value = existing.allergies || '';
  }

  document.getElementById('regOverlay').style.display = 'flex';
}

function closeRegistration() {
  document.getElementById('regOverlay').style.display = 'none';
  pendingPatientPayload = null;
}

function collectFormPayload() {
  return {
    first_name: document.getElementById('p_first').value.trim(),
    middle_name: document.getElementById('p_middle').value.trim(),
    last_name: document.getElementById('p_last').value.trim(),
    sex: document.getElementById('p_sex').value,
    date_of_birth: document.getElementById('p_dob').value || null,
    phone: document.getElementById('p_phone').value.trim(),
    national_id: document.getElementById('p_nin').value.trim(),
    blood_group: document.getElementById('p_blood').value,
    district: document.getElementById('p_district').value.trim(),
    village: document.getElementById('p_village').value.trim(),
    next_of_kin_name: document.getElementById('p_nok_name').value.trim(),
    next_of_kin_phone: document.getElementById('p_nok_phone').value.trim(),
    allergies: document.getElementById('p_allergies').value.trim(),
    facility_id: me.facility_id || null,
    created_by: me.id
  };
}

async function handlePatientFormSubmit(e) {
  e.preventDefault();
  const editingId = document.getElementById('p_id').value;
  const payload = collectFormPayload();

  if (editingId) {
    const { error } = await supabaseClient.from('patients').update(payload).eq('id', editingId);
    if (error) { alert(error.message); return; }
    await logAudit('UPDATE', 'PATIENTS', 'patients', editingId, null, payload);
    closeRegistration();
    await loadPatients();
    return;
  }

  // duplicate check
  const orParts = [];
  if (payload.phone) orParts.push(`phone.eq.${payload.phone}`);
  if (payload.national_id) orParts.push(`national_id.eq.${payload.national_id}`);
  let matches = [];
  if (orParts.length) {
    const { data } = await supabaseClient.from('patients').select('*').or(orParts.join(','));
    matches = data || [];
  }
  if (payload.date_of_birth) {
    const { data } = await supabaseClient.from('patients').select('*')
      .ilike('first_name', payload.first_name)
      .ilike('last_name', payload.last_name)
      .eq('date_of_birth', payload.date_of_birth);
    (data || []).forEach(m => { if (!matches.find(x => x.id === m.id)) matches.push(m); });
  }

  if (matches.length > 0) {
    pendingPatientPayload = payload;
    document.getElementById('patientForm').style.display = 'none';
    document.getElementById('dupCheckArea').style.display = 'block';
    document.getElementById('dupWarning').textContent =
      `${matches.length} possible existing record${matches.length > 1 ? 's' : ''} found. Please check before creating a new patient.`;
    document.getElementById('dupResults').innerHTML = matches.map(m => `
      <div class="panel" style="margin-bottom:8px;">
        <div class="panel-body" style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <strong>${m.first_name} ${m.last_name}</strong> · <span class="mono">${m.mrn}</span><br>
            <span style="color:var(--hc-ink-soft); font-size:.85rem;">
              ${m.sex}, ${calcAge(m.date_of_birth)} yrs · ${m.phone || 'no phone'} · ${m.national_id || 'no national ID'}
            </span>
          </div>
          <button class="btn btn-secondary" onclick="useExisting('${m.id}')">Open this record</button>
        </div>
      </div>
    `).join('');
    return;
  }

  await saveNewPatientAnyway(null, payload);
}

function backToForm() {
  document.getElementById('dupCheckArea').style.display = 'none';
  document.getElementById('patientForm').style.display = 'block';
}

function useExisting(id) {
  closeRegistration();
  openProfile(id);
}

async function saveNewPatientAnyway(e, directPayload) {
  const payload = directPayload || pendingPatientPayload;
  if (!payload) return;

  const { data, error } = await supabaseClient.from('patients').insert(payload).select().single();
  if (error) { alert(error.message); return; }

  await logAudit('CREATE', 'PATIENTS', 'patients', data.id, null, payload);
  pendingPatientPayload = null;
  closeRegistration();
  await loadPatients();
  openProfile(data.id);
}
