/**
 * Privacy-Preserving Clinical Translation Pipeline
 *
 * Implements client-side, zero-telemetry translation of decrypted clinical records
 * for cross-border patients and migrant health initiatives (Issue #76).
 *
 * Privacy Guarantees:
 * - 100% In-Memory / Client-Side Execution: Decrypted Protected Health Information (PHI)
 *   never leaves the patient's browser. Zero network calls or external APIs are used.
 * - PII Sanitization: Neutralizes sensitive patterns before term tokenization.
 * - Deterministic In-Memory Caching: LRU cache avoids re-computation and eliminates memory leaks.
 *
 * Complexity Design:
 * - Time Complexity: O(N) where N is the character/token length of the clinical text;
 *   O(1) for repeated translations via memoized hash cache.
 * - Space Complexity: O(N) for string representation and bounded O(K) cache memory.
 */

import type { MedicalRecord } from '@/types';

export type SupportedLanguage = 'es' | 'fr' | 'ar' | 'pt' | 'de' | 'zh' | 'sw';

export interface LanguageMeta {
  code: SupportedLanguage;
  name: string;
  nativeName: string;
  flag: string;
  dir: 'ltr' | 'rtl';
}

export const SUPPORTED_LANGUAGES: LanguageMeta[] = [
  { code: 'es', name: 'Spanish', nativeName: 'Español', flag: '🇪🇸', dir: 'ltr' },
  { code: 'fr', name: 'French', nativeName: 'Français', flag: '🇫🇷', dir: 'ltr' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', flag: '🇸🇦', dir: 'rtl' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português', flag: '🇵🇹', dir: 'ltr' },
  { code: 'de', name: 'German', nativeName: 'Deutsch', flag: '🇩🇪', dir: 'ltr' },
  { code: 'zh', name: 'Chinese', nativeName: '中文 (简体)', flag: '🇨🇳', dir: 'ltr' },
  { code: 'sw', name: 'Swahili', nativeName: 'Kiswahili', flag: '🇰🇪', dir: 'ltr' },
];

export const MANDATORY_TRANSLATION_WATERMARK = 'Automated translation — verify with physician';

export interface TranslatedMedicalRecord {
  originalRecordId: string;
  targetLanguage: SupportedLanguage;
  languageMeta: LanguageMeta;
  translatedAt: string;
  watermark: string;
  diagnosis: string;
  prescription?: string;
  notes?: string;
  labels: {
    encounterDate: string;
    physician: string;
    diagnosis: string;
    prescription: string;
    clinicalNotes: string;
    certifiedOriginal: string;
    automatedTranslation: string;
    disclaimer: string;
  };
}

/**
 * Localized clinical UI labels
 */
const UI_LABELS: Record<SupportedLanguage, TranslatedMedicalRecord['labels']> = {
  es: {
    encounterDate: 'Fecha de consulta',
    physician: 'Médico tratante',
    diagnosis: 'Diagnóstico clínico',
    prescription: 'Prescripción médica',
    clinicalNotes: 'Notas clínicas',
    certifiedOriginal: 'Registro clínico certificado original',
    automatedTranslation: 'Traducción clínica automatizada',
    disclaimer: 'Traducción automatizada — verifique con su médico',
  },
  fr: {
    encounterDate: 'Date de consultation',
    physician: 'Médecin traitant',
    diagnosis: 'Diagnostic clinique',
    prescription: 'Ordonnance médicale',
    clinicalNotes: 'Observations cliniques',
    certifiedOriginal: 'Dossier clinique original certifié',
    automatedTranslation: 'Traduction clinique automatisée',
    disclaimer: 'Traduction automatisée — à vérifier auprès du médecin',
  },
  ar: {
    encounterDate: 'تاريخ المقابلة السريرية',
    physician: 'الطبيب المعالج',
    diagnosis: 'التشخيص السريري',
    prescription: 'الوصفة الطبية',
    clinicalNotes: 'الملاحظات السريرية',
    certifiedOriginal: 'السجل الطبي المعتمد الأصلي',
    automatedTranslation: 'الترجمة السريرية الآلية',
    disclaimer: 'ترجمة آلية — يرجى التأكيد مع الطبيب المعالج',
  },
  pt: {
    encounterDate: 'Data da consulta',
    physician: 'Médico assistente',
    diagnosis: 'Diagnóstico clínico',
    prescription: 'Prescrição médica',
    clinicalNotes: 'Notas clínicas',
    certifiedOriginal: 'Registro clínico original certificado',
    automatedTranslation: 'Tradução clínica automatizada',
    disclaimer: 'Tradução automatizada — confirme com o médico',
  },
  de: {
    encounterDate: 'Behandlungsdatum',
    physician: 'Behandelnder Arzt',
    diagnosis: 'Klinische Diagnose',
    prescription: 'Medizinisches Rezept',
    clinicalNotes: 'Klinische Notizen',
    certifiedOriginal: 'Zertifizierte Original-Krankenakte',
    automatedTranslation: 'Automatische klinische Übersetzung',
    disclaimer: 'Automatische Übersetzung — mit dem Arzt abgleichen',
  },
  zh: {
    encounterDate: '就诊日期',
    physician: '主治医师',
    diagnosis: '临床诊断',
    prescription: '处方记录',
    clinicalNotes: '临床病程记录',
    certifiedOriginal: '原始认证医疗记录',
    automatedTranslation: '自动临床翻译',
    disclaimer: '自动翻译 — 请与主治医生核实',
  },
  sw: {
    encounterDate: 'Tarehe ya uchunguzi',
    physician: 'Daktari anayehusika',
    diagnosis: 'Utambuzi wa kimatibabu',
    prescription: 'Maagizo ya dawa',
    clinicalNotes: 'Maelezo ya kimatibabu',
    certifiedOriginal: 'Kumbukumbu halisi ya kimatibabu',
    automatedTranslation: 'Tafsiri ya kiotomatiki ya kimatibabu',
    disclaimer: 'Tafsiri ya mashine — thibitisha na daktari',
  },
};

