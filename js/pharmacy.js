// ==========================================================
// HCMIS — Pharmacy
// ==========================================================

let meP = null;
let medicinesCache = [];
let batchesCache = [];

(async function init() {
  meP = await requireAuth();
  if (!meP) return;

  document.getElementById('whoName').textContent = meP.full_name;
  document.getElementById('whoRole').textContent = meP.role;
  document.getElementById('facilityName').textContent =
    (meP.facilities && meP.facilities.name) ? meP.facilities.name : 'No facility assigned';
  if (['SUPER_ADMIN', 'FACILITY_ADMIN'].includes(meP.role)) {
    document.getElementById('adminNavGroup').style.display = 'block';
  }

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${btn.dataset.tab}`));
    });
  });

  document.getElementById('medForm').addEventListener('submit', addMedicine);
  document.getElementById('stockForm').addEventListener('submit', saveBatch);
  document.getElementById('cancelStockBtn').addEventListener('click', () => document.getElementById('stockOverlay').style.display = 'none');
  document.getElementById('dispenseForm').addEventListener('submit', doDispense);
  document.getElementById('cancelDispenseBtn').addEventListener('click', () => document.getElementById('dispenseOverlay').style.display = 'none');
  document.getElementById('disp_medicine').addEventListener('change', updateStockHint);

  await loadCatalogueAndStock();
  await loadAlerts();
  await loadQueue();
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
  if (medicinesCache.length === 0) { tbody.innerHTML = '<tr><td colspan="6" class="empty">No medicines in catalogue yet.</td></tr>'; return; }
  tbody.innerHTML = medicinesCache.map(m => `
    <tr>
      <td>${m.generic_name}${m.brand_name ? ' (' + m.brand_name + ')' : ''}</td>
      <td>${m.strength || '—'}</td>
      <td>${m.dosage_form || '—'}</td>
      <td class="mono">${totalStock(m.id)} ${m.unit}</td>
      <td>${m.reorder_level}</td>
      <td><button class="link-btn" onclick="openStockForm('${m.id}')">Add stock</button></td>
    </tr>
  `).join('');

  const sel = document.getElementById('disp_medicine');
  sel.innerHTML = medicinesCache.map(m => `<option value="${m.id}">${m.generic_name}${m.strength ? ' ' + m.strength : ''}${m.brand_name ? ' (' + m.brand_name + ')' : ''}</option>`).join('');
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

// ---------------- CATALOGUE ----------------
async function addMedicine(e) {
  e.preventDefault();
  const payload = {
    generic_name: document.getElementById('m_generic').value.trim(),
    brand_name: document.getElementById('m_brand').value.trim(),
    strength: document.getElementById('m_strength').value.trim(),
    dosage_form: document.getElementById('m_form').value.trim(),
    unit: document.getElementById('m_unit').value.trim() || 'tablet',
    reorder_level: parseInt(document.getElementById('m_reorder').value) || 0
  };
  const { data, error } = await supabaseClient.from('medicines').insert(payload).select().single();
  if (error) { alert(error.message); return; }
  await logAudit('CREATE', 'PHARMACY', 'medicines', data.id, null, payload);
  document.getElementById('medForm').reset();
  document.getElementById('m_unit').value = 'tablet';
  await loadCatalogueAndStock();
  await loadAlerts();
}

// ---------------- STOCK ----------------
function openStockForm(medicineId) {
  document.getElementById('stockForm').reset();
  document.getElementById('s_medicine_id').value = medicineId;
  document.getElementById('stockOverlay').style.display = 'flex';
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

  document.getElementById('stockOverlay').style.display = 'none';
  await loadCatalogueAndStock();
  await loadAlerts();
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

  document.getElementById('dispenseOverlay').style.display = 'flex';
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

  const available = totalStock(medicineId);
  if (qtyNeeded > available) {
    alert(`Insufficient stock — only ${available} available.`);
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

    const unitPrice = d.batch.selling_price || 0;
    await supabaseClient.from('dispensation_items').insert({
      dispensation_id: dispensationId, prescription_item_id: itemId, medicine_id: medicineId,
      batch_id: d.batch.id, quantity_dispensed: d.take, unit_price: unitPrice, total_price: unitPrice * d.take
    });
  }

  await supabaseClient.from('prescription_items').update({ status: 'DISPENSED' }).eq('id', itemId);
  await logAudit('DISPENSE', 'PHARMACY', 'prescription_items', itemId, null, { medicine_id: medicineId, quantity: qtyNeeded });

  // bill the dispensed items to the encounter's invoice
  const { data: rx } = await supabaseClient.from('prescriptions').select('patient_id, encounter_id').eq('id', prescriptionId).single();
  if (rx) {
    const medicine = medicinesCache.find(m => m.id === medicineId);
    const inv = await findOrCreateInvoice(rx.patient_id, rx.encounter_id, meP.facility_id, meP.id);
    if (inv) {
      for (const d of deductions) {
        await addInvoiceItem(inv.id, {
          description: medicine ? medicine.generic_name : 'Medicine',
          quantity: d.take, unit_price: d.batch.selling_price || 0,
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
