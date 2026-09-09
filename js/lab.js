// ==========================================================
// HCMIS — Laboratory
// ==========================================================

let meL = null;

(async function init() {
  meL = await requireAuth();
  if (!meL) return;

  document.getElementById('whoName').textContent = meL.full_name;
  document.getElementById('whoRole').textContent = meL.role;
  document.getElementById('facilityName').textContent =
    (meL.facilities && meL.facilities.name) ? meL.facilities.name : 'No facility assigned';
  if (['SUPER_ADMIN', 'FACILITY_ADMIN'].includes(meL.role)) {
    document.getElementById('adminNavGroup').style.display = 'block';
  }

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${btn.dataset.tab}`));
    });
  });

  document.getElementById('resultForm').addEventListener('submit', saveResult);
  document.getElementById('cancelResultBtn').addEventListener('click', () => document.getElementById('resultOverlay').style.display = 'none');
  document.getElementById('testForm').addEventListener('submit', addTestToCatalogue);

  await loadCritical();
  await loadPending();
  await loadValidation();
  await loadCompleted();
  await loadCatalogue();
})();

async function addTestToCatalogue(e) {
  e.preventDefault();
  const payload = {
    test_name: document.getElementById('tc_name').value.trim(),
    category: document.getElementById('tc_category').value.trim(),
    specimen_type: document.getElementById('tc_specimen').value.trim(),
    unit: document.getElementById('tc_unit').value.trim(),
    reference_range: document.getElementById('tc_range').value.trim(),
    price: parseFloat(document.getElementById('tc_price').value) || 0
  };
  const { data, error } = await supabaseClient.from('lab_tests').insert(payload).select().single();
  if (error) { alert(error.message); return; }
  await logAudit('CREATE', 'LABORATORY', 'lab_tests', data.id, null, payload);
  document.getElementById('testForm').reset();
  await loadCatalogue();
}

async function loadCatalogue() {
  const { data } = await supabaseClient.from('lab_tests').select('*').order('test_name');
  const tbody = document.getElementById('catalogueTable');
  if (!data || data.length === 0) { tbody.innerHTML = '<tr><td colspan="4" class="empty">No tests in catalogue yet.</td></tr>'; return; }
  tbody.innerHTML = data.map(t => `<tr><td>${t.test_name}</td><td>${t.category || '—'}</td><td>${t.reference_range || '—'}</td><td>${parseFloat(t.price || 0).toLocaleString()}</td></tr>`).join('');
}

async function fetchItems(statuses) {
  const { data } = await supabaseClient
    .from('lab_order_items')
    .select('*, lab_orders(order_number, priority, patient_id, patients(first_name, last_name, mrn)), lab_results(*)')
    .in('status', statuses)
    .order('id', { ascending: false });
  return data || [];
}

async function loadPending() {
  const items = await fetchItems(['PENDING']);
  const tbody = document.getElementById('pendingTable');
  if (items.length === 0) { tbody.innerHTML = '<tr><td colspan="5" class="empty">No pending tests.</td></tr>'; return; }
  tbody.innerHTML = items.map(i => `
    <tr>
      <td class="mono">${i.lab_orders.order_number}</td>
      <td>${i.lab_orders.patients.first_name} ${i.lab_orders.patients.last_name} · ${i.lab_orders.patients.mrn}</td>
      <td>${i.test_name}</td>
      <td>${i.lab_orders.priority}</td>
      <td><button class="link-btn" onclick="openResultForm('${i.id}','${i.test_name}')">Enter result</button></td>
    </tr>
  `).join('');
}

async function loadValidation() {
  const items = await fetchItems(['ENTERED']);
  const tbody = document.getElementById('validationTable');
  if (items.length === 0) { tbody.innerHTML = '<tr><td colspan="6" class="empty">Nothing awaiting validation.</td></tr>'; return; }
  tbody.innerHTML = items.map(i => {
    const r = i.lab_results && i.lab_results[0];
    return `
    <tr>
      <td class="mono">${i.lab_orders.order_number}</td>
      <td>${i.lab_orders.patients.first_name} ${i.lab_orders.patients.last_name} · ${i.lab_orders.patients.mrn}</td>
      <td>${i.test_name}</td>
      <td>${r ? (r.result_value || r.numeric_result || '—') + ' ' + (r.unit || '') + (r.flag ? ' (' + r.flag + ')' : '') : '—'}</td>
      <td>${r && r.entered_by === meL.id ? 'You' : '—'}</td>
      <td><button class="link-btn" onclick="validateResult('${i.id}')">Validate</button></td>
    </tr>`;
  }).join('');
}

async function loadCompleted() {
  const items = await fetchItems(['VALIDATED']);
  const tbody = document.getElementById('completedTable');
  if (items.length === 0) { tbody.innerHTML = '<tr><td colspan="5" class="empty">No completed results yet.</td></tr>'; return; }
  tbody.innerHTML = items.slice(0, 50).map(i => {
    const r = i.lab_results && i.lab_results[0];
    return `
    <tr>
      <td class="mono">${i.lab_orders.order_number}</td>
      <td>${i.lab_orders.patients.first_name} ${i.lab_orders.patients.last_name} · ${i.lab_orders.patients.mrn}</td>
      <td>${i.test_name}</td>
      <td>${r ? (r.result_value || r.numeric_result || '—') + ' ' + (r.unit || '') : '—'}</td>
      <td><span class="pill ${r && r.flag === 'CRITICAL' ? 'inactive' : 'active'}">${r ? r.flag || 'NORMAL' : '—'}</span></td>
    </tr>`;
  }).join('');
}

async function loadCritical() {
  const { data } = await supabaseClient
    .from('lab_results')
    .select('*, lab_order_items(test_name, lab_orders(order_number, patient_id, patients(first_name, last_name, mrn)))')
    .eq('flag', 'CRITICAL')
    .is('acknowledged_at', null)
    .not('validated_at', 'is', null);

  const panel = document.getElementById('criticalPanel');
  if (!data || data.length === 0) { panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  document.getElementById('criticalList').innerHTML = data.map(r => `
    <div class="panel" style="margin-bottom:8px;">
      <div class="panel-body" style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <strong>${r.lab_order_items.lab_orders.patients.first_name} ${r.lab_order_items.lab_orders.patients.last_name}</strong>
          (${r.lab_order_items.lab_orders.patients.mrn}) — ${r.lab_order_items.test_name}: ${r.result_value || r.numeric_result} ${r.unit || ''}
        </div>
        <button class="btn btn-secondary" onclick="acknowledgeCritical('${r.id}')">Acknowledge</button>
      </div>
    </div>
  `).join('');
}

function openResultForm(itemId, testName) {
  document.getElementById('resultTitle').textContent = `Enter result — ${testName}`;
  document.getElementById('resultForm').reset();
  document.getElementById('r_item_id').value = itemId;
  document.getElementById('resultOverlay').style.display = 'flex';
}

async function saveResult(e) {
  e.preventDefault();
  const itemId = document.getElementById('r_item_id').value;
  const payload = {
    lab_order_item_id: itemId,
    result_value: document.getElementById('r_value').value.trim(),
    numeric_result: parseFloat(document.getElementById('r_numeric').value) || null,
    unit: document.getElementById('r_unit').value.trim(),
    reference_range: document.getElementById('r_ref').value.trim(),
    flag: document.getElementById('r_flag').value,
    comment: document.getElementById('r_comment').value.trim(),
    entered_by: meL.id,
    entered_at: new Date().toISOString()
  };

  const { data, error } = await supabaseClient.from('lab_results').insert(payload).select().single();
  if (error) { alert(error.message); return; }
  await supabaseClient.from('lab_order_items').update({ status: 'ENTERED' }).eq('id', itemId);
  await logAudit('CREATE', 'LABORATORY', 'lab_results', data.id, null, payload);

  document.getElementById('resultOverlay').style.display = 'none';
  await loadPending();
  await loadValidation();
}

async function validateResult(itemId) {
  const { data: results } = await supabaseClient.from('lab_results').select('*').eq('lab_order_item_id', itemId).single();
  if (!results) return;
  await supabaseClient.from('lab_results').update({ validated_by: meL.id, validated_at: new Date().toISOString() }).eq('id', results.id);
  await supabaseClient.from('lab_order_items').update({ status: 'VALIDATED' }).eq('id', itemId);
  await logAudit('VALIDATE', 'LABORATORY', 'lab_results', results.id, null, { validated_by: meL.id });

  await loadValidation();
  await loadCompleted();
  await loadCritical();
}

async function acknowledgeCritical(resultId) {
  await supabaseClient.from('lab_results').update({ acknowledged_by: meL.id, acknowledged_at: new Date().toISOString() }).eq('id', resultId);
  await logAudit('ACKNOWLEDGE', 'LABORATORY', 'lab_results', resultId, null, { acknowledged_by: meL.id });
  await loadCritical();
}
