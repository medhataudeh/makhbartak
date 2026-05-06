import type {
  Test, Package, Order, Notification, Patient, Address,
  Coupon, SystemSettings, Nurse, AdminStats, Instruction,
  ShiftConfig, TestCategory, SliderItem, AdminUser, Invoice,
  ActivityLog, SvgIcon, AdminRole, OrderResultFile,
  NurseGamification, NurseLevel, NurseBadge, NurseRoute,
  GamificationConfig, Lab, LabUser, LabPriceAgreement,
  LabSettlement, LabSettlementItem, ContentPage, OrderRating,
  LibraryInstruction, LibraryTool, NurseChecklistDefaults,
  AuthUser,
} from "./types";
import { ROLE_PERMISSIONS } from "./types";

// Reproducible Picsum seeds keyed to a healthcare/clinical mood.
// In production, these would be replaced with real CDN-hosted product images
// uploaded by the content admin.
const img = (seed: string, w: number, h: number) =>
  `https://picsum.photos/seed/${seed}/${w}/${h}`;

// ─── Test Categories ────────────────────────────────────────────────────────
export const TEST_CATEGORIES: TestCategory[] = [
  { id: "cat-1", nameAr: "هرمونات", nameEn: "Hormones" },
  { id: "cat-2", nameAr: "كيمياء الدم", nameEn: "Blood Chemistry" },
  { id: "cat-3", nameAr: "تعداد الدم", nameEn: "CBC" },
  { id: "cat-4", nameAr: "فيتامينات", nameEn: "Vitamins" },
  { id: "cat-5", nameAr: "الغدة الدرقية", nameEn: "Thyroid" },
  { id: "cat-6", nameAr: "السكري", nameEn: "Diabetes" },
  { id: "cat-7", nameAr: "الكلى", nameEn: "Kidney" },
  { id: "cat-8", nameAr: "الكبد", nameEn: "Liver" },
];

// ─── Tests ──────────────────────────────────────────────────────────────────
export const MOCK_TESTS: Test[] = [
  {
    id: "t-1", nameAr: "تعداد الدم الكامل", nameEn: "Complete Blood Count",
    shortName: "CBC", aliasesAr: ["فحص الدم", "صورة الدم الكاملة"],
    aliasesEn: ["blood count", "hemogram"], categoryId: "cat-3",
    sampleType: "blood", costPrice: 3, sellPrice: 12, isActive: true,
    instructionsAr: ["صيام 8 ساعات"], tools: ["إبر سحب دم", "أنابيب دم", "قفازات"],
    customerInstructions: [
      { id: "ti-t1-1", key: "fasting_8h", icon: "clock",   priority: 10, isActive: true,
        titleAr: "الصيام لمدة 8 ساعات",
        bodyAr:  "يُمتنع عن الطعام والشراب لمدة 8 ساعات قبل أخذ العينة (الماء مسموح)." },
      { id: "ti-t1-2", key: "id_ready",   icon: "id-card", priority: 40, isActive: true,
        titleAr: "جهّز هويتك الشخصية",
        bodyAr:  "اطّلع الممرض على هويتك الشخصية للتحقق قبل أخذ العينة." },
    ],
    nurseTools: [
      { toolId: "tl-needle",  quantityPerTest: 1, required: true },
      { toolId: "tl-tube",    quantityPerTest: 1, required: true, note: "EDTA" },
      { toolId: "tl-swab",    quantityPerTest: 1, required: true },
      { toolId: "tl-bandage", quantityPerTest: 1, required: false },
    ],
  },
  {
    id: "t-2", nameAr: "سكر صائم", nameEn: "Fasting Blood Sugar",
    shortName: "FBS", aliasesAr: ["سكر الدم", "جلوكوز"],
    aliasesEn: ["glucose", "blood sugar", "FBS"], categoryId: "cat-6",
    sampleType: "blood", costPrice: 2, sellPrice: 8, isActive: true,
    instructionsAr: ["صيام 8 ساعات", "تجنب السكريات قبل الصيام"],
    tools: ["إبر سحب دم", "أنابيب دم", "قفازات"],
  },
  {
    id: "t-3", nameAr: "فيتامين د", nameEn: "Vitamin D",
    shortName: "Vit D", aliasesAr: ["فيتامين دال", "25-OH فيتامين د"],
    aliasesEn: ["vitamin d3", "25-OH", "cholecalciferol"], categoryId: "cat-4",
    sampleType: "blood", costPrice: 8, sellPrice: 25, isActive: true,
    instructionsAr: ["لا يشترط صيام"], tools: ["إبر سحب دم", "أنابيب دم"],
  },
  {
    id: "t-4", nameAr: "هرمون الغدة الدرقية", nameEn: "Thyroid Stimulating Hormone",
    shortName: "TSH", aliasesAr: ["تحليل الغدة", "تي إس إتش"],
    aliasesEn: ["TSH", "thyrotropin"], categoryId: "cat-5",
    sampleType: "blood", costPrice: 6, sellPrice: 20, isActive: true,
    instructionsAr: ["لا يشترط صيام"], tools: ["إبر سحب دم", "أنابيب دم"],
  },
  {
    id: "t-5", nameAr: "الكوليسترول الكلي", nameEn: "Total Cholesterol",
    shortName: "Cholesterol", aliasesAr: ["كوليسترول", "دهون الدم"],
    aliasesEn: ["cholesterol", "lipids"], categoryId: "cat-2",
    sampleType: "blood", costPrice: 3, sellPrice: 10, isActive: true,
    instructionsAr: ["صيام 12 ساعة", "تجنب الأطعمة الدسمة"],
    tools: ["إبر سحب دم", "أنابيب دم"],
    customerInstructions: [
      // NOTE: same key as t-1 "fasting_8h" would dedupe, but cholesterol
      // requires the longer 12h fast — different key, both render.
      { id: "ti-t5-1", key: "fasting_12h", icon: "clock", priority: 11, isActive: true,
        titleAr: "الصيام لمدة 12 ساعة",
        bodyAr:  "يُمتنع عن الطعام والمشروبات (عدا الماء) لمدة 12 ساعة قبل العينة." },
      { id: "ti-t5-2", key: "id_ready",    icon: "id-card", priority: 40, isActive: true,
        titleAr: "جهّز هويتك الشخصية",
        bodyAr:  "اطّلع الممرض على هويتك الشخصية للتحقق قبل أخذ العينة." },
    ],
    nurseTools: [
      { toolId: "tl-needle",  quantityPerTest: 1, required: true },
      { toolId: "tl-tube",    quantityPerTest: 1, required: true, note: "Plain / SST" },
      { toolId: "tl-swab",    quantityPerTest: 1, required: true },
    ],
  },
  {
    id: "t-6", nameAr: "الكرياتينين", nameEn: "Creatinine",
    shortName: "Creat", aliasesAr: ["كرياتين الدم", "وظائف الكلى"],
    aliasesEn: ["creatinine", "kidney function"], categoryId: "cat-7",
    sampleType: "blood", costPrice: 3, sellPrice: 10, isActive: true,
    instructionsAr: ["لا يشترط صيام"], tools: ["إبر سحب دم", "أنابيب دم"],
  },
  {
    id: "t-7", nameAr: "وظائف الكبد", nameEn: "Liver Function Tests",
    shortName: "LFT", aliasesAr: ["إنزيمات الكبد", "ليفر"],
    aliasesEn: ["liver function", "SGPT", "SGOT", "LFT"], categoryId: "cat-8",
    sampleType: "blood", costPrice: 7, sellPrice: 22, isActive: true,
    instructionsAr: ["صيام 8 ساعات"], tools: ["إبر سحب دم", "أنابيب دم"],
  },
  {
    id: "t-8", nameAr: "فيتامين ب12", nameEn: "Vitamin B12",
    shortName: "B12", aliasesAr: ["فيتامين بي 12", "كوبالامين"],
    aliasesEn: ["vitamin b12", "cobalamin", "B12"], categoryId: "cat-4",
    sampleType: "blood", costPrice: 7, sellPrice: 22, isActive: true,
    instructionsAr: ["لا يشترط صيام"], tools: ["إبر سحب دم", "أنابيب دم"],
  },
  {
    id: "t-9", nameAr: "هرمون التستوستيرون", nameEn: "Testosterone",
    shortName: "Testo", aliasesAr: ["تستيرون", "هرمون الذكورة"],
    aliasesEn: ["testosterone", "androgen"], categoryId: "cat-1",
    sampleType: "blood", costPrice: 9, sellPrice: 28, isActive: true,
    instructionsAr: ["يفضل السحب صباحاً"], tools: ["إبر سحب دم", "أنابيب دم"],
  },
  {
    id: "t-10", nameAr: "الحديد في الدم", nameEn: "Serum Iron",
    shortName: "Iron", aliasesAr: ["فيريتين", "تشبع الحديد"],
    aliasesEn: ["iron", "ferritin", "TIBC"], categoryId: "cat-2",
    sampleType: "blood", costPrice: 5, sellPrice: 16, isActive: true,
    instructionsAr: ["صيام 8 ساعات"], tools: ["إبر سحب دم", "أنابيب دم"],
  },
  {
    id: "t-11", nameAr: "تحليل البول الكامل", nameEn: "Urine Analysis",
    shortName: "UA", aliasesAr: ["بول كامل", "فحص البول"],
    aliasesEn: ["urine analysis", "urinalysis", "UA"], categoryId: "cat-7",
    sampleType: "urine", costPrice: 2, sellPrice: 8, isActive: true,
    instructionsAr: ["البول الصباحي الأول", "جرة بول نظيفة"],
    tools: ["عبوات بول", "قفازات"],
  },
  {
    id: "t-12", nameAr: "الهيموغلوبين الغليكوزيلاتي", nameEn: "Glycated Hemoglobin",
    shortName: "HbA1c", aliasesAr: ["سكر تراكمي", "هيموغلوبين أ1ج"],
    aliasesEn: ["HbA1c", "glycated hemoglobin", "A1c"], categoryId: "cat-6",
    sampleType: "blood", costPrice: 6, sellPrice: 18, isActive: true,
    instructionsAr: ["لا يشترط صيام"], tools: ["إبر سحب دم", "أنابيب دم"],
  },
];

