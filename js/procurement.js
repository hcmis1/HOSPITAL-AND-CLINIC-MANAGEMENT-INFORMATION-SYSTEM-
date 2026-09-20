// ==========================================================
// HCMIS — Procurement
// ==========================================================

let mePr = null;
let currentPoId = null;
let isProcAdmin = false;

(async function init() {
  mePr = await requireAuth();
  if (!mePr) return;

  document.getElementById('whoName').textContent = mePr.full_name;
  document.getElementById('whoRole').textContent = mePr.role;
  document.getElementById('facilityName').textContent =
    (mePr.facilities && mePr.facilities.name) ? mePr.facilities.name : 'No facility assigned';
  isProcAdmin = ['SUPER_ADMIN', 'FACILITY_ADMIN'].includes(mePr.role);

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${btn.dataset.tab}`));
    });
  });

  document.getElementById('reqForm').addEventListener('submit', submitRequisition);
  document.getElementById('supplierForm').addEventListener('submit', submitSupplier);
  document.getElementById('poForm').addEventListener('submit', createPO);
  document.getElementById('addPoItemBtn').addEventListener('click', addPoItem);
  document.getElementById('markSentBtn').addEventListener('click', markSent);
  document.getElementById('receiveGoodsBtn').addEventListener('click', recordGoodsReceived);

  document.getElementById('storeItemForm').addEventListener('submit', addStoreItem);
  document.getElementById('storeBatchForm').addEventListener('submit', receiveStoreBatch);
  document.getElementById('storeIssueForm').addEventListener('submit', issueStoreStock);

  await loadDepartmentOptions();
  await loadSuppliers();
  await loadRequisitions();
  await loadPOs();
  await loadStoreCatalogue();
  await loadRecentIssuances();
})();

async function loadDepartmentOptions() {
  let query = supabaseClient.from('departments').select('id, name').order('name');
  if (mePr.facility_id) query = query.eq('facility_id', mePr.facility_id);
  const { data } = await query;
  document.getElementById('rq_department').innerHTML = '<option value="">— none —</option>' + (data || []).map(d => `<option value="${d.id}">${d.name}</option>`).join('');
}

// ---------------- REQUISITIONS ----------------
async function submitRequisition(e) {
  e.preventDefault();
  const payload = {
    requested_by: mePr.id,
    department_id: document.getElementById('rq_department').value || null,
    item_description: document.getElementById('rq_item').value.trim(),
    quantity: parseFloat(document.getElementById('rq_qty').value) || 1,
    justification: document.getElementById('rq_justification').value.trim()
  };
  const { data, error } = await supabaseClient.from('purchase_requisitions').insert(payload).select().single();
  if (error) { alert(error.message); return; }
  await logAudit('CREATE', 'PROCUREMENT', 'purchase_requisitions', data.id, null, payload);
  document.getElementById('reqForm').reset();
  await loadRequisitions();
}

async function loadRequisitions() {
  const { data } = await supabaseClient.from('purchase_requisitions').select('*').order('created_at', { ascending: false }).limit(50);
  const tbody = document.getElementById('reqTable');
  if (!data || data.length === 0) { tbody.innerHTML = '<tr><td colspan="5" class="empty">No requisitions yet.</td></tr>'; return; }

  tbody.innerHTML = data.map(r => `
    <tr>
      <td class="mono">${r.requisition_number}</td>
      <td>${r.item_description}</td>
      <td>${r.quantity}</td>
      <td><span class="pill ${r.status === 'APPROVED' ? 'active' : (r.status === 'REJECTED' ? 'inactive' : 'inactive')}">${r.status}</span></td>
      <td>${r.status === 'PENDING' ? `
        <button class="link-btn" onclick="decideRequisition('${r.id}','APPROVED')">Approve</button> ·
        <button class="link-btn danger" onclick="decideRequisition('${r.id}','REJECTED')">Reject</button>` : ''}</td>
    </tr>
  `).join('');

  const approved = data.filter(r => r.status === 'APPROVED');
  document.getElementById('po_requisition').innerHTML = '<option value="">— none —</option>' + approved.map(r => `<option value="${r.id}">${r.requisition_number} — ${r.item_description}</option>`).join('');
}

async function decideRequisition(id, status) {
  await supabaseClient.from('purchase_requisitions').update({ status, approved_by: mePr.id }).eq('id', id);
  await logAudit('UPDATE', 'PROCUREMENT', 'purchase_requisitions', id, null, { status });
  await loadRequisitions();
}

// ---------------- SUPPLIERS ----------------
async function submitSupplier(e) {
  e.preventDefault();
  const payload = {
    name: document.getElementById('sp_name').value.trim(),
    contact_person: document.getElementById('sp_contact').value.trim(),
    phone: document.getElementById('sp_phone').value.trim(),
    email: document.getElementById('sp_email').value.trim()
  };
  const { data, error } = await supabaseClient.from('suppliers').insert(payload).select().single();
  if (error) { alert(error.message); return; }
  await logAudit('CREATE', 'PROCUREMENT', 'suppliers', data.id, null, payload);
  document.getElementById('supplierForm').reset();
  await loadSuppliers();
}

async function loadSuppliers() {
  const { data } = await supabaseClient.from('suppliers').select('*').order('name');
  const tbody = document.getElementById('supplierTable');
  document.getElementById('po_supplier').innerHTML = (data || []).map(s => `<option value="${s.id}">${s.name}</option>`).join('') || '<option value="">Add a supplier first</option>';
  if (!data || data.length === 0) { tbody.innerHTML = '<tr><td colspan="4" class="empty">No suppliers yet.</td></tr>'; return; }
  tbody.innerHTML = data.map(s => `<tr><td>${s.name}</td><td>${s.contact_person || '—'}</td><td>${s.phone || '—'}</td><td>${s.email || '—'}</td></tr>`).join('');
}

// ---------------- PURCHASE ORDERS ----------------
async function createPO(e) {
  e.preventDefault();
  const payload = {
    supplier_id: document.getElementById('po_supplier').value,
    requisition_id: document.getElementById('po_requisition').value || null,
    expected_date: document.getElementById('po_expected').value || null,
    created_by: mePr.id
  };
  if (!payload.supplier_id) { alert('Add a supplier first.'); return; }
  const { data, error } = await supabaseClient.from('purchase_orders').insert(payload).select().single();
  if (error) { alert(error.message); return; }
  await logAudit('CREATE', 'PROCUREMENT', 'purchase_orders', data.id, null, payload);
  document.getElementById('poForm').reset();
  await loadPOs();
  openPoDetail(data.id);
}

async function loadPOs() {
  const { data } = await supabaseClient.from('purchase_orders').select('*, suppliers(name)').order('created_at', { ascending: false }).limit(50);
  const tbody = document.getElementById('poTable');
  if (!data || data.length === 0) { tbody.innerHTML = '<tr><td colspan="5" class="empty">No purchase orders yet.</td></tr>'; return; }
  tbody.innerHTML = data.map(po => `
    <tr>
      <td class="mono">${po.po_number}</td>
      <td>${po.suppliers ? po.suppliers.name : '—'}</td>
      <td class="mono">${po.order_date}</td>
      <td><span class="pill ${po.status === 'RECEIVED' ? 'active' : 'inactive'}">${po.status}</span></td>
      <td><button class="link-btn" onclick="openPoDetail('${po.id}')">Open</button></td>
    </tr>
  `).join('');
}

async function openPoDetail(id) {
  currentPoId = id;
  const { data: po } = await supabaseClient.from('purchase_orders').select('*, suppliers(name)').eq('id', id).single();
  if (!po) return;

  document.getElementById('poTitle').textContent = `${po.po_number} — ${po.suppliers ? po.suppliers.name : ''}`;
  const isOpenForItems = po.status === 'DRAFT';
  document.getElementById('poItemFieldset').style.display = isOpenForItems ? 'block' : 'none';
  document.getElementById('markSentBtn').style.display = po.status === 'DRAFT' ? 'inline-flex' : 'none';
  document.getElementById('receiveGoodsBtn').style.display = po.status === 'SENT' ? 'inline-flex' : 'none';

  await loadPoItems(id);
  document.getElementById('poDetail').style.display = 'block';
  document.getElementById('poDetail').scrollIntoView({ behavior: 'smooth' });
}

function closePoDetail() {
  document.getElementById('poDetail').style.display = 'none';
  currentPoId = null;
}

async function loadPoItems(poId) {
  const { data } = await supabaseClient.from('purchase_order_items').select('*').eq('purchase_order_id', poId);
  const box = document.getElementById('poItemsList');
  if (!data || data.length === 0) { box.innerHTML = '<span class="empty">No items added yet.</span>'; return; }
  box.innerHTML = data.map(i => `
    <div class="panel" style="margin-bottom:6px;"><div class="panel-body" style="padding:10px 14px;">
      ${i.description} — Qty ${i.quantity} @ ${i.unit_cost || 0} = ${i.total || 0}
    </div></div>
  `).join('');
}

async function addPoItem() {
  const description = document.getElementById('poi_desc').value.trim();
  const quantity = parseFloat(document.getElementById('poi_qty').value) || 1;
  const unit_cost = parseFloat(document.getElementById('poi_cost').value) || 0;
  if (!description || !currentPoId) return;

  const payload = { purchase_order_id: currentPoId, description, quantity, unit_cost, total: quantity * unit_cost };
  const { data, error } = await supabaseClient.from('purchase_order_items').insert(payload).select().single();
  if (error) { alert(error.message); return; }
  await logAudit('CREATE', 'PROCUREMENT', 'purchase_order_items', data.id, null, payload);

  document.getElementById('poi_desc').value = '';
  document.getElementById('poi_qty').value = '1';
  document.getElementById('poi_cost').value = '';
  await loadPoItems(currentPoId);
}

async function markSent() {
  if (!currentPoId) return;
  await supabaseClient.from('purchase_orders').update({ status: 'SENT' }).eq('id', currentPoId);
  await logAudit('UPDATE', 'PROCUREMENT', 'purchase_orders', currentPoId, null, { status: 'SENT' });
  await openPoDetail(currentPoId);
  await loadPOs();
}

async function recordGoodsReceived() {
  if (!currentPoId) return;
  const { data: items } = await supabaseClient.from('purchase_order_items').select('*').eq('purchase_order_id', currentPoId);
  if (!items || items.length === 0) { alert('No items on this order.'); return; }

  const { data: gr, error } = await supabaseClient.from('goods_received').insert({
    purchase_order_id: currentPoId, received_by: mePr.id
  }).select().single();
  if (error) { alert(error.message); return; }

  for (const item of items) {
    await supabaseClient.from('goods_received_items').insert({
      goods_received_id: gr.id, purchase_order_item_id: item.id, quantity_received: item.quantity, condition: 'GOOD'
    });
  }
  await supabaseClient.from('purchase_orders').update({ status: 'RECEIVED' }).eq('id', currentPoId);
  await logAudit('CREATE', 'PROCUREMENT', 'goods_received', gr.id, null, { purchase_order_id: currentPoId });

  alert('Goods received recorded. Remember to add matching stock in Pharmacy (medicines) or the Inventory/Store tab (general supplies).');
  await openPoDetail(currentPoId);
  await loadPOs();
}

// ---------------- INVENTORY / STORE ----------------
async function addStoreItem(e) {
  e.preventDefault();
  const payload = {
    name: document.getElementById('si_name').value.trim(),
    category: document.getElementById('si_category').value.trim(),
    unit: document.getElementById('si_unit').value.trim() || 'piece',
    reorder_level: parseFloat(document.getElementById('si_reorder').value) || 0
  };
  const { data, error } = await supabaseClient.from('store_items').insert(payload).select().single();
  if (error) { alert(error.message); return; }
  await logAudit('CREATE', 'PROCUREMENT', 'store_items', data.id, null, payload);
  document.getElementById('storeItemForm').reset();
  await loadStoreCatalogue();
}

async function receiveStoreBatch(e) {
  e.preventDefault();
  const quantity = parseFloat(document.getElementById('sb_qty').value);
  const payload = {
    item_id: document.getElementById('sb_item').value,
    quantity_received: quantity,
    quantity_remaining: quantity,
    batch_number: document.getElementById('sb_batch').value.trim(),
    expiry_date: document.getElementById('sb_expiry').value || null,
    unit_cost: parseFloat(document.getElementById('sb_cost').value) || null,
    supplier: document.getElementById('sb_supplier').value.trim(),
    received_by: mePr.id
  };
  const { data, error } = await supabaseClient.from('store_batches').insert(payload).select().single();
  if (error) { alert(error.message); return; }
  await logAudit('CREATE', 'PROCUREMENT', 'store_batches', data.id, null, payload);
  document.getElementById('storeBatchForm').reset();
  await loadStoreCatalogue();
}

async function issueStoreStock(e) {
  e.preventDefault();
  const itemId = document.getElementById('is_item').value;
  let qtyNeeded = parseFloat(document.getElementById('is_qty').value);
  if (!qtyNeeded || qtyNeeded <= 0) { alert('Enter a quantity greater than zero.'); return; }

  const { data: batches } = await supabaseClient.from('store_batches').select('*')
    .eq('item_id', itemId).gt('quantity_remaining', 0)
    .order('expiry_date', { ascending: true, nullsFirst: false })
    .order('received_date', { ascending: true });

  const available = (batches || []).reduce((sum, b) => sum + parseFloat(b.quantity_remaining), 0);
  if (qtyNeeded > available) { alert(`Insufficient stock — only ${available} available.`); return; }

  const department = document.getElementById('is_department').value.trim();
  const issuedTo = document.getElementById('is_to').value.trim();
  const purpose = document.getElementById('is_purpose').value.trim();

  for (const batch of batches) {
    if (qtyNeeded <= 0) break;
    const take = Math.min(qtyNeeded, parseFloat(batch.quantity_remaining));
    await supabaseClient.from('store_batches').update({ quantity_remaining: batch.quantity_remaining - take }).eq('id', batch.id);
    const { data: issuance } = await supabaseClient.from('store_issuances').insert({
      item_id: itemId, batch_id: batch.id, quantity_issued: take,
      department, issued_to: issuedTo, purpose, issued_by: mePr.id
    }).select().single();
    await logAudit('CREATE', 'PROCUREMENT', 'store_issuances', issuance.id, null, { item_id: itemId, quantity: take });
    qtyNeeded -= take;
  }

  document.getElementById('storeIssueForm').reset();
  await loadStoreCatalogue();
  await loadRecentIssuances();
}

async function loadStoreCatalogue() {
  const { data: items } = await supabaseClient.from('store_items').select('*').eq('status', 'ACTIVE').order('name');
  const { data: batches } = await supabaseClient.from('store_batches').select('item_id, quantity_remaining');

  const balances = {};
  (batches || []).forEach(b => { balances[b.item_id] = (balances[b.item_id] || 0) + parseFloat(b.quantity_remaining); });

  const itemSel = document.getElementById('sb_item');
  const issueSel = document.getElementById('is_item');
  if (itemSel) itemSel.innerHTML = (items || []).map(i => `<option value="${i.id}">${i.name}</option>`).join('');
  if (issueSel) issueSel.innerHTML = (items || []).map(i => `<option value="${i.id}">${i.name} (${balances[i.id] || 0} ${i.unit} in stock)</option>`).join('');

  const tbody = document.getElementById('storeStockTable');
  if (!items || items.length === 0) { tbody.innerHTML = '<tr><td colspan="4" class="empty">No items in the store catalogue yet.</td></tr>'; return; }
  tbody.innerHTML = items.map(i => {
    const stock = balances[i.id] || 0;
    const low = stock <= i.reorder_level;
    return `<tr ${low ? 'style="background:#FDECEC;"' : ''}><td>${i.name}${low ? ' <strong>(low)</strong>' : ''}</td><td>${i.category || '—'}</td><td class="mono">${stock} ${i.unit}</td><td>${i.reorder_level}</td></tr>`;
  }).join('');

  const lowStockItems = items.filter(i => (balances[i.id] || 0) <= i.reorder_level);
  const lowPanel = document.getElementById('lowStockPanel');
  if (lowStockItems.length > 0) {
    lowPanel.style.display = 'block';
    document.getElementById('lowStockList').innerHTML = lowStockItems.map(i =>
      `<span class="pill inactive" style="margin:2px;">${i.name}: ${balances[i.id] || 0} ${i.unit} left (reorder at ${i.reorder_level})</span>`
    ).join(' ');
  } else {
    lowPanel.style.display = 'none';
  }
}

async function loadRecentIssuances() {
  const { data } = await supabaseClient
    .from('store_issuances')
    .select('*, store_items(name), app_users(full_name)')
    .order('issued_at', { ascending: false })
    .limit(30);

  const tbody = document.getElementById('storeIssuanceTable');
  if (!data || data.length === 0) { tbody.innerHTML = '<tr><td colspan="6" class="empty">No issuances recorded yet.</td></tr>'; return; }
  tbody.innerHTML = data.map(r => `
    <tr>
      <td class="mono">${new Date(r.issued_at).toLocaleString('en-GB')}</td>
      <td>${r.store_items ? r.store_items.name : '—'}</td>
      <td class="mono">${r.quantity_issued}</td>
      <td>${r.department || '—'}</td>
      <td>${r.issued_to || '—'}</td>
      <td>${r.app_users ? r.app_users.full_name : '—'}</td>
    </tr>
  `).join('');
}
