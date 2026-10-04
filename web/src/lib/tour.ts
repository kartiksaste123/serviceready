import { driver, type DriveStep, type Driver } from "driver.js";

export type TourStage = "onboard" | "studio" | "done";

const tourKey = (userId: string) => `sr_tour:${userId}`;

export function getTourStage(userId: string): TourStage | null {
  if (typeof window === "undefined") return null;
  try {
    const stage = window.localStorage.getItem(tourKey(userId));
    return stage === "onboard" || stage === "studio" || stage === "done" ? stage : null;
  } catch {
    return null;
  }
}

export function setTourStage(userId: string, stage: TourStage): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(tourKey(userId), stage);
  } catch {
  }
}

const onboardSteps: DriveStep[] = [
  {
    popover: {
      title: "Welcome to ServiceReady",
      description:
        "Turn your rate card into a storefront that clients and AI assistants can book. Clients pay a PayPal deposit before you start. 4 quick steps.",
    },
  },
  {
    element: '[data-tour="ratecard"]',
    popover: {
      title: "Paste your prices",
      description: "Paste a rate card, a WhatsApp message or a spreadsheet. Messy is fine.",
    },
  },
  {
    element: '[data-tour="examples"]',
    popover: {
      title: "No rate card handy?",
      description: "Pick an example to see how it works.",
    },
  },
  {
    element: '[data-tour="structure"]',
    popover: {
      title: "Let AI organise it",
      description:
        "AI turns it into services. You check every price and deposit before anything goes live.",
    },
  },
];

const studioSteps: DriveStep[] = [
  {
    element: '[data-tour="nav-bookings"]',
    popover: {
      title: "Bookings",
      description:
        "Every booking and its payment progress, from quote sent to fully paid. 'What needs you today' shows what to do next.",
    },
  },
  {
    element: '[data-tour="nav-approvals"]',
    popover: {
      title: "Needs your approval",
      description:
        "The AI suggests replies, reminders and invoices. Nothing is sent to a client until you approve it here.",
    },
  },
  {
    element: '[data-tour="nav-collections"]',
    popover: {
      title: "Who owes what",
      description: "Unpaid balances, and how long each client has taken to pay.",
    },
  },
  {
    element: '[data-tour="nav-connect"]',
    popover: {
      title: "Connect AI assistants",
      description:
        "Let ChatGPT, Claude and other assistants find your services and request quotes. They can't pay or approve anything.",
    },
  },
  {
    element: '[data-tour="nav-services"]',
    popover: {
      title: "Services & prices",
      description:
        "Edit prices and deposits, and copy your storefront link to share with clients. Replay this tour anytime with 'Show tutorial' below the menu.",
    },
  },
];

function startTour(steps: DriveStep[], onDone: () => void): Driver {
  const available = steps
    .filter((step) => {
      if (typeof step.element !== "string") return true;
      return typeof document !== "undefined" && document.querySelector(step.element) !== null;
    })
    .map((step, index): DriveStep =>
      index === 0
        ? {
            ...step,
            popover: { ...step.popover, showButtons: ["next", "close"] },
          }
        : step,
    );
  const tour = driver({
    steps: available,
    showProgress: true,
    progressText: "{{current}} of {{total}}",
    nextBtnText: "Next",
    prevBtnText: "Back",
    doneBtnText: "Got it",
    allowClose: true,
    smoothScroll: true,
    stagePadding: 6,
    onDestroyed: onDone,
  });
  if (available.length) tour.drive();
  else onDone();
  return tour;
}

export function startOnboardTour(onDone: () => void): Driver {
  return startTour(onboardSteps, onDone);
}

export function startStudioTour(opts: { onDone: () => void }): Driver {
  return startTour(studioSteps, opts.onDone);
}
