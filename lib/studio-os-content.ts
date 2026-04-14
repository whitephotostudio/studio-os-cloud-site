export type StudioPanelIcon =
  | "admin"
  | "photographer"
  | "orderForms"
  | "sorter"
  | "backdrops"
  | "composites"
  | "orders"
  | "cloud";

export type StudioPanel = {
  id: string;
  title: string;
  subtitle: string;
  icon: StudioPanelIcon;
  screenshot: string;
  thumbnail?: string;
  description: string;
  features: string[];
  badge?: string;
  alt: string;
  accent: {
    color: string;
    bg: string;
    border: string;
  };
};

export type StudioVisualAsset = {
  src?: string;
  alt: string;
  label: string;
  hint: string;
  objectPosition?: string;
};

export type UseCaseVisual = {
  id: string;
  title: string;
  label: string;
  description: string;
  src?: string;
  plannedImagePath: string;
  alt: string;
};

// Swap these paths as approved marketing exports land without changing layout code.
export const studioPanels: StudioPanel[] = [
  {
    id: "admin",
    title: "Admin",
    subtitle: "Schools · events · client info",
    icon: "admin",
    screenshot: "/images/studio-os/admin.jpg",
    description:
      "Keep every school, event, and client organized from one place — so you always know where every job stands.",
    features: [
      "School and event setup",
      "Client information",
      "Job organization",
      "Workflow control",
      "Easy roster import with history",
      "Auto PIN creation in seconds",
    ],
    badge: "Control center",
    alt: "Studio OS admin panel managing schools, imports, and student data.",
    accent: {
      color: "#EF4444",
      bg: "#fef2f2",
      border: "#fecaca",
    },
  },
  {
    id: "photographer",
    title: "Photographer",
    subtitle: "QR scan · tethered capture · zero mix-ups",
    icon: "photographer",
    screenshot: "/images/studio-os/photographer-panel-v2.jpg",
    description:
      "Keep photo day moving without stopping to fix mistakes. Scan, confirm, and shoot — every session stays organized from the first frame.",
    features: [
      "Direct camera tethering",
      "QR scan workflow",
      "Instant student confirmation",
      "Faster capture pace",
      "No mix-ups, no corrections later",
    ],
    badge: "Capture-ready",
    alt: "Studio OS photographer panel with live capture, roster search, and selected student preview.",
    accent: {
      color: "#3B82F6",
      bg: "#eff6ff",
      border: "#bfdbfe",
    },
  },
  {
    id: "orderForms",
    title: "Order Forms",
    subtitle: "Per-student order management",
    icon: "orderForms",
    screenshot: "/images/studio-os/order-forms-main.png",
    description:
      "Get every order right before it goes to production — packages confirmed, information collected, nothing missed.",
    features: [
      "Per-student setup",
      "Package tracking",
      "Data collection",
      "Order prep",
    ],
    badge: "Package builder",
    alt: "Studio OS order form modal showing package setup and selected prints for a student.",
    accent: {
      color: "#10B981",
      bg: "#f0fdf4",
      border: "#bbf7d0",
    },
  },
  {
    id: "sorter",
    title: "Sorter",
    subtitle: "Batch sort · crop · select",
    icon: "sorter",
    screenshot: "/images/studio-os/sorter-panel.jpg",
    description:
      "Stay organized from the first photo. Sort, crop, and prepare images faster — what used to take hours now takes minutes.",
    features: [
      "AI background removal",
      "Batch sorting",
      "Crop workflow",
      "Selection tools",
      "One-click yearbook export",
      "Send to print from Sorter",
      "In-house order workflow",
    ],
    badge: "Batch workflow",
    alt: "Studio OS sorter panel showing a selected portrait, editing controls, and a bottom filmstrip for batch review.",
    accent: {
      color: "#F97316",
      bg: "#fff7ed",
      border: "#fed7aa",
    },
  },
  {
    id: "backdrops",
    title: "Backdrops",
    subtitle: "Cloud sync · pricing · parent previews",
    icon: "backdrops",
    screenshot: "/images/studio-os/backdrops-panel.jpg",
    description:
      "Turn background upgrades into a revenue stream. Offer premium backdrops online, set your own pricing, and let parents choose — no extra work for you.",
    features: [
      "Sync backdrop library to Studio OS Cloud",
      "In-house AI removal workflow from Sorter",
      "Set which backdrops are free or premium",
      "Control upgrade pricing",
      "Parent-facing backdrop availability",
      "See which backdrops sell best",
    ],
    badge: "Revenue-ready",
    alt: "Studio OS backdrops panel with backdrop library filters and available background options.",
    accent: {
      color: "#8B5CF6",
      bg: "#faf5ff",
      border: "#e9d5ff",
    },
  },
  {
    id: "composites",
    title: "Composites",
    subtitle: "One-click AI builder · full control",
    icon: "composites",
    screenshot: "/images/studio-os/composites-builder-main.png",
    description:
      "Stop building composites manually. One click generates a professional class composite — AI handles the layout, you add your branding, and it auto-assigns to the right class.",
    features: [
      "One-click AI class composites",
      "AI head sizing and crop alignment",
      "Manual full control",
      "Fast logo and branding insert",
      "Auto-assign composites to classes",
      "Separate composite pricing from portraits",
      "Print-ready export",
    ],
    badge: "AI-powered",
    alt: "Studio OS composites builder showing a live class composite layout with logo placement and adjustable student portraits.",
    accent: {
      color: "#14B8A6",
      bg: "#f0fdfa",
      border: "#99f6e4",
    },
  },
  {
    id: "orders",
    title: "Orders",
    subtitle: "Auto-matched · print-ready",
    icon: "orders",
    screenshot: "/images/studio-os/orders-panel.jpg",
    description:
      "Review every order before it goes to production. Photos matched to the right student, everything confirmed — no surprises, no reprints.",
    features: [
      "Automatic order matching",
      "Print-ready jobs",
      "Fulfillment prep",
      "Full order review before production",
    ],
    badge: "Fulfillment",
    alt: "Studio OS orders panel with print order filters, order items, and printing actions.",
    accent: {
      color: "#F59E0B",
      bg: "#fffbeb",
      border: "#fde68a",
    },
  },
  {
    id: "cloud",
    title: "Cloud",
    subtitle: "Sync · galleries · clients",
    icon: "cloud",
    screenshot: "/images/studio-os/cloud-panel.jpg",
    description:
      "Your desktop workflow connects directly to online galleries, parent ordering, and final delivery — everything stays in sync automatically.",
    features: [
      "Live gallery sync",
      "Instant cloud access",
      "Parent delivery links",
      "Organized per-job distribution",
    ],
    badge: "Live sync",
    alt: "Studio OS cloud sync screen showing school sync progress and upload status cards.",
    accent: {
      color: "#0EA5E9",
      bg: "#f0f9ff",
      border: "#bae6fd",
    },
  },
];

