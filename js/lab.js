// ==========================================================
// HCMIS — Laboratory
// ==========================================================

let meL = null;
let wiCart = [];
let isLabAdmin = false;

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
  document.getElementById('editTestForm').addEventListener('submit', saveTestEdit);
  document.getElementById('addParamRowBtn').addEventListener('click', addParamRow);
  document.getElementById('saveParamsBtn').addEventListener('click', saveParams);
  document.getElementById('addWiTestBtn').addEventListener('click', addWiTest);
  document.getElementById('registerWiBtn').addEventListener('click', registerWalkIn);

  isLabAdmin = ['SUPER_ADMIN', 'FACILITY_ADMIN'].includes(meL.role);

  await loadCritical();
  await loadPending();
  await loadValidation();
  await loadCompleted();
  await loadCatalogue();
  await loadWiTestDatalist();
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

// ---------------- EDIT TEST (ADMIN) ----------------
async function openEditTestForm(testId) {
  if (!isLabAdmin) return;
  const { data: test } = await supabaseClient.from('lab_tests').select('*').eq('id', testId).single();
  if (!test) return;

  document.getElementById('editTestTitle').textContent = 'Edit test — ' + test.test_name;
  document.getElementById('et_id').value = test.id;
  document.getElementById('et_name').value = test.test_name;
  document.getElementById('et_category').value = test.category || '';
  document.getElementById('et_specimen').value = test.specimen_type || '';
  document.getElementById('et_unit').value = test.unit || '';
  document.getElementById('et_range').value = test.reference_range || '';
  document.getElementById('et_price').value = test.price || 0;
  document.getElementById('et_status').value = test.status || 'ACTIVE';

  const { data: params } = await supabaseClient.from('lab_test_parameters').select('*').eq('lab_test_id', test.id).order('display_order');
  const paramsSection = document.getElementById('editTestParamsSection');
  if (params && params.length > 0) {
    paramsSection.style.display = 'block';
    renderParamRows(params);
  } else {
    paramsSection.style.display = 'none';
    document.getElementById('editParamsRows').innerHTML = '';
  }

  document.getElementById('editTestOverlay').style.display = 'flex';
}

function renderParamRows(params) {
  document.getElementById('editParamsRows').innerHTML = params.map((p, idx) => `
    <tr data-param-id="${p.id || ''}">
      <td><input type="text" class="ep-name" value="${p.parameter_name || ''}" style="width:100%;"></td>
      <td><input type="text" class="ep-unit" value="${p.unit || ''}" style="width:100%;"></td>
      <td><input type="text" class="ep-range" value="${p.reference_range || ''}" style="width:100%;"></td>
      <td><button type="button" class="link-btn danger" onclick="this.closest('tr').remove()">Remove</button></td>
    </tr>
  `).join('');
}

function addParamRow() {
  const tbody = document.getElementById('editParamsRows');
  const row = document.createElement('tr');
  row.innerHTML = `
    <td><input type="text" class="ep-name" style="width:100%;" placeholder="Parameter name"></td>
    <td><input type="text" class="ep-unit" style="width:100%;"></td>
    <td><input type="text" class="ep-range" style="width:100%;"></td>
    <td><button type="button" class="link-btn danger" onclick="this.closest('tr').remove()">Remove</button></td>
  `;
  tbody.appendChild(row);
  document.getElementById('editTestParamsSection').style.display = 'block';
}

async function saveTestEdit(e) {
  e.preventDefault();
  const id = document.getElementById('et_id').value;
  const payload = {
    category: document.getElementById('et_category').value.trim(),
    specimen_type: document.getElementById('et_specimen').value.trim(),
    unit: document.getElementById('et_unit').value.trim(),
    reference_range: document.getElementById('et_range').value.trim(),
    price: parseFloat(document.getElementById('et_price').value) || 0,
    status: document.getElementById('et_status').value
  };
  const { error } = await supabaseClient.from('lab_tests').update(payload).eq('id', id);
  if (error) { alert(error.message); return; }
  await logAudit('UPDATE', 'LABORATORY', 'lab_tests', id, null, payload);
  document.getElementById('editTestOverlay').style.display = 'none';
  await loadCatalogue();
  await loadWiTestDatalist();
}

