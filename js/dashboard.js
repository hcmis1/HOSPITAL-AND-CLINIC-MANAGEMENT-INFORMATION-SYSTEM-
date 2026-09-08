// ==========================================================
// HCMIS — Dashboard
// ==========================================================

const ROLE_LABELS = {
  SUPER_ADMIN: 'Super Administrator',
  FACILITY_ADMIN: 'Facility Administrator',
  MEDICAL_DIRECTOR: 'Medical Director',
  DOCTOR: 'Doctor',
  CLINICAL_OFFICER: 'Clinical Officer',
  NURSE: 'Nurse',
  MIDWIFE: 'Midwife',
  LAB_TECH: 'Laboratory Technologist',
  RADIOGRAPHER: 'Radiographer',
  PHARMACIST: 'Pharmacist',
  CASHIER: 'Cashier',
  ACCOUNTANT: 'Accountant',
  HR_OFFICER: 'HR Officer',
  RECEPTIONIST: 'Receptionist'
};

(async function init() {
  const appUser = await requireAuth();
  if (!appUser) return;

  document.getElementById('todayDate').textContent = new Date().toLocaleDateString('en-GB', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  document.getElementById('greeting').textContent = `Welcome, ${appUser.full_name.split(' ')[0]}`;
  document.getElementById('whoName').textContent = appUser.full_name;
  document.getElementById('whoRole').textContent = ROLE_LABELS[appUser.role] || appUser.role;
  document.getElementById('facilityName').textContent =
    (appUser.facilities && appUser.facilities.name) ? appUser.facilities.name : 'No facility assigned';

  const isAdmin = ['SUPER_ADMIN', 'FACILITY_ADMIN'].includes(appUser.role);

  if (isAdmin) {
    document.getElementById('adminNavGroup').style.display = 'block';
    document.getElementById('adminStats').style.display = 'grid';
    loadAdminStats(appUser);
    document.getElementById('workspaceMsg').textContent =
      'Use Administration in the sidebar to manage facilities, departments, users and view the audit trail.';
  } else {
    document.getElementById('workspaceMsg').textContent =
      `Your ${ROLE_LABELS[appUser.role] || appUser.role} workspace modules will appear here as they are built.`;
  }
})();

async function loadAdminStats(appUser) {
  const isSuper = appUser.role === 'SUPER_ADMIN';

  let facQuery = supabaseClient.from('facilities').select('id', { count: 'exact', head: true });
  let deptQuery = supabaseClient.from('departments').select('id', { count: 'exact', head: true });
  let userQuery = supabaseClient.from('app_users').select('id', { count: 'exact', head: true }).eq('status', 'ACTIVE');

  if (!isSuper && appUser.facility_id) {
    deptQuery = deptQuery.eq('facility_id', appUser.facility_id);
    userQuery = userQuery.eq('facility_id', appUser.facility_id);
  }

  const [fac, dept, users] = await Promise.all([facQuery, deptQuery, userQuery]);

  document.getElementById('statFacilities').textContent = isSuper ? (fac.count ?? 0) : 1;
  document.getElementById('statDepartments').textContent = dept.count ?? 0;
  document.getElementById('statUsers').textContent = users.count ?? 0;
}
