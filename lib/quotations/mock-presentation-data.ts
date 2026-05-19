import { FALLBACK_COMPANY_PROFILE, type CompanyProfile } from "@/lib/company-profile";
import {
  normalizePresentationSettings,
  type QuotationPresentationSettings,
} from "@/lib/quotations/presentation-settings";

type MockPresentationQuotation = {
  id: string;
  quotation_no: string | null;
  title: string;
  quotation_date: string;
};

type MockPresentationClient = {
  id: string;
  company_name: string;
} | null;

type MockPresentationProject = {
  id: string;
  project_name: string | null;
  location: string | null;
  attention_to: string | null;
} | null;

type MockPresentationSection = {
  id: string;
  section_title: string;
  section_notes: string | null;
  parent_section_id: string | null;
  section_kind: "main" | "sub";
  sort_order: number;
  is_active: boolean;
};

type MockPresentationItem = {
  id: string;
  section_id: string | null;
  item_type: string;
  manual_serial: string | null;
  item_code_snapshot: string | null;
  item_name_snapshot: string | null;
  brand_name_snapshot: string | null;
  category_name_snapshot: string | null;
  specified_image_url_snapshot: string | null;
  proposed_image_url_snapshot: string | null;
  specification_snapshot: string | null;
  finish_selections_snapshot: unknown;
  room_name_snapshot: string | null;
  model_snapshot: string | null;
  finish_snapshot: string | null;
  size_snapshot: string | null;
  origin_snapshot: string | null;
  warranty_snapshot: string | null;
  supplier_name_snapshot: string | null;
  sort_order: number;
  line_style: string;
  is_active: boolean;
  cell_layout: {
    images?: Record<string, unknown>;
  } | null;
};

type MockPreviewLayoutMode = "single" | "two_per_page";
type MockPreviewFinishesMode = "on" | "off";
type MockPreviewScaleMode = "default" | "zoomed";

type MockPresentationPreviewOptions = {
  finishes: MockPreviewFinishesMode;
  layout: MockPreviewLayoutMode;
  scale: MockPreviewScaleMode;
};

export type MockPresentationPreviewData = {
  client: MockPresentationClient;
  companyProfile: CompanyProfile;
  finishImageUrlByItemAndFinishId: Record<string, string | null>;
  imageUrlByItemId: Record<string, string | null>;
  initialSettings: QuotationPresentationSettings;
  items: MockPresentationItem[];
  mainLayoutImageUrlById: Record<string, string | null>;
  presentationOverrideImageUrlByItemId: Record<string, string | null>;
  project: MockPresentationProject;
  quotation: MockPresentationQuotation;
  sectionOverrideImageUrlBySectionAndField: Record<string, string | null>;
  sections: MockPresentationSection[];
};

