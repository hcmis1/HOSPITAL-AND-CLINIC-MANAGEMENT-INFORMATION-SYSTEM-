// ==========================================================
// HCMIS — Maternity
// ==========================================================

let meM = null;
let currentEpisode = null;
let currentDelivery = null;

(async function init() {
  meM = await requireAuth();
  if (!meM) return;

  document.getElementById('whoName').textContent = meM.full_name;
  document.getElementById('whoRole').textContent = meM.role;
  document.getElementById('facilityName').textContent =
    (meM.facilities && meM.facilities.name) ? meM.facilities.name : 'No facility assigned';
  if (['SUPER_ADMIN', 'FACILITY_ADMIN'].includes(meM.role)) {
    document.getElementById('adminNavGroup').style.display = 'block';
  }

  document.getElementById('episodeForm').addEventListener('submit', startEpisode);
  document.getElementById('addLabourBtn').addEventListener('click', addLabourObservation);
  document.getElementById('recordDeliveryBtn').addEventListener('click', recordDelivery);
  document.getElementById('registerNewbornBtn').addEventListener('click', registerNewborn);

  let searchTimer;
  document.getElementById('mo_search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const term = e.target.value.trim();
    if (!term) { document.getElementById('mo_results').innerHTML = ''; return; }
    searchTimer = setTimeout(() => searchMoPatients(term), 250);
  });

  await loadEpisodes();
})();