/**
 * Curated Medical Terminology & Phrase Dictionary
 * Mapped across target languages for accurate clinical context.
 * Aligned with the international ICD-10-CM and SNOMED-CT taxonomies in DIAGNOSIS_CODES.
 */
const CLINICAL_LEXICON: Record<string, Record<SupportedLanguage, string>> = {
  // ICD-10 & SNOMED-CT Aligned Diagnoses
  'essential (primary) hypertension': {
    es: 'Hipertensión arterial esencial (primaria)',
    fr: 'Hypertension artérielle essentielle (primitive)',
    ar: 'ارتفاع ضغط الدم الأساسي (الأولي)',
    pt: 'Hipertensão arterial essencial (primária)',
    de: 'Essenzielle (primäre) Hypertonie',
    zh: '原发性高血压',
    sw: 'Shinikizo la juu la damu la msingi',
  },
  'essential hypertension': {
    es: 'Hipertensión arterial esencial',
    fr: 'Hypertension artérielle essentielle',
    ar: 'ارتفاع ضغط الدم الأساسي',
    pt: 'Hipertensão arterial primária',
    de: 'Essenzielle Hypertonie',
    zh: '原发性高血压',
    sw: 'Shinikizo la juu la damu la msingi',
  },
  'hypertensive disorder': {
    es: 'Trastorno hipertensivo',
    fr: 'Trouble hypertensif',
    ar: 'اضطراب ارتفاع ضغط الدم',
    pt: 'Distúrbio hipertensivo',
    de: 'Hypertensive Erkrankung',
    zh: '高血压性疾病',
    sw: 'Ugonjwa wa shinikizo la juu la damu',
  },
  'hypertension': {
    es: 'Hipertensión',
    fr: 'Hypertension',
    ar: 'ارتفاع ضغط الدم',
    pt: 'Hipertensão',
    de: 'Hypertonie',
    zh: '高血压',
    sw: 'Shinikizo la juu la damu',
  },
  'type 2 diabetes mellitus without complications': {
    es: 'Diabetes mellitus tipo 2 sin complicaciones',
    fr: 'Diabète de type 2 sans complication',
    ar: 'مرض السكري من النوع الثاني دون مضاعفات',
    pt: 'Diabetes mellitus tipo 2 sem complicações',
    de: 'Diabetes mellitus Typ 2 ohne Komplikationen',
    zh: '2型糖尿病，无并发症',
    sw: 'Kisukari cha aina ya 2 kisicho na matatizo mengine',
  },
  'type 2 diabetes mellitus': {
    es: 'Diabetes mellitus tipo 2',
    fr: 'Diabète de type 2',
    ar: 'مرض السكري من النوع الثاني',
    pt: 'Diabetes mellitus tipo 2',
    de: 'Diabetes mellitus Typ 2',
    zh: '2型糖尿病',
    sw: 'Kisukari cha aina ya 2',
  },
  'diabetes mellitus type 2': {
    es: 'Diabetes mellitus tipo 2',
    fr: 'Diabète de type 2',
    ar: 'مرض السكري من النوع الثاني',
    pt: 'Diabetes mellitus tipo 2',
    de: 'Diabetes mellitus Typ 2',
    zh: '2型糖尿病',
    sw: 'Kisukari cha aina ya 2',
  },
  'diabetes mellitus': {
    es: 'Diabetes mellitus',
    fr: 'Diabète sucré',
    ar: 'مرض السكري',
    pt: 'Diabetes mellitus',
    de: 'Diabetes mellitus',
    zh: '糖尿病',
    sw: 'Ugonjwa wa kisukari',
  },
  'unspecified asthma, uncomplicated': {
    es: 'Asma no especificada, no complicada',
    fr: 'Asthme non précisé, sans complication',
    ar: 'الربو غير المحدد، غير المصحوب بمضاعفات',
    pt: 'Asma não especificada, não complicada',
    de: 'Nicht näher bezeichnetes Asthma, unkompliziert',
    zh: '未特指的哮喘，无并发症',
    sw: 'Pumu isiyojulikana, bila matatizo',
  },
  'acute upper respiratory infection, unspecified': {
    es: 'Infección aguda de las vías respiratorias superiores, no especificada',
    fr: 'Infection aiguë des voies respiratoires supérieures, sans précision',
    ar: 'عدوى حادة في الجهاز التنفسي العلوي، غير محددة',
    pt: 'Infecção aguda das vias aéreas superiores, não especificada',
    de: 'Akute Infektion der oberen Atemwege, nicht näher bezeichnet',
    zh: '急性上呼吸道感染，未特指',
    sw: 'Maambukizi ya ghafla ya njia ya juu ya hewa',
  },
  'upper respiratory infection': {
    es: 'Infección de las vías respiratorias superiores',
    fr: 'Infection des voies respiratoires supérieures',
    ar: 'عدوى الجهاز التنفسي العلوي',
    pt: 'Infecção das vias aéreas superiores',
    de: 'Infektion der oberen Atemwege',
    zh: '上呼吸道感染',
    sw: 'Maambukizi ya njia ya hewa',
  },
  'acute bronchitis': {
    es: 'Bronquitis aguda',
    fr: 'Bronchite aiguë',
    ar: 'التهاب الشعب الهوائية الحاد',
    pt: 'Bronquite aguda',
    de: 'Akute Bronchitis',
    zh: '急性支气管炎',
    sw: 'Homa ya mapafu ya ghafla',
  },
  'asthma': {
    es: 'Asma bronquial',
    fr: 'Asthme bronchique',
    ar: 'الربو القصبي',
    pt: 'Asma brônquica',
    de: 'Bronchialasthma',
    zh: '支气管哮喘',
    sw: 'Pumu ya kifua',
  },
  'bronchial asthma': {
    es: 'Asma bronquial',
    fr: 'Asthme bronchique',
    ar: 'الربو القصبي',
    pt: 'Asma brônquica',
    de: 'Bronchialasthma',
    zh: '支气管哮喘',
    sw: 'Pumu',
  },
  'covid-19': {
    es: 'COVID-19',
    fr: 'COVID-19',
    ar: 'كوفيد-19',
    pt: 'COVID-19',
    de: 'COVID-19',
    zh: '新型冠状病毒感染 (COVID-19)',
    sw: 'COVID-19',
  },
  'covid-19 infection': {
    es: 'Infección por COVID-19',
    fr: 'Infection au COVID-19',
    ar: 'عدوى كوفيد-19',
    pt: 'Infecção por COVID-19',
    de: 'COVID-19-Infektion',
    zh: '新型冠状病毒感染',
    sw: 'Maambukizi ya COVID-19',
  },
  'acute pharyngitis, unspecified': {
    es: 'Faringitis aguda, no especificada',
    fr: 'Pharyngite aiguë, sans précision',
    ar: 'التهاب البلعوم الحاد، غير محدد',
    pt: 'Faringite aguda, não especificada',
    de: 'Akute Pharyngitis, nicht näher bezeichnet',
    zh: '急性咽炎，未特指',
    sw: 'Koo kuwasha na kuwaka ghafla',
  },
  'acute pharyngitis': {
    es: 'Faringitis aguda',
    fr: 'Pharyngite aiguë',
    ar: 'التهاب البلعوم الحاد',
    pt: 'Faringite aguda',
    de: 'Akute Pharyngitis',
    zh: '急性咽炎',
    sw: 'Koo kuwasha na kuwaka ghafla',
  },
  'bacterial infection': {
    es: 'Infección bacteriana',
    fr: 'Infection bactérienne',
    ar: 'عدوى بكتيرية',
    pt: 'Infecção bacteriana',
    de: 'Bakterielle Infektion',
    zh: '细菌感染',
    sw: 'Maambukizi ya bakteria',
  },
  'viral infection': {
    es: 'Infección viral',
    fr: 'Infection virale',
    ar: 'عدوى فيروسية',
    pt: 'Infecção viral',
    de: 'Virale Infektion',
    zh: '病毒感染',
    sw: 'Maambukizi ya virusi',
  },
  'gastroesophageal reflux disease': {
    es: 'Enfermedad por reflujo gastroesofágico (ERGE)',
    fr: 'Reflux gastro-œsophagien (RGO)',
    ar: 'مرض الارتجاع المعدي المريئي',
    pt: 'Doença do refluxo gastroesofágico (DRGE)',
    de: 'Gastroösophageale Refluxkrankheit (GERD)',
    zh: '胃食管反流病',
    sw: 'Ugonjwa wa kiungulia na kurudi kwa asidi',
  },
  'gastro-esophageal reflux disease without esophagitis': {
    es: 'Enfermedad por reflujo gastroesofágico sin esofagitis',
    fr: 'Reflux gastro-œsophagien sans œsophagite',
    ar: 'مرض الارتجاع المعدي المريئي دون التهاب المريء',
    pt: 'Doença do refluxo gastroesofágico sem esofagite',
    de: 'Gastroösophageale Refluxkrankheit ohne Ösophagitis',
    zh: '胃食管反流病，无食管炎',
    sw: 'Ugonjwa wa kiungulia bila kuvimba koo',
  },
  'low back pain, unspecified': {
    es: 'Dolor lumbar, no especificado',
    fr: 'Lombalgie, sans précision',
    ar: 'ألم أسفل الظهر، غير محدد',
    pt: 'Dor lombar, não especificada',
    de: 'Kreuzschmerz, nicht näher bezeichnet',
    zh: '下腰痛，未特指',
    sw: 'Maumivu ya kiuno, yasiyobainishwa',
  },
  'low back pain': {
    es: 'Dolor lumbar',
    fr: 'Lombalgie',
    ar: 'ألم أسفل الظهر',
    pt: 'Dor lombar',
    de: 'Kreuzschmerz',
    zh: '下腰痛',
    sw: 'Maumivu ya kiuno',
  },
  'major depressive disorder, single episode, unspecified': {
    es: 'Trastorno depresivo mayor, episodio único, no especificado',
    fr: 'Trouble dépressif majeur, épisode isolé, sans précision',
    ar: 'اضطراب اكتئابي جسيم، نوبة وحيدة، غير محددة',
    pt: 'Transtorno depressivo maior, episódio único, não especificado',
    de: 'Major Depression, einzelne Episode, nicht näher bezeichnet',
    zh: '重度抑郁障碍，单次发作，未特指',
    sw: 'Ugonjwa mkubwa wa sonona, awamu moja',
  },
  'depressive disorder': {
    es: 'Trastorno depresivo',
    fr: 'Trouble dépressif',
    ar: 'اضطراب اكتئابي',
    pt: 'Transtorno depressivo',
    de: 'Depressive Störung',
    zh: '抑郁障碍',
    sw: 'Ugonjwa wa sonona',
  },
  'generalized anxiety disorder': {
    es: 'Trastorno de ansiedad generalizada',
    fr: 'Trouble anxiété généralisée',
    ar: 'اضطراب القلق العام',
    pt: 'Transtorno de ansiedade generalizada',
    de: 'Generalisierte Angststörung',
    zh: '广泛性焦虑障碍',
    sw: 'Wasiwasi uliokithiri wa jumla',
  },
  'anxiety disorder': {
    es: 'Trastorno de ansiedad',
    fr: 'Trouble anxieux',
    ar: 'اضطراب القلق',
    pt: 'Transtorno de ansiedade',
    de: 'Angststörung',
    zh: '焦虑障碍',
    sw: 'Ugonjwa wa wasiwasi',
  },
  'hyperlipidemia, unspecified': {
    es: 'Hiperlipidemia, no especificada',
    fr: 'Hyperlipidémie, sans précision',
    ar: 'فرط شحميات الدم، غير محدد',
    pt: 'Hiperlipidemia, não especificada',
    de: 'Hyperlipidämie, nicht näher bezeichnet',
    zh: '高脂血症，未特指',
    sw: 'Kiwango cha juu cha mafuta ya damu',
  },
  'hyperlipidemia': {
    es: 'Hiperlipidemia',
    fr: 'Hyperlipidémie',
    ar: 'فرط شحميات الدم',
    pt: 'Hiperlipidemia',
    de: 'Hyperlipidämie',
    zh: '高脂血症',
    sw: 'Kiwango cha juu cha mafuta mwilini',
  },
  'urinary tract infection, site not specified': {
    es: 'Infección de las vías urinarias, localización no especificada',
    fr: 'Infection des voies urinaires, siège non précisé',
    ar: 'عدوى المسالك البولية، موقع غير محدد',
    pt: 'Infecção do trato urinário, local não especificado',
    de: 'Harnwegsinfektion, Lokalisation nicht näher bezeichnet',
    zh: '泌尿道感染，部位未特指',
    sw: 'Maambukizi ya mfumo wa mkojo',
  },
  'urinary tract infectious disease': {
    es: 'Infección de las vías urinarias',
    fr: 'Infection des voies urinaires',
    ar: 'عدوى المسالك البولية',
    pt: 'Infecção do trato urinário',
    de: 'Harnwegsinfektion',
    zh: '泌尿系统感染',
    sw: 'Ugonjwa wa maambukizi ya mfumo wa mkojo',
  },
  'headache, unspecified': {
    es: 'Cefalea, no especificada',
    fr: 'Céphalée, sans précision',
    ar: 'صداع، غير محدد',
    pt: 'Cefaleia, não especificada',
    de: 'Kopfschmerz, nicht näher bezeichnet',
    zh: '头痛，未特指',
    sw: 'Kuumwa kichwa',
  },
  'headache': {
    es: 'Cefalea (dolor de cabeza)',
    fr: 'Céphalée',
    ar: 'صداع',
    pt: 'Cefaleia',
    de: 'Kopfschmerz',
    zh: '头痛',
    sw: 'Kichwa kuuma',
  },
  'migraine, unspecified, not intractable, without status migrainosus': {
    es: 'Migraña, no especificada, no intratable, sin estado de mal migrañoso',
    fr: 'Migraine, sans précision, non réfractaire, sans état de mal migraineux',
    ar: 'صداع نصفي، غير محدد، غير مستعصٍ، دون حالة شقيقة مستمرة',
    pt: 'Enxaqueca, não especificada, não intratável, sem estado migranoso',
    de: 'Migräne, nicht näher bezeichnet, nicht therapieresistent',
    zh: '偏头痛，未特指，非难治性',
    sw: 'Kuumwa kichwa upande mmoja bila matatizo makubwa',
  },
  'migraine': {
    es: 'Migraña',
    fr: 'Migraine',
    ar: 'الصداع النصفي',
    pt: 'Enxaqueca',
    de: 'Migräne',
    zh: '偏头痛',
    sw: 'Kuumwa kichwa upande mmoja',
  },
  'hypothyroidism, unspecified': {
    es: 'Hipotiroidismo, no especificado',
    fr: 'Hypothyroïdie, sans précision',
    ar: 'قصور الغدة الدرقية، غير محدد',
    pt: 'Hipotireoidismo, não especificado',
    de: 'Hypothyreose, nicht näher bezeichnet',
    zh: '甲状腺功能减退症，未特指',
    sw: 'Upungufu wa tezi ya dundumio',
  },
  'anemia, unspecified': {
    es: 'Anemia, no especificada',
    fr: 'Anémie, sans précision',
    ar: 'فقر الدم، غير محدد',
    pt: 'Anemia, não especificada',
    de: 'Anämie, nicht näher bezeichnet',
    zh: '贫血，未特指',
    sw: 'Upungufu wa damu',
  },
  'chronic obstructive pulmonary disease, unspecified': {
    es: 'Enfermedad pulmonar obstructiva crónica, no especificada',
    fr: 'Bronchopneumopathie chronique obstructive, sans précision',
    ar: 'مرض الانسداد الرئوي المزمن، غير محدد',
    pt: 'Doença pulmonar obstrutiva crônica, não especificada',
    de: 'Chronische obstruktive Lungenkrankheit, nicht näher bezeichnet',
    zh: '慢性阻塞性肺疾病，未特指',
    sw: 'Ugonjwa sugu wa kuzuia mapafu',
  },
  'obesity, unspecified': {
    es: 'Obesidad, no especificada',
    fr: 'Obésité, sans précision',
    ar: 'السمنة، غير محددة',
    pt: 'Obesidade, não especificada',
    de: 'Adipositas, nicht näher bezeichnet',
    zh: '肥胖症，未特指',
    sw: 'Unene uliokithiri',
  },
  'cough, unspecified': {
    es: 'Tos, no especificada',
    fr: 'Toux, sans précision',
    ar: 'سعال، غير محدد',
    pt: 'Tosse, não especificada',
    de: 'Husten, nicht näher bezeichnet',
    zh: '咳嗽，未特指',
    sw: 'Kikohozi',
  },
  'fever, unspecified': {
    es: 'Fiebre, no especificada',
    fr: 'Fièvre, sans précision',
    ar: 'حمى، غير محددة',
    pt: 'Febre, não especificada',
    de: 'Fieber, nicht näher bezeichnet',
    zh: '发热，未特指',
    sw: 'Homa',
  },
  'pneumonia, unspecified organism': {
    es: 'Neumonía, organismo no especificado',
    fr: 'Pneumonie à micro-organisme non précisé',
    ar: 'الالتهاب الرئوي، كائن حي غير محدد',
    pt: 'Pneumonia por microorganismo não especificado',
    de: 'Pneumonie, nicht näher bezeichneter Erreger',
    zh: '肺炎，未特指病原体',
    sw: 'Nimonia',
  },
  'pneumonia': {
    es: 'Neumonía',
    fr: 'Pneumonie',
    ar: 'الالتهاب الرئوي',
    pt: 'Pneumonia',
    de: 'Lungenentzündung',
    zh: '肺炎',
    sw: 'Nimonia',
  },
  'chronic kidney disease, unspecified': {
    es: 'Enfermedad renal crónica, no especificada',
    fr: 'Maladie rénale chronique, sans précision',
    ar: 'مرض الكلى المزمن، غير محدد',
    pt: 'Doença renal crônica, não especificada',
    de: 'Chronische Nierenkrankheit, nicht näher bezeichnet',
    zh: '慢性肾脏病，未特指',
    sw: 'Ugonjwa sugu wa figo',
  },
  'insomnia, unspecified': {
    es: 'Insomnio, no especificado',
    fr: 'Insomnie, sans précision',
    ar: 'أرق، غير محدد',
    pt: 'Insônia, não especificada',
    de: 'Schlaflosigkeit, nicht näher bezeichnet',
    zh: '失眠症，未特指',
    sw: 'Kukosa usingizi',
  },
  'unspecified osteoarthritis, unspecified site': {
    es: 'Osteoartritis no especificada, sitio no especificado',
    fr: 'Arthrose sans précision, siège non précisé',
    ar: 'التهاب المفاصل العظمي غير المحدد، موقع غير محدد',
    pt: 'Osteoartrite não especificada, localização não especificada',
    de: 'Nicht näher bezeichnete Arthrose, Lokalisation nicht näher bezeichnet',
    zh: '骨关节炎，未特指部位',
    sw: 'Maumivu ya viungo vya mifupa',
  },
  'osteoarthritis': {
    es: 'Osteoartritis',
    fr: 'Arthrose',
    ar: 'التهاب المفاصل العظمي',
    pt: 'Osteoartrite',
    de: 'Arthrose',
    zh: '骨关节炎',
    sw: 'Maumivu ya viungo vya mifupa',
  },
  'encounter for general adult medical examination without abnormal findings': {
    es: 'Consulta para examen médico general de adultos sin hallazgos anormales',
    fr: 'Examen médical général d’adulte sans anomalie détectée',
    ar: 'مقابلة لفحص طبي عام للبالغين دون وجود نتائج غير طبيعية',
    pt: 'Consulta para exame médico geral de adulto sem achados anormais',
    de: 'Allgemeine medizinische Untersuchung bei Erwachsenen ohne auffälligen Befund',
    zh: '成人一般健康体检，无异常发现',
    sw: 'Uchunguzi wa jumla wa afya bila matatizo yoyote',
  },

  // Clinical Observations & Phrases
  'routine checkup completed': {
    es: 'Chequeo de rutina completado',
    fr: 'Bilan de santé régulier terminé',
    ar: 'تم الفحص الدوري الروتيني بنجاح',
    pt: 'Exame de rotina concluído',
    de: 'Routinemäßige Kontrolluntersuchung abgeschlossen',
    zh: '常规健康检查已完成',
    sw: 'Uchunguzi wa kawaida umekamilika',
  },
  'patient presented with mild fatigue': {
    es: 'El paciente se presentó con fatiga leve',
    fr: 'Le patient a présenté une légère fatigue',
    ar: 'حضر المريض يعاني من إجهاد خفيف',
    pt: 'Paciente apresentou fadiga leve',
    de: 'Patient stellte sich mit leichter Müdigkeit vor',
    zh: '患者就诊时主诉轻度乏力',
    sw: 'Mgonjwa alifika akiwa na uchovu mdogo',
  },
  'patient presented with': {
    es: 'El paciente se presentó con',
    fr: 'Le patient a présenté',
    ar: 'حضر المريض وهو يعاني من',
    pt: 'Paciente apresentou',
    de: 'Patient stellte sich vor mit',
    zh: '患者就诊时表现为',
    sw: 'Mgonjwa alifika akiwa na',
  },
  'confirmed stage 1 resolution with clean margins': {
    es: 'Se confirmó resolución de etapa 1 con márgenes limpios',
    fr: 'Résolution de stade 1 confirmée avec marges saines',
    ar: 'تم تأكيد زوال المرحلة الأولى مع هوامش سليمة ونظيفة',
    pt: 'Confirmada resolução de estágio 1 com margens livres',
    de: 'Bestätigte Remission im Stadium 1 mit sauberen Rändern',
    zh: '确认为1期病变缓解，切缘阴性干净',
    sw: 'Imethibitishwa hatua ya 1 kuondoka kukiwa na mipaka safi',
  },
  'recommended follow-up in 3 months': {
    es: 'Se recomendó seguimiento en 3 meses',
    fr: 'Suivi recommandé dans 3 mois',
    ar: 'يوصى بالمتابعة خلال 3 أشهر',
    pt: 'Acompanhamento recomendado em 3 meses',
    de: 'Wiedervorstellung in 3 Monaten empfohlen',
    zh: '建议3个月后随访复查',
    sw: 'Inashauriwa kurudi kufanyiwa uchunguzi baada ya miezi 3',
  },
  'vital signs stable': {
    es: 'Signos vitales estables',
    fr: 'Signes vitaux stables',
    ar: 'العلامات الحيوية مستقرة',
    pt: 'Sinais vitais estáveis',
    de: 'Vitale Parameter stabil',
    zh: '生命体征平稳',
    sw: 'Hali ya afya na mapigo viko shwari',
  },
  'no acute distress': {
    es: 'Sin angustia aguda',
    fr: 'Pas de détresse aiguë',
    ar: 'لا توجد علامات ضيق حاد',
    pt: 'Sem sofrimento agudo',
    de: 'Kein akuter Leidensdruck',
    zh: '无急性病容',
    sw: 'Hakuna dhiki kali ya dharura',
  },
  'clean margins': {
    es: 'márgenes limpios',
    fr: 'marges saines',
    ar: 'هوامش نظيفة وسليمة',
    pt: 'margens limpas',
    de: 'saubere Resektionsränder',
    zh: '切缘干净',
    sw: 'mipaka safi',
  },
  'recommended rest and hydration': {
    es: 'Se recomienda reposo e hidratación abundante',
    fr: 'Repos et hydratation recommandés',
    ar: 'ينصح بالراحة وشرب السوائل بكميات وافرة',
    pt: 'Recomenda-se repouso e hidratação',
    de: 'Ruhe und ausreichende Flüssigkeitszufuhr empfohlen',
    zh: '建议充分休息和补充水分',
    sw: 'Pumzika vya kutosha na unywe maji mengi',
  },
  'continue current medication': {
    es: 'Continuar con la medicación actual',
    fr: 'Poursuivre le traitement actuel',
    ar: 'الاستمرار على العلاج الدوائي الحالي',
    pt: 'Continuar com a medicação atual',
    de: 'Aktuelle Medikation fortführen',
    zh: '继续服用当前药物',
    sw: 'Endelea kutumia dawa za sasa',
  },
  'mild fatigue': {
    es: 'fatiga leve',
    fr: 'légère fatigue',
    ar: 'إرهاق خفيف',
    pt: 'fadiga leve',
    de: 'leichte Müdigkeit',
    zh: '轻度乏力',
    sw: 'uchovu mdogo',
  },
  'fever': {
    es: 'Fiebre',
    fr: 'Fièvre',
    ar: 'حمى',
    pt: 'Febre',
    de: 'Fieber',
    zh: '发热',
    sw: 'Homa',
  },
  'chest pain': {
    es: 'Dolor torácico',
    fr: 'Douleur thoracique',
    ar: 'ألم في الصدر',
    pt: 'Dor no peito',
    de: 'Brustschmerzen',
    zh: '胸痛',
    sw: 'Maumivu ya kifua',
  },
  'shortness of breath': {
    es: 'Dificultad respiratoria',
    fr: 'Essoufflement',
    ar: 'ضيق في التنفس',
    pt: 'Falta de ar',
    de: 'Kurzatmigkeit',
    zh: '呼吸急促',
    sw: 'Pumzi fupi',
  },

  // Prescriptions, Dosages & Regimens
  'take 1 tablet daily': {
    es: 'Tomar 1 comprimido al día',
    fr: 'Prendre 1 comprimé par jour',
    ar: 'تناول قرص واحد يومياً',
    pt: 'Tomar 1 comprimido ao dia',
    de: '1 Tablette täglich einnehmen',
    zh: '每日服用1片',
    sw: 'Meza kidonge 1 kila siku',
  },
  'orally twice daily': {
    es: 'por vía oral dos veces al día',
    fr: 'par voie orale deux fois par jour',
    ar: 'عن طريق الفم مرتين يومياً',
    pt: 'por via oral duas vezes ao dia',
    de: 'zweimal täglich oral',
    zh: '口服，每日两次',
    sw: 'kwa mdomo mara mbili kwa siku',
  },
  'twice daily': {
    es: 'dos veces al día',
    fr: 'deux fois par jour',
    ar: 'مرتين يومياً',
    pt: 'duas vezes ao dia',
    de: 'zweimal täglich',
    zh: '每日两次',
    sw: 'mara mbili kwa siku',
  },
  'once daily': {
    es: 'una vez al día',
    fr: 'une fois par jour',
    ar: 'مرة واحدة يومياً',
    pt: 'uma vez ao dia',
    de: 'einmal täglich',
    zh: '每日一次',
    sw: 'mara moja kwa siku',
  },
  'with food': {
    es: 'con alimentos',
    fr: 'avec de la nourriture',
    ar: 'مع وجبة الطعام',
    pt: 'com alimentos',
    de: 'mit den Mahlzeiten',
    zh: '随餐服用',
    sw: 'pamoja na chakula',
  },
  'at bedtime': {
    es: 'al acostarse',
    fr: 'au coucher',
    ar: 'عند النوم',
    pt: 'ao deitar',
    de: 'vor dem Schlafengehen',
    zh: '睡前服用',
    sw: 'wakati wa kulala',
  },
  'for 7 days': {
    es: 'durante 7 días',
    fr: 'pendant 7 jours',
    ar: 'لمدة 7 أيام',
    pt: 'durante 7 dias',
    de: 'für 7 Tage',
    zh: '持续7天',
    sw: 'kwa siku 7',
  },
  'for 10 days': {
    es: 'durante 10 días',
    fr: 'pendant 10 jours',
    ar: 'لمدة 10 أيام',
    pt: 'durante 10 dias',
    de: 'für 10 Tage',
    zh: '持续10天',
    sw: 'kwa siku 10',
  },
  'as needed for pain': {
    es: 'según sea necesario para el dolor',
    fr: 'au besoin en cas de douleur',
    ar: 'عند الحاجة لتسكين الألم',
    pt: 'conforme necessário para dor',
    de: 'bei Bedarf gegen Schmerzen',
    zh: '疼痛时按需服用',
    sw: 'ikihitajika kwa maumivu',
  },
  'every 8 hours': {
    es: 'cada 8 horas',
    fr: 'toutes les 8 heures',
    ar: 'كل 8 ساعات',
    pt: 'a cada 8 horas',
    de: 'alle 8 Stunden',
    zh: '每8小时一次',
    sw: 'kila masaa 8',
  },
  'every 12 hours': {
    es: 'cada 12 horas',
    fr: 'toutes les 12 heures',
    ar: 'كل 12 ساعة',
    pt: 'a cada 12 horas',
    de: 'alle 12 Stunden',
    zh: '每12小时一次',
    sw: 'kila masaa 12',
  },
};

