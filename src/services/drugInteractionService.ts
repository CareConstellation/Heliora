import type { MedicationCheckResult, MedicationConflict } from '@/types';

/**
 * Standard clinical drug-drug interaction pairs and severity.
 */
interface DrugInteractionRule {
  drugA: string[];
  drugB: string[];
  severity: 'severe' | 'moderate' | 'minor';
  title: string;
  description: string;
  recommendation: string;
}

const DRUG_INTERACTION_RULES: DrugInteractionRule[] = [
  {
    drugA: ['warfarin', 'coumadin', 'jantoven'],
    drugB: ['aspirin', 'ibuprofen', 'advil', 'motrin', 'naproxen', 'aleve', 'ketorolac', 'diclofenac'],
    severity: 'severe',
    title: 'High Hemorrhage & Bleeding Risk',
    description: 'Concurrent use of anticoagulants (Warfarin) and NSAIDs/Aspirin significantly increases major GI and systemic bleeding risk.',
    recommendation: 'Avoid combination or use acetaminophen for pain relief under strict INR monitoring.',
  },
  {
    drugA: ['lisinopril', 'enalapril', 'ramipril', 'losartan', 'valsartan'],
    drugB: ['spironolactone', 'eplerenone', 'potassium', 'k-dur'],
    severity: 'severe',
    title: 'Severe Hyperkalemia Risk',
    description: 'Combining ACE inhibitors/ARBs with potassium-sparing diuretics or potassium supplements can lead to life-threatening cardiac arrhythmias.',
    recommendation: 'Check serum potassium and creatinine before initiating; monitor electrolytes closely.',
  },
  {
    drugA: ['methotrexate'],
    drugB: ['ibuprofen', 'naproxen', 'ketorolac', 'amoxicillin'],
    severity: 'severe',
    title: 'Severe Methotrexate Toxicity',
    description: 'NSAIDs or penicillins decrease renal clearance of methotrexate, resulting in severe pancytopenia and toxic accumulation.',
    recommendation: 'Do not co-administer high-dose methotrexate with NSAIDs.',
  },
  {
    drugA: ['sildenafil', 'viagra', 'tadalafil', 'cialis'],
    drugB: ['nitroglycerin', 'nitro', 'isosorbide', 'nitrate'],
    severity: 'severe',
    title: 'Fatal Hypotension Contraindication',
    description: 'PDE5 inhibitors potently amplify nitric oxide hypotensive effects; concurrent nitrate use is strictly contraindicated.',
    recommendation: 'Absolute contraindication. Withhold nitrates for at least 24-48 hours after PDE5 inhibitor use.',
  },
  {
    drugA: ['fluoxetine', 'prozac', 'sertraline', 'zoloft', 'paroxetine', 'citalopram', 'escitalopram'],
    drugB: ['phenelzine', 'tranylcypromine', 'selegiline', 'tramadol', 'linezolid'],
    severity: 'severe',
    title: 'Serotonin Syndrome Warning',
    description: 'Concomitant administration can cause severe serotonin syndrome (hyperthermia, rigidity, autonomic instability).',
    recommendation: 'Observe a 14-day washout period between serotonergic agents and MAOIs.',
  },
  {
    drugA: ['simvastatin', 'zocor', 'lovastatin'],
    drugB: ['clarithromycin', 'erythromycin', 'itraconazole', 'ketoconazole'],
    severity: 'severe',
    title: 'Rhabdomyolysis and Myopathy Risk',
    description: 'Strong CYP3A4 inhibitors dramatically increase statin plasma levels, causing acute rhabdomyolysis and renal failure.',
    recommendation: 'Temporarily suspend statin therapy during macrolide antibiotic course.',
  },
  {
    drugA: ['ciprofloxacin', 'cipro', 'levofloxacin', 'levaquin'],
    drugB: ['antacids', 'calcium', 'magnesium', 'aluminum', 'iron', 'ferrous'],
    severity: 'moderate',
    title: 'Antibiotic Chelation / Absorption Failure',
    description: 'Divalent and trivalent cations bind fluoroquinolones in the GI tract, preventing therapeutic absorption.',
    recommendation: 'Administer fluoroquinolone 2 hours before or 6 hours after cation-containing antacids/supplements.',
  },
  {
    drugA: ['clopidogrel', 'plavix'],
    drugB: ['omeprazole', 'prilosec'],
    severity: 'moderate',
    title: 'Reduced Antiplatelet Activation',
    description: 'Omeprazole inhibits CYP2C19, significantly reducing conversion of clopidogrel to its active antiplatelet metabolite.',
    recommendation: 'Consider pantoprazole or H2-receptor antagonists if acid suppression is needed.',
  },
];

interface AllergyRule {
  allergen: string[];
  conflictingDrugs: string[];
  severity: 'severe' | 'moderate';
  title: string;
  description: string;
}