async function saveParams() {
  const id = document.getElementById('et_id').value;
  const rows = Array.from(document.querySelectorAll('#editParamsRows tr'));
  const keepIds = [];
  for (const row of rows) {
    const name = row.querySelector('.ep-name').value.trim();
    if (!name) continue;
    const paramId = row.dataset.paramId;
    const payload = {
      lab_test_id: id,
      parameter_name: name,
      unit: row.querySelector('.ep-unit').value.trim(),
      reference_range: row.querySelector('.ep-range').value.trim()
    };
    if (paramId) {
      await supabaseClient.from('lab_test_parameters').update(payload).eq('id', paramId);
      keepIds.push(paramId);
    } else {
      const { data } = await supabaseClient.from('lab_test_parameters').insert(payload).select().single();
      if (data) keepIds.push(data.id);
    }
  }
  // Remove any parameters that were deleted from the form
  const { data: existing } = await supabaseClient.from('lab_test_parameters').select('id').eq('lab_test_id', id);
  const toDelete = (existing || []).filter(p => !keepIds.includes(p.id)).map(p => p.id);
  if (toDelete.length > 0) {
    await supabaseClient.from('lab_test_parameters').delete().in('id', toDelete);
  }
  await logAudit('UPDATE', 'LABORATORY', 'lab_test_parameters', id, null, { parameter_count: keepIds.length });
  alert('Parameters saved.');
  await loadCatalogue();
}

async function loadCatalogue() {
  const { data } = await supabaseClient.from('lab_tests').select('*, lab_test_parameters(id)').order('test_name');
  const tbody = document.getElementById('catalogueTable');
  if (!data || data.length === 0) { tbody.innerHTML = '<tr><td colspan="5" class="empty">No tests in catalogue yet.</td></tr>'; return; }
  tbody.innerHTML = data.map(t => {
    const paramCount = (t.lab_test_parameters || []).length;
    const nameCell = paramCount > 0 ? `${t.test_name} <span class="pill active">${paramCount} parameters</span>` : t.test_name;
    const editBtn = isLabAdmin ? `<button class="link-btn" onclick="openEditTestForm('${t.id}')">Edit</button>` : '—';
    return `<tr><td>${nameCell}</td><td>${t.category || '—'}</td><td>${t.reference_range || '—'}</td><td>${parseFloat(t.price || 0).toLocaleString()}</td><td>${editBtn}</td></tr>`;
  }).join('');
}

async function fetchItems(statuses) {
  const { data } = await supabaseClient
    .from('lab_order_items')
    .select('*, lab_orders(order_number, priority, patient_id, patients(first_name, last_name, mrn)), lab_results(*, lab_result_parameters(*))')
    .in('status', statuses)
    .order('id', { ascending: false });
  return data || [];
}