function svgDataUrl(
  title: string,
  lines: string[],
  options?: { accent?: string; background?: string; shape?: "wide" | "tall" | "plan" | "swatch" },
) {
  const background = options?.background ?? "#f5f7fa";
  const accent = options?.accent ?? "#1f2937";
  const shape = options?.shape ?? "wide";
  const lineMarkup = lines
    .map((line, index) => `<text x="50%" y="${56 + index * 26}" text-anchor="middle" font-family="Arial, sans-serif" font-size="20" fill="#475569">${line}</text>`)
    .join("");
  const centerShape = shape === "tall"
    ? `<rect x="310" y="110" width="180" height="420" rx="36" fill="${accent}" opacity="0.18"/><rect x="340" y="140" width="120" height="260" rx="26" fill="${accent}" opacity="0.38"/><rect x="360" y="398" width="80" height="100" rx="18" fill="${accent}" opacity="0.52"/>`
    : shape === "plan"
      ? `<rect x="120" y="120" width="560" height="320" rx="24" fill="#ffffff" stroke="${accent}" stroke-width="8"/><path d="M240 120V440M420 120V440M120 280H680" stroke="${accent}" stroke-width="6" stroke-dasharray="18 14" opacity="0.45"/><circle cx="240" cy="280" r="18" fill="${accent}" opacity="0.28"/><circle cx="420" cy="280" r="18" fill="${accent}" opacity="0.28"/><circle cx="600" cy="280" r="18" fill="${accent}" opacity="0.28"/>`
      : shape === "swatch"
        ? `<rect x="80" y="70" width="640" height="420" rx="28" fill="${accent}" opacity="0.82"/>`
        : `<rect x="120" y="170" width="560" height="180" rx="28" fill="${accent}" opacity="0.18"/><rect x="170" y="205" width="460" height="110" rx="20" fill="${accent}" opacity="0.38"/><rect x="220" y="325" width="40" height="120" rx="12" fill="${accent}" opacity="0.48"/><rect x="540" y="325" width="40" height="120" rx="12" fill="${accent}" opacity="0.48"/>`;

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" role="img" aria-label="${title}">
      <rect width="800" height="600" fill="${background}"/>
      <rect x="36" y="36" width="728" height="528" rx="32" fill="#ffffff" stroke="#d6dce5" stroke-width="4"/>
      ${centerShape}
      <text x="50%" y="120" text-anchor="middle" font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="${accent}">${title}</text>
      ${lineMarkup}
    </svg>
  `;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function finishSelection(
  id: string,
  groupLabel: string,
  finishCode: string,
  finishName: string,
  finishDescription: string,
) {
  return {
    id,
    group_label: groupLabel,
    finish_code: finishCode,
    finish_name: finishName,
    finish_description: finishDescription,
    show_in_specification: true,
    type: "finish",
  };
}

export function buildMockPresentationPreviewData(
  options: MockPresentationPreviewOptions,
): MockPresentationPreviewData {
  const project = {
    id: "mock-project",
    project_name: "Noa Workplace Experience Centre",
    location: "Dubai Design District",
    attention_to: null,
  } satisfies NonNullable<MockPresentationProject>;
  const client = {
    id: "mock-client",
    company_name: "Acme Advisory Group",
  } satisfies NonNullable<MockPresentationClient>;
  const quotation = {
    id: "mock-quotation-presentation-preview",
    quotation_no: "Q-DEV-2026-019",
    title: "Workplace Furniture Presentation",
    quotation_date: "2026-05-19",
  } satisfies MockPresentationQuotation;

  const sections: MockPresentationSection[] = [
    { id: "main-ground-floor", section_title: "Ground Floor", section_notes: "Arrival, leadership, and front-of-house areas.", parent_section_id: null, section_kind: "main", sort_order: 1, is_active: true },
    { id: "section-manager", section_title: "Manager", section_notes: "Private office focused on executive storage and a calm materials mix.", parent_section_id: "main-ground-floor", section_kind: "sub", sort_order: 1, is_active: true },
    { id: "section-ceo", section_title: "CEO", section_notes: "Statement furniture with cleaner silhouettes and visitor seating.", parent_section_id: "main-ground-floor", section_kind: "sub", sort_order: 2, is_active: true },
    { id: "main-first-floor", section_title: "First Floor", section_notes: "Team collaboration and client-facing meeting settings.", parent_section_id: null, section_kind: "main", sort_order: 2, is_active: true },
    { id: "section-workstation", section_title: "Workstation Area", section_notes: "Open-plan desking with task seating and screens.", parent_section_id: "main-first-floor", section_kind: "sub", sort_order: 1, is_active: true },
    { id: "section-meeting-room", section_title: "Meeting Room", section_notes: "Compact collaboration zone for internal workshops and presentations.", parent_section_id: "main-first-floor", section_kind: "sub", sort_order: 2, is_active: true },
  ];

  const items: MockPresentationItem[] = [
    {
      id: "item-wide-desk",
      section_id: "section-manager",
      item_type: "product",
      manual_serial: "01",
      item_code_snapshot: "LEAD-1800",
      item_name_snapshot: "Lead Executive Desk",
      brand_name_snapshot: "Noa Collection",
      category_name_snapshot: "Executive Desking",
      specified_image_url_snapshot: null,
      proposed_image_url_snapshot: svgDataUrl("Executive Desk", ["Wide desk test", "Long specification example"], { accent: "#1d4ed8", shape: "wide" }),
      specification_snapshot: "A premium executive workstation with integrated cable access, return storage, modesty panel, and a durable commercial-grade finish specification intended to test longer product copy inside the fixed content area without pushing the footer.",
      finish_selections_snapshot: [
        finishSelection("wood-walnut", "WOOD FINISHES", "07", "Classic Walnut", "Warm walnut veneer with matte open-pore finish."),
        finishSelection("metal-grey", "METAL FINISHES", "GR M1", "Ice Grey", "Powder-coated structural metal support frame."),
      ],
      room_name_snapshot: "Manager",
      model_snapshot: "LEAD-1800-R",
      finish_snapshot: "Classic Walnut / Ice Grey",
      size_snapshot: "1800 W x 800 D x 750 H",
      origin_snapshot: "Italy",
      warranty_snapshot: "5 years",
      supplier_name_snapshot: "Noa Offices",
      sort_order: 1,
      line_style: "standard",
      is_active: true,
      cell_layout: null,
    },
    {
      id: "item-tall-chair",
      section_id: "section-manager",
      item_type: "product",
      manual_serial: "02",
      item_code_snapshot: "ELITE-CH",
      item_name_snapshot: "Elite Task Chair",
      brand_name_snapshot: "Orion Seating",
      category_name_snapshot: "Task Seating",
      specified_image_url_snapshot: null,
      proposed_image_url_snapshot: svgDataUrl("Task Chair", ["Tall cut-out test", "Contain fit check"], { accent: "#0f766e", shape: "tall" }),
      specification_snapshot: "Mesh-backed ergonomic task chair with synchronized mechanism, adjustable arms, lumbar support, and polished base.",
      finish_selections_snapshot: [
        finishSelection("fabric-grey", "FABRIC FINISH", "Grey", "Grey", "Neutral textured fabric finish for seat upholstery."),
      ],
      room_name_snapshot: "Manager",
      model_snapshot: "ELITE-PRO",
      finish_snapshot: "Grey Fabric",
      size_snapshot: "680 W x 680 D x 980-1080 H",
      origin_snapshot: "Germany",
      warranty_snapshot: "5 years",
      supplier_name_snapshot: "Noa Offices",
      sort_order: 2,
      line_style: "standard",
      is_active: true,
      cell_layout: null,
    },
    {
      id: "item-hidden-storage",
      section_id: "section-ceo",
      item_type: "product",
      manual_serial: "03",
      item_code_snapshot: "STORE-LOW",
      item_name_snapshot: "Low Storage Credenza",
      brand_name_snapshot: "Noa Collection",
      category_name_snapshot: "Storage",
      specified_image_url_snapshot: null,
      proposed_image_url_snapshot: svgDataUrl("Storage Credenza", ["Hidden item test"], { accent: "#7c3aed", shape: "wide" }),
      specification_snapshot: "Hidden in the mock presentation flow to verify filtering and numbering.",
      finish_selections_snapshot: [],
      room_name_snapshot: "CEO",
      model_snapshot: "STORE-LOW",
      finish_snapshot: null,
      size_snapshot: "1600 W x 450 D x 700 H",
      origin_snapshot: "Turkey",
      warranty_snapshot: "3 years",
      supplier_name_snapshot: "Noa Offices",
      sort_order: 1,
      line_style: "standard",
      is_active: true,
      cell_layout: null,
    },
    {
      id: "item-workstation-bench",
      section_id: "section-workstation",
      item_type: "product",
      manual_serial: "04",
      item_code_snapshot: "OXI-P-140",
      item_name_snapshot: "Oxi_P Bench Workstation",
      brand_name_snapshot: "Las Mobili",
      category_name_snapshot: "Workstations",
      specified_image_url_snapshot: null,
      proposed_image_url_snapshot: svgDataUrl("Bench Workstation", ["Wide workstation pair"], { accent: "#b45309", shape: "wide" }),
      specification_snapshot: "Bench desking system with central leg profile, shared access points, and clean collaborative planning geometry.",
      finish_selections_snapshot: [],
      room_name_snapshot: "Workstation Area",
      model_snapshot: null,
      finish_snapshot: null,
      size_snapshot: null,
      origin_snapshot: "Italy",
      warranty_snapshot: null,
      supplier_name_snapshot: null,
      sort_order: 1,
      line_style: "standard",
      is_active: true,
      cell_layout: null,
    },
    {
      id: "item-meeting-table",
      section_id: "section-meeting-room",
      item_type: "product",
      manual_serial: "05",
      item_code_snapshot: "MEET-2400",
      item_name_snapshot: "Meeting Table",
      brand_name_snapshot: "Noa Collection",
      category_name_snapshot: "Meeting Tables",
      specified_image_url_snapshot: null,
      proposed_image_url_snapshot: svgDataUrl("Meeting Table", ["Wide table test"], { accent: "#be123c", shape: "wide" }),
      specification_snapshot: "Rectangular meeting table with cable access and slim structural frame.",
      finish_selections_snapshot: [],
      room_name_snapshot: "Meeting Room",
      model_snapshot: "MEET-2400",
      finish_snapshot: null,
      size_snapshot: "2400 W x 1200 D x 750 H",
      origin_snapshot: "UAE",
      warranty_snapshot: "2 years",
      supplier_name_snapshot: "Noa Offices",
      sort_order: 1,
      line_style: "standard",
      is_active: true,
      cell_layout: null,
    },
    {
      id: "item-meeting-chair",
      section_id: "section-meeting-room",
      item_type: "product",
      manual_serial: "06",
      item_code_snapshot: "VIS-01",
      item_name_snapshot: "Visitor Chair",
      brand_name_snapshot: "Orion Seating",
      category_name_snapshot: "Visitor Seating",
      specified_image_url_snapshot: null,
      proposed_image_url_snapshot: svgDataUrl("Visitor Chair", ["Tall chair pair"], { accent: "#2563eb", shape: "tall" }),
      specification_snapshot: null,
      finish_selections_snapshot: [],
      room_name_snapshot: "Meeting Room",
      model_snapshot: null,
      finish_snapshot: null,
      size_snapshot: null,
      origin_snapshot: null,
      warranty_snapshot: null,
      supplier_name_snapshot: null,
      sort_order: 2,
      line_style: "standard",
      is_active: true,
      cell_layout: null,
    },
  ];

  const imageUrlByItemId = Object.fromEntries(
    items.map((item) => [item.id, item.proposed_image_url_snapshot ?? item.specified_image_url_snapshot ?? null] as const),
  );
  const finishImageUrlByItemAndFinishId: Record<string, string | null> = options.finishes === "off"
    ? {}
    : {
        "item-wide-desk:wood-walnut": svgDataUrl("Classic Walnut", ["WOOD FINISHES", "07 | Classic Walnut"], { accent: "#8b5e3c", background: "#f8f5ef", shape: "swatch" }),
        "item-wide-desk:metal-grey": svgDataUrl("Ice Grey", ["METAL FINISHES", "GR M1 | Ice Grey"], { accent: "#9ca3af", background: "#f4f6f8", shape: "swatch" }),
        "item-tall-chair:fabric-grey": svgDataUrl("Grey Fabric", ["FABRIC FINISH", "Grey"], { accent: "#6b7280", background: "#f5f5f5", shape: "swatch" }),
      };
  const mainLayoutImageUrlById = {
    "main-ground-floor": svgDataUrl("Ground Floor Plan", ["Main area layout placeholder"], { accent: "#0f766e", shape: "plan" }),
    "main-first-floor": svgDataUrl("First Floor Plan", ["Main area layout placeholder"], { accent: "#1d4ed8", shape: "plan" }),
  };
  const sectionOverrideImageUrlBySectionAndField = {
    "section-manager:areaImageUrl": svgDataUrl("Manager Mood Image", ["Area image placeholder"], { accent: "#8b5cf6", shape: "wide" }),
    "section-manager:sectionLayoutImageUrl": svgDataUrl("Manager Snapshot", ["Section layout snapshot"], { accent: "#334155", shape: "plan" }),
    "section-workstation:areaImageUrl": svgDataUrl("Workstation Area", ["Area image placeholder"], { accent: "#0284c7", shape: "wide" }),
    "section-workstation:sectionLayoutImageUrl": svgDataUrl("Workstation Snapshot", ["Section layout snapshot"], { accent: "#0f172a", shape: "plan" }),
  };
  const presentationOverrideImageUrlByItemId = {
    "item-workstation-bench": svgDataUrl("Workstation Override", ["Presentation image override"], { accent: "#ca8a04", shape: "wide" }),
  };
  const includeFinishes = options.finishes === "on";
  const layoutMode = options.layout;
  const scaleMultiplier = options.scale === "zoomed" ? 1.15 : 1;

  const initialSettings = normalizePresentationSettings({
    hiddenItemIds: ["item-hidden-storage"],
    layoutMode,
    contentVisibility: layoutMode === "two_per_page"
      ? { specification: false, dimensions: false, finishes: false, brand: true, origin: true, model: false, code: true }
      : { specification: true, dimensions: true, finishes: includeFinishes, brand: true, origin: true, model: true, code: true },
    pageVisibility: { cover: true, designConsiderations: true, mainLayoutPages: true, sectionDividers: true, thankYou: true },
    mainSectionOverrides: {
      "main-ground-floor": { title: "Ground Floor", note: "Leadership and reception-facing furniture selections.", layoutImageUrl: mainLayoutImageUrlById["main-ground-floor"] },
      "main-first-floor": { title: "First Floor", note: "Collaboration, desking, and meeting presentation flow.", layoutImageUrl: mainLayoutImageUrlById["main-first-floor"] },
    },
    sectionOverrides: {
      "section-manager": { title: "Manager", note: "Executive workspace with premium desking and task seating.", areaImageUrl: sectionOverrideImageUrlBySectionAndField["section-manager:areaImageUrl"] ?? "", sectionLayoutImageUrl: sectionOverrideImageUrlBySectionAndField["section-manager:sectionLayoutImageUrl"] ?? "" },
      "section-workstation": { title: "Workstation Area", note: "Open-plan benching and support seating for team collaboration.", areaImageUrl: sectionOverrideImageUrlBySectionAndField["section-workstation:areaImageUrl"] ?? "", sectionLayoutImageUrl: sectionOverrideImageUrlBySectionAndField["section-workstation:sectionLayoutImageUrl"] ?? "" },
    },
    coverOverrides: {
      title: "Workplace Furniture Presentation",
      subtitle: "Development preview using mock data for visual QA of slides, layouts, and print output.",
      projectDisplayName: project.project_name ?? "",
      clientDisplayName: client.company_name,
      preparedBy: "Noa Offices",
      website: "www.noaoffices.com",
    },
    closingOverrides: {
      title: "Thank You",
      message: "Development preview only. Review layout, flow, image fit, and print output without using live quotation data.",
      website: "www.noaoffices.com",
      email: "info@noaoffices.com",
      phone: "+971 4 380 9234",
      officeDetails: "Dubai / Abu Dhabi, United Arab Emirates",
    },
    itemOverrides: {
      "item-wide-desk": { imageUrl: "", imageFit: "contain", imagePosition: "center", imageScale: Number((1 * scaleMultiplier).toFixed(2)) },
      "item-tall-chair": { imageUrl: "", imageFit: "contain", imagePosition: "center", imageScale: Number((0.9 * scaleMultiplier).toFixed(2)) },
      "item-workstation-bench": { imageUrl: presentationOverrideImageUrlByItemId["item-workstation-bench"] ?? "", imageFit: "cover", imagePosition: "center", imageScale: Number((0.95 * scaleMultiplier).toFixed(2)) },
      "item-meeting-table": { imageUrl: "", imageFit: "contain", imagePosition: "center", imageScale: Number((1.05 * scaleMultiplier).toFixed(2)) },
    },
    flowOrder: {
      mainSectionKeys: ["main-ground-floor", "main-first-floor"],
      sectionKeysByMain: {
        "main-ground-floor": ["section-manager", "section-ceo"],
        "main-first-floor": ["section-workstation", "section-meeting-room"],
      },
      itemIdsBySection: {
        "section-manager": ["item-wide-desk", "item-tall-chair"],
        "section-ceo": ["item-hidden-storage"],
        "section-workstation": ["item-workstation-bench"],
        "section-meeting-room": ["item-meeting-table", "item-meeting-chair"],
      },
    },
    updatedAt: "2026-05-19T10:00:00.000Z",
  });

  return {
    client,
    companyProfile: {
      ...FALLBACK_COMPANY_PROFILE,
      companyName: "Noa Offices",
      displayName: "Noa Offices",
      email: "info@noaoffices.com",
      logoPath: "/noa-logo.png",
      logoUrl: "/noa-logo.png",
      name: "Noa Offices",
      phone: "+971 4 380 9234",
      website: "www.noaoffices.com",
    },
    finishImageUrlByItemAndFinishId,
    imageUrlByItemId,
    initialSettings,
    items,
    mainLayoutImageUrlById,
    presentationOverrideImageUrlByItemId,
    project,
    quotation,
    sectionOverrideImageUrlBySectionAndField,
    sections,
  };
}