// ─── Packages ───────────────────────────────────────────────────────────────
export const MOCK_PACKAGES: Package[] = [
  {
    id: "pkg-1", nameAr: "باقة الفحص الشامل", nameEn: "Full Checkup Package",
    descriptionAr: "فحص شامل لأهم مؤشرات الصحة العامة",
    fullDescriptionAr:
      "تشمل هذه الباقة فحوصات تعداد الدم، السكر، الكوليسترول، وظائف الكلى وتحليل البول — لتقييم متكامل لحالتك الصحية مرة كل ستة أشهر.",
    category: "checkup", price: 59, originalPrice: 88,
    tests: [MOCK_TESTS[0], MOCK_TESTS[1], MOCK_TESTS[4], MOCK_TESTS[5], MOCK_TESTS[6], MOCK_TESTS[10]],
    mainImage: img("makhbartak-checkup", 800, 800),
    mobileImage: img("makhbartak-checkup-m", 600, 800),
    desktopImage: img("makhbartak-checkup-d", 1200, 700),
    badgeAr: "الأكثر طلباً",
    displayOrder: 1, showInSlider: true, isActive: true,
  },
  {
    id: "pkg-2", nameAr: "باقة الرياضيين", nameEn: "Athletes Package",
    descriptionAr: "تحاليل مخصصة للرياضيين لمتابعة الأداء والصحة العامة",
    fullDescriptionAr:
      "صُممت هذه الباقة لمتابعة لياقتك ومستويات الهرمونات والحديد والفيتامينات الضرورية للنشاط البدني المنتظم.",
    category: "athletes", price: 75, originalPrice: 110,
    tests: [MOCK_TESTS[0], MOCK_TESTS[8], MOCK_TESTS[2], MOCK_TESTS[7], MOCK_TESTS[9]],
    mainImage: img("makhbartak-athletes", 800, 800),
    mobileImage: img("makhbartak-athletes-m", 600, 800),
    desktopImage: img("makhbartak-athletes-d", 1200, 700),
    badgeAr: "للرياضيين",
    displayOrder: 2, showInSlider: true, isActive: true,
  },
  {
    id: "pkg-3", nameAr: "باقة التنحيف", nameEn: "Weight Loss Package",
    descriptionAr: "تحاليل تساعدك في متابعة رحلة إنقاص الوزن",
    fullDescriptionAr:
      "متابعة هرمونية وأيضية تكشف توازن السكر، الدرقية، الكوليسترول والسكر التراكمي — لخطّة تنحيف ذكية ومتابعة مستمرة.",
    category: "slimming", price: 65, originalPrice: 90,
    tests: [MOCK_TESTS[1], MOCK_TESTS[3], MOCK_TESTS[4], MOCK_TESTS[11], MOCK_TESTS[7]],
    mainImage: img("makhbartak-slim", 800, 800),
    mobileImage: img("makhbartak-slim-m", 600, 800),
    desktopImage: img("makhbartak-slim-d", 1200, 700),
    displayOrder: 3, showInSlider: true, isActive: true,
  },
  {
    id: "pkg-4", nameAr: "باقة الفيتامينات", nameEn: "Vitamins Package",
    descriptionAr: "كشف مستوى أهم الفيتامينات والمعادن في الجسم",
    fullDescriptionAr:
      "تشمل قياس مستويات فيتامين د، فيتامين ب12 والحديد — أهم الفيتامينات والمعادن لطاقتك اليومية ومناعتك.",
    category: "vitamins", price: 55, originalPrice: 75,
    tests: [MOCK_TESTS[2], MOCK_TESTS[7], MOCK_TESTS[9]],
    mainImage: img("makhbartak-vit", 800, 800),
    mobileImage: img("makhbartak-vit-m", 600, 800),
    desktopImage: img("makhbartak-vit-d", 1200, 700),
    badgeAr: "خصم 27%",
    displayOrder: 4, showInSlider: false, isActive: true,
  },
  {
    id: "pkg-5", nameAr: "باقة الغدة الدرقية", nameEn: "Thyroid Package",
    descriptionAr: "فحص متكامل لوظائف الغدة الدرقية",
    fullDescriptionAr:
      "تقييم شامل لوظيفة الغدة الدرقية مع تعداد دم — يفيد في حالات التعب المزمن وتقلّبات الوزن والمزاج.",
    category: "checkup", price: 45, originalPrice: 60,
    tests: [MOCK_TESTS[3], MOCK_TESTS[0]],
    mainImage: img("makhbartak-thyroid", 800, 800),
    mobileImage: img("makhbartak-thyroid-m", 600, 800),
    desktopImage: img("makhbartak-thyroid-d", 1200, 700),
    displayOrder: 5, showInSlider: false, isActive: true,
  },
];

// ─── Home Sliders ────────────────────────────────────────────────────────────
export const MOCK_SLIDERS: SliderItem[] = [
  {
    id: "sl-1",
    titleAr: "الفحص الشامل من بيتك",
    subtitleAr: "ست تحاليل تقييمية بسعر مخفّض ، يأتيك الممرض في الموعد",
    mobileImage: img("makhbartak-sl1-m", 800, 1000),
    desktopImage: img("makhbartak-sl1-d", 1600, 800),
    priceLabel: "59 ل.س",
    ctaLabel: "احجز الباقة",
    ctaTarget: "package",
    ctaTargetId: "pkg-1",
    testsCount: 6,
    badgeAr: "خصم 33%",
    displayOrder: 1, isActive: true,
  },
  {
    id: "sl-2",
    titleAr: "وصفتك تحاليلك بدون تعب",
    subtitleAr: "صوّر وصفة الطبيب وسنستخرج التحاليل ونرتّب لك زيارة في نفس اليوم",
    mobileImage: img("makhbartak-sl2-m", 800, 1000),
    desktopImage: img("makhbartak-sl2-d", 1600, 800),
    priceLabel: "حسب الوصفة",
    ctaLabel: "ارفع وصفتك",
    ctaTarget: "prescription",
    badgeAr: "ذكاء اصطناعي",
    displayOrder: 2, isActive: true,
  },
  {
    id: "sl-3",
    titleAr: "باقة الرياضيين",
    subtitleAr: "متابعة هرمونية وقوية لكل رياضي يسعى للأفضل",
    mobileImage: img("makhbartak-sl3-m", 800, 1000),
    desktopImage: img("makhbartak-sl3-d", 1600, 800),
    priceLabel: "75 ل.س",
    ctaLabel: "تفاصيل الباقة",
    ctaTarget: "package",
    ctaTargetId: "pkg-2",
    testsCount: 5,
    displayOrder: 3, isActive: true,
  },
  {
    id: "sl-4",
    titleAr: "اختر تحاليلك بنفسك",
    subtitleAr: "ابحث وأضف ما تحتاج فقط — سعر شفّاف لكل تحليل",
    mobileImage: img("makhbartak-sl4-m", 800, 1000),
    desktopImage: img("makhbartak-sl4-d", 1600, 800),
    priceLabel: "حسب اختيارك",
    ctaLabel: "ابدأ الآن",
    ctaTarget: "custom-builder",
    displayOrder: 4, isActive: true,
  },
];

