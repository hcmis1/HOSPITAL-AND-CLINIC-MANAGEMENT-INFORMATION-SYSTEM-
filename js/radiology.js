// ==========================================================
// HCMIS — Radiology
// ==========================================================

let meR = null;
let wiCart = [];
let isRadAdmin = false;

(async function init() {
  meR = await requireAuth();
  if (!meR) return;

  document.getElementById('whoName').textContent = meR.full_name;
  document.getElementById('whoRole').textContent = meR.role;
  document.getElementById('facilityName').textContent =
    (meR.facilities && meR.facilities.name) ? meR.facilities.name : 'No facility assigned';
  if (['SUPER_ADMIN', 'FACILITY_ADMIN'].includes(meR.role)) {
    document.getElementById('adminNavGroup').style.display = 'block';
  }

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${btn.dataset.tab}`));
    });
  });

  document.getElementById('reportForm').addEventListener('submit', saveReport);
  document.getElementById('cancelReportBtn').addEventListener('click', () => document.getElementById('reportOverlay').style.display = 'none');
  document.getElementById('serviceForm').addEventListener('submit', addServiceToCatalogue);
  document.getElementById('editServiceForm').addEventListener('submit', saveServiceEdit);
  document.getElementById('addWiServiceBtn').addEventListener('click', addWiService);
  document.getElementById('registerWiBtn').addEventListener('click', registerWalkIn);

  isRadAdmin = ['SUPER_ADMIN', 'FACILITY_ADMIN'].includes(meR.role);

  await loadPending();
  await loadCompleted();
  await loadCatalogue();
  await loadWiServiceDatalist();
})();

async function addServiceToCatalogue(e) {
  e.preventDefault();
  const payload = {
    name: document.getElementById('sc_name').value.trim(),
    modality: document.getElementById('sc_modality').value.trim(),
    body_part: document.getElementById('sc_bodypart').value.trim(),
    preparation: document.getElementById('sc_prep').value.trim(),
    price: parseFloat(document.getElementById('sc_price').value) || 0
  };
  const { data, error } = await supabaseClient.from('imaging_services').insert(payload).select().single();
  if (error) { alert(error.message); return; }
  await logAudit('CREATE', 'RADIOLOGY', 'imaging_services', data.id, null, payload);
  document.getElementById('serviceForm').reset();
  await loadCatalogue();
}

async function loadCatalogue() {
  const { data } = await supabaseClient.from('imaging_services').select('*').order('name');
  const tbody = document.getElementById('catalogueTable');
  if (!data || data.length === 0) { tbody.innerHTML = '<tr><td colspan="5" class="empty">No services in catalogue yet.</td></tr>'; return; }
  tbody.innerHTML = data.map(s => {
    const editBtn = isRadAdmin ? `<button class="link-btn" onclick="openEditServiceForm('${s.id}')">Edit</button>` : '—';
    return `<tr><td>${s.name}</td><td>${s.modality || '—'}</td><td>${s.preparation || '—'}</td><td>${parseFloat(s.price || 0).toLocaleString()}</td><td>${editBtn}</td></tr>`;
  }).join('');
}

// ---------------- EDIT SERVICE (ADMIN) ----------------
async function openEditServiceForm(serviceId) {
  if (!isRadAdmin) return;
  const { data: service } = await supabaseClient.from('imaging_services').select('*').eq('id', serviceId).single();
  if (!service) return;

  document.getElementById('editServiceTitle').textContent = 'Edit service — ' + service.name;
  document.getElementById('es_id').value = service.id;
  document.getElementById('es_name').value = service.name;
  document.getElementById('es_modality').value = service.modality || '';
  document.getElementById('es_bodypart').value = service.body_part || '';
  document.getElementById('es_prep').value = service.preparation || '';
  document.getElementById('es_price').value = service.price || 0;
  document.getElementById('es_status').value = service.status || 'ACTIVE';

  document.getElementById('editServiceOverlay').style.display = 'flex';
}

async function saveServiceEdit(e) {
  e.preventDefault();
  const id = document.getElementById('es_id').value;
  const payload = {
    modality: document.getElementById('es_modality').value.trim(),
    body_part: document.getElementById('es_bodypart').value.trim(),
    preparation: document.getElementById('es_prep').value.trim(),
    price: parseFloat(document.getElementById('es_price').value) || 0,
    status: document.getElementById('es_status').value
  };
  const { error } = await supabaseClient.from('imaging_services').update(payload).eq('id', id);
  if (error) { alert(error.message); return; }
  await logAudit('UPDATE', 'RADIOLOGY', 'imaging_services', id, null, payload);
  document.getElementById('editServiceOverlay').style.display = 'none';
  await loadCatalogue();
  await loadWiServiceDatalist();
}

// ---------------- WALK-IN IMAGING ----------------
async function loadWiServiceDatalist() {
  const { data } = await supabaseClient.from('imaging_services').select('name').eq('status', 'ACTIVE');
  document.getElementById('imgServicesDatalist2').innerHTML = (data || []).map(s => `<option value="${s.name}">`).join('');
}

async function addWiService() {
  const name = document.getElementById('wi_service_name').value.trim();
  if (!name) return;
  const { data: matches } = await supabaseClient.from('imaging_services').select('*').ilike('name', name);
  const price = (matches && matches[0]) ? matches[0].price || 0 : 0;
  const preparation = (matches && matches[0]) ? matches[0].preparation || '' : '';
  wiCart.push({ name, price, preparation });
  document.getElementById('wi_service_name').value = '';
  renderWiCart();
}

function renderWiCart() {
  const box = document.getElementById('wiCartList');
  if (wiCart.length === 0) { box.innerHTML = '<span class="empty">No services added yet.</span>'; document.getElementById('wiTotal').textContent = '0'; return; }
  box.innerHTML = wiCart.map((s, idx) => `
    <div style="padding:6px 0; border-bottom:1px solid var(--hc-line);">
      <div style="display:flex; justify-content:space-between;">
        <span>${s.name}</span>
        <span>${s.price.toLocaleString()} <button class="link-btn danger" onclick="removeWiService(${idx})">×</button></span>
      </div>
      ${s.preparation && s.preparation.toLowerCase() !== 'no special preparation' ? `<div style="font-size:.85rem; color:var(--hc-amber-700, #a05a00);">⚠ Prep needed: ${s.preparation}</div>` : ''}
    </div>
  `).join('');
  const total = wiCart.reduce((sum, s) => sum + s.price, 0);
  document.getElementById('wiTotal').textContent = total.toLocaleString();
}

function removeWiService(idx) {
  wiCart.splice(idx, 1);
  renderWiCart();
}

async function registerWalkIn() {
  if (wiCart.length === 0) { alert('Add at least one imaging service.'); return; }

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
      first_name: firstName, last_name: lastName, sex, phone, facility_id: meR.facility_id || null, created_by: meR.id
    }).select().single();
    if (patErr) { alert(patErr.message); return; }
    patientId = newPatient.id;
  }

  const { data: order, error: orderErr } = await supabaseClient.from('imaging_orders').insert({
    patient_id: patientId, requested_by: meR.id
  }).select().single();
  if (orderErr) { alert(orderErr.message); return; }

  for (const s of wiCart) {
    await supabaseClient.from('imaging_order_items').insert({ imaging_order_id: order.id, service_name: s.name });
  }

  const { data: invoice, error: invErr } = await supabaseClient.from('invoices').insert({
    patient_id: patientId, facility_id: meR.facility_id || null, created_by: meR.id
  }).select().single();
  if (invErr) { alert(invErr.message); return; }

  for (const s of wiCart) {
    await addInvoiceItem(invoice.id, { description: s.name, quantity: 1, unit_price: s.price, source_module: 'RADIOLOGY' });
  }

  const { data: freshInvoice } = await supabaseClient.from('invoices').select('*').eq('id', invoice.id).single();
  const { data: payment, error: payErr } = await supabaseClient.from('payments').insert({
    invoice_id: invoice.id, patient_id: patientId, amount: freshInvoice.total,
    payment_method: document.getElementById('wi_method').value,
    transaction_reference: document.getElementById('wi_ref').value.trim(), received_by: meR.id
  }).select().single();
  if (payErr) { alert(payErr.message); return; }

  await supabaseClient.from('invoices').update({ amount_paid: freshInvoice.total }).eq('id', invoice.id);
  await recalcInvoiceTotals(invoice.id);
  await logAudit('CREATE', 'RADIOLOGY', 'imaging_orders', order.id, null, { walk_in: true, patient_id: patientId });

  printWiImagingReceipt(firstName, lastName, order, payment);

  wiCart = [];
  renderWiCart();
  document.getElementById('wi_ref').value = '';
  await loadPending();
}

function printWiImagingReceipt(firstName, lastName, order, payment) {
  const body = `
    <div class="row"><span class="label">Order</span><span class="mono">${order.order_number}</span></div>
    <div class="row"><span class="label">Receipt</span><span class="mono">${payment.payment_number}</span></div>
    <div class="row"><span class="label">Date</span><span class="mono">${new Date(payment.payment_date).toLocaleString('en-GB')}</span></div>
    <div class="row"><span class="label">Customer</span><span>${firstName} ${lastName}</span></div>
    <table>
      <thead><tr><th>Service</th><th>Price</th></tr></thead>
      <tbody>${wiCart.map(s => `<tr><td>${s.name}</td><td>${s.price.toLocaleString()}</td></tr>`).join('')}</tbody>
    </table>
    <div class="row total-row"><span>Amount paid</span><span>${parseFloat(payment.amount).toLocaleString()}</span></div>
    <p style="margin-top:20px; color:#4E6360; font-size:.85rem;">Present this slip for imaging.</p>
  `;
  openPrintDocument('Imaging Order ' + order.order_number, meR.facilities ? meR.facilities.name : 'HCMIS', body);
}

async function fetchItems(statuses) {
  const { data } = await supabaseClient
    .from('imaging_order_items')
    .select('*, imaging_orders(order_number, priority, patient_id, patients(first_name, last_name, mrn)), imaging_reports(*)')
    .in('status', statuses)
    .order('id', { ascending: false });
  return data || [];
}

async function loadPending() {
  const items = await fetchItems(['PENDING']);
  const tbody = document.getElementById('pendingTable');
  if (items.length === 0) { tbody.innerHTML = '<tr><td colspan="5" class="empty">No pending imaging.</td></tr>'; return; }
  tbody.innerHTML = items.map(i => `
    <tr>
      <td class="mono">${i.imaging_orders.order_number}</td>
      <td>${i.imaging_orders.patients.first_name} ${i.imaging_orders.patients.last_name} · ${i.imaging_orders.patients.mrn}</td>
      <td>${i.service_name} ${i.modality ? '(' + i.modality + ')' : ''}</td>
      <td>${i.imaging_orders.priority}</td>
      <td><button class="link-btn" onclick="openReportForm('${i.id}','${i.service_name}')">Enter report</button></td>
    </tr>
  `).join('');
}

async function loadCompleted() {
  const items = await fetchItems(['COMPLETED']);
  const tbody = document.getElementById('completedTable');
  if (items.length === 0) { tbody.innerHTML = '<tr><td colspan="5" class="empty">No completed reports yet.</td></tr>'; return; }
  tbody.innerHTML = items.slice(0, 50).map(i => {
    const r = i.imaging_reports && i.imaging_reports[0];
    return `
    <tr>
      <td class="mono">${i.imaging_orders.order_number}</td>
      <td>${i.imaging_orders.patients.first_name} ${i.imaging_orders.patients.last_name} · ${i.imaging_orders.patients.mrn}</td>
      <td>${i.service_name}</td>
      <td>${r ? r.impression || '—' : '—'}</td>
      <td><button class="link-btn" onclick='printRadiologyResult(${JSON.stringify(i).replace(/'/g, "&apos;")})'>Print</button></td>
    </tr>`;
  }).join('');
}

function printRadiologyResult(item) {
  const r = item.imaging_reports && item.imaging_reports[0];
  const body = `
    <div class="row"><span class="label">Order</span><span class="mono">${item.imaging_orders.order_number}</span></div>
    <div class="row"><span class="label">Patient</span><span>${item.imaging_orders.patients.first_name} ${item.imaging_orders.patients.last_name} · ${item.imaging_orders.patients.mrn}</span></div>
    <div class="row"><span class="label">Service</span><span>${item.service_name} ${item.modality ? '(' + item.modality + ')' : ''}</span></div>
    ${r ? `
      <p><strong>Findings</strong><br>${r.findings || '—'}</p>
      <p><strong>Impression</strong><br>${r.impression || '—'}</p>
      ${r.recommendations ? `<p><strong>Recommendations</strong><br>${r.recommendations}</p>` : ''}
    ` : '<p>No report on file.</p>'}
    <p style="margin-top:20px; color:#4E6360; font-size:.85rem;">Radiology report</p>
  `;
  openPrintDocument('Radiology Result — ' + item.imaging_orders.order_number, meR.facilities ? meR.facilities.name : 'HCMIS', body);
}

function openReportForm(itemId, serviceName) {
  document.getElementById('reportTitle').textContent = `Report — ${serviceName}`;
  document.getElementById('reportForm').reset();
  document.getElementById('rep_item_id').value = itemId;
  document.getElementById('reportOverlay').style.display = 'flex';
}

async function saveReport(e) {
  e.preventDefault();
  const itemId = document.getElementById('rep_item_id').value;
  const payload = {
    imaging_order_item_id: itemId,
    radiologist_id: meR.id,
    findings: document.getElementById('rep_findings').value.trim(),
    impression: document.getElementById('rep_impression').value.trim(),
    recommendations: document.getElementById('rep_recommendations').value.trim(),
    reported_at: new Date().toISOString()
  };

  const { data, error } = await supabaseClient.from('imaging_reports').insert(payload).select().single();
  if (error) { alert(error.message); return; }
  await supabaseClient.from('imaging_order_items').update({ status: 'COMPLETED' }).eq('id', itemId);
  await logAudit('CREATE', 'RADIOLOGY', 'imaging_reports', data.id, null, payload);

  document.getElementById('reportOverlay').style.display = 'none';
  await loadPending();
  await loadCompleted();
}
