// ==========================================================
// HCMIS — Wards & Beds
// ==========================================================

let meW = null;
let wardsCache = [];
let roomsCache = [];

(async function init() {
  meW = await requireAuth();
  if (!meW) return;

  document.getElementById('whoName').textContent = meW.full_name;
  document.getElementById('whoRole').textContent = meW.role;
  document.getElementById('facilityName').textContent =
    (meW.facilities && meW.facilities.name) ? meW.facilities.name : 'No facility assigned';
  if (['SUPER_ADMIN', 'FACILITY_ADMIN'].includes(meW.role)) {
    document.getElementById('adminNavGroup').style.display = 'block';
  }

  document.getElementById('wardForm').addEventListener('submit', addWard);
  document.getElementById('roomForm').addEventListener('submit', addRoom);
  document.getElementById('bedForm').addEventListener('submit', addBed);

  await loadAll();
})();

async function loadAll() {
  const { data: wards } = await supabaseClient.from('wards').select('*').order('name');
  wardsCache = wards || [];
  document.getElementById('r_ward').innerHTML = wardsCache.map(w => `<option value="${w.id}">${w.name}</option>`).join('') || '<option value="">Add a ward first</option>';

  const { data: rooms } = await supabaseClient.from('rooms').select('*, wards(name)').order('room_number');
  roomsCache = rooms || [];
  document.getElementById('b_room').innerHTML = roomsCache.map(r => `<option value="${r.id}">${r.wards ? r.wards.name : ''} — ${r.room_number}</option>`).join('') || '<option value="">Add a room first</option>';

  await renderBedMap();
}

async function addWard(e) {
  e.preventDefault();
  const payload = {
    facility_id: meW.facility_id || null,
    name: document.getElementById('w_name').value.trim(),
    ward_type: document.getElementById('w_type').value.trim(),
    gender: document.getElementById('w_gender').value,
    capacity: parseInt(document.getElementById('w_capacity').value) || 0
  };
  const { data, error } = await supabaseClient.from('wards').insert(payload).select().single();
  if (error) { alert(error.message); return; }
  await logAudit('CREATE', 'HOSPITAL', 'wards', data.id, null, payload);
  document.getElementById('wardForm').reset();
  await loadAll();
}

async function addRoom(e) {
  e.preventDefault();
  const wardId = document.getElementById('r_ward').value;
  if (!wardId) { alert('Add a ward first.'); return; }
  const payload = {
    ward_id: wardId,
    room_number: document.getElementById('r_number').value.trim(),
    room_type: document.getElementById('r_type').value.trim(),
    capacity: parseInt(document.getElementById('r_capacity').value) || 1
  };
  const { data, error } = await supabaseClient.from('rooms').insert(payload).select().single();
  if (error) { alert(error.message); return; }
  await logAudit('CREATE', 'HOSPITAL', 'rooms', data.id, null, payload);
  document.getElementById('roomForm').reset();
  await loadAll();
}

async function addBed(e) {
  e.preventDefault();
  const roomId = document.getElementById('b_room').value;
  if (!roomId) { alert('Add a room first.'); return; }
  const payload = {
    room_id: roomId,
    bed_number: document.getElementById('b_number').value.trim(),
    bed_type: document.getElementById('b_type').value.trim()
  };
  const { data, error } = await supabaseClient.from('beds').insert(payload).select().single();
  if (error) { alert(error.message); return; }
  await logAudit('CREATE', 'HOSPITAL', 'beds', data.id, null, payload);
  document.getElementById('bedForm').reset();
  await renderBedMap();
}

async function renderBedMap() {
  const box = document.getElementById('bedMap');
  if (wardsCache.length === 0) { box.innerHTML = '<p class="empty">No wards set up yet.</p>'; return; }

  const { data: beds } = await supabaseClient.from('beds').select('*, rooms(room_number, ward_id)');
  let html = '';
  for (const ward of wardsCache) {
    const wardRooms = roomsCache.filter(r => r.ward_id === ward.id);
    const wardBeds = (beds || []).filter(b => wardRooms.some(r => r.id === b.room_id));
    const occupied = wardBeds.filter(b => b.status === 'OCCUPIED').length;
    html += `<h4 style="margin-top:18px;">${ward.name} <span style="color:var(--hc-ink-soft); font-weight:400; font-size:.85rem;">(${occupied}/${wardBeds.length} occupied)</span></h4>`;
    if (wardBeds.length === 0) { html += '<p class="empty">No beds added yet.</p>'; continue; }
    html += '<div class="bed-grid">' + wardBeds.map(b => {
      const room = wardRooms.find(r => r.id === b.room_id);
      return `<div class="bed-tile bed-${b.status}"><span class="num">${room ? room.room_number : ''}-${b.bed_number}</span>${b.status}</div>`;
    }).join('') + '</div>';
  }
  box.innerHTML = html;
}