// ─── Instructions ────────────────────────────────────────────────────────────
export const COMMON_INSTRUCTIONS: Instruction[] = [
  { id: "ins-1", icon: "clock", textAr: "صيام 8 ساعات قبل التحليل", textEn: "Fast for 8 hours before the test" },
  { id: "ins-2", icon: "droplets", textAr: "اشرب الماء فقط أثناء الصيام", textEn: "Drink water only during fasting" },
  { id: "ins-3", icon: "pill", textAr: "تجنب الأدوية قبل التحليل إذا طلب منك الطبيب ذلك", textEn: "Avoid medications if advised by your doctor" },
  { id: "ins-4", icon: "id-card", textAr: "جهّز هويتك الشخصية عند وصول الممرض", textEn: "Have your ID ready when the nurse arrives" },
  { id: "ins-5", icon: "shirt", textAr: "ارتدِ ملابس مريحة تسمح بالوصول للذراع", textEn: "Wear comfortable clothing with sleeve access" },
];

// ─── Phase 1 demo seed UUIDs (must match supabase/migrations/010) ───────────
// These are the deterministic ids used both in the mock store and in the
// Supabase seed so the API route can resolve session.linkedEntityId →
// customers.id and patient_id / address_id without an extra lookup.
export const SEED_CUSTOMER_1_ID = "00000000-0000-4000-8000-00000000c001";
// ─── Phase 3 nurse seed UUIDs (must match supabase/migrations/016) ──────────
export const SEED_NURSE_1_ID = "00000000-0000-4000-8000-0000000a0001";
export const SEED_NURSE_2_ID = "00000000-0000-4000-8000-0000000a0002";
export const SEED_NURSE_3_ID = "00000000-0000-4000-8000-0000000a0003";
export const SEED_CUSTOMER_2_ID = "00000000-0000-4000-8000-00000000c002";
export const SEED_PATIENT_1_ID  = "00000000-0000-4000-8000-00000000d001";
export const SEED_PATIENT_2_ID  = "00000000-0000-4000-8000-00000000d002";
export const SEED_ADDRESS_1_ID  = "00000000-0000-4000-8000-00000000e001";
export const SEED_ADDRESS_2_ID  = "00000000-0000-4000-8000-00000000e002";

// ─── Patients ────────────────────────────────────────────────────────────────
export const MOCK_PATIENTS: Patient[] = [
  { id: SEED_PATIENT_1_ID, userId: SEED_CUSTOMER_1_ID, name: "أحمد محمد علي", isDefault: true },
  { id: SEED_PATIENT_2_ID, userId: SEED_CUSTOMER_1_ID, name: "فاطمة أحمد", isDefault: false },
];

// ─── Addresses ───────────────────────────────────────────────────────────────
export const MOCK_ADDRESSES: Address[] = [
  {
    id: SEED_ADDRESS_1_ID, userId: SEED_CUSTOMER_1_ID, label: "المنزل",
    description: "المزة – شارع الفردوس، بناء رقم 12، الطابق 3",
    lat: 33.5138, lng: 36.2765, city: "دمشق", isDefault: true,
  },
  {
    id: SEED_ADDRESS_2_ID, userId: SEED_CUSTOMER_1_ID, label: "العمل",
    description: "المالكي – برج المعلومات، الطابق 5",
    lat: 33.5203, lng: 36.2912, city: "دمشق", isDefault: false,
  },
];

// ─── Orders ──────────────────────────────────────────────────────────────────
export const MOCK_ORDERS: Order[] = [
  {
    id: "ord-1", userId: SEED_CUSTOMER_1_ID, status: "result_ready",
    type: "package", packageNameAr: "باقة الفحص الشامل",
    packageSnapshot: {
      packageId: "pkg-1",
      nameAr: "باقة الفحص الشامل",
      nameEn: "Full Checkup Package",
      image: img("makhbartak-checkup", 800, 800),
      testsCount: 6,
      price: 59,
    },
    items: [
      { id: "oi-1", testId: "t-1", nameAr: "تعداد الدم الكامل", nameEn: "CBC", priceSnapshot: 12 },
      { id: "oi-2", testId: "t-2", nameAr: "سكر صائم", nameEn: "Fasting Blood Sugar", priceSnapshot: 8 },
      { id: "oi-3", testId: "t-5", nameAr: "الكوليسترول الكلي", nameEn: "Total Cholesterol", priceSnapshot: 10 },
    ],
    subtotal: 88, couponDiscount: 29, couponCode: "WELCOME30", total: 59,
    shift: "morning", visitDate: "2025-05-01",
    address: MOCK_ADDRESSES[0], patient: MOCK_PATIENTS[0],
    paymentMethod: "cash", paymentStatus: "pending",
    instructions: COMMON_INSTRUCTIONS,
    resultPdfUrl: "/results/ord-1.pdf",
    nurseId: SEED_NURSE_1_ID, labId: "lab-1",
    internalNotes: "المريض يفضّل الموعد الصباحي فقط",
    createdAt: "2025-04-30T08:00:00Z", updatedAt: "2025-05-01T11:30:00Z",
  },
  {
    id: "ord-2", userId: SEED_CUSTOMER_1_ID, status: "confirmed",
    type: "custom",
    items: [
      { id: "oi-4", testId: "t-3", nameAr: "فيتامين د", nameEn: "Vitamin D", priceSnapshot: 25 },
      { id: "oi-5", testId: "t-8", nameAr: "فيتامين ب12", nameEn: "Vitamin B12", priceSnapshot: 22 },
    ],
    subtotal: 47, couponDiscount: 0, total: 47,
    shift: "evening", visitDate: "2025-05-05",
    address: MOCK_ADDRESSES[0], patient: MOCK_PATIENTS[0],
    paymentMethod: "online", paymentStatus: "paid",
    instructions: [COMMON_INSTRUCTIONS[3]],
    createdAt: "2025-05-02T14:00:00Z", updatedAt: "2025-05-02T14:05:00Z",
  },
  {
    id: "ord-3", userId: SEED_CUSTOMER_1_ID, status: "on_the_way",
    type: "custom",
    items: [
      { id: "oi-6", testId: "t-4", nameAr: "هرمون الغدة الدرقية", nameEn: "TSH", priceSnapshot: 20 },
    ],
    subtotal: 20, couponDiscount: 0, total: 20,
    shift: "morning", visitDate: "2025-05-02",
    address: MOCK_ADDRESSES[0], patient: MOCK_PATIENTS[0],
    paymentMethod: "cash", paymentStatus: "pending",
    instructions: [COMMON_INSTRUCTIONS[3]],
    createdAt: "2025-05-02T06:00:00Z", updatedAt: "2025-05-02T09:10:00Z",
  },
  {
    id: "ord-4", userId: SEED_CUSTOMER_1_ID, status: "sent_to_lab",
    type: "custom",
    items: [
      { id: "oi-7", testId: "t-7", nameAr: "وظائف الكبد", nameEn: "Liver Function Tests", priceSnapshot: 22 },
    ],
    subtotal: 22, couponDiscount: 0, total: 22,
    shift: "morning", visitDate: "2025-05-03",
    address: MOCK_ADDRESSES[0], patient: MOCK_PATIENTS[0],
    paymentMethod: "cash", paymentStatus: "pending",
    instructions: [COMMON_INSTRUCTIONS[0]],
    nurseId: SEED_NURSE_1_ID, labId: "lab-1",
    createdAt: "2025-05-03T07:00:00Z", updatedAt: "2025-05-03T10:30:00Z",
  },
  {
    id: "ord-5", userId: SEED_CUSTOMER_1_ID, status: "sample_collected",
    type: "custom",
    items: [
      { id: "oi-8", testId: "t-12", nameAr: "الهيموغلوبين الغليكوزيلاتي", nameEn: "Glycated Hemoglobin", priceSnapshot: 18 },
    ],
    subtotal: 18, couponDiscount: 0, total: 18,
    shift: "evening", visitDate: "2025-05-03",
    address: MOCK_ADDRESSES[1], patient: MOCK_PATIENTS[1],
    paymentMethod: "cash", paymentStatus: "pending",
    instructions: [],
    nurseId: SEED_NURSE_2_ID, labId: "lab-2",
    createdAt: "2025-05-03T15:00:00Z", updatedAt: "2025-05-03T17:30:00Z",
  },
];

