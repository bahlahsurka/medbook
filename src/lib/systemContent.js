// lib/systemContent.js
//
// Static, factual, editorial-style content for the System page hero — NOT
// user data, NOT fabricated statistics. A concise one-line description of
// what each of the app's built-in default systems covers (museum-wall-label
// style), plus an optional pairing to one of the real medical diagrams
// already supplied for the public landing page's "Medicine is visual"
// section (lib/landingImages.js) — reused here as a very subtle, low-
// opacity background treatment for the handful of systems where a genuine
// visual match exists. Every other system (a custom name, or simply one
// without a mapped image) falls back to a pure colour-wash hero instead —
// nothing below is required for the System hero to render correctly.
import { LANDING_IMAGES } from './landingImages';

export const SYSTEM_BLURBS = {
  'Internal Medicine': 'Adult general medicine — the connective tissue between every organ system.',
  'Surgery': 'Operative and perioperative care, from indication to recovery.',
  'Pediatrics': 'Growth, development, and disease across infancy through adolescence.',
  'Obstetrics & Gynecology': 'Pregnancy, childbirth, and the reproductive health of women.',
  'Psychiatry': 'Mood, thought, and behaviour — the diagnosis and treatment of mental illness.',
  'Emergency Medicine': 'Acute presentations, rapid triage, and time-critical decisions.',
  'Family Medicine': 'Continuity of care across ages, from prevention to chronic disease.',
  'Cardiology': 'The heart and vasculature — rhythm, perfusion, and failure.',
  'Pulmonology': 'Gas exchange, airway disease, and the mechanics of breathing.',
  'Gastroenterology': 'The gut and liver, and the disorders of digestion and absorption.',
  'Nephrology': 'Filtration, fluid balance, and the physiology of the kidney.',
  'Neurology': 'The brain, spinal cord, and peripheral nerves in health and disease.',
  'Endocrinology': 'Hormones, glands, and the systems they regulate.',
  'Hematology & Oncology': 'Blood disorders and the biology of malignancy.',
  'Infectious Disease': 'Pathogens, host defence, and the treatment of infection.',
  'Musculoskeletal': 'Bones, joints, and the mechanics of movement.',
  'Dermatology': 'The skin — its structure, its diseases, and how they present.',
  'Ophthalmology': 'Vision and the structures of the eye.',
  'ENT': "Ear, nose, and throat — the head and neck's sensory organs.",
  'Reproductive (Male & Female)': 'The reproductive organs and their disorders.',
  'Rheumatology': 'Autoimmune and inflammatory disease of joints and connective tissue.',
  'Pharmacology': 'Mechanisms, interactions, and the logic of drug therapy.',
  'Biostatistics & Epidemiology': 'Study design, data, and population-level disease patterns.',
  'Ethics & Law': 'The principles and obligations that govern clinical practice.',
  'Anatomy': 'The structure of the human body, region by region.',
  'Biochemistry': 'The molecular machinery underlying physiology and disease.',
  'Immunology': "The body's defence systems, and how they can misfire.",
};

// Only a genuine visual match, reused from an asset already in the app —
// never a generic stock photo. Absent for every system without one; the
// hero's own colour wash already carries the page on its own in that case.
export const SYSTEM_HERO_IMAGE = {
  'Dermatology': LANDING_IMAGES.skinImmunology,
  'Cardiology': LANDING_IMAGES.heartFailurePathway,
  'Neurology': LANDING_IMAGES.circleOfWillis,
  'Infectious Disease': LANDING_IMAGES.hivAntiviral,
  'Hematology & Oncology': LANDING_IMAGES.cancerImmunology,
};
