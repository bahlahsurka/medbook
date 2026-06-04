export const SYSTEMS = [
  'Internal Medicine','Surgery','Pediatrics','Obstetrics & Gynecology',
  'Psychiatry','Emergency Medicine','Family Medicine',
  'Cardiology','Pulmonology','Gastroenterology','Nephrology',
  'Neurology','Endocrinology','Hematology & Oncology','Infectious Disease',
  'Musculoskeletal','Dermatology','Ophthalmology','ENT','Urology','Rheumatology',
  'Pharmacology','Biostatistics & Epidemiology','Ethics & Law','Anatomy',
  'Biochemistry','Immunology'
];

export const SYS_COLOR = {
  'Internal Medicine':'#2563eb','Surgery':'#dc2626','Pediatrics':'#16a34a',
  'Obstetrics & Gynecology':'#db2777','Psychiatry':'#7c3aed',
  'Emergency Medicine':'#ea580c','Family Medicine':'#0891b2',
  'Cardiology':'#dc2626','Pulmonology':'#2563eb','Gastroenterology':'#d97706',
  'Nephrology':'#7c3aed','Neurology':'#0891b2','Endocrinology':'#ca8a04',
  'Hematology & Oncology':'#be123c','Infectious Disease':'#15803d',
  'Musculoskeletal':'#92400e','Dermatology':'#c026d3','Ophthalmology':'#0369a1',
  'ENT':'#065f46','Urology':'#1d4ed8','Rheumatology':'#9f1239',
  'Pharmacology':'#374151','Biostatistics & Epidemiology':'#0f766e',
  'Ethics & Law':'#4338ca','Anatomy':'#78350f','Biochemistry':'#475569',
  'Immunology':'#6d28d9'
};

export const DIFFICULTY = ['Easy','Medium','Hard','Flagged'];
export const DIFF_COLOR = { Easy:'#16a34a', Medium:'#d97706', Hard:'#dc2626', Flagged:'#7c3aed' };

const SYS_KEY = 'medbook_systems_v1';

export function loadUserSystems() {
  try {
    const raw = localStorage.getItem(SYS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return SYSTEMS.map(name => ({ name, color: SYS_COLOR[name] || '#2563eb', custom: false }));
}

export function saveUserSystems(list) {
  try { localStorage.setItem(SYS_KEY, JSON.stringify(list)); } catch {}
}
