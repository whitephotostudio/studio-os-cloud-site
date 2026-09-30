/**
 * Studio OS tutorial series — one short video per panel, hosted on the
 * Studio OS Cloud YouTube channel and embedded on /tutorials.
 *
 * `youtubeId` is the watch id of the uploaded video; `chapters` mirror the
 * chapter markers in each video's YouTube description (seconds from start).
 */

export const tutorialsChannelUrl =
  "https://www.youtube.com/channel/UC2Ou4lxHAD9BrYq9qa303_Q";

/** YouTube playlist "Studio OS Tutorials" (all videos, in order). */
export const tutorialsPlaylistId = "PLQs7rvgosmJ0";

export type TutorialChapter = { at: number; label: string };

export type Tutorial = {
  /** Series number as shown on the card ("1", "3b", …). */
  number: string;
  slug: string;
  title: string;
  youtubeId: string;
  /** Length as displayed ("2:16"). */
  duration: string;
  /** Length in whole seconds (for schema.org duration). */
  seconds: number;
  blurb: string;
  chapters: TutorialChapter[];
};

export type TutorialGroup = {
  heading: string;
  intro: string;
  tutorials: Tutorial[];
};

const c = (at: number, label: string): TutorialChapter => ({ at, label });

export const tutorialGroups: TutorialGroup[] = [
  {
    heading: "Start here",
    intro: "What Studio OS is, and the three settings every job depends on.",
    tutorials: [
      {
        number: "1",
        slug: "welcome-to-studio-os",
        title: "Welcome to Studio OS",
        youtubeId: "2FpBc0ytVwc",
        duration: "1:26",
        seconds: 86,
        blurb:
          "A two-minute tour of the desktop app and Studio OS Cloud, and how the two halves stay in sync.",
        chapters: [
          c(0, "Welcome to Studio OS"),
          c(12, "The two halves: desktop app and cloud"),
          c(31, "The desktop app's panels"),
          c(51, "What clients see online"),
          c(64, "Everything stays in sync"),
          c(75, "How to use this series"),
        ],
      },
      {
        number: "2",
        slug: "getting-started",
        title: "Getting started",
        youtubeId: "ujnR4FTIn_c",
        duration: "2:16",
        seconds: 136,
        blurb:
          "Install, sign in, School vs Project mode, the school switcher, your hot folder, and the Import Hub.",
        chapters: [
          c(0, "Download, install and sign in"),
          c(21, "The green status pill"),
          c(33, "School mode vs Project mode"),
          c(59, "Picking a school in Admin"),
          c(71, "Set your hot folder"),
          c(93, "Import Hub: cloud, SD card, folder"),
          c(118, "Background tasks"),
        ],
      },
    ],
  },
  {
    heading: "Before picture day",
    intro: "Build the roster, hand out QR labels, and let families book their time.",
    tutorials: [
      {
        number: "3",
        slug: "admin",
        title: "Admin",
        youtubeId: "EaKSouv0b1g",
        duration: "2:22",
        seconds: 142,
        blurb:
          "Add a school, import the roster with a merge preview, add staff, and print QR labels with every student's ID and PIN.",
        chapters: [
          c(0, "What Admin is for"),
          c(15, "Add a school and import the CSV roster"),
          c(51, "Filter by class and track progress"),
          c(63, "Walk-ins, staff roles and renaming a class"),
          c(87, "IDs, PINs and QR codes"),
          c(100, "Print QR labels; online bookings in the roster"),
          c(119, "School link, exports and the Sorter shortcut"),
        ],
      },
      {
        number: "3b",
        slug: "roster-converter",
        title: "Roster Converter & editing",
        youtubeId: "nIxGNe8GTUY",
        duration: "3:24",
        seconds: 204,
        blurb:
          "Import any school spreadsheet: detect class headings, map Last, First names, fix rows in the preview, merge, and restore roster versions.",
        chapters: [
          c(0, "Why the XLSX Converter exists"),
          c(26, "Select the file and open the wizard"),
          c(47, "Class headings on the left"),
          c(70, "Map the name column, IDs and PINs"),
          c(97, "Build Preview and Use Import"),
          c(111, "Fix a row before it is saved"),
          c(133, "Remove a student from the preview"),
          c(143, "Import: merge or replace"),
          c(167, "The roster back in Admin"),
          c(181, "Roster versions and restore"),
        ],
      },
      {
        number: "4",
        slug: "schedule-and-bookings",
        title: "Schedule and bookings",
        youtubeId: "yUI9EXSGI10",
        duration: "2:51",
        seconds: 171,
        blurb:
          "Your calendar of shoots, online booking for picture day, confirmed appointments in the roster, and gallery-ready emails.",
        chapters: [
          c(0, "Your calendar of shoots"),
          c(22, "Month, week and day views"),
          c(35, "Shoot details and Open School"),
          c(59, "Set up client booking"),
          c(96, "What families see on the booking page"),
          c(116, "Appointments in the roster and gallery-ready emails"),
          c(138, "Add a shoot from the calendar"),
          c(159, "Remove from Calendar"),
        ],
      },
    ],
  },
  {
    heading: "Picture day",
    intro: "Every photo on the right student, with zero mix-ups.",
    tutorials: [
      {
        number: "5",
        slug: "photographer",
        title: "Photographer",
        youtubeId: "-GFexGzsOjI",
        duration: "3:18",
        seconds: 198,
        blurb:
          "Scan a label, shoot tethered, and the first frame becomes the best photo automatically. Walk-ins, staff, re-assign, fast review, and two stations.",
        chapters: [
          c(0, "The Photographer panel"),
          c(22, "Scan the QR label"),
          c(42, "Shoot with tethering"),
          c(65, "The first frame is the best photo"),
          c(92, "Next student, and Add Student on the spot"),
          c(120, "Add Staff and the side panel"),
          c(142, "Re-assign a photo"),
          c(162, "Fast review: focus, straighten, crop"),
          c(180, "Two stations and Station Merge"),
        ],
      },
    ],
  },
  {
    heading: "After the shoot",
    intro: "Pick the keepers, edit, sell backdrops, and build the class composite.",
    tutorials: [
      {
        number: "6",
        slug: "sorter",
        title: "Sorter",
        youtubeId: "9NbUZZYi-r8",
        duration: "2:11",
        seconds: 131,
        blurb:
          "AI Best, Needs Attention, price sheets you reuse across schools, sync to the parents portal, and yearbook export.",
        chapters: [
          c(0, "What Sorter is for"),
          c(15, "AI Best and Suggest Best"),
          c(34, "Best Photos and Needs Attention"),
          c(45, "Review and Develop"),
          c(58, "Edit Student"),
          c(68, "Packages and prices"),
          c(84, "Reusable price sheets"),
          c(96, "Sync to Cloud and Pull from Cloud"),
          c(108, "Yearbook Export and the trash folder"),
        ],
      },
      {
        number: "7",
        slug: "develop",
        title: "Develop",
        youtubeId: "pk91B-or69g",
        duration: "2:37",
        seconds: 157,
        blurb:
          "The built-in non-destructive editor: light, color, crop, detail, one-click background removal, backdrops, Photoshop actions, and sync.",
        chapters: [
          c(0, "The built-in editor"),
          c(21, "Light: white balance, tone and curve"),
          c(35, "Color: saturation, vibrance, HSL"),
          c(47, "Crop and Straighten, Batch Auto Align"),
          c(63, "Detail: vignette, denoise, sharpening"),
          c(75, "Remove Background"),
          c(89, "Backdrops with live preview"),
          c(101, "Photoshop actions round trip"),
          c(117, "Sync All and Auto Sync"),
          c(129, "Compare, undo, reset, presets and export"),
        ],
      },
      {
        number: "8",
        slug: "backdrops",
        title: "Backdrops",
        youtubeId: "6729eowSIs4",
        duration: "1:31",
        seconds: 91,
        blurb:
          "Digital backgrounds parents can buy: import a folder, set free or premium prices, show or hide, and push the catalog to the cloud.",
        chapters: [
          c(0, "What backdrops are"),
          c(12, "Import a folder of backdrops"),
          c(27, "Rename, recategorize, describe"),
          c(37, "Free or premium, with your price"),
          c(48, "Show or hide without deleting"),
          c(59, "Push to Cloud and Pull from Cloud"),
          c(77, "What parents see on the portal"),
        ],
      },
      {
        number: "9",
        slug: "composites",
        title: "Composites",
        youtubeId: "vAS7KGFGKNk",
        duration: "2:17",
        seconds: 137,
        blurb:
          "Class group images in minutes: portraits load themselves, Match Heads sizes every face the same, export JPG and PDF, save as a preset.",
        chapters: [
          c(0, "What Composites builds"),
          c(15, "Open a class: portraits load themselves"),
          c(29, "Template, background, center block and branding"),
          c(65, "Text and Branding, title font"),
          c(80, "Portrait Style and Cutout"),
          c(94, "Match Heads"),
          c(114, "Display names, export and save as a preset"),
        ],
      },
    ],
  },
  {
    heading: "Orders and delivery",
    intro: "Paper forms, every online order print-ready, and verified uploads to the cloud.",
    tutorials: [
      {
        number: "10",
        slug: "order-forms",
        title: "Order Forms",
        youtubeId: "agB0sV5Znuk",
        duration: "1:00",
        seconds: 60,
        blurb:
          "Personalized paper order forms with each student's photo, your Studio Profile and the gallery link, generated as one PDF.",
        chapters: [
          c(0, "Paper order forms"),
          c(11, "Your Studio Profile"),
          c(25, "Gallery link and who gets a form"),
          c(41, "Preview and Generate PDF"),
        ],
      },
      {
        number: "11",
        slug: "orders",
        title: "Orders",
        youtubeId: "sZjq_66iASU",
        duration: "2:32",
        seconds: 152,
        blurb:
          "From parent purchase to the lab: crop for print, retouch in Photoshop, Approve and Send to a hot folder or Noritsu, digital delivery, exports, refunds.",
        chapters: [
          c(0, "Where the money shows up"),
          c(21, "Filter, sort, search and status chips"),
          c(42, "Inside an order"),
          c(60, "Crop for print"),
          c(77, "Photoshop retouching, Approve and Send, Pickup Ready"),
          c(108, "Digital orders"),
          c(125, "CSV, PDF summary, packing slips, labels"),
          c(137, "Refunds and Protect Orders"),
        ],
      },
      {
        number: "12",
        slug: "cloud",
        title: "Cloud",
        youtubeId: "HLCu7XdE4ls",
        duration: "1:39",
        seconds: 99,
        blurb:
          "The bridge between your Mac and Studio OS Cloud: uploads that only read Done when verified, Verify Cloud, Recover from R2, Import Hub.",
        chapters: [
          c(0, "The bridge to Studio OS Cloud"),
          c(11, "School cards and upload status"),
          c(28, "Upload Selected: verified before Done"),
          c(45, "Verify Cloud and Already Uploaded"),
          c(64, "Recover from R2, the data agreement, Import Hub"),
          c(87, "The school is live"),
        ],
      },
    ],
  },
  {
    heading: "Running the studio",
    intro: "Rebook every school, quote and invoice, and run events the same way.",
    tutorials: [
      {
        number: "13",
        slug: "clients-and-sales",
        title: "Clients and Sales",
        youtubeId: "Z09akPGtDJs",
        duration: "2:07",
        seconds: 127,
        blurb:
          "A small CRM built for studios — booking cycles, follow-ups, quick emails — plus quotes that convert to invoices with one click.",
        chapters: [
          c(0, "A small CRM for studios"),
          c(18, "The client record"),
          c(31, "Booking cycles and follow-ups"),
          c(51, "Quick email with AI personalization"),
          c(65, "Tasks, reminders, location photos"),
          c(76, "Sales: from quote to invoice"),
          c(108, "Invoices and PIN protection"),
        ],
      },
      {
        number: "14",
        slug: "project-mode",
        title: "Project mode",
        youtubeId: "Wp6s6GImfIc",
        duration: "2:05",
        seconds: 125,
        blurb:
          "Weddings, sports, graduations and corporate events organized by albums, with branded galleries, visitor emails, and the same Orders panel.",
        chapters: [
          c(0, "Switch to Project mode"),
          c(21, "Project Admin"),
          c(38, "Import folders as albums"),
          c(59, "Project Sorter"),
          c(73, "Project price sheet"),
          c(87, "Sync to a branded gallery"),
          c(101, "Gallery visitors"),
          c(114, "Orders land in Orders"),
        ],
      },
    ],
  },
  {
    heading: "What your clients see",
    intro: "The parents portal, event galleries and the booking page from the other side.",
    tutorials: [
      {
        number: "15",
        slug: "studio-os-cloud",
        title: "Studio OS Cloud",
        youtubeId: "V7ItFgqh41I",
        duration: "1:13",
        seconds: 73,
        blurb:
          "Parents type a PIN and see only their child, pick prints and upgrades, and check out by card. Event galleries, the booking page, and the free trial.",
        chapters: [
          c(0, "What your clients see"),
          c(10, "Parents portal: PIN, packages, upgrades"),
          c(33, "Checkout and event galleries"),
          c(47, "Booking page, free trial and download"),
        ],
      },
    ],
  },
];

export const tutorials: Tutorial[] = tutorialGroups.flatMap((group) => group.tutorials);

export function tutorialWatchUrl(tutorial: Tutorial): string {
  return tutorialsPlaylistId
    ? `https://www.youtube.com/watch?v=${tutorial.youtubeId}&list=${tutorialsPlaylistId}`
    : `https://www.youtube.com/watch?v=${tutorial.youtubeId}`;
}

export function tutorialThumbnailUrl(tutorial: Tutorial): string {
  return `https://i.ytimg.com/vi/${tutorial.youtubeId}/hqdefault.jpg`;
}

export function formatIsoDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `PT${minutes}M${rest}S`;
}

export function formatTimestamp(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}