const ALLERGY_RULES: AllergyRule[] = [
  {
    allergen: ['penicillin', 'penicillins', 'amoxicillin', 'ampicillin'],
    conflictingDrugs: [
      'penicillin',
      'amoxicillin',
      'amoxil',
      'augmentin',
      'ampicillin',
      'piperacillin',
      'zosyn',
      'cephalexin',
      'keflex',
    ],
    severity: 'severe',
    title: 'Anaphylaxis / Severe Allergen Cross-Reactivity',
    description: 'Patient has a documented Penicillin allergy. Proposed prescription contains a beta-lactam antibiotic which may trigger severe anaphylactic reaction.',
  },
  {
    allergen: ['sulfa', 'sulfonamide', 'sulfonamides'],
    conflictingDrugs: ['bactrim', 'septra', 'sulfamethoxazole', 'sulfadiazine', 'celecoxib', 'celebrex'],
    severity: 'severe',
    title: 'Severe Sulfonamide Hypersensitivity',
    description: 'Patient has a documented Sulfa allergy. Risk of severe cutaneous adverse reactions (Stevens-Johnson syndrome / toxic epidermal necrolysis).',
  },
  {
    allergen: ['aspirin', 'nsaid', 'nsaids', 'ibuprofen'],
    conflictingDrugs: ['aspirin', 'ibuprofen', 'advil', 'motrin', 'naproxen', 'aleve', 'ketorolac', 'toradol', 'meloxicam'],
    severity: 'severe',
    title: 'Severe NSAID / Aspirin Hypersensitivity',
    description: 'Patient has documented Aspirin/NSAID allergy. Can induce severe bronchospasm, urticaria, or anaphylaxis.',
  },
  {
    allergen: ['codeine', 'morphine', 'opioids', 'opioid'],
    conflictingDrugs: ['codeine', 'morphine', 'oxycodone', 'percocet', 'hydrocodone', 'vicodin', 'fentanyl', 'tramadol'],
    severity: 'severe',
    title: 'Severe Opioid Reaction Risk',
    description: 'Patient has documented Opioid hypersensitivity. High risk of severe respiratory depression or allergic shock.',
  },
];

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
}

function containsAnyWord(haystack: string, keywords: string[]): boolean {
  const words = normalizeText(haystack).split(/\s+/).filter(Boolean);
  return keywords.some((kw) => {
    const kwNorm = normalizeText(kw).trim();
    if (words.includes(kwNorm)) return true;
    return words.some((w) => w.startsWith(kwNorm) || kwNorm.startsWith(w));
  });
}

/**
 * Automatically cross-checks proposed prescription against active medications and documented patient allergies.
 */
export async function checkMedicationInteractions(params: {
  proposedPrescription: string;
  activeMedications: string[];
  allergies: string[];
}): Promise<MedicationCheckResult> {
  const { proposedPrescription, activeMedications, allergies } = params;
  if (!proposedPrescription || !proposedPrescription.trim()) {
    return {
      hasConflicts: false,
      hasSevereContraindications: false,
      hasAllergyConflicts: false,
      conflicts: [],
    };
  }

  const conflicts: MedicationConflict[] = [];

  // 1. Check Drug-Allergy conflicts
  for (const allergy of allergies) {
    if (!allergy || !allergy.trim()) continue;
    for (const rule of ALLERGY_RULES) {
      const allergyMatches = containsAnyWord(allergy, rule.allergen);
      if (allergyMatches) {
        const drugMatches = containsAnyWord(proposedPrescription, rule.conflictingDrugs);
        if (drugMatches) {
          conflicts.push({
            id: `allergy-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            type: 'allergy_conflict',
            severity: rule.severity,
            drug: proposedPrescription,
            conflictingWith: allergy,
            title: rule.title,
            description: rule.description,
            recommendation: 'Select an alternative medication class with no cross-reactivity.',
          });
        }
      }
    }
  }

  // 2. Check Drug-Drug interaction conflicts with active medications
  for (const activeMed of activeMedications) {
    if (!activeMed || !activeMed.trim()) continue;

    for (const rule of DRUG_INTERACTION_RULES) {
      const matchA =
        containsAnyWord(proposedPrescription, rule.drugA) &&
        containsAnyWord(activeMed, rule.drugB);
      const matchB =
        containsAnyWord(proposedPrescription, rule.drugB) &&
        containsAnyWord(activeMed, rule.drugA);

      if (matchA || matchB) {
        conflicts.push({
          id: `interaction-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          type: 'drug_interaction',
          severity: rule.severity,
          drug: proposedPrescription,
          conflictingWith: activeMed,
          title: rule.title,
          description: rule.description,
          recommendation: rule.recommendation,
        });
      }
    }
  }

  const hasSevereContraindications = conflicts.some(
    (c) => c.severity === 'severe' && c.type === 'drug_interaction',
  );
  const hasAllergyConflicts = conflicts.some((c) => c.type === 'allergy_conflict');

  return {
    hasConflicts: conflicts.length > 0,
    hasSevereContraindications,
    hasAllergyConflicts,
    conflicts,
  };
}