// ─── Notifications ───────────────────────────────────────────────────────────
export const MOCK_NOTIFICATIONS: Notification[] = [
  {
    id: "n-1", userId: SEED_CUSTOMER_1_ID, titleAr: "نتيجتك جاهزة",
    bodyAr: "تم رفع نتيجة طلبك #ord-1. اضغط لعرضها.",
    type: "result_ready", orderId: "ord-1", isRead: false,
    createdAt: "2025-05-01T11:30:00Z",
  },
  {
    id: "n-2", userId: SEED_CUSTOMER_1_ID, titleAr: "الممرض في الطريق",
    bodyAr: "الممرض في طريقه إليك الآن.",
    type: "nurse_on_way", orderId: "ord-3", isRead: false,
    createdAt: "2025-05-02T09:10:00Z",
  },
  {
    id: "n-3", userId: SEED_CUSTOMER_1_ID, titleAr: "تم تأكيد طلبك",
    bodyAr: "تم تأكيد طلبك #ord-2 بنجاح.",
    type: "order_confirmed", orderId: "ord-2", isRead: true,
    createdAt: "2025-05-02T14:05:00Z",
  },
];

// ─── Coupons ─────────────────────────────────────────────────────────────────
export const MOCK_COUPONS: Coupon[] = [
  {
    id: "c-1", code: "WELCOME30", type: "percentage", value: 30,
    minOrderAmount: 40, maxDiscount: 50, usageLimit: 1000, usedCount: 245,
    startDate: "2025-01-01", expiryDate: "2025-12-31", isActive: true,
  },
  {
    id: "c-2", code: "FIXED10", type: "fixed", value: 10,
    minOrderAmount: 30, maxDiscount: 10, usageLimit: 500, usedCount: 500,
    startDate: "2025-01-01", expiryDate: "2025-12-31", isActive: true,
  },
];

// ─── Shift Config ─────────────────────────────────────────────────────────────
// Resolve the two shifts (morning/evening) for a given visit date, taking
// into account:
//  - admin-defined start/end hours (optional override of the seed defaults)
//  - minimum booking notice (only matters when date === today)
//  - per-shift capacity (when admin sets a non-zero cap)
//
// Past dates are filtered upstream by the date picker — this function still
// returns rows for them but marks them unavailable.
interface ShiftConfigsInput {
  date: string;            // YYYY-MM-DD
  minNoticeMinutes?: number;
  /** "HH:MM" overrides — fall back to the seeded 8/10 + 16/18 if not given. */
  morningStart?: string;
  morningEnd?: string;
  eveningStart?: string;
  eveningEnd?: string;
  /** Pass currently-confirmed orders for that date so capacity can be checked. */
  ordersForDate?: { shift: "morning" | "evening"; status: string }[];
  /** 0 = unlimited. */
  maxOrdersPerShift?: number;
  /**
   * Days beyond today still considered bookable. Defaults to a permissive 30
   * if omitted (callers from the customer flow should always pass this from
   * SystemSettings.bookingWindowDays).
   */
  bookingWindowDays?: number;
}

const NOT_AVAILABLE_AR = "هذا الموعد غير متاح، يرجى اختيار وقت آخر";

export function getShiftConfigs(input?: ShiftConfigsInput | number): ShiftConfig[] {
  // Local YYYY-MM-DD — must match the format the booking picker uses to key
  // dates. toISOString() shifts to UTC and flips the day in any +UTC
  // timezone (e.g. Damascus UTC+3 between 21:00 and midnight), which would
  // mark today as "past" and disable the whole 3-day picker.
  const localYmd = (d: Date): string => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  // Backwards compat: old call sites passed `minNoticeMinutes` as a single
  // positional number. New call sites pass an object.
  const cfg: ShiftConfigsInput = typeof input === "number"
    ? { date: localYmd(new Date()), minNoticeMinutes: input }
    : (input ?? { date: localYmd(new Date()) });

  const minNotice = cfg.minNoticeMinutes ?? 120;
  const now = new Date();
  const todayStr = localYmd(new Date());
  const todayMidnight = new Date(todayStr + "T00:00:00");
  const target = new Date(cfg.date + "T00:00:00");
  const isPast = target < todayMidnight;
  const isToday = cfg.date === todayStr;
  // Windowed: today + bookingWindowDays additional days are bookable.
  const windowDays = cfg.bookingWindowDays ?? 30;
  const daysAhead = Math.round((target.getTime() - todayMidnight.getTime()) / 86_400_000);
  const isBeyondWindow = daysAhead > windowDays;

  const parseHM = (hm: string | undefined, fallback: number): { h: number; m: number } => {
    if (!hm) return { h: fallback, m: 0 };
    const [h, m] = hm.split(":").map((x) => parseInt(x, 10));
    return { h: Number.isFinite(h) ? h : fallback, m: Number.isFinite(m) ? m : 0 };
  };

  const m1 = parseHM(cfg.morningStart, 8);
  const m2 = parseHM(cfg.morningEnd, 10);
  const e1 = parseHM(cfg.eveningStart, 16);
  const e2 = parseHM(cfg.eveningEnd, 18);

  const shifts: { shift: "morning" | "evening"; labelAr: string; sH: number; sM: number; eH: number; eM: number }[] = [
    { shift: "morning", labelAr: "فترة الصباح", sH: m1.h, sM: m1.m, eH: m2.h, eM: m2.m },
    { shift: "evening", labelAr: "فترة المساء", sH: e1.h, sM: e1.m, eH: e2.h, eM: e2.m },
  ];

  return shifts.map((s) => {
    let available = !isPast && !isBeyondWindow;
    let reason: string | undefined;

    if (isPast) {
      reason = NOT_AVAILABLE_AR;
    } else if (isBeyondWindow) {
      reason = NOT_AVAILABLE_AR;
    } else if (isToday) {
      const shiftStart = new Date(target);
      shiftStart.setHours(s.sH, s.sM, 0, 0);
      const minutesUntilShift = (shiftStart.getTime() - now.getTime()) / 60000;
      if (minutesUntilShift < minNotice) {
        available = false;
        reason = NOT_AVAILABLE_AR;
      }
    }

    if (available && cfg.maxOrdersPerShift && cfg.maxOrdersPerShift > 0 && cfg.ordersForDate) {
      const taken = cfg.ordersForDate.filter((o) => o.shift === s.shift && o.status !== "cancelled").length;
      if (taken >= cfg.maxOrdersPerShift) {
        available = false;
        reason = "اكتمل الحجز لهذه الفترة، يرجى اختيار وقت آخر";
      }
    }

    return {
      shift: s.shift,
      labelAr: s.labelAr,
      startHour: s.sH,
      endHour: s.eH,
      available,
      unavailableReason: reason,
    };
  });
}

// ─── System Settings ─────────────────────────────────────────────────────────
export const SYSTEM_SETTINGS: SystemSettings = {
  minBookingNoticeMinutes: 120,
  morningShiftStart: "08:00",
  morningShiftEnd: "10:00",
  eveningShiftStart: "16:00",
  eveningShiftEnd: "18:00",
  supportedCities: ["دمشق", "ريف دمشق"],
  whatsappNumber: "+963911000000",
  allowCashOrders: true,
  bookingWindowDays: 2,
  maxOrdersPerShift: 0, // 0 = unlimited
};

// ─── Nurses ──────────────────────────────────────────────────────────────────
export const MOCK_NURSES: Nurse[] = [
  { id: SEED_NURSE_1_ID, name: "محمد الأحمد", phone: "+963911111111", city: "دمشق",      photoUrl: img("makhbartak-nur1", 200, 200), isActive: true },
  { id: SEED_NURSE_2_ID, name: "سارة السيد",  phone: "+963922222222", city: "دمشق",      photoUrl: img("makhbartak-nur2", 200, 200), isActive: true },
  { id: SEED_NURSE_3_ID, name: "ليث ناصر",   phone: "+963933333333", city: "ريف دمشق", photoUrl: img("makhbartak-nur3", 200, 200), isActive: true },
];