export const studioFeatureAssets = {
  backdrops: {
    before: {
      src: "/images/studio-os/backdrops-before-tight.png",
      alt: "Original student portrait against a light blue backdrop before background removal.",
      label: "Original portrait",
      hint: "Original capture",
      objectPosition: "center 8%",
    },
    processed: {
      src: "/images/studio-os/backdrops-processed-v2.jpg",
      alt: "Studio OS crop workflow showing a processed portrait ready for print.",
      label: "Processed crop",
      hint: "Current app capture",
      objectPosition: "left top",
    },
    live: {
      src: "/images/studio-os/backdrops-live.png",
      alt: "Studio OS backdrop preview showing a portrait with a replacement background applied.",
      label: "Live preview",
      hint: "Backdrop preview in app",
      objectPosition: "center top",
    },
  },
  scan: [
    {
      src: "/images/studio-os/scan-qr-1-v2.jpg",
      alt: "Studio OS DYMO labels screen with a live QR label preview and student roster details.",
      label: "QR check-in",
      hint: "DYMO labels and QR workflow",
      objectPosition: "center center",
    },
    {
      src: "/images/studio-os/scan-qr-2-v2.jpg",
      alt: "Studio OS portrait review screen with recent captures and a selected student image.",
      label: "Student confirmation",
      hint: "Live capture confirmation",
      objectPosition: "70% center",
    },
  ] satisfies [StudioVisualAsset, StudioVisualAsset],
  composites: {
    src: "/images/studio-os/composites-builder-main.png",
    alt: "Studio OS composites builder showing a live class composite preview with logo placement and student portraits.",
    label: "AI composite builder",
    hint: "Live class composite editor",
    objectPosition: "center center",
  },
  excel: {
    src: "/images/studio-os/excel-roster-wizard.png",
    alt: "Studio OS roster import wizard showing spreadsheet column mapping and roster setup tools.",
    label: "Roster import",
    hint: "Built-in roster conversion",
    objectPosition: "center top",
  },
  cloud: {
    src: "/images/studio-os/cloud-panel.jpg",
    alt: "Studio OS cloud sync screen with school upload progress and sync status cards.",
    label: "Studio Cloud sync",
    hint: "Live upload progress",
    objectPosition: "center top",
  },
  cloudGallery: {
    src: "/images/studio-os/cloud-gallery-website.png",
    alt: "Studio OS client gallery storefront showing a portrait preview with backdrop browsing controls.",
    label: "Client gallery preview",
    hint: "Website gallery and backdrop browser",
    objectPosition: "center top",
  },
} as const;

// These homepage slots stay ready for the final use-case photography drop.
export const studioUseCases: UseCaseVisual[] = [
  {
    id: "school",
    title: "School Photography",
    label: "School day",
    description:
      "Prepared for student portraits, roster-driven capture, and class-day storytelling imagery.",
    src: "/images/use-cases/school-main.jpg",
    plannedImagePath: "/images/use-cases/school-main.jpg",
    alt: "Graduate portrait session in a studio setup for Studio OS school-day photography use cases.",
  },
  {
    id: "corporate",
    title: "Corporate Events",
    label: "Corporate",
    description:
      "Ready for conference coverage, team headshots, and polished event-delivery proof.",
    src: "/images/use-cases/corporate-main.jpg",
    plannedImagePath: "/images/use-cases/corporate-main.jpg",
    alt: "Professional corporate portrait at a desk for Studio OS business and event photography use cases.",
  },
  {
    id: "wedding",
    title: "Weddings",
    label: "Wedding",
    description:
      "A clean slot for future wedding visuals without turning the homepage into a gallery.",
    src: "/images/use-cases/wedding-main.png",
    plannedImagePath: "/images/use-cases/wedding-main.png",
    alt: "Wedding portrait session with a photographer capturing the couple for Studio OS use-case imagery.",
  },
];
