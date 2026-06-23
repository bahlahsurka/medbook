import { supabase } from './supabase';

export const DEFAULT_SYSTEMS = [
  { name:'Internal Medicine',           color:'#2563eb', custom:false },
  { name:'Surgery',                     color:'#dc2626', custom:false },
  { name:'Pediatrics',                  color:'#16a34a', custom:false },
  { name:'Obstetrics & Gynecology',     color:'#db2777', custom:false },
  { name:'Psychiatry',                  color:'#7c3aed', custom:false },
  { name:'Emergency Medicine',          color:'#ea580c', custom:false },
  { name:'Family Medicine',             color:'#0891b2', custom:false },
  { name:'Cardiology',                  color:'#dc2626', custom:false },
  { name:'Pulmonology',                 color:'#2563eb', custom:false },
  { name:'Gastroenterology',            color:'#d97706', custom:false },
  { name:'Nephrology',                  color:'#7c3aed', custom:false },
  { name:'Neurology',                   color:'#0891b2', custom:false },
  { name:'Endocrinology',               color:'#ca8a04', custom:false },
  { name:'Hematology & Oncology',       color:'#be123c', custom:false },
  { name:'Infectious Disease',          color:'#15803d', custom:false },
  { name:'Musculoskeletal',             color:'#92400e', custom:false },
  { name:'Dermatology',                 color:'#c026d3', custom:false },
  { name:'Ophthalmology',               color:'#0369a1', custom:false },
  { name:'ENT',                         color:'#065f46', custom:false },
  { name:'Reproductive (Male & Female)',color:'#8e44ad', custom:false },
  { name:'Rheumatology',                color:'#9f1239', custom:false },
  { name:'Pharmacology',                color:'#374151', custom:false },
  { name:'Biostatistics & Epidemiology',color:'#0f766e', custom:false },
  { name:'Ethics & Law',                color:'#4338ca', custom:false },
  { name:'Anatomy',                     color:'#78350f', custom:false },
  { name:'Biochemistry',                color:'#475569', custom:false },
  { name:'Immunology',                  color:'#6d28d9', custom:false },
];

// Load systems from Supabase — falls back to defaults
export async function loadSystems(userId) {
  try {
    const { data, error } = await supabase
      .from('user_systems')
      .select('systems')
      .eq('user_id', userId)
      .single();
    if (error || !data || !data.systems?.length) return DEFAULT_SYSTEMS;
    return data.systems;
  } catch { return DEFAULT_SYSTEMS; }
}

// Save systems to Supabase (upsert)
export async function saveSystems(userId, systems) {
  const { error } = await supabase
    .from('user_systems')
    .upsert({ user_id: userId, systems, updated_at: new Date().toISOString() },
             { onConflict: 'user_id' });
  if (error) throw new Error(error.message);
}