// ─── Admin Stats ─────────────────────────────────────────────────────────────
export const ADMIN_STATS: AdminStats = {
  todayOrders: 14, pendingOrders: 5, completedToday: 7, revenue: 1240,
};

// ─── Order Status Labels ─────────────────────────────────────────────────────
export const ORDER_STATUS_LABELS: Record<string, { ar: string; color: string }> = {
  created: { ar: "تم الإنشاء", color: "bg-gray-100 text-gray-600" },
  priced: { ar: "تم التسعير", color: "bg-blue-100 text-blue-700" },
  scheduled: { ar: "مجدول", color: "bg-cyan-100 text-cyan-700" },
  confirmed: { ar: "مؤكد", color: "bg-primary-100 text-primary-700" },
  nurse_assigned: { ar: "تم تعيين الممرض", color: "bg-indigo-100 text-indigo-700" },
  on_the_way: { ar: "الممرض في الطريق", color: "bg-purple-100 text-purple-700" },
  arrived: { ar: "وصل الممرض", color: "bg-amber-100 text-amber-700" },
  sample_collected: { ar: "تم أخذ العينة", color: "bg-emerald-100 text-emerald-700" },
  sent_to_lab: { ar: "أُرسلت للمخبر", color: "bg-teal-100 text-teal-700" },
  lab_processing: { ar: "يعالجها المخبر", color: "bg-sky-100 text-sky-700" },
  result_ready: { ar: "النتيجة جاهزة", color: "bg-green-100 text-green-700" },
  completed: { ar: "مكتمل", color: "bg-green-100 text-green-700" },
  failed_to_collect: { ar: "تعذر الأخذ", color: "bg-red-100 text-red-700" },
  lab_issue: { ar: "مشكلة في المخبر", color: "bg-orange-100 text-orange-700" },
  cancelled: { ar: "ملغي", color: "bg-red-100 text-red-600" },
};

export const FAILED_COLLECTION_REASONS = [
  { value: "patient_absent", labelAr: "المريض غير موجود" },
  { value: "patient_refused", labelAr: "رفض المريض" },
  { value: "draw_failed", labelAr: "تعذر سحب العينة" },
  { value: "location_issue", labelAr: "مشكلة في الموقع" },
  { value: "other", labelAr: "سبب آخر" },
];

export const LAB_ISSUE_REASONS = [
  { value: "invalid_sample", labelAr: "عينة غير صالحة" },
  { value: "incomplete_sample", labelAr: "عينة ناقصة" },
  { value: "patient_data_error", labelAr: "خطأ في بيانات المريض" },
  { value: "needs_redrawn", labelAr: "يحتاج إعادة سحب" },
  { value: "other", labelAr: "سبب آخر" },
];

// ─── Admin Users ─────────────────────────────────────────────────────────────
export const MOCK_ADMINS: AdminUser[] = [
  { id: "ad-1", username: "admin",     password: "admin123",   name: "مدير النظام",   role: "super_admin",      isActive: true, lastLogin: "2026-05-01T09:00:00Z" },
  { id: "ad-2", username: "ops",       password: "ops123",     name: "ليلى الحسن",   role: "operations_admin", isActive: true, lastLogin: "2026-05-01T08:30:00Z" },
  { id: "ad-3", username: "lab",       password: "lab123",     name: "د. عمر زين",   role: "lab_admin",        isActive: true },
  { id: "ad-4", username: "support",   password: "support123", name: "نور الخطيب",  role: "customer_support", isActive: true },
  { id: "ad-5", username: "finance",   password: "finance123", name: "ريم الحلبي",  role: "finance_admin",    isActive: true },
  { id: "ad-6", username: "content",   password: "content123", name: "كرم الديب",    role: "content_admin",    isActive: true },
];

// ─── Invoices ────────────────────────────────────────────────────────────────
export const MOCK_INVOICES: Invoice[] = [
  {
    id: "inv-1", invoiceNumber: "INV-2025-0001",
    orderId: "ord-1", customerPhone: "+963911000000", patientName: "أحمد محمد علي",
    items: [
      { id: "it-1", nameAr: "تعداد الدم الكامل", nameEn: "CBC", quantity: 1, unitPrice: 12, total: 12 },
      { id: "it-2", nameAr: "سكر صائم", nameEn: "Fasting Blood Sugar", quantity: 1, unitPrice: 8, total: 8 },
      { id: "it-3", nameAr: "الكوليسترول الكلي", nameEn: "Cholesterol", quantity: 1, unitPrice: 10, total: 10 },
    ],
    subtotal: 88, packageDiscount: 0, couponCode: "WELCOME30", couponDiscount: 29,
    taxRate: 0, taxAmount: 0, total: 59,
    paymentMethod: "cash", paymentStatus: "pending",
    issuedAt: "2026-04-30T08:05:00Z",
  },
  {
    id: "inv-2", invoiceNumber: "INV-2025-0002",
    orderId: "ord-2", customerPhone: "+963911000000", patientName: "أحمد محمد علي",
    items: [
      { id: "it-4", nameAr: "فيتامين د", nameEn: "Vitamin D", quantity: 1, unitPrice: 25, total: 25 },
      { id: "it-5", nameAr: "فيتامين ب12", nameEn: "Vitamin B12", quantity: 1, unitPrice: 22, total: 22 },
    ],
    subtotal: 47, packageDiscount: 0, couponDiscount: 0,
    taxRate: 0, taxAmount: 0, total: 47,
    paymentMethod: "online", paymentStatus: "paid",
    issuedAt: "2026-05-02T14:05:00Z",
  },
  {
    id: "inv-3", invoiceNumber: "INV-2025-0003",
    orderId: "ord-3", customerPhone: "+963911000000", patientName: "أحمد محمد علي",
    items: [
      { id: "it-6", nameAr: "هرمون الغدة الدرقية", nameEn: "TSH", quantity: 1, unitPrice: 20, total: 20 },
    ],
    subtotal: 20, packageDiscount: 0, couponDiscount: 0,
    taxRate: 0, taxAmount: 0, total: 20,
    paymentMethod: "cash", paymentStatus: "pending",
    issuedAt: "2026-05-02T06:10:00Z",
  },
];

// Generate an invoice from an order — used when an order is confirmed.
export function generateInvoice(order: Order, sequence: number): Invoice {
  return {
    id: `inv-${order.id}`,
    invoiceNumber: `INV-${new Date().getFullYear()}-${String(sequence).padStart(4, "0")}`,
    orderId: order.id,
    customerPhone: SYSTEM_SETTINGS.whatsappNumber,
    patientName: order.patient.name,
    items: order.items.map((it) => ({
      id: `it-${it.id}`, nameAr: it.nameAr, nameEn: it.nameEn,
      quantity: 1, unitPrice: it.priceSnapshot, total: it.priceSnapshot,
    })),
    subtotal: order.subtotal,
    packageDiscount: 0,
    couponCode: order.couponCode,
    couponDiscount: order.couponDiscount,
    taxRate: 0, taxAmount: 0,
    total: order.total,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus === "paid" ? "paid" : "pending",
    issuedAt: new Date().toISOString(),
  };
}

// ─── Activity Logs ───────────────────────────────────────────────────────────
export const MOCK_ACTIVITY_LOGS: ActivityLog[] = [
  { id: "al-1", adminId: "ad-1", adminName: "مدير النظام", role: "super_admin",
    action: "login", entity: "session", entityId: "-", details: "تسجيل دخول من المتصفح",
    createdAt: "2026-05-01T09:00:00Z" },
  { id: "al-2", adminId: "ad-2", adminName: "ليلى الحسن", role: "operations_admin",
    action: "order_update", entity: "order", entityId: "ord-3", details: "تحديث الحالة إلى on_the_way",
    createdAt: "2026-05-02T09:10:00Z" },
  { id: "al-3", adminId: "ad-5", adminName: "ريم الحلبي", role: "finance_admin",
    action: "invoice_status", entity: "invoice", entityId: "inv-2", details: "تأكيد الدفع الإلكتروني",
    createdAt: "2026-05-02T14:06:00Z" },
  { id: "al-4", adminId: "ad-6", adminName: "كرم الديب", role: "content_admin",
    action: "package_edit", entity: "package", entityId: "pkg-1", details: "تحديث الصورة الرئيسية",
    createdAt: "2026-04-30T17:00:00Z" },
  { id: "al-5", adminId: "ad-6", adminName: "كرم الديب", role: "content_admin",
    action: "slider_edit", entity: "slider", entityId: "sl-1", details: "تفعيل سلايدر العرض الترويجي",
    createdAt: "2026-04-30T17:05:00Z" },
];