/**
 * LRU In-Memory Translation Cache
 * Bounded to 128 entries to guarantee O(1) retrieval and prevent memory bloat.
 */
class TranslationCache {
  private cache = new Map<string, string>();
  private readonly maxSize = 128;

  get(key: string): string | undefined {
    const val = this.cache.get(key);
    if (val !== undefined) {
      // Refresh recency
      this.cache.delete(key);
      this.cache.set(key, val);
    }
    return val;
  }

  set(key: string, value: string): void {
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(key, value);
  }

  clear(): void {
    this.cache.clear();
  }
}

const memoryCache = new TranslationCache();

/**
 * Sanitizes input text to neutralize accidentally embedded identity tokens or sensitive numbers
 * while preserving valid clinical dosages and terms.
 * Time Complexity: O(N) single-pass regex replacement.
 */
function sanitizeClinicalText(text: string): string {
  if (!text) return '';
  return text
    // Redact credit cards or 16-digit patterns if accidentally present
    .replace(/\b(?:\d{4}[-\s]?){3}\d{4}\b/g, '[REDACTED_NUM]')
    // Redact SSN-like patterns (XXX-XX-XXXX)
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[REDACTED_ID]');
}

/**
 * Deterministic clinical phrase translation engine.
 * Matches multi-word medical idioms and clinical terms in order of decreasing length.
 * Time Complexity: O(M * N) where M is dictionary count and N is text length.
 * Space Complexity: O(N) for translated string.
 */
