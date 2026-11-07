// me-companion.journeys.mjs - Personal companion UI journeys
// COMPANION-UI-REGRESSION-GUARD-1: Prevent "For the Quniverse" fleet asks from returning

export const journeys = [
  {
    name: 'Personal companion loads without fleet content',
    host: 'me.q08.org',
    path: '/companion',
    steps: [
      { action: 'navigate', path: '/companion' },
      { action: 'wait', selector: '[data-testid="today-tab"]', timeout: 5000 },
      { action: 'assertAbsent', text: 'For the Quniverse', reason: 'Fleet asks must not appear on personal companion' },
      { action: 'assertAbsent', text: 'Send to the Quniverse', reason: 'Fleet send button must not appear' },
      { action: 'assertPresent', selector: '[data-testid="today-tab"]', reason: 'Today tab must be visible' }
    ],
    budget: { taps: 2, types: 0 }
  },
  {
    name: 'Inbox loads and works',
    host: 'me.q08.org',
    path: '/companion',
    steps: [
      { action: 'navigate', path: '/companion' },
      { action: 'tap', text: 'Inbox' },
      { action: 'wait', selector: '[data-testid="inbox-list"]', timeout: 5000 },
      { action: 'assertAbsent', text: 'to_fleet', reason: 'Inbox items must not have fleet status' },
      { action: 'assertPresent', selector: '[data-testid="inbox-list"]', reason: 'Inbox list must be visible' }
    ],
    budget: { taps: 3, types: 0 }
  }
];
