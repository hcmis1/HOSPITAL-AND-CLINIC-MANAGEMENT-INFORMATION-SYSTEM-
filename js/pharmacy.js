// ==========================================================
// HCMIS — Pharmacy
// ==========================================================

let meP = null;
let medicinesCache = [];
let batchesCache = [];
let isPharmAdmin = false;
let posCart = [];

(async function init() {
  meP = await requireAuth();
  if (!meP) return;

  document.getElementById('whoName').textContent = meP.full_name;
  document.getElementById('whoRole').textContent = meP.role;
  document.getElementById('facilityName').textContent =
    (meP.facilities && meP.facilities.name) ? meP.facilities.name : 'No facility assigned';
  if (['SUPER_ADMIN', 'FACILITY_ADMIN'].includes(meP.role)) {
    document.getElementById('adminNavGroup').style.display = 'block';
    isPharmAdmin = true;
  }

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${btn.dataset.tab}`));
    });
  });

  document.getElementById('medForm').addEventListener('submit', addMedicine);
  document.getElementById('editMedForm').addEventListener('submit', saveMedicineEdit);
  document.getElementById('stockForm').addEventListener('submit', saveBatch);
  document.getElementById('cancelStockBtn').addEventListener('click', () => document.getElementById('stockOverlay').style.display = 'none');
  document.getElementById('dispenseForm').addEventListener('submit', doDispense);
  document.getElementById('cancelDispenseBtn').addEventListener('click', () => document.getElementById('dispenseOverlay').style.display = 'none');
  document.getElementById('disp_medicine').addEventListener('change', updateStockHint);
  document.getElementById('disp_medicine').addEventListener('change', toggleWitnessField);
  document.getElementById('addPosItemBtn').addEventListener('click', addPosItem);
  document.getElementById('completeSaleBtn').addEventListener('click', completeSale);
  document.getElementById('dosingForm').addEventListener('submit', addDosingGuideline);
  document.getElementById('protocolForm').addEventListener('submit', addDiagnosisProtocol);
  document.getElementById('adjustForm').addEventListener('submit', recordAdjustment);
  document.getElementById('cat_search').addEventListener('input', renderCatalogue);
  document.getElementById('cat_filter').addEventListener('change', renderCatalogue);
  document.getElementById('dx_search').addEventListener('input', renderProtocolsList);

  await loadCatalogueAndStock();
  await loadAlerts();
  await loadQueue();
  await loadDiagnosisProtocols();
  await loadControlledBalances();
  await loadControlledRegister();
})();

async function loadCatalogueAndStock() {
  const { data: meds } = await supabaseClient.from('medicines').select('*').order('generic_name');
  const { data: batches } = await supabaseClient.from('medicine_batches').select('*, medicines(generic_name, brand_name, unit)').order('expiry_date');
  medicinesCache = meds || [];
  batchesCache = batches || [];
  renderCatalogue();
  renderStock();
}

function totalStock(medicineId) {
  return batchesCache
    .filter(b => b.medicine_id === medicineId && b.status === 'ACTIVE' && new Date(b.expiry_date) >= new Date())
    .reduce((sum, b) => sum + b.quantity, 0);
}

function renderCatalogue() {
  const tbody = document.getElementById('catalogueTable');

  // Populate the category dropdown once, from whatever categories exist
  const catSel = document.getElementById('cat_filter');
  if (catSel && catSel.options.length <= 1) {
    const categories = [...new Set(medicinesCache.map(m => m.therapeutic_category).filter(Boolean))].sort();
    catSel.innerHTML = '<option value="">All categories</option>' + categories.map(c => `<option value="${c}">${c}</option>`).join('');
  }

  const searchTerm = (document.getElementById('cat_search')?.value || '').toLowerCase().trim();
  const categoryFilter = document.getElementById('cat_filter')?.value || '';
  const filtered = medicinesCache.filter(m => {
    const matchesSearch = !searchTerm || m.generic_name.toLowerCase().includes(searchTerm) || (m.brand_name && m.brand_name.toLowerCase().includes(searchTerm));
    const matchesCategory = !categoryFilter || m.therapeutic_category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  if (filtered.length === 0) { tbody.innerHTML = `<tr><td colspan="7" class="empty">${medicinesCache.length === 0 ? 'No medicines in catalogue yet.' : 'No medicines match this search/filter.'}</td></tr>`; return; }
  tbody.innerHTML = filtered.map(m => {
    const editBtn = isPharmAdmin ? ` · <button class="link-btn" onclick="openEditMedicineForm('${m.id}')">Edit</button>` : '';
    return `
    <tr>
      <td>${m.generic_name}${m.brand_name ? ' (' + m.brand_name + ')' : ''}${m.therapeutic_category ? '<br><span class="pill active" style="font-size:.75rem;">' + m.therapeutic_category + '</span>' : ''}</td>
      <td>${m.strength || '—'}</td>
      <td>${m.dosage_form || '—'}</td>
      <td class="mono">${totalStock(m.id)} ${m.unit}</td>
      <td>${m.reorder_level}</td>
      <td class="mono">${parseFloat(m.default_price || 0).toLocaleString()}</td>
      <td><button class="link-btn" onclick="openStockForm('${m.id}')">Add stock</button> · <button class="link-btn" onclick="openDosingPanel('${m.id}','${m.generic_name.replace(/'/g, "\\'")}')">Dosing guide</button>${editBtn}</td>
    </tr>
  `;
  }).join('');

  const sel = document.getElementById('disp_medicine');
  sel.innerHTML = medicinesCache.map(m => `<option value="${m.id}">${m.generic_name}${m.strength ? ' ' + m.strength : ''}${m.brand_name ? ' (' + m.brand_name + ')' : ''}</option>`).join('');

  const posSel = document.getElementById('pos_medicine');
  if (posSel) posSel.innerHTML = medicinesCache.map(m => `<option value="${m.id}">${m.generic_name}${m.strength ? ' ' + m.strength : ''}${m.brand_name ? ' (' + m.brand_name + ')' : ''}</option>`).join('');

  const prSel = document.getElementById('pr_medicine');
  if (prSel) prSel.innerHTML = medicinesCache.map(m => `<option value="${m.id}">${m.generic_name}${m.brand_name ? ' (' + m.brand_name + ')' : ''}</option>`).join('');
}

function renderStock() {
  const tbody = document.getElementById('stockTable');
  if (batchesCache.length === 0) { tbody.innerHTML = '<tr><td colspan="6" class="empty">No stock recorded yet.</td></tr>'; return; }
  const today = new Date();
  tbody.innerHTML = batchesCache.map(b => {
    const expired = new Date(b.expiry_date) < today;
    const depleted = b.quantity <= 0;
    const displayStatus = depleted ? 'DEPLETED' : (expired ? 'EXPIRED' : 'ACTIVE');
    return `
      <tr>
        <td>${b.medicines ? b.medicines.generic_name : '—'}</td>
        <td class="mono">${b.batch_number || '—'}</td>
        <td class="mono">${b.expiry_date}</td>
        <td>${b.quantity} ${b.medicines ? b.medicines.unit : ''}</td>
        <td><span class="pill ${displayStatus === 'ACTIVE' ? 'active' : 'inactive'}">${displayStatus}</span></td>
        <td>
          <button class="link-btn" onclick="adjustBatch('${b.id}')">Adjust</button> ·
          <button class="link-btn" onclick="markDamaged('${b.id}')">Damaged</button> ·
          <button class="link-btn" onclick="returnBatch('${b.id}')">Return</button>
        </td>
      </tr>`;
  }).join('');
}

async function adjustBatch(batchId) {
  const batch = batchesCache.find(b => b.id === batchId);
  if (!batch) return;
  const newQtyStr = prompt(`Current quantity: ${batch.quantity}. Enter corrected quantity:`, batch.quantity);
  if (newQtyStr === null) return;
  const newQty = parseInt(newQtyStr);
  if (isNaN(newQty) || newQty < 0) { alert('Enter a valid quantity.'); return; }
  const reason = prompt('Reason for adjustment:') || '';
  const diff = newQty - batch.quantity;

  await supabaseClient.from('medicine_batches').update({ quantity: newQty, status: newQty <= 0 ? 'DEPLETED' : 'ACTIVE' }).eq('id', batchId);
  await supabaseClient.from('stock_movements').insert({
    medicine_id: batch.medicine_id, batch_id: batchId, movement_type: 'ADJUSTMENT',
    quantity: diff, reference_type: 'MANUAL', performed_by: meP.id
  });
  await logAudit('UPDATE', 'PHARMACY', 'medicine_batches', batchId, null, { quantity: newQty, reason });

  await loadCatalogueAndStock();
  await loadAlerts();
}

async function markDamaged(batchId) {
  const batch = batchesCache.find(b => b.id === batchId);
  if (!batch) return;
  const qtyStr = prompt(`Quantity damaged (available: ${batch.quantity}):`, '0');
  if (qtyStr === null) return;
  const qty = parseInt(qtyStr);
  if (isNaN(qty) || qty <= 0 || qty > batch.quantity) { alert('Enter a valid quantity.'); return; }
  const newQty = batch.quantity - qty;

  await supabaseClient.from('medicine_batches').update({ quantity: newQty, status: newQty <= 0 ? 'DEPLETED' : 'ACTIVE' }).eq('id', batchId);
  await supabaseClient.from('stock_movements').insert({
    medicine_id: batch.medicine_id, batch_id: batchId, movement_type: 'DAMAGE',
    quantity: -qty, reference_type: 'MANUAL', performed_by: meP.id
  });
  await logAudit('UPDATE', 'PHARMACY', 'medicine_batches', batchId, null, { damaged: qty });

  await loadCatalogueAndStock();
  await loadAlerts();
}

async function returnBatch(batchId) {
  const batch = batchesCache.find(b => b.id === batchId);
  if (!batch) return;
  const qtyStr = prompt(`Quantity to return to supplier (available: ${batch.quantity}):`, '0');
  if (qtyStr === null) return;
  const qty = parseInt(qtyStr);
  if (isNaN(qty) || qty <= 0 || qty > batch.quantity) { alert('Enter a valid quantity.'); return; }
  const newQty = batch.quantity - qty;

  await supabaseClient.from('medicine_batches').update({ quantity: newQty, status: newQty <= 0 ? 'DEPLETED' : 'ACTIVE' }).eq('id', batchId);
  await supabaseClient.from('stock_movements').insert({
    medicine_id: batch.medicine_id, batch_id: batchId, movement_type: 'RETURN',
    quantity: -qty, reference_type: 'MANUAL', performed_by: meP.id
  });
  await logAudit('UPDATE', 'PHARMACY', 'medicine_batches', batchId, null, { returned: qty });

  await loadCatalogueAndStock();
  await loadAlerts();
}

async function loadAlerts() {
  const today = new Date();
  const in30 = new Date(); in30.setDate(in30.getDate() + 30);

  const lowStock = medicinesCache.filter(m => totalStock(m.id) < m.reorder_level);
  const expiringSoon = batchesCache.filter(b => b.status === 'ACTIVE' && b.quantity > 0 && new Date(b.expiry_date) <= in30 && new Date(b.expiry_date) >= today);

  const panel = document.getElementById('alertsPanel');
  if (lowStock.length === 0 && expiringSoon.length === 0) { panel.style.display = 'none'; return; }
  panel.style.display = 'block';

  let html = '';
  lowStock.forEach(m => {
    html += `<div class="panel" style="margin-bottom:6px;"><div class="panel-body" style="padding:10px 14px;">⚠ <strong>${m.generic_name}</strong> is below reorder level (${totalStock(m.id)} / ${m.reorder_level})</div></div>`;
  });
  expiringSoon.forEach(b => {
    html += `<div class="panel" style="margin-bottom:6px;"><div class="panel-body" style="padding:10px 14px;">⏳ <strong>${b.medicines ? b.medicines.generic_name : 'Medicine'}</strong> batch ${b.batch_number || ''} expires ${b.expiry_date} (${b.quantity} left)</div></div>`;
  });
  document.getElementById('alertsList').innerHTML = html;
}

// ---------------- WALK-IN SALE (POS) ----------------
function findEarliestBatchPrice(medicineId) {
  const eligible = batchesCache
    .filter(b => b.medicine_id === medicineId && b.status === 'ACTIVE' && b.quantity > 0 && new Date(b.expiry_date) >= new Date())
    .sort((a, b) => new Date(a.expiry_date) - new Date(b.expiry_date));
  const medicine = medicinesCache.find(m => m.id === medicineId);
  const defaultPrice = medicine ? (medicine.default_price || 0) : 0;
  if (eligible.length === 0) return defaultPrice;
  return eligible[0].selling_price || defaultPrice;
}

function addPosItem() {
  const medicineId = document.getElementById('pos_medicine').value;
  const qty = parseInt(document.getElementById('pos_qty').value) || 0;
  const medicine = medicinesCache.find(m => m.id === medicineId);
  if (!medicine || qty <= 0) return;

  const available = totalStock(medicineId);
  if (qty > available) { alert(`Only ${available} in stock.`); return; }

  const unitPrice = findEarliestBatchPrice(medicineId);
  posCart.push({ medicineId, name: medicine.generic_name, qty, unitPrice });
  renderPosCart();
}

function renderPosCart() {
  const box = document.getElementById('posCartList');
  if (posCart.length === 0) { box.innerHTML = '<span class="empty">No items added yet.</span>'; document.getElementById('posTotal').textContent = '0'; return; }
  box.innerHTML = posCart.map((c, idx) => `
    <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--hc-line);">
      <span>${c.name} × ${c.qty} @ ${c.unitPrice.toLocaleString()}</span>
      <span>${(c.qty * c.unitPrice).toLocaleString()} <button class="link-btn danger" onclick="removePosItem(${idx})">×</button></span>
    </div>
  `).join('');
  const total = posCart.reduce((s, c) => s + c.qty * c.unitPrice, 0);
  document.getElementById('posTotal').textContent = total.toLocaleString();
}

function removePosItem(idx) {
  posCart.splice(idx, 1);
  renderPosCart();
}

async function completeSale() {
  if (posCart.length === 0) { alert('Add at least one item to the sale.'); return; }

  // re-validate stock right before completing
  for (const c of posCart) {
    if (c.qty > totalStock(c.medicineId)) { alert(`Insufficient stock for ${c.name}.`); return; }
  }

  const firstName = document.getElementById('pos_first').value.trim() || 'Walk-in';
  const lastName = document.getElementById('pos_last').value.trim() || 'Customer';
  const phone = document.getElementById('pos_phone').value.trim();
  const sex = document.getElementById('pos_sex').value;

  // reuse an existing patient by phone if one matches, else create a lightweight record
  let patientId = null;
  if (phone) {
    const { data: existing } = await supabaseClient.from('patients').select('id').eq('phone', phone).limit(1).maybeSingle();
    if (existing) patientId = existing.id;
  }
  if (!patientId) {
    const { data: newPatient, error: patErr } = await supabaseClient.from('patients').insert({
      first_name: firstName, last_name: lastName, sex, phone, facility_id: meP.facility_id || null, created_by: meP.id
    }).select().single();
    if (patErr) { alert(patErr.message); return; }
    patientId = newPatient.id;
  }

  const { data: invoice, error: invErr } = await supabaseClient.from('invoices').insert({
    patient_id: patientId, facility_id: meP.facility_id || null, created_by: meP.id
  }).select().single();
  if (invErr) { alert(invErr.message); return; }

  for (const c of posCart) {
    const eligible = batchesCache
      .filter(b => b.medicine_id === c.medicineId && b.status === 'ACTIVE' && b.quantity > 0 && new Date(b.expiry_date) >= new Date())
      .sort((a, b) => new Date(a.expiry_date) - new Date(b.expiry_date));
    let remaining = c.qty;
    for (const batch of eligible) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, batch.quantity);
      remaining -= take;
      const newQty = batch.quantity - take;
      await supabaseClient.from('medicine_batches').update({ quantity: newQty, status: newQty <= 0 ? 'DEPLETED' : 'ACTIVE' }).eq('id', batch.id);
      await supabaseClient.from('stock_movements').insert({
        medicine_id: c.medicineId, batch_id: batch.id, movement_type: 'DISPENSING',
        quantity: -take, reference_type: 'POS_SALE', reference_id: invoice.id, performed_by: meP.id
      });
    }
    await addInvoiceItem(invoice.id, { description: c.name, quantity: c.qty, unit_price: c.unitPrice, source_module: 'PHARMACY' });
  }

  const { data: freshInvoice } = await supabaseClient.from('invoices').select('*').eq('id', invoice.id).single();
  const { data: payment, error: payErr } = await supabaseClient.from('payments').insert({
    invoice_id: invoice.id, patient_id: patientId, amount: freshInvoice.total,
    payment_method: document.getElementById('pos_method').value,
    transaction_reference: document.getElementById('pos_ref').value.trim(), received_by: meP.id
  }).select().single();
  if (payErr) { alert(payErr.message); return; }

  await supabaseClient.from('invoices').update({ amount_paid: freshInvoice.total }).eq('id', invoice.id);
  await recalcInvoiceTotals(invoice.id);
  await logAudit('CREATE', 'PHARMACY', 'invoices', invoice.id, null, { pos_sale: true, total: freshInvoice.total });

  printPosReceipt(firstName, lastName, invoice, payment);

  posCart = [];
  renderPosCart();
  document.getElementById('pos_ref').value = '';
  await loadCatalogueAndStock();
  await loadAlerts();
}

function printPosReceipt(firstName, lastName, invoice, payment) {
  const body = `
    <div class="row"><span class="label">Receipt</span><span class="mono">${payment.payment_number}</span></div>
    <div class="row"><span class="label">Date</span><span class="mono">${new Date(payment.payment_date).toLocaleString('en-GB')}</span></div>
    <div class="row"><span class="label">Customer</span><span>${firstName} ${lastName}</span></div>
    <table>
      <thead><tr><th>Item</th><th>Qty</th><th>Unit price</th><th>Total</th></tr></thead>
      <tbody>${posCart.map(c => `<tr><td>${c.name}</td><td>${c.qty}</td><td>${c.unitPrice.toLocaleString()}</td><td>${(c.qty * c.unitPrice).toLocaleString()}</td></tr>`).join('')}</tbody>
    </table>
    <div class="row total-row"><span>Amount paid</span><span>${parseFloat(payment.amount).toLocaleString()}</span></div>
  `;
  openPrintDocument('Pharmacy Receipt ' + payment.payment_number, meP.facilities, body, { documentType: 'receipt', signedBy: meP.full_name, signedRole: 'Pharmacist/Dispenser' });
}
// ---------------- DIAGNOSIS PROTOCOLS ----------------
async function addDiagnosisProtocol(e) {
  e.preventDefault();
  const payload = {
    diagnosis_name: document.getElementById('pr_diagnosis').value.trim(),
    medicine_id: document.getElementById('pr_medicine').value,
    line: document.getElementById('pr_line').value,
    notes: document.getElementById('pr_notes').value.trim()
  };
  const { data, error } = await supabaseClient.from('diagnosis_protocols').insert(payload).select().single();
  if (error) { alert(error.message); return; }
  await logAudit('CREATE', 'PHARMACY', 'diagnosis_protocols', data.id, null, payload);
  document.getElementById('protocolForm').reset();
  await loadDiagnosisProtocols();
}

let diagnosisProtocolsCache = [];

async function loadDiagnosisProtocols() {
  const { data } = await supabaseClient.from('diagnosis_protocols').select('*, medicines(generic_name, brand_name)').order('diagnosis_name');
  diagnosisProtocolsCache = data || [];
  renderProtocolsList();
}

function renderProtocolsList() {
  const box = document.getElementById('protocolsList');
  if (!box) return;
  if (diagnosisProtocolsCache.length === 0) { box.innerHTML = '<p class="empty">No protocols set up yet.</p>'; return; }

  const searchTerm = (document.getElementById('dx_search')?.value || '').toLowerCase().trim();
  const filtered = searchTerm
    ? diagnosisProtocolsCache.filter(p => p.diagnosis_name.toLowerCase().includes(searchTerm))
    : diagnosisProtocolsCache;

  if (filtered.length === 0) { box.innerHTML = '<p class="empty">No conditions match this search.</p>'; return; }

  const grouped = {};
  filtered.forEach(p => { (grouped[p.diagnosis_name] = grouped[p.diagnosis_name] || []).push(p); });

  box.innerHTML = Object.keys(grouped).sort().map(dx => `
    <div class="panel" style="margin-bottom:8px;">
      <div class="panel-header"><h3 style="font-size:.95rem;">${dx}</h3></div>
      <div class="panel-body">
        ${grouped[dx].map(p => `
          <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--hc-line);">
            <span>
              <span class="pill ${p.line === 'FIRST_LINE' ? 'active' : 'inactive'}">${p.line.replace('_', ' ')}</span>
              ${p.medicines ? p.medicines.generic_name : ''} ${p.notes ? '- ' + p.notes : ''}
            </span>
            <button class="link-btn danger" onclick="deleteDiagnosisProtocol('${p.id}')">Remove</button>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}

async function deleteDiagnosisProtocol(id) {
  await supabaseClient.from('diagnosis_protocols').delete().eq('id', id);
  await logAudit('DELETE', 'PHARMACY', 'diagnosis_protocols', id, null, null);
  await loadDiagnosisProtocols();
}
// ---------------- DOSING GUIDELINES ----------------
async function openDosingPanel(medicineId, medicineName) {
  document.getElementById('dosingTitle').textContent = 'Dosing guide — ' + medicineName;
  document.getElementById('dg_medicine_id').value = medicineId;
  document.getElementById('dosingForm').reset();
  document.getElementById('dg_min').value = '0';
  await loadDosingGuidelines(medicineId);
  document.getElementById('dosingOverlay').style.display = 'flex';
}

async function loadDosingGuidelines(medicineId) {
  const { data } = await supabaseClient.from('medicine_dosing_guidelines').select('*').eq('medicine_id', medicineId).order('age_min_years');
  const box = document.getElementById('dosingList');
  if (!data || data.length === 0) { box.innerHTML = '<span class="empty">No dosing options set yet — clinicians will need to enter dose manually for this medicine.</span>'; return; }
  box.innerHTML = data.map(g => `
    <div class="panel" style="margin-bottom:6px;">
      <div class="panel-body" style="padding:10px 14px; display:flex; justify-content:space-between; align-items:center;">
        <div>
          <strong>${g.age_band_label}</strong>
          (${g.age_min_years}${g.age_max_years != null ? '–' + g.age_max_years : '+'} yrs${g.weight_min_kg != null ? ', ' + g.weight_min_kg + (g.weight_max_kg != null ? '–' + g.weight_max_kg : '+') + 'kg' : ''}) —
          ${g.dose} ${g.route || ''} ${g.frequency || ''} ${g.duration ? 'for ' + g.duration : ''}
          ${g.notes ? `<br><span style="color:var(--hc-ink-soft); font-size:.85rem;">${g.notes}</span>` : ''}
        </div>
        <button class="link-btn danger" onclick="deleteDosingGuideline('${g.id}','${medicineId}')">Remove</button>
      </div>
    </div>
  `).join('');
}

async function addDosingGuideline(e) {
  e.preventDefault();
  const medicineId = document.getElementById('dg_medicine_id').value;
  const payload = {
    medicine_id: medicineId,
    age_band_label: document.getElementById('dg_label').value.trim(),
    age_min_years: parseFloat(document.getElementById('dg_min').value) || 0,
    age_max_years: document.getElementById('dg_max').value ? parseFloat(document.getElementById('dg_max').value) : null,
    weight_min_kg: document.getElementById('dg_wmin').value ? parseFloat(document.getElementById('dg_wmin').value) : null,
    weight_max_kg: document.getElementById('dg_wmax').value ? parseFloat(document.getElementById('dg_wmax').value) : null,
    dose: document.getElementById('dg_dose').value.trim(),
    route: document.getElementById('dg_route').value.trim(),
    frequency: document.getElementById('dg_freq').value.trim(),
    duration: document.getElementById('dg_duration').value.trim(),
    notes: document.getElementById('dg_notes').value.trim()
  };
  const { data, error } = await supabaseClient.from('medicine_dosing_guidelines').insert(payload).select().single();
  if (error) { alert(error.message); return; }
  await logAudit('CREATE', 'PHARMACY', 'medicine_dosing_guidelines', data.id, null, payload);
  document.getElementById('dosingForm').reset();
  document.getElementById('dg_medicine_id').value = medicineId;
  document.getElementById('dg_min').value = '0';
  await loadDosingGuidelines(medicineId);
}

async function deleteDosingGuideline(id, medicineId) {
  await supabaseClient.from('medicine_dosing_guidelines').delete().eq('id', id);
  await logAudit('DELETE', 'PHARMACY', 'medicine_dosing_guidelines', id, null, null);
  await loadDosingGuidelines(medicineId);
}
// ---------------- CATALOGUE ----------------
async function addMedicine(e) {
  e.preventDefault();
  const payload = {
    generic_name: document.getElementById('m_generic').value.trim(),
    brand_name: document.getElementById('m_brand').value.trim(),
    strength: document.getElementById('m_strength').value.trim(),
    dosage_form: document.getElementById('m_form').value.trim(),
    unit: document.getElementById('m_unit').value.trim() || 'tablet',
    reorder_level: parseInt(document.getElementById('m_reorder').value) || 0,
    default_price: parseFloat(document.getElementById('m_price').value) || 0
  };
  const { data, error } = await supabaseClient.from('medicines').insert(payload).select().single();
  if (error) { alert(error.message); return; }
  await logAudit('CREATE', 'PHARMACY', 'medicines', data.id, null, payload);
  document.getElementById('medForm').reset();
  document.getElementById('m_unit').value = 'tablet';
  document.getElementById('m_price').value = '0';
  await loadCatalogueAndStock();
  await loadAlerts();
}

// ---------------- STOCK ----------------
function openStockForm(medicineId) {
  document.getElementById('stockForm').reset();
  document.getElementById('s_medicine_id').value = medicineId;
  const medicine = medicinesCache.find(m => m.id === medicineId);
  document.getElementById('s_price').value = medicine ? (medicine.default_price || 0) : 0;
  document.getElementById('stockOverlay').style.display = 'flex';
}

// ---------------- EDIT MEDICINE (ADMIN) ----------------
function openEditMedicineForm(medicineId) {
  if (!isPharmAdmin) return;
  const m = medicinesCache.find(x => x.id === medicineId);
  if (!m) return;
  document.getElementById('editMedTitle').textContent = 'Edit medicine — ' + m.generic_name;
  document.getElementById('em_id').value = m.id;
  document.getElementById('em_generic').value = m.generic_name || '';
  document.getElementById('em_brand').value = m.brand_name || '';
  document.getElementById('em_strength').value = m.strength || '';
  document.getElementById('em_form').value = m.dosage_form || '';
  document.getElementById('em_unit').value = m.unit || '';
  document.getElementById('em_reorder').value = m.reorder_level || 0;
  document.getElementById('em_price').value = m.default_price || 0;
  document.getElementById('em_status').value = m.status || 'ACTIVE';
  document.getElementById('editMedOverlay').style.display = 'flex';
}

async function saveMedicineEdit(e) {
  e.preventDefault();
  const id = document.getElementById('em_id').value;
  const payload = {
    generic_name: document.getElementById('em_generic').value.trim(),
    brand_name: document.getElementById('em_brand').value.trim(),
    strength: document.getElementById('em_strength').value.trim(),
    dosage_form: document.getElementById('em_form').value.trim(),
    unit: document.getElementById('em_unit').value.trim() || 'tablet',
    reorder_level: parseInt(document.getElementById('em_reorder').value) || 0,
    default_price: parseFloat(document.getElementById('em_price').value) || 0,
    status: document.getElementById('em_status').value
  };
  const { error } = await supabaseClient.from('medicines').update(payload).eq('id', id);
  if (error) { alert(error.message); return; }
  await logAudit('UPDATE', 'PHARMACY', 'medicines', id, null, payload);
  document.getElementById('editMedOverlay').style.display = 'none';
  await loadCatalogueAndStock();
}

// ---------------- CONTROLLED SUBSTANCE REGISTER ----------------
// Appends one row to the ledger and returns the new balance. Never
// updates or deletes existing rows -- corrections are new rows.
async function recordControlledTransaction({ medicineId, transactionType, quantity, patientId, patientName, prescriptionId, prescriberName, batchId, witnessedBy, reason }) {
  const { data: last } = await supabaseClient
    .from('controlled_substance_register')
    .select('balance_after')
    .eq('medicine_id', medicineId)
    .order('transaction_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  const prevBalance = last ? parseFloat(last.balance_after) : 0;
  const balanceAfter = prevBalance + quantity;

  const { error } = await supabaseClient.from('controlled_substance_register').insert({
    medicine_id: medicineId, transaction_type: transactionType, quantity, balance_after: balanceAfter,
    patient_id: patientId || null, patient_name_snapshot: patientName || null,
    prescription_id: prescriptionId || null, prescriber_name_snapshot: prescriberName || null,
    batch_id: batchId || null, performed_by: meP.id, witnessed_by: witnessedBy || null, reason: reason || null
  });
  if (error) console.error('Controlled substance register write failed:', error.message);
  return balanceAfter;
}

async function loadControlledBalances() {
  const controlledMeds = medicinesCache.filter(m => m.is_controlled);
  const box = document.getElementById('controlledBalances');
  if (controlledMeds.length === 0) { box.innerHTML = '<p class="empty">No medicines are flagged as controlled substances.</p>'; return; }

  const rows = await Promise.all(controlledMeds.map(async m => {
    const { data: last } = await supabaseClient
      .from('controlled_substance_register')
      .select('balance_after')
      .eq('medicine_id', m.id)
      .order('transaction_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    return { name: m.generic_name, balance: last ? last.balance_after : 0 };
  }));

  box.innerHTML = `
    <table>
      <thead><tr><th>Medicine</th><th>Register balance</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td>${r.name}</td><td class="mono">${r.balance}</td></tr>`).join('')}</tbody>
    </table>
    <p class="empty" style="margin-top:8px;">This is the narcotic register balance, tracked separately from general stock quantity — the two should normally match. Investigate any mismatch immediately.</p>
  `;

  if (isPharmAdmin) {
    document.getElementById('controlledAdjustPanel').style.display = 'block';
    document.getElementById('adj_medicine').innerHTML = controlledMeds.map(m => `<option value="${m.id}">${m.generic_name}</option>`).join('');
  }
}

async function loadControlledRegister() {
  const { data } = await supabaseClient
    .from('controlled_substance_register')
    .select('*, medicines(generic_name)')
    .order('transaction_date', { ascending: false })
    .limit(100);

  const tbody = document.getElementById('controlledRegisterTable');
  if (!data || data.length === 0) { tbody.innerHTML = '<tr><td colspan="7" class="empty">No entries yet.</td></tr>'; return; }

  const staffIds = [...new Set(data.flatMap(r => [r.performed_by, r.witnessed_by]).filter(Boolean))];
  const { data: staff } = staffIds.length > 0
    ? await supabaseClient.from('app_users').select('id, full_name').in('id', staffIds)
    : { data: [] };
  const staffName = id => (staff || []).find(s => s.id === id)?.full_name || '—';

  tbody.innerHTML = data.map(r => `
    <tr>
      <td class="mono">${new Date(r.transaction_date).toLocaleString('en-GB')}</td>
      <td>${r.medicines ? r.medicines.generic_name : '—'}</td>
      <td>${r.transaction_type}</td>
      <td class="mono">${r.quantity > 0 ? '+' : ''}${r.quantity}</td>
      <td class="mono">${r.balance_after}</td>
      <td>${r.patient_name_snapshot || '—'}</td>
      <td>${staffName(r.performed_by)}${r.witnessed_by ? ' / witness: ' + staffName(r.witnessed_by) : ''}${r.reason ? '<br><span style="font-size:.8rem; color:var(--hc-ink-soft);">' + r.reason + '</span>' : ''}</td>
    </tr>
  `).join('');
}

async function recordAdjustment(e) {
  e.preventDefault();
  const medicineId = document.getElementById('adj_medicine').value;
  const qty = parseFloat(document.getElementById('adj_qty').value);
  const reason = document.getElementById('adj_reason').value.trim();
  if (!qty || !reason) { alert('Enter a non-zero quantity and a reason.'); return; }

  await recordControlledTransaction({ medicineId, transactionType: 'ADJUSTMENT', quantity: qty, reason });
  await logAudit('ADJUST', 'PHARMACY', 'controlled_substance_register', medicineId, null, { quantity: qty, reason });

  document.getElementById('adjustForm').reset();
  await loadControlledBalances();
  await loadControlledRegister();
}

async function loadWitnessOptions() {
  const { data } = await supabaseClient.from('app_users').select('id, full_name').eq('status', 'ACTIVE').order('full_name');
  document.getElementById('disp_witness').innerHTML = '<option value="">Select witness…</option>' + (data || []).filter(u => u.id !== meP.id).map(u => `<option value="${u.id}">${u.full_name}</option>`).join('');
}

async function saveBatch(e) {
  e.preventDefault();
  const medicineId = document.getElementById('s_medicine_id').value;
  const payload = {
    medicine_id: medicineId,
    batch_number: document.getElementById('s_batch').value.trim(),
    expiry_date: document.getElementById('s_expiry').value,
    quantity: parseInt(document.getElementById('s_qty').value) || 0,
    unit_cost: parseFloat(document.getElementById('s_cost').value) || null,
    selling_price: parseFloat(document.getElementById('s_price').value) || null,
    supplier: document.getElementById('s_supplier').value.trim()
  };
  const { data, error } = await supabaseClient.from('medicine_batches').insert(payload).select().single();
  if (error) { alert(error.message); return; }
  await supabaseClient.from('stock_movements').insert({
    medicine_id: medicineId, batch_id: data.id, movement_type: 'RECEIPT',
    quantity: payload.quantity, reference_type: 'MANUAL', performed_by: meP.id
  });
  await logAudit('CREATE', 'PHARMACY', 'medicine_batches', data.id, null, payload);

  const medicine = medicinesCache.find(m => m.id === medicineId);
  if (medicine && medicine.is_controlled) {
    await recordControlledTransaction({
      medicineId, transactionType: 'RECEIVED', quantity: payload.quantity, batchId: data.id,
      reason: `Stock received — batch ${payload.batch_number || ''}, supplier ${payload.supplier || 'not specified'}`
    });
  }

  document.getElementById('stockOverlay').style.display = 'none';
  await loadCatalogueAndStock();
  await loadAlerts();
  await loadControlledBalances();
}

// ---------------- DISPENSING QUEUE ----------------
async function loadQueue() {
  const { data } = await supabaseClient
    .from('prescriptions')
    .select('*, patients(first_name, last_name, mrn), prescription_items(*)')
    .eq('status', 'PENDING')
    .order('created_at', { ascending: false });

  const box = document.getElementById('queueBody');
  if (!data || data.length === 0) { box.innerHTML = '<p class="empty">No pending prescriptions.</p>'; return; }

  box.innerHTML = data.map(rx => `
    <div class="panel" style="margin-bottom:10px;">
      <div class="panel-header">
        <h3>${rx.patients.first_name} ${rx.patients.last_name} · ${rx.patients.mrn}</h3>
        <span class="mono" style="color:var(--hc-ink-soft); font-size:.82rem;">${rx.prescription_number}</span>
      </div>
      <div class="panel-body">
        ${rx.prescription_items.map(item => `
          <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid var(--hc-line);">
            <div>
              <strong>${item.medicine_name}</strong> — ${item.dose || ''} ${item.route || ''} ${item.frequency || ''} for ${item.duration || ''} (${item.quantity || '—'})
            </div>
            ${item.status === 'DISPENSED'
              ? '<span class="pill active">DISPENSED</span>'
              : `<button class="btn btn-secondary" onclick="openDispenseForm('${item.id}','${rx.id}','${item.medicine_name.replace(/'/g, "\\'")}',${item.quantity ? parseInt(item.quantity) || 1 : 1})">Dispense</button>`}
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}

function openDispenseForm(itemId, prescriptionId, medicineNameHint, qtyHint) {
  document.getElementById('dispenseTitle').textContent = `Dispense — ${medicineNameHint}`;
  document.getElementById('disp_item_id').value = itemId;
  document.getElementById('disp_prescription_id').value = prescriptionId;
  document.getElementById('disp_qty').value = qtyHint || 1;

  const guess = medicinesCache.find(m =>
    medicineNameHint.toLowerCase().includes(m.generic_name.toLowerCase()) ||
    (m.brand_name && medicineNameHint.toLowerCase().includes(m.brand_name.toLowerCase()))
  );
  if (guess) document.getElementById('disp_medicine').value = guess.id;
  updateStockHint();
  toggleWitnessField();

  document.getElementById('dispenseOverlay').style.display = 'flex';
}

async function toggleWitnessField() {
  const medId = document.getElementById('disp_medicine').value;
  const medicine = medicinesCache.find(m => m.id === medId);
  const field = document.getElementById('disp_witness_field');
  if (medicine && medicine.is_controlled) {
    field.style.display = 'block';
    document.getElementById('disp_witness').required = true;
    await loadWitnessOptions();
  } else {
    field.style.display = 'none';
    document.getElementById('disp_witness').required = false;
  }
}

function updateStockHint() {
  const medId = document.getElementById('disp_medicine').value;
  document.getElementById('disp_stock_hint').textContent = medId ? `Available: ${totalStock(medId)}` : '';
}

async function doDispense(e) {
  e.preventDefault();
  const itemId = document.getElementById('disp_item_id').value;
  const prescriptionId = document.getElementById('disp_prescription_id').value;
  const medicineId = document.getElementById('disp_medicine').value;
  const qtyNeeded = parseInt(document.getElementById('disp_qty').value);
  const medicine = medicinesCache.find(m => m.id === medicineId);
  const defaultPrice = medicine ? (medicine.default_price || 0) : 0;

  const available = totalStock(medicineId);
  if (qtyNeeded > available) {
    alert(`Insufficient stock — only ${available} available.`);
    return;
  }

  const witnessId = document.getElementById('disp_witness').value;
  if (medicine && medicine.is_controlled && !witnessId) {
    alert('This is a controlled substance — select a witness before dispensing.');
    return;
  }

  // FEFO: earliest-expiry active batches first
  const eligible = batchesCache
    .filter(b => b.medicine_id === medicineId && b.status === 'ACTIVE' && b.quantity > 0 && new Date(b.expiry_date) >= new Date())
    .sort((a, b) => new Date(a.expiry_date) - new Date(b.expiry_date));

  let remaining = qtyNeeded;
  const deductions = [];
  for (const batch of eligible) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, batch.quantity);
    deductions.push({ batch, take });
    remaining -= take;
  }

  // find or create a dispensation record for this prescription
  let { data: existingDisp } = await supabaseClient.from('dispensations').select('id').eq('prescription_id', prescriptionId).maybeSingle();
  let dispensationId = existingDisp ? existingDisp.id : null;
  if (!dispensationId) {
    const { data: newDisp, error } = await supabaseClient.from('dispensations').insert({
      prescription_id: prescriptionId, dispensed_by: meP.id
    }).select().single();
    if (error) { alert(error.message); return; }
    dispensationId = newDisp.id;
  }

  for (const d of deductions) {
    const newQty = d.batch.quantity - d.take;
    await supabaseClient.from('medicine_batches').update({
      quantity: newQty, status: newQty <= 0 ? 'DEPLETED' : 'ACTIVE'
    }).eq('id', d.batch.id);

    await supabaseClient.from('stock_movements').insert({
      medicine_id: medicineId, batch_id: d.batch.id, movement_type: 'DISPENSING',
      quantity: -d.take, reference_type: 'PRESCRIPTION', reference_id: prescriptionId, performed_by: meP.id
    });

    const unitPrice = d.batch.selling_price || defaultPrice;
    await supabaseClient.from('dispensation_items').insert({
      dispensation_id: dispensationId, prescription_item_id: itemId, medicine_id: medicineId,
      batch_id: d.batch.id, quantity_dispensed: d.take, unit_price: unitPrice, total_price: unitPrice * d.take
    });
  }

  await supabaseClient.from('prescription_items').update({ status: 'DISPENSED' }).eq('id', itemId);
  await logAudit('DISPENSE', 'PHARMACY', 'prescription_items', itemId, null, { medicine_id: medicineId, quantity: qtyNeeded });

  // bill the dispensed items to the encounter's invoice
  const { data: rx } = await supabaseClient.from('prescriptions').select('patient_id, encounter_id, patients(first_name, last_name), app_users:prescriber_id(full_name)').eq('id', prescriptionId).single();

  if (medicine && medicine.is_controlled && rx) {
    for (const d of deductions) {
      await recordControlledTransaction({
        medicineId, transactionType: 'DISPENSED', quantity: -d.take,
        patientId: rx.patient_id, patientName: rx.patients ? `${rx.patients.first_name} ${rx.patients.last_name}` : null,
        prescriptionId, prescriberName: rx.app_users ? rx.app_users.full_name : null,
        batchId: d.batch.id, witnessedBy: witnessId
      });
    }
    await loadControlledBalances();
    await loadControlledRegister();
  }

  if (rx) {
    const inv = await findOrCreateInvoice(rx.patient_id, rx.encounter_id, meP.facility_id, meP.id);
    if (inv) {
      for (const d of deductions) {
        await addInvoiceItem(inv.id, {
          description: medicine ? medicine.generic_name : 'Medicine',
          quantity: d.take, unit_price: d.batch.selling_price || defaultPrice,
          source_module: 'PHARMACY', source_record_id: itemId
        });
      }
    }
  }

  // if every item on this prescription is now dispensed/cancelled, close the prescription
  const { data: allItems } = await supabaseClient.from('prescription_items').select('status').eq('prescription_id', prescriptionId);
  if (allItems && allItems.every(i => i.status !== 'PENDING')) {
    await supabaseClient.from('prescriptions').update({ status: 'DISPENSED' }).eq('id', prescriptionId);
  }

  document.getElementById('dispenseOverlay').style.display = 'none';
  await loadCatalogueAndStock();
  await loadAlerts();
  await loadQueue();
}
