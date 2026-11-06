// jobs.q08.org (qnfo-jobsearch), opened on a phone (live mode only, read-only GETs). JOBSEARCH-APPLY-1: a person must be able to see, without signing in,
// how the one-click apply works and the queue filter for matches that are ready to apply. Nothing is submitted or changed.
export const name = "jobs";
export const liveBase = "https://jobs.q08.org";
export const journeys = [
  { id: "apply-controls-visible", title: "Open jobs.q08.org on a phone and see the Ready to apply filter and the one-click apply setup", modes: ["live"],
    async run(u) {
      await u.open("/");
      await u.see("Ready to apply");
      await u.see("One-click apply: set up once");
      await u.screen("home");
    } },
  { id: "apply-and-prepare-screens", title: "Open the Apply and prepare page on a phone and see its three screens: check fit, answers, interview prep", modes: ["live"],
    async run(u) {
      await u.open("/prep");
      await u.see("Check fit");
      await u.tap("Answers");
      await u.see("Draft answers");
      await u.tap("Interview prep");
      await u.see("Build interview brief");
      await u.screen("prep");
    } }
];
