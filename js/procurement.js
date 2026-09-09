// ==========================================================
// HCMIS — Procurement
// ==========================================================

let mePr = null;
let currentPoId = null;

(async function init() {
  mePr = await requireAuth();
  if (!mePr) return;

  document.getElementById('whoName').textContent = mePr.full_name;
  document.getElementById('whoRole').textContent = mePr.role;
  document.getElementById('facilityName').textContent =
    (mePr.facilities && mePr.facilities.name) ? mePr.facilities.name : 'No facility assigned';

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

  await loadDepartmentOptions();
  await loadSuppliers();
  await loadRequisitions();
  await loadPOs();
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

  alert('Goods received recorded. Remember to add matching stock batches in Pharmacy if these were medicines.');
  await openPoDetail(currentPoId);
  await loadPOs();
}