export function translateClinicalText(text: string, targetLang: SupportedLanguage): string {
  if (!text || !text.trim()) return '';

  const cacheKey = `${targetLang}:${text.trim()}`;
  const cached = memoryCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const sanitized = sanitizeClinicalText(text);

  // Exact match fast path
  const lowerExact = sanitized.trim().toLowerCase();
  if (CLINICAL_LEXICON[lowerExact]?.[targetLang]) {
    const translatedExact = CLINICAL_LEXICON[lowerExact][targetLang];
    memoryCache.set(cacheKey, translatedExact);
    return translatedExact;
  }

  // Tokenize and replace multi-word and clinical dictionary phrases
  // Sort keys descending by length so longer multi-word phrases match first
  const sortedTerms = Object.keys(CLINICAL_LEXICON).sort((a, b) => b.length - a.length);

  let result = sanitized;
  for (const term of sortedTerms) {
    const replacement = CLINICAL_LEXICON[term]?.[targetLang];
    if (!replacement) continue;

    // Case-insensitive boundary match
    const regex = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    result = result.replace(regex, replacement);
  }

  memoryCache.set(cacheKey, result);
  return result;
}

/**
 * Translates an entire decrypted clinical record object into the target language.
 * Completely client-side, zero external data leakage.
 *
 * Time Complexity: O(N) where N is the total text volume of diagnosis + prescription + notes.
 * Space Complexity: O(N) returning a typed TranslatedMedicalRecord.
 */
export function translateMedicalRecord(
  record: MedicalRecord,
  targetLang: SupportedLanguage
): TranslatedMedicalRecord {
  const languageMeta =
    SUPPORTED_LANGUAGES.find((lang) => lang.code === targetLang) || SUPPORTED_LANGUAGES[0];

  const translatedDiagnosis = translateClinicalText(record.diagnosis, targetLang);
  const translatedPrescription = record.prescription
    ? translateClinicalText(record.prescription, targetLang)
    : undefined;
  const translatedNotes = record.notes
    ? translateClinicalText(record.notes, targetLang)
    : undefined;

  return {
    originalRecordId: record.id,
    targetLanguage: targetLang,
    languageMeta,
    translatedAt: new Date().toISOString(),
    watermark: MANDATORY_TRANSLATION_WATERMARK,
    diagnosis: translatedDiagnosis,
    prescription: translatedPrescription,
    notes: translatedNotes,
    labels: UI_LABELS[targetLang] || UI_LABELS.es,
  };
}
