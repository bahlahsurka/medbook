// lib/landingImages.js
//
// Central asset config for the public landing page's "Medicine is visual"
// section (LandingPage.js's VisualLearning composition). Every image file
// lives in public/images/landing/ — swapping one out later means dropping
// in a new file there and updating its `src` here; nothing in
// LandingPage.js itself needs to change.
//
// These are real, licensed medical diagrams supplied for this section, not
// placeholders — but the shape below (src/alt/caption) is exactly what a
// future replacement needs to fill in, so a not-yet-available image can be
// added the same way once it exists. Every entry needs real, concise alt
// text: these are genuine medical diagrams carrying real information, not
// decoration, so a screen reader visitor needs to get the same idea from
// the alt text that a sighted visitor gets from looking at the image.

export const LANDING_IMAGES = {
  heartFailurePathway: {
    src: '/images/landing/heart-failure-pathogenesis.jpg',
    alt: 'Flowchart of the pathogenesis of decompensated heart failure: decreased cardiac output triggers sympathetic nervous system, renin-angiotensin system and antidiuretic hormone activation, driving increased heart rate, vasoconstriction and extracellular volume to maintain blood pressure, at the cost of long-term deleterious cardiac remodeling.',
    caption: 'Clinical pathway · Cardiology',
  },
  circleOfWillis: {
    src: '/images/landing/circle-of-willis-anatomy.jpg',
    alt: 'Labeled diagram of the circle of Willis and cerebral circulation, showing the anterior and posterior cerebral arteries, middle cerebral artery, communicating arteries, and the basilar and vertebral arteries.',
    caption: 'Anatomy diagram · Neurology',
  },
  hivAntiviral: {
    src: '/images/landing/hiv-antiviral-therapy-mechanism.jpg',
    alt: 'Diagram of the HIV replication cycle and antiviral drug classes acting at each stage: fusion and entry inhibitors, reverse transcriptase inhibitors, integrase inhibitors and protease inhibitors, alongside other antiviral drug targets.',
    caption: 'Pharmacology · Infectious Disease',
  },
  skinImmunology: {
    src: '/images/landing/skin-uv-melanoma-immunology.jpg',
    alt: 'Cross-section of skin under UV light showing epidermis, dermis and subcutaneous tissue, with a melanoma and hair follicle, alongside T-cell, Merkel cell and B-cell illustrations.',
    caption: 'Illustration · Dermatology',
  },
  cancerImmunology: {
    src: '/images/landing/cancer-immunology-tcell-recognition.jpg',
    alt: 'Diagram showing a DNA mutation leading to a mutant peptide displayed on a cancer cell surface, which a T-cell recognises while unmutated cells go unrecognised.',
    caption: 'Immunology · Oncology',
  },
  postCardiacInjury: {
    src: '/images/landing/post-cardiac-injury-pathway.jpg',
    alt: 'Pathway diagram of retained pericardial blood breaking down into oxyhemoglobin, methemoglobin and reactive oxygen species, damaging the myocardial cell membrane and releasing myoglobin, troponin-I and CK-MB, contributing to post-operative atrial fibrillation.',
    caption: 'Pathophysiology · Cardiology',
  },
};