async function searchMoPatients(term) {
  const { data } = await supabaseClient.from('patients').select('*')
    .or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,phone.ilike.%${term}%,mrn.ilike.%${term}%`).limit(8);
  const box = document.getElementById('mo_results');
  if (!data || data.length === 0) { box.innerHTML = '<div class="empty">No matches</div>'; return; }
  box.innerHTML = data.map(p => `
    <div class="link-btn" style="display:block; padding:6px 0;" onclick='selectMoPatient(${JSON.stringify(p).replace(/'/g, "&apos;")})'>
      ${p.first_name} ${p.last_name} · ${p.mrn}
    </div>
  `).join('');
}

function selectMoPatient(p) {
  document.getElementById('mo_patient_id').value = p.id;
  document.getElementById('mo_selected').innerHTML = `<span class="pill active">${p.first_name} ${p.last_name} · ${p.mrn}</span>`;
  document.getElementById('mo_results').innerHTML = '';
  document.getElementById('mo_search').value = '';
}

async function startEpisode(e) {
  e.preventDefault();
  const motherId = document.getElementById('mo_patient_id').value;
  if (!motherId) { alert('Search for and select the mother first.'); return; }

  const payload = {
    mother_patient_id: motherId,
    gravida: parseInt(document.getElementById('e_gravida').value) || null,
    para: parseInt(document.getElementById('e_para').value) || null,
    abortions: parseInt(document.getElementById('e_abortions').value) || null,
    living_children: parseInt(document.getElementById('e_living').value) || null,
    lmp: document.getElementById('e_lmp').value || null,
    edd: document.getElementById('e_edd').value || null
  };
  const { data, error } = await supabaseClient.from('maternity_episodes').insert(payload).select().single();
  if (error) { alert(error.message); return; }
  await logAudit('CREATE', 'MATERNITY', 'maternity_episodes', data.id, null, payload);

  document.getElementById('episodeForm').reset();
  document.getElementById('mo_patient_id').value = '';
  document.getElementById('mo_selected').innerHTML = '';
  await loadEpisodes();
}

async function loadEpisodes() {
  const { data } = await supabaseClient.from('maternity_episodes').select('*, patients(first_name, last_name, mrn)')
    .neq('status', 'CLOSED').order('created_at', { ascending: false });
  const tbody = document.getElementById('episodesTable');
  if (!data || data.length === 0) { tbody.innerHTML = '<tr><td colspan="4" class="empty">No active episodes.</td></tr>'; return; }
  tbody.innerHTML = data.map(e => `
    <tr>
      <td>${e.patients.first_name} ${e.patients.last_name} · ${e.patients.mrn}</td>
      <td><span class="pill ${e.status === 'DELIVERED' || e.status === 'POSTNATAL' ? 'active' : 'inactive'}">${e.status}</span></td>
      <td class="mono">${e.edd || '—'}</td>
      <td><button class="link-btn" onclick="openEpisode('${e.id}')">Open</button></td>
    </tr>
  `).join('');
}

async function openEpisode(id) {
  const { data: ep } = await supabaseClient.from('maternity_episodes').select('*, patients(first_name, last_name, mrn)').eq('id', id).single();
  if (!ep) return;
  currentEpisode = ep;

  document.getElementById('episodeTitle').textContent = `${ep.patients.first_name} ${ep.patients.last_name} · ${ep.patients.mrn}`;
  document.getElementById('episodeMeta').innerHTML = `
    <div class="grid-2">
      <div><strong>Status:</strong> ${ep.status}</div>
      <div><strong>Gravida/Para:</strong> ${ep.gravida ?? '—'} / ${ep.para ?? '—'}</div>
      <div><strong>LMP:</strong> ${ep.lmp || '—'}</div>
      <div><strong>EDD:</strong> ${ep.edd || '—'}</div>
    </div>
  `;

  await loadLabourRecords();
  await loadDeliveryAndNewborn();

  document.getElementById('episodeDetail').style.display = 'block';
  document.getElementById('episodeDetail').scrollIntoView({ behavior: 'smooth' });
}

function closeEpisode() {
  document.getElementById('episodeDetail').style.display = 'none';
  currentEpisode = null;
  currentDelivery = null;
}

async function loadLabourRecords() {
  const { data } = await supabaseClient.from('labour_records').select('*').eq('maternity_episode_id', currentEpisode.id).order('recorded_at', { ascending: false });
  const box = document.getElementById('labourList');
  if (!data || data.length === 0) { box.innerHTML = '<span class="empty">No observations recorded yet.</span>'; return; }
  box.innerHTML = data.map(l => `
    <div class="panel" style="margin-bottom:6px;">
      <div class="panel-body" style="padding:10px 14px; font-size:.9rem;">
        <span class="mono" style="color:var(--hc-ink-soft);">${new Date(l.recorded_at).toLocaleTimeString('en-GB')}</span> —
        Dilation ${l.cervical_dilation ?? '—'}cm, FHR ${l.fetal_heart_rate ?? '—'}, BP ${l.maternal_bp || '—'}, Pulse ${l.maternal_pulse ?? '—'}, Temp ${l.maternal_temperature ?? '—'}
        ${l.contractions ? '· ' + l.contractions : ''}
      </div>
    </div>
  `).join('');
}

async function addLabourObservation() {
  const payload = {
    maternity_episode_id: currentEpisode.id,
    cervical_dilation: parseFloat(document.getElementById('l_dilation').value) || null,
    contractions: document.getElementById('l_contractions').value.trim(),
    fetal_heart_rate: parseInt(document.getElementById('l_fhr').value) || null,
    maternal_bp: document.getElementById('l_bp').value.trim(),
    maternal_pulse: parseInt(document.getElementById('l_pulse').value) || null,
    maternal_temperature: parseFloat(document.getElementById('l_temp').value) || null,
    membrane_status: document.getElementById('l_membrane').value.trim(),
    recorded_by: meM.id
  };
  const { data, error } = await supabaseClient.from('labour_records').insert(payload).select().single();
  if (error) { alert(error.message); return; }
  await logAudit('CREATE', 'MATERNITY', 'labour_records', data.id, null, payload);

  if (currentEpisode.status === 'ANTENATAL') {
    await supabaseClient.from('maternity_episodes').update({ status: 'IN_LABOUR' }).eq('id', currentEpisode.id);
    currentEpisode.status = 'IN_LABOUR';
  }

  ['l_dilation', 'l_contractions', 'l_fhr', 'l_bp', 'l_pulse', 'l_temp', 'l_membrane'].forEach(id => document.getElementById(id).value = '');
  await loadLabourRecords();
}

async function loadDeliveryAndNewborn() {
  const { data: delivery } = await supabaseClient.from('deliveries').select('*').eq('maternity_episode_id', currentEpisode.id).maybeSingle();
  currentDelivery = delivery || null;

  if (!delivery) {
    document.getElementById('deliveryInfo').innerHTML = '<span class="empty">Not yet delivered.</span>';
    document.getElementById('deliveryFieldset').style.display = 'block';
    document.getElementById('newbornFieldset').style.display = 'none';
    document.getElementById('newbornInfo').innerHTML = '<span class="empty">Record delivery first.</span>';
    return;
  }

  document.getElementById('deliveryFieldset').style.display = 'none';
  document.getElementById('deliveryInfo').innerHTML = `
    <div class="panel"><div class="panel-body">
      Delivered ${new Date(delivery.delivery_time).toLocaleString('en-GB')} · ${delivery.mode_of_delivery}
      ${delivery.complications ? '· ' + delivery.complications : ''}
    </div></div>
  `;

  const { data: newborn } = await supabaseClient.from('newborns').select('*, patients:baby_patient_id(first_name, last_name, mrn)').eq('delivery_id', delivery.id).maybeSingle();
  if (newborn) {
    document.getElementById('newbornFieldset').style.display = 'none';
    document.getElementById('newbornInfo').innerHTML = `
      <div class="panel"><div class="panel-body">
        ${newborn.patients ? newborn.patients.first_name + ' ' + newborn.patients.last_name + ' · ' + newborn.patients.mrn : 'Baby'} —
        ${newborn.sex}, ${newborn.birth_weight || '—'}kg, Apgar ${newborn.apgar_1 ?? '—'}/${newborn.apgar_5 ?? '—'}/${newborn.apgar_10 ?? '—'}, ${newborn.outcome}
      </div></div>
    `;
  } else {
    document.getElementById('newbornFieldset').style.display = 'block';
    document.getElementById('newbornInfo').innerHTML = '<span class="empty">Newborn not registered yet.</span>';
  }
}

async function recordDelivery() {
  const payload = {
    maternity_episode_id: currentEpisode.id,
    mode_of_delivery: document.getElementById('d_mode').value,
    place_of_delivery: document.getElementById('d_place').value.trim(),
    complications: document.getElementById('d_complications').value.trim(),
    attendant_id: meM.id
  };
  const { data, error } = await supabaseClient.from('deliveries').insert(payload).select().single();
  if (error) { alert(error.message); return; }
  await logAudit('CREATE', 'MATERNITY', 'deliveries', data.id, null, payload);

  await supabaseClient.from('maternity_episodes').update({ status: 'DELIVERED' }).eq('id', currentEpisode.id);
  currentEpisode.status = 'DELIVERED';

  await loadDeliveryAndNewborn();
  await loadEpisodes();
}

async function registerNewborn() {
  if (!currentDelivery) return;
  const mother = currentEpisode.patients;

  const babyPayload = {
    first_name: 'Baby of',
    last_name: mother.last_name,
    sex: document.getElementById('n_sex').value,
    date_of_birth: currentDelivery.delivery_time.slice(0, 10),
    facility_id: meM.facility_id || null,
    created_by: meM.id
  };
  const { data: baby, error: babyErr } = await supabaseClient.from('patients').insert(babyPayload).select().single();
  if (babyErr) { alert(babyErr.message); return; }

  const payload = {
    mother_patient_id: currentEpisode.mother_patient_id,
    baby_patient_id: baby.id,
    delivery_id: currentDelivery.id,
    sex: document.getElementById('n_sex').value,
    birth_weight: parseFloat(document.getElementById('n_weight').value) || null,
    apgar_1: parseInt(document.getElementById('n_apgar1').value) || null,
    apgar_5: parseInt(document.getElementById('n_apgar5').value) || null,
    apgar_10: parseInt(document.getElementById('n_apgar10').value) || null,
    outcome: document.getElementById('n_outcome').value
  };
  const { data, error } = await supabaseClient.from('newborns').insert(payload).select().single();
  if (error) { alert(error.message); return; }
  await logAudit('CREATE', 'MATERNITY', 'newborns', data.id, null, payload);

  await supabaseClient.from('maternity_episodes').update({ status: 'POSTNATAL' }).eq('id', currentEpisode.id);

  await loadDeliveryAndNewborn();
  await loadEpisodes();
}
