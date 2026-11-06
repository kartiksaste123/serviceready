/** Guided-tour content. Targets are `data-tour="<id>"` attributes in the desk UI. */
export type TourStep = {
  /** data-tour id to spotlight; omit for a centred card. */
  target?: string;
  title: string;
  body: string;
};

export type TourId =
  | "welcome"
  | "bookings"
  | "approvals"
  | "payments"
  | "catalog"
  | "quote"
  | "connect"
  | "settings"
  | "log";

export const TOURS: Record<TourId, { label: string; steps: TourStep[] }> = {
  welcome: {
    label: "Welcome tour",
    steps: [
      {
        title: "Welcome to ServiceReady 👋",
        body: "ServiceReady turns your services into a bookable storefront. Clients (or their AI assistants) request a quote, pay a deposit with PayPal, and you get paid the balance when you deliver. Here's a 1-minute tour.",
      },
      {
        target: "nav-storefront",
        title: "Your storefront",
        body: "Your public booking page. Share this link anywhere — clients pick a service, get an instant quote and pay the deposit right there.",
      },
      {
        target: "nav-catalog",
        title: "Services & prices",
        body: "Set what you sell: title, price, deposit % and what's included. Add a cover image (upload or generate with AI). This is exactly what clients and AI assistants can book.",
      },
      {
        target: "nav-bookings",
        title: "Bookings",
        body: "Every client request lands here, from quote → deposit paid → delivered → fully paid. Open a booking to start work or send the final invoice.",
      },
      {
        target: "nav-payments",
        title: "PayPal deposit & invoice",
        body: "Clients pay a deposit through PayPal when they book. When you mark a job delivered, a PayPal invoice for the balance is sent automatically. Unpaid balances show up in Payments due.",
      },
      {
        target: "nav-approvals",
        title: "Approvals",
        body: "Your AI assistant drafts follow-ups like payment reminders. Nothing is sent to a client until you approve it here.",
      },
      {
        target: "nav-connect",
        title: "AI assistants",
        body: "Connect Claude, ChatGPT or a browser assistant so they can quote and book your services for clients.",
      },
      {
        target: "tutorial-btn",
        title: "Replay anytime",
        body: "Each page has a Tutorial button that walks you through just that section. You're all set!",
      },
    ],
  },
  bookings: {
    label: "Bookings tutorial",
    steps: [
      {
        target: "copy-link",
        title: "Share your booking link",
        body: "Copy your storefront link and send it to clients or put it in your bio. Every request made there shows up on this page.",
      },
      {
        target: "kpis",
        title: "Your numbers at a glance",
        body: "Deposits collected, money still owed, fully paid work, and how fast clients pay their balance.",
      },
      {
        target: "today",
        title: "Needs you today",
        body: "Shortcuts to what needs action: messages to approve, unpaid balances, and jobs in progress.",
      },
      {
        target: "bookings-filters",
        title: "Filter by stage",
        body: "Quoted = waiting for deposit. Active = deposit paid, work underway. Delivered = invoice sent. Paid = done.",
      },
      {
        target: "all-bookings",
        title: "All bookings",
        body: "Click any row to open the booking — that's where you start work, mark it delivered, and send the PayPal invoice.",
      },
    ],
  },
  approvals: {
    label: "Approvals tutorial",
    steps: [
      {
        target: "approvals-tabs",
        title: "Waiting vs. Decided",
        body: "Waiting = drafts your assistant wants to send. Decided = everything you approved or dismissed, kept as a record.",
      },
      {
        target: "approvals-list",
        title: "Review each draft",
        body: "Read the message and the amount. Approve to send it to the client, or Dismiss to drop it. Nothing goes out without you.",
      },
    ],
  },
  payments: {
    label: "Payments due tutorial",
    steps: [
      {
        target: "payments-list",
        title: "Who still owes you",
        body: "Clients whose work is delivered and whose final PayPal invoice isn't paid yet — most urgent first. Open a booking to check PayPal or send a reminder.",
      },
    ],
  },
  catalog: {
    label: "Services tutorial",
    steps: [
      {
        target: "catalog-import",
        title: "Import your rate card",
        body: "Paste your price list in plain text — AI turns it into ready-to-book services you can review before publishing.",
      },
      {
        target: "service-cover",
        title: "Cover image",
        body: "Generate with AI creates a cover that matches the service (takes ~20–60s). Prefer your own? Use Upload.",
      },
      {
        target: "service-card",
        title: "What clients book",
        body: "Price, deposit and deliverables here are exactly what clients pay through PayPal — amounts are signed so they can't be changed.",
      },
      {
        target: "catalog-storefront",
        title: "See it like a client",
        body: "Open your storefront to check how your services look to buyers.",
      },
    ],
  },
  quote: {
    label: "Booking tutorial",
    steps: [
      {
        target: "quote-progress",
        title: "Where this booking is",
        body: "The tracker shows each stage and the line on the right tells you the next step.",
      },
      {
        target: "quote-actions",
        title: "Actions",
        body: "Start work captures a held PayPal deposit. Mark delivered sends the client a PayPal invoice for the balance. Check PayPal re-syncs payment status.",
      },
      {
        target: "quote-payments",
        title: "Payments",
        body: "Every PayPal deposit, invoice and tip for this booking, with live status.",
      },
      {
        target: "quote-audit",
        title: "History",
        body: "A full timeline of what happened on this booking and who did it.",
      },
    ],
  },
  connect: {
    label: "AI assistants tutorial",
    steps: [
      {
        target: "connect-url",
        title: "1. Copy the connection",
        body: "This address lets an AI assistant read your services and request quotes on a client's behalf.",
      },
      {
        target: "connect-tools",
        title: "2. Paste it into the assistant",
        body: "Pick your assistant and copy the matching snippet into its settings. Quotes it creates appear in Bookings.",
      },
    ],
  },
  settings: {
    label: "Settings tutorial",
    steps: [
      {
        target: "settings-form",
        title: "Your business rules",
        body: "Default deposit, reminder timing and cancellation / no-show rules. Assistants always follow these when quoting or following up.",
      },
    ],
  },
  log: {
    label: "Activity log tutorial",
    steps: [
      {
        target: "log-main",
        title: "Everything that happened",
        body: "Quotes, PayPal payments, approvals and assistant actions — newest first. Search to find a client or event.",
      },
    ],
  },
};