// ─── Icons ───────────────────────────────────────────────────────────────────
export const MOCK_ICONS: SvgIcon[] = [
  { id: "ic-1", nameAr: "صيام",         nameEn: "Fasting",     svg: "lucide:clock",         category: "instruction", isActive: true },
  { id: "ic-2", nameAr: "ماء",           nameEn: "Water",       svg: "lucide:droplets",      category: "instruction", isActive: true },
  { id: "ic-3", nameAr: "أدوية",         nameEn: "Medication",  svg: "lucide:pill",          category: "instruction", isActive: true },
  { id: "ic-4", nameAr: "هوية",          nameEn: "ID",          svg: "lucide:id-card",       category: "instruction", isActive: true },
  { id: "ic-5", nameAr: "ملابس",         nameEn: "Clothing",    svg: "lucide:shirt",         category: "instruction", isActive: true },
  { id: "ic-6", nameAr: "باقة",          nameEn: "Package",     svg: "lucide:package",       category: "package",     isActive: true },
  { id: "ic-7", nameAr: "تحليل",         nameEn: "Test",        svg: "lucide:flask-conical", category: "package",     isActive: true },
  { id: "ic-8", nameAr: "نجمة",          nameEn: "Star",        svg: "lucide:star",          category: "slider",      isActive: true },
  { id: "ic-9", nameAr: "حقنة",          nameEn: "Syringe",     svg: "lucide:syringe",       category: "general",     isActive: true },
  { id: "ic-10", nameAr: "قلب",          nameEn: "Heart",       svg: "lucide:heart-pulse",   category: "general",     isActive: true },
];

// ─── Permission helper ──────────────────────────────────────────────────────
export function canAccess(role: AdminRole, section: string): boolean {
  const perms = ROLE_PERMISSIONS[role];
  return perms.includes("*") || perms.includes(section);
}

// ─── Order result files ─────────────────────────────────────────────────────
// Files belong to the *order*, not individual tests. A lab can upload one or
// many PDFs per order (e.g. results in one PDF, separate report in another).
export const MOCK_RESULT_FILES: OrderResultFile[] = [
  {
    id: "rf-1", orderId: "ord-1", labId: "lab-1",
    fileUrl: "/results/ord-1-main.pdf", fileName: "ord-1-results.pdf",
    uploadedBy: "د. عمر زين", uploadedAt: "2026-05-01T11:30:00Z",
    note: "نتائج مكتملة", isActive: true,
  },
];

// ─── Gamification config ────────────────────────────────────────────────────
export const NURSE_LEVELS: NurseLevel[] = [
  { id: "lv-1", name: "مبتدئ",  minPoints: 0,    color: "#94A3B8" },
  { id: "lv-2", name: "متمرس",  minPoints: 200,  color: "#0891B2" },
  { id: "lv-3", name: "محترف",  minPoints: 600,  color: "#059669" },
  { id: "lv-4", name: "خبير",   minPoints: 1500, color: "#A855F7" },
  { id: "lv-5", name: "أسطورة", minPoints: 3000, color: "#F59E0B" },
];

export const NURSE_BADGES: NurseBadge[] = [
  { id: "bd-1", name: "البداية", icon: "lucide:sparkles",        description: "أكمل أول زيارة" },
  { id: "bd-2", name: "10 زيارات", icon: "lucide:medal",         description: "أكمل 10 زيارات بنجاح" },
  { id: "bd-3", name: "100 زيارة", icon: "lucide:trophy",        description: "وصلت إلى 100 زيارة" },
  { id: "bd-4", name: "أسبوع كامل", icon: "lucide:flame",        description: "7 أيام عمل متتالية بدون فشل" },
  { id: "bd-5", name: "نجم الشهر", icon: "lucide:star",          description: "أعلى نقاط في الشهر" },
  { id: "bd-6", name: "موصِل المخبر", icon: "lucide:truck",      description: "10 عينات سُلِّمت بسرعة" },
];

export const GAMIFICATION_CONFIG: GamificationConfig = {
  pointPerCompletion: 10,
  pointPerLabDelivery: 5,
  pointStreakBonus: 3,
  levels: NURSE_LEVELS,
  badges: NURSE_BADGES,
};

export const MOCK_GAMIFICATION: Record<string, NurseGamification> = {
  [SEED_NURSE_1_ID]: {
    nurseId: SEED_NURSE_1_ID,
    totalCompleted: 142,
    totalPoints: 1820,
    pointsToday: 25,
    level: NURSE_LEVELS[3], // خبير
    badges: [NURSE_BADGES[0], NURSE_BADGES[1], NURSE_BADGES[2], NURSE_BADGES[3]],
    monthlyCompleted: 38,
    monthlyPoints: 460,
    successRate: 94,
    failedCount: 9,
    streak: 6,
  },
  [SEED_NURSE_2_ID]: {
    nurseId: SEED_NURSE_2_ID,
    totalCompleted: 78,
    totalPoints: 720,
    pointsToday: 10,
    level: NURSE_LEVELS[2], // محترف
    badges: [NURSE_BADGES[0], NURSE_BADGES[1]],
    monthlyCompleted: 22,
    monthlyPoints: 240,
    successRate: 91,
    failedCount: 7,
    streak: 3,
  },
  [SEED_NURSE_3_ID]: {
    nurseId: SEED_NURSE_3_ID,
    totalCompleted: 18,
    totalPoints: 130,
    pointsToday: 0,
    level: NURSE_LEVELS[0], // مبتدئ
    badges: [NURSE_BADGES[0]],
    monthlyCompleted: 18,
    monthlyPoints: 130,
    successRate: 88,
    failedCount: 2,
    streak: 0,
  },
};

// ─── Nurse routes ───────────────────────────────────────────────────────────
// Today + next two days for nur-1. Admin reorders these stops.
function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

export const MOCK_NURSE_ROUTES: NurseRoute[] = [
  {
    nurseId: SEED_NURSE_1_ID,
    date: todayPlus(0),
    stops: [
      { orderId: MOCK_ORDERS[2].id, order: MOCK_ORDERS[2], sequence: 1, status: "pending" },
      { orderId: MOCK_ORDERS[1].id, order: MOCK_ORDERS[1], sequence: 2, status: "pending" },
    ],
  },
  {
    nurseId: SEED_NURSE_1_ID,
    date: todayPlus(1),
    stops: [
      { orderId: MOCK_ORDERS[0].id, order: MOCK_ORDERS[0], sequence: 1, status: "pending" },
    ],
  },
  {
    nurseId: SEED_NURSE_1_ID,
    date: todayPlus(2),
    stops: [],
  },
];

// Build the nurse's morning prep checklist from today's tests.
export function buildPrepChecklist(nurseId: string, date: string = todayPlus(0)) {
  const route = MOCK_NURSE_ROUTES.find((r) => r.nurseId === nurseId && r.date === date);
  if (!route) return [];
  const tools = new Set<string>();
  let needsCooler = false;
  for (const stop of route.stops) {
    for (const item of stop.order.items) {
      const test = MOCK_TESTS.find((t) => t.id === item.testId);
      if (!test) continue;
      test.tools.forEach((t) => tools.add(t));
      if (test.sampleType === "blood") needsCooler = true;
    }
  }
  // Always include labels on top.
  tools.add("ملصقات الترميز");
  if (needsCooler) tools.add("حافظة باردة للنقل");
  return Array.from(tools).map((label, i) => ({ id: `pc-${i}`, label, checked: false }));
}