// Summarize a lab_results row (with its lab_result_parameters) into
// {text, flag} for compact display in tables. Falls back to the old
// single-value fields for any result entered before panel support.
function summarizeResult(r) {
  if (!r) return { text: '—', flag: null };
  const params = r.lab_result_parameters || [];
  if (params.length === 0) {
    return {
      text: (r.result_value || r.numeric_result || '—') + (r.unit ? ' ' + r.unit : ''),
      flag: r.flag
    };
  }
  if (params.length === 1) {
    const p = params[0];
    return { text: (p.value || '—') + (p.unit ? ' ' + p.unit : ''), flag: p.flag };
  }
  const abnormal = params.filter(p => p.flag !== 'NORMAL');
  const worst = params.some(p => p.flag === 'CRITICAL') ? 'CRITICAL' : (abnormal.length > 0 ? (params.some(p=>p.flag==='HIGH')?'HIGH':'LOW') : 'NORMAL');
  return {
    text: `${params.length} parameters${abnormal.length ? ` (${abnormal.length} flagged)` : ''}`,
    flag: worst
  };
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
    const s = summarizeResult(r);
    return `
    <tr>
      <td class="mono">${i.lab_orders.order_number}</td>
      <td>${i.lab_orders.patients.first_name} ${i.lab_orders.patients.last_name} · ${i.lab_orders.patients.mrn}</td>
      <td>${i.test_name}</td>
      <td>${s.text}${s.flag && s.flag !== 'NORMAL' ? ' (' + s.flag + ')' : ''}</td>
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
    const s = summarizeResult(r);
    return `
    <tr>
      <td class="mono">${i.lab_orders.order_number}</td>
      <td>${i.lab_orders.patients.first_name} ${i.lab_orders.patients.last_name} · ${i.lab_orders.patients.mrn}</td>
      <td>${i.test_name}</td>
      <td>${s.text}</td>
      <td><span class="pill ${s.flag === 'CRITICAL' ? 'inactive' : 'active'}">${s.flag || 'NORMAL'}</span></td>
      <td><button class="link-btn" onclick='printLabResult(${JSON.stringify(i).replace(/'/g, "&apos;")})'>Print</button></td>
    </tr>`;
  }).join('');
}

function printLabResult(item) {
  const r = item.lab_results && item.lab_results[0];
  const params = (r && r.lab_result_parameters && r.lab_result_parameters.length > 0)
    ? [...r.lab_result_parameters].sort((a, b) => a.display_order - b.display_order)
    : (r ? [{ parameter_name: item.test_name, value: r.result_value || r.numeric_result, unit: r.unit, reference_range: r.reference_range, flag: r.flag || 'NORMAL' }] : []);

  const rows = params.map(p => `
    <tr>
      <td>${p.parameter_name}</td>
      <td>${p.value != null && p.value !== '' ? p.value : '—'}</td>
      <td>${p.unit || '—'}</td>
      <td>${p.reference_range || '—'}</td>
      <td>${p.flag && p.flag !== 'NORMAL' ? `<strong>${p.flag}</strong>` : 'Normal'}</td>
    </tr>
  `).join('');

  const body = `
    <div class="row"><span class="label">Order</span><span class="mono">${item.lab_orders.order_number}</span></div>
    <div class="row"><span class="label">Patient</span><span>${item.lab_orders.patients.first_name} ${item.lab_orders.patients.last_name} · ${item.lab_orders.patients.mrn}</span></div>
    <div class="row"><span class="label">Test</span><span>${item.test_name}</span></div>
    <table>
      <thead><tr><th>Parameter</th><th>Result</th><th>Unit</th><th>Reference range</th><th>Flag</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5">—</td></tr>'}</tbody>
    </table>
    ${r && r.comment ? `<p><strong>Comment</strong><br>${r.comment}</p>` : ''}
    <p style="margin-top:20px; color:#4E6360; font-size:.85rem;">Validated result — laboratory report</p>
  `;
  openPrintDocument('Lab Result — ' + item.lab_orders.order_number, meL.facilities, body, { signedBy: meL.full_name, signedRole: 'Laboratory' });
}

async function loadCritical() {
  const { data } = await supabaseClient
    .from('lab_results')
    .select('*, lab_result_parameters(*), lab_order_items(test_name, lab_orders(order_number, patient_id, patients(first_name, last_name, mrn)))')
    .eq('flag', 'CRITICAL')
    .is('acknowledged_at', null)
    .not('validated_at', 'is', null);

  const panel = document.getElementById('criticalPanel');
  if (!data || data.length === 0) { panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  document.getElementById('criticalList').innerHTML = data.map(r => {
    const criticalParams = (r.lab_result_parameters || []).filter(p => p.flag === 'CRITICAL');
    const detail = criticalParams.length > 0
      ? criticalParams.map(p => `${p.parameter_name}: ${p.value} ${p.unit || ''}`).join(', ')
      : `${r.result_value || r.numeric_result} ${r.unit || ''}`;
    return `
    <div class="panel" style="margin-bottom:8px;">
      <div class="panel-body" style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <strong>${r.lab_order_items.lab_orders.patients.first_name} ${r.lab_order_items.lab_orders.patients.last_name}</strong>
          (${r.lab_order_items.lab_orders.patients.mrn}) — ${r.lab_order_items.test_name}: ${detail}
        </div>
        <button class="btn btn-secondary" onclick="acknowledgeCritical('${r.id}')">Acknowledge</button>
      </div>
    </div>
  `;
  }).join('');
}

async function openResultForm(itemId, testName) {
  document.getElementById('resultTitle').textContent = `Enter result — ${testName}`;
  document.getElementById('resultForm').reset();
  document.getElementById('r_item_id').value = itemId;

  // Look up the test's catalogue entry and any panel parameters
  const { data: test } = await supabaseClient.from('lab_tests').select('id, unit, reference_range').eq('test_name', testName).maybeSingle();
  let params = [];
  if (test) {
    const { data: testParams } = await supabaseClient.from('lab_test_parameters').select('*').eq('lab_test_id', test.id).order('display_order');
    params = testParams || [];
  }
  // Simple test (no panel parameters): treat the test itself as one parameter
  if (params.length === 0) {
    params = [{ parameter_name: testName, unit: test ? test.unit : '', reference_range: test ? test.reference_range : '' }];
  }

  const flagOptions = f => ['NORMAL', 'LOW', 'HIGH', 'CRITICAL'].map(v => `<option value="${v}" ${v === f ? 'selected' : ''}>${v}</option>`).join('');
  document.getElementById('resultParamRows').innerHTML = params.map((p, idx) => `
    <tr data-param-name="${p.parameter_name}">
      <td>${p.parameter_name}</td>
      <td><input type="text" class="param-value" data-idx="${idx}" style="width:100%;"></td>
      <td><input type="text" class="param-unit" data-idx="${idx}" value="${p.unit || ''}" style="width:100%;"></td>
      <td><input type="text" class="param-range" data-idx="${idx}" value="${p.reference_range || ''}" style="width:100%;"></td>
      <td><select class="param-flag" data-idx="${idx}">${flagOptions('NORMAL')}</select></td>
    </tr>
  `).join('');

  document.getElementById('resultOverlay').style.display = 'flex';
}

async function saveResult(e) {
  e.preventDefault();
  const itemId = document.getElementById('r_item_id').value;

  const rows = Array.from(document.querySelectorAll('#resultParamRows tr'));
  const paramValues = rows.map((row, idx) => ({
    parameter_name: row.dataset.paramName,
    value: row.querySelector('.param-value').value.trim(),
    unit: row.querySelector('.param-unit').value.trim(),
    reference_range: row.querySelector('.param-range').value.trim(),
    flag: row.querySelector('.param-flag').value,
    display_order: idx
  }));

  const worstFlag = paramValues.some(p => p.flag === 'CRITICAL') ? 'CRITICAL'
    : paramValues.some(p => p.flag === 'HIGH') ? 'HIGH'
    : paramValues.some(p => p.flag === 'LOW') ? 'LOW'
    : 'NORMAL';

  // For a single-parameter (simple) test, also populate the legacy
  // top-level fields so older reporting/queries keep working.
  const isSimple = paramValues.length === 1;
  const summaryPayload = {
    lab_order_item_id: itemId,
    result_value: isSimple ? paramValues[0].value : `${paramValues.length} parameters recorded`,
    numeric_result: isSimple ? (parseFloat(paramValues[0].value) || null) : null,
    unit: isSimple ? paramValues[0].unit : null,
    reference_range: isSimple ? paramValues[0].reference_range : null,
    flag: worstFlag,
    comment: document.getElementById('r_comment').value.trim(),
    entered_by: meL.id,
    entered_at: new Date().toISOString()
  };

  const { data, error } = await supabaseClient.from('lab_results').insert(summaryPayload).select().single();
  if (error) { alert(error.message); return; }

  const paramRows = paramValues.map(p => ({ ...p, lab_result_id: data.id }));
  const { error: paramError } = await supabaseClient.from('lab_result_parameters').insert(paramRows);
  if (paramError) { alert(paramError.message); return; }

  await supabaseClient.from('lab_order_items').update({ status: 'ENTERED' }).eq('id', itemId);
  await logAudit('CREATE', 'LABORATORY', 'lab_results', data.id, null, { ...summaryPayload, parameters: paramValues });

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

// ---------------- WALK-IN TEST ORDER ----------------
async function loadWiTestDatalist() {
  const { data } = await supabaseClient.from('lab_tests').select('test_name').eq('status', 'ACTIVE');
  document.getElementById('labTestsDatalist2').innerHTML = (data || []).map(t => `<option value="${t.test_name}">`).join('');
}

async function addWiTest() {
  const name = document.getElementById('wi_test_name').value.trim();
  if (!name) return;
  const { data: matches } = await supabaseClient.from('lab_tests').select('*').ilike('test_name', name);
  const price = (matches && matches[0]) ? matches[0].price || 0 : 0;
  wiCart.push({ name, price });
  document.getElementById('wi_test_name').value = '';
  renderWiCart();
}

function renderWiCart() {
  const box = document.getElementById('wiCartList');
  if (wiCart.length === 0) { box.innerHTML = '<span class="empty">No tests added yet.</span>'; document.getElementById('wiTotal').textContent = '0'; return; }
  box.innerHTML = wiCart.map((t, idx) => `
    <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--hc-line);">
      <span>${t.name}</span>
      <span>${t.price.toLocaleString()} <button class="link-btn danger" onclick="removeWiTest(${idx})">×</button></span>
    </div>
  `).join('');
  const total = wiCart.reduce((s, t) => s + t.price, 0);
  document.getElementById('wiTotal').textContent = total.toLocaleString();
}

function removeWiTest(idx) {
  wiCart.splice(idx, 1);
  renderWiCart();
}

async function registerWalkIn() {
  if (wiCart.length === 0) { alert('Add at least one test.'); return; }

  const firstName = document.getElementById('wi_first').value.trim() || 'Walk-in';
  const lastName = document.getElementById('wi_last').value.trim() || 'Customer';
  const phone = document.getElementById('wi_phone').value.trim();
  const sex = document.getElementById('wi_sex').value;

  let patientId = null;
  if (phone) {
    const { data: existing } = await supabaseClient.from('patients').select('id').eq('phone', phone).limit(1).maybeSingle();
    if (existing) patientId = existing.id;
  }
  if (!patientId) {
    const { data: newPatient, error: patErr } = await supabaseClient.from('patients').insert({
      first_name: firstName, last_name: lastName, sex, phone, facility_id: meL.facility_id || null, created_by: meL.id
    }).select().single();
    if (patErr) { alert(patErr.message); return; }
    patientId = newPatient.id;
  }

  const { data: order, error: orderErr } = await supabaseClient.from('lab_orders').insert({
    patient_id: patientId, ordered_by: meL.id
  }).select().single();
  if (orderErr) { alert(orderErr.message); return; }

  for (const t of wiCart) {
    await supabaseClient.from('lab_order_items').insert({ lab_order_id: order.id, test_name: t.name });
  }

  const { data: invoice, error: invErr } = await supabaseClient.from('invoices').insert({
    patient_id: patientId, facility_id: meL.facility_id || null, created_by: meL.id
  }).select().single();
  if (invErr) { alert(invErr.message); return; }

  for (const t of wiCart) {
    await addInvoiceItem(invoice.id, { description: t.name, quantity: 1, unit_price: t.price, source_module: 'LABORATORY' });
  }

  const { data: freshInvoice } = await supabaseClient.from('invoices').select('*').eq('id', invoice.id).single();
  const { data: payment, error: payErr } = await supabaseClient.from('payments').insert({
    invoice_id: invoice.id, patient_id: patientId, amount: freshInvoice.total,
    payment_method: document.getElementById('wi_method').value,
    transaction_reference: document.getElementById('wi_ref').value.trim(), received_by: meL.id
  }).select().single();
  if (payErr) { alert(payErr.message); return; }

  await supabaseClient.from('invoices').update({ amount_paid: freshInvoice.total }).eq('id', invoice.id);
  await recalcInvoiceTotals(invoice.id);
  await logAudit('CREATE', 'LABORATORY', 'lab_orders', order.id, null, { walk_in: true, patient_id: patientId });

  printWiReceipt(firstName, lastName, order, payment);

  wiCart = [];
  renderWiCart();
  document.getElementById('wi_ref').value = '';
  await loadPending();
}

function printWiReceipt(firstName, lastName, order, payment) {
  const body = `
    <div class="row"><span class="label">Order</span><span class="mono">${order.order_number}</span></div>
    <div class="row"><span class="label">Receipt</span><span class="mono">${payment.payment_number}</span></div>
    <div class="row"><span class="label">Date</span><span class="mono">${new Date(payment.payment_date).toLocaleString('en-GB')}</span></div>
    <div class="row"><span class="label">Customer</span><span>${firstName} ${lastName}</span></div>
    <table>
      <thead><tr><th>Test</th><th>Price</th></tr></thead>
      <tbody>${wiCart.map(t => `<tr><td>${t.name}</td><td>${t.price.toLocaleString()}</td></tr>`).join('')}</tbody>
    </table>
    <div class="row total-row"><span>Amount paid</span><span>${parseFloat(payment.amount).toLocaleString()}</span></div>
    <p style="margin-top:20px; color:#4E6360; font-size:.85rem;">Present this slip when collecting results.</p>
  `;
  openPrintDocument('Lab Order ' + order.order_number, meL.facilities, body, { documentType: 'receipt', signedBy: meL.full_name, signedRole: 'Laboratory' });
}