// ─── Nurse notifications (separate inbox) ───────────────────────────────────
export const MOCK_NURSE_NOTIFICATIONS: Notification[] = [
  {
    id: "nn-1", userId: SEED_NURSE_1_ID,
    titleAr: "زيارة جديدة في جدولك",
    bodyAr: "تم إسناد طلب جديد لليوم في منطقة المالكي",
    type: "nurse_assigned", orderId: "ord-3", isRead: false,
    createdAt: new Date(Date.now() - 1000 * 60 * 25).toISOString(),
  },
  {
    id: "nn-2", userId: SEED_NURSE_1_ID,
    titleAr: "تم تعديل ترتيب الجدول",
    bodyAr: "غيّرت الإدارة ترتيب الزيارات اليوم — راجع جدولك.",
    type: "route_changed", isRead: false,
    createdAt: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
  },
  {
    id: "nn-3", userId: SEED_NURSE_1_ID,
    titleAr: "ملاحظة من المخبر",
    bodyAr: "العينة السابقة بحاجة إعادة سحب — تواصل مع الإدارة.",
    type: "lab_issue", orderId: "ord-1", isRead: true,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(),
  },
];

// ─── Labs ───────────────────────────────────────────────────────────────────
// `name`/`phone` are kept as legacy aliases for the previous shape so older
// screens keep compiling — admin lab management (Stage 2) edits the rich fields.
export const MOCK_LABS: Lab[] = [
  {
    id: "lab-1",
    name: "مخبر الشام الطبي",
    phone: "+963112345678",
    nameAr: "مخبر الشام الطبي",
    nameEn: "Sham Medical Lab",
    logo: img("makhbartak-lab1", 200, 200),
    isActive: true,
    officialName: "مخبر الشام الطبي للتحاليل المخبرية",
    registrationNumber: "REG-2018-1042",
    licenseNumber: "LIC-MED-3318",
    taxNumber: "TAX-991-0042",
    addressFull: "دمشق – المزة – خلف فندق الشام",
    city: "دمشق", area: "المزة",
    lat: 33.5083, lng: 36.2580,
    phoneMain: "+963112345678",
    phoneSecondary: "+963112345679",
    email: "info@sham-lab.sy",
    whatsapp: "+963944111222",
    representative: {
      fullName: "د. عمر زين",
      role: "مدير المخبر",
      phone: "+963944333111",
      email: "omar.zein@sham-lab.sy",
    },
    supportedCities: ["دمشق", "ريف دمشق"],
    workingHours: "8:00 – 20:00 يومياً",
    acceptedSampleTypes: ["blood", "urine"],
    avgProcessingHours: 6,
    branding: {
      primaryColor: "#0891B2",
      secondaryColor: "#0E7490",
      accentColor: "#ECFEFF",
      portalDisplayName: "بوابة مخبر الشام",
      logo: img("makhbartak-lab1", 200, 200),
    },
  },
  {
    id: "lab-2",
    name: "مخبر النور",
    phone: "+963113334455",
    nameAr: "مخبر النور",
    nameEn: "Al Nour Lab",
    logo: img("makhbartak-lab2", 200, 200),
    isActive: true,
    officialName: "مخبر النور للتحاليل الدقيقة",
    registrationNumber: "REG-2020-2210",
    licenseNumber: "LIC-MED-4117",
    addressFull: "دمشق – المالكي – شارع الفرنسيين",
    city: "دمشق", area: "المالكي",
    lat: 33.5203, lng: 36.2912,
    phoneMain: "+963113334455",
    representative: {
      fullName: "د. سارة الحلبي",
      role: "مديرة العمليات",
      phone: "+963944778899",
    },
    supportedCities: ["دمشق"],
    workingHours: "9:00 – 18:00",
    acceptedSampleTypes: ["blood", "urine"],
    avgProcessingHours: 8,
    branding: {
      primaryColor: "#7C3AED",
      secondaryColor: "#5B21B6",
      accentColor: "#F5F3FF",
      portalDisplayName: "بوابة مخبر النور",
    },
  },
];

// ─── Lab users ──────────────────────────────────────────────────────────────
// Two users per lab: a lab_admin (does everything) + a lab_accounting user
// (settlements only). lab_uploader role exists in the union but is left
// unseeded — admin can create one from the dashboard.
export const MOCK_LAB_USERS: LabUser[] = [
  { id: "lu-1", labId: "lab-1", username: "sham-admin", password: "sham123", fullName: "د. عمر زين",   role: "lab_admin",      isActive: true, lastLoginAt: "2026-04-30T08:00:00Z" },
  { id: "lu-2", labId: "lab-1", username: "sham-acct",  password: "sham456", fullName: "هيا الكفري",   role: "lab_accounting", isActive: true },
  { id: "lu-3", labId: "lab-2", username: "noor-admin", password: "noor123", fullName: "د. سارة الحلبي", role: "lab_admin",      isActive: true },
  { id: "lu-4", labId: "lab-2", username: "noor-acct",  password: "noor456", fullName: "ريم القاسم",   role: "lab_accounting", isActive: true },
];

// ─── Customer login accounts ────────────────────────────────────────────────
// linkedEntityId points at the User record (e.g. "u-1" carries the seed
// patients/addresses/orders that this prototype's store returns globally).
export const MOCK_CUSTOMER_USERS: AuthUser[] = [
  { id: "cu-1", username: "customer1", password: "customer123", name: "أحمد محمد علي", role: "customer", linkedEntityId: SEED_CUSTOMER_1_ID, isActive: true },
  { id: "cu-2", username: "customer2", password: "customer123", name: "فاطمة الحسن",  role: "customer", linkedEntityId: SEED_CUSTOMER_2_ID, isActive: true },
];

// ─── Nurse login accounts ───────────────────────────────────────────────────
// linkedEntityId points at the Nurse record in MOCK_NURSES.
export const MOCK_NURSE_USERS: AuthUser[] = [
  { id: "nu-1", username: "nurse1", password: "nurse123", name: "محمد الأحمد", role: "nurse", linkedEntityId: SEED_NURSE_1_ID, isActive: true },
  { id: "nu-2", username: "nurse2", password: "nurse123", name: "سارة السيد",  role: "nurse", linkedEntityId: SEED_NURSE_2_ID, isActive: true },
];

// ─── Lab price agreements ──────────────────────────────────────────────────
// Lab-1 has explicit per-test prices for half its catalog. Anything missing
// falls back to the platform default in computeLabAmount() (60% of sell).
export const MOCK_LAB_PRICE_AGREEMENTS: LabPriceAgreement[] = [
  { id: "lpa-1", labId: "lab-1", testId: "t-1",  labPrice: 6,  effectiveFrom: "2025-01-01", isActive: true }, // CBC
  { id: "lpa-2", labId: "lab-1", testId: "t-2",  labPrice: 4,  effectiveFrom: "2025-01-01", isActive: true }, // FBS
  { id: "lpa-3", labId: "lab-1", testId: "t-5",  labPrice: 5,  effectiveFrom: "2025-01-01", isActive: true }, // Cholesterol
  { id: "lpa-4", labId: "lab-1", testId: "t-7",  labPrice: 12, effectiveFrom: "2025-01-01", isActive: true }, // LFT
  { id: "lpa-5", labId: "lab-2", testId: "t-12", labPrice: 10, effectiveFrom: "2025-01-01", isActive: true }, // HbA1c
];

/** Default share when no explicit agreement exists. */
export const DEFAULT_LAB_SHARE = 0.6;

/** Look up the lab amount for a given lab + test. Falls back to share of sell. */
export function lookupLabPrice(labId: string, testId: string, sellPriceFallback: number): number {
  const a = MOCK_LAB_PRICE_AGREEMENTS.find((x) => x.isActive && x.labId === labId && x.testId === testId);
  if (a) return a.labPrice;
  return Math.round(sellPriceFallback * DEFAULT_LAB_SHARE);
}

/** Compute a lab amount for the whole order, summing per item. */
export function computeOrderLabAmount(labId: string, items: { testId: string; priceSnapshot: number }[]): number {
  return items.reduce((s, it) => s + lookupLabPrice(labId, it.testId, it.priceSnapshot), 0);
}

// ─── Lab settlements ───────────────────────────────────────────────────────
// One historical paid settlement for lab-1 so admin/lab UI has data to show.
export const MOCK_LAB_SETTLEMENTS: LabSettlement[] = [
  {
    id: "ls-1", labId: "lab-1",
    periodStart: "2026-04-01", periodEnd: "2026-04-30",
    totalOrders: 1, totalLabAmount: 15, totalPaid: 15,
    status: "paid",
    notes: "تسوية شهر نيسان — مكتملة",
    createdAt: "2026-05-01T10:00:00Z",
  },
];

export const MOCK_LAB_SETTLEMENT_ITEMS: LabSettlementItem[] = [
  { id: "lsi-1", settlementId: "ls-1", orderId: "ord-1", labAmount: 15, status: "paid" },
];

// ─── Content pages (terms / privacy / support / FAQ) ───────────────────────
const _now = "2025-05-01T00:00:00Z";
export const MOCK_CONTENT_PAGES: ContentPage[] = [
  {
    id: "cp-terms",
    slug: "terms",
    titleAr: "الشروط والأحكام",
    isActive: true, updatedAt: _now,
    bodyAr:
`باستخدامك تطبيق مختبرك فإنك توافق على الشروط التالية:

1. الخدمة موجّهة للأشخاص في عمر 18 عاماً فأكثر، أو بإشراف وليّ أمر للقاصرين.
2. التزم بدقة المعلومات المُدخلة (اسم المريض، الهاتف، العنوان).
3. تُعتبر الزيارة مؤكدة فقط بعد ظهور حالة "تم تأكيد الموعد".
4. في حال إلغاء الزيارة بعد وصول الممرض، يحقّ للتطبيق احتساب رسم تحرك.
5. النتائج المخبرية مرجعية ولا تُغني عن استشارة الطبيب.
6. تحتفظ الإدارة بحق تعديل هذه الشروط مع إشعار مسبق ضمن التطبيق.`,
  },
  {
    id: "cp-privacy",
    slug: "privacy",
    titleAr: "سياسة الخصوصية",
    isActive: true, updatedAt: _now,
    bodyAr:
`نحن في مختبرك نأخذ خصوصيتك على محمل الجد:

• نجمع البيانات اللازمة فقط لتنفيذ الطلب: الاسم، الهاتف، العنوان، نوع الزيارة، النتائج.
• لا نشارك بياناتك مع أطراف ثالثة دون موافقتك، عدا المخبر المعتمد لتنفيذ التحاليل.
• النتائج تُحفظ بشكل مشفّر وتبقى متاحة لك ضمن طلباتك في أي وقت.
• يمكنك طلب حذف بياناتك بالتواصل مع فريق الدعم.
• تستخدم بعض المزايا التقنية ملفات تعريف على جهازك لحفظ تفضيلاتك (مثل طريقة الدفع المختارة).`,
  },
  {
    id: "cp-support",
    slug: "support",
    titleAr: "الدعم",
    supportPhone: "+963 11 200 0000",
    supportWhatsapp: "+963 911 000 000",
    isActive: true, updatedAt: _now,
    bodyAr:
`فريق الدعم متاح يومياً من الساعة 8 صباحاً حتى 8 مساءً.

نسعى للرد على رسائل واتساب خلال 15 دقيقة في أوقات الذروة.

عند التواصل، يُفضّل إرسال رقم الطلب لتسريع المعالجة.`,
  },
  {
    id: "cp-faq",
    slug: "faq",
    titleAr: "الأسئلة الشائعة",
    isActive: true, updatedAt: _now,
    bodyAr: "",
    faqItems: [
      { q: "هل يأتي الممرض إلى منزلي؟",       a: "نعم — جميع التحاليل تُؤخذ من منزلك ضمن دمشق وريف دمشق ضمن الأوقات المحدّدة." },
      { q: "كم تستغرق النتائج؟",               a: "أغلب التحاليل تكون جاهزة خلال 6 إلى 24 ساعة بعد أخذ العينة." },
      { q: "هل أحتاج إلى صيام قبل التحليل؟",   a: "بعض التحاليل تتطلّب الصيام (مثل سكر صائم وكوليسترول). تجد التعليمات في تفاصيل الطلب." },
      { q: "كيف أدفع؟",                         a: "نقداً عند وصول الممرض أو إلكترونياً بالبطاقة. اختيارك يُحفظ تلقائياً للطلبات القادمة." },
      { q: "هل يمكنني إلغاء الطلب؟",           a: "نعم قبل وصول الممرض. تواصل مع الدعم لإعادة الجدولة أو الإلغاء." },
    ],
  },
];

// ─── Order ratings ─────────────────────────────────────────────────────────
// Seeded with one rating for the historical completed-style order so the
// admin UI shows what filled-in ratings look like.
export const MOCK_ORDER_RATINGS: OrderRating[] = [
  {
    id: "rt-1", orderId: "ord-1", userId: SEED_CUSTOMER_1_ID,
    nurseId: SEED_NURSE_1_ID, labId: "lab-1",
    nurseRating: 5, labRating: 4, overallRating: 5,
    comment: "ممرض ودود، النتائج وصلت بسرعة.",
    createdAt: "2026-05-02T08:00:00Z",
  },
];

// ─── Instruction library (admin-curated catalog) ───────────────────────────
// Each row has a stable `key` used to dedupe across multiple tests in one
// order. The seed covers the most common pre-visit instructions so admin
// starts with a usable catalog.
export const MOCK_LIBRARY_INSTRUCTIONS: LibraryInstruction[] = [
  { id: "li-fast8",   key: "fasting_8h",       icon: "clock",     priority: 10, isActive: true,
    titleAr: "الصيام لمدة 8 ساعات",
    bodyAr:  "يُمتنع عن الطعام والشراب لمدة 8 ساعات قبل أخذ العينة (الماء مسموح)." },
  { id: "li-fast12",  key: "fasting_12h",      icon: "clock",     priority: 11, isActive: true,
    titleAr: "الصيام لمدة 12 ساعة",
    bodyAr:  "يُمتنع عن الطعام والمشروبات (عدا الماء) لمدة 12 ساعة قبل العينة." },
  { id: "li-water",   key: "water_only",       icon: "droplets",  priority: 20, isActive: true,
    titleAr: "اشرب الماء فقط أثناء الصيام",
    bodyAr:  "للحفاظ على ترطيب الجسم، يُسمح بشرب الماء فقط طوال فترة الصيام." },
  { id: "li-meds",    key: "avoid_meds",       icon: "pill",      priority: 30, isActive: true,
    titleAr: "تجنّب الأدوية إذا أوصى الطبيب",
    bodyAr:  "في حال طلب طبيبك إيقاف بعض الأدوية، يُرجى الالتزام بذلك قبل التحليل." },
  { id: "li-id",      key: "id_ready",         icon: "id-card",   priority: 40, isActive: true,
    titleAr: "جهّز هويتك الشخصية",
    bodyAr:  "اطّلع الممرض على هويتك الشخصية للتحقق قبل أخذ العينة." },
  { id: "li-clothes", key: "comfortable_arm",  icon: "shirt",     priority: 50, isActive: true,
    titleAr: "ارتدِ ملابس مريحة",
    bodyAr:  "تسهّل ملابس مريحة الوصول إلى الذراع لأخذ العينة بسهولة." },
  { id: "li-urine",   key: "morning_urine",    icon: "droplets",  priority: 25, isActive: true,
    titleAr: "البول الصباحي الأول",
    bodyAr:  "اجمع عينة البول الصباحية الأولى في عبوة نظيفة قبل وصول الممرض." },
];

// ─── Tool library (admin-curated catalog) ──────────────────────────────────
export const MOCK_LIBRARY_TOOLS: LibraryTool[] = [
  { id: "tl-needle",   nameAr: "إبرة سحب دم",     unit: "حبة",   isActive: true },
  { id: "tl-tube",     nameAr: "أنبوب دم",         unit: "أنبوب", isActive: true },
  { id: "tl-gloves",   nameAr: "قفازات",           unit: "زوج",   isActive: true },
  { id: "tl-swab",     nameAr: "مسحة كحول",        unit: "حبة",   isActive: true },
  { id: "tl-bandage",  nameAr: "لاصق طبي",         unit: "حبة",   isActive: true },
  { id: "tl-urinecup", nameAr: "عبوة بول",          unit: "عبوة", isActive: true },
  { id: "tl-labels",   nameAr: "ملصقات الترميز",    unit: "ورقة", isActive: true },
  { id: "tl-cooler",   nameAr: "حافظة باردة للنقل", unit: "وحدة", isActive: true },
];

// Defaults used by the morning prep checklist aggregation.
export const NURSE_CHECKLIST_DEFAULTS: NurseChecklistDefaults = {
  defaultToolIds: ["tl-labels", "tl-gloves"],
  bufferPct: 15,
};
