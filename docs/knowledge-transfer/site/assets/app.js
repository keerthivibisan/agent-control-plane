/* Static KT interactions only: no ACP API, storage or provider calls. */
/* global document, window */
'use strict';

const pageLabels = {
  overview: 'Overview',
  architecture: 'Architecture & authority',
  workflow: 'Ticket & workflow',
  conflicts: 'Conflict recovery',
  tokens: 'Token efficiency',
  issues: 'Issues & tradeoffs',
  future: 'Future integrations',
  evidence: 'Evidence & status',
  publishing: 'Publishing & sharing',
};

const scenarios = {
  helper: {
    title: 'Start a helper: lead intent, engine authorization, server launch',
    checks:
      'Validate caller and run phase, resolve the helper node, then check capacity, depth, budget and attempts.',
    effect:
      'Persist the accepted transition; prepare a recorded-tip worktree and trusted setup; launch a role-scoped SDK query.',
    limit:
      'Accepted does not mean started or finished. Setup/startup failure becomes evidence for the engine.',
  },
  edit: {
    title: 'Edit a file: role tools and the permission bridge still apply',
    checks:
      'A helper/tester may edit in its own authorized worktree; planner/reviewer/lead toolsets remain read-only. Profiles can narrow tools.',
    effect:
      'The adapter and server permission path evaluate the actual tool request under effective policy; the engine does not approve arbitrary shell text.',
    limit:
      'Full-auto does not grant branch mutation. Git guards keep merge, rebase, commit and push authority with ACP.',
  },
  integrate: {
    title: 'Integrate work: a request is not a ref update',
    checks:
      'The lead requests integration; ACP checks the change state, configured evidence gates and recorded Git expectations.',
    effect:
      'Server-controlled workspace operations combine work and promote with guarded refs/compare-and-swap. A conflict follows the dedicated repair path.',
    limit:
      'Worktrees isolate edits but do not remove conflicts. Previously passed evidence cannot be assumed to cover changed commits.',
  },
  publish: {
    title: 'Publish a result: delivery is a separate authority',
    checks:
      'Owner action or explicit project delegation must cover the target and selected verification route; automatic resolution alone is insufficient.',
    effect:
      'Server Git/GitHub paths push/open/update a PR, or locally fast-forward when allowed. Delivery state is recorded before the remote operation.',
    limit:
      'Delegated conflict delivery does not automatically merge a remote PR. Unknown remote outcomes require reconciliation, not blind retries.',
  },
};

const menuButton = document.getElementById('menu');
const navigation = document.getElementById('navigation');
const mobile = window.matchMedia('(max-width: 800px)');
function closeMenu() {
  document.body.classList.remove('menu-open');
  menuButton.setAttribute('aria-expanded', 'false');
  navigation.inert = mobile.matches;
}
function showPage(focus = false) {
  const requested = window.location.hash.slice(1);
  if (requested === 'main') {
    document.getElementById('main').focus();
    return;
  }
  const key = Object.hasOwn(pageLabels, requested) ? requested : 'overview';
  document.querySelectorAll('.page').forEach((section) => {
    section.hidden = section.id !== key;
  });
  document.querySelectorAll('nav a').forEach((link) => {
    if (link.hash === `#${key}`) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  document.getElementById('current').textContent = pageLabels[key];
  document.title = `${pageLabels[key]} — ACP Knowledge Transfer`;
  closeMenu();
  if (focus) document.getElementById('main').focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'instant' });
}
function selectScenario(key) {
  const item = scenarios[key];
  const panel = document.getElementById('authorization-detail');
  panel.replaceChildren();
  const heading = document.createElement('h3');
  heading.textContent = item.title;
  panel.append(heading);
  for (const [label, text] of [
    ['Checks', item.checks],
    ['Execution', item.effect],
    ['Boundary', item.limit],
  ]) {
    const paragraph = document.createElement('p');
    const strong = document.createElement('strong');
    strong.textContent = `${label}: `;
    paragraph.append(strong, document.createTextNode(text));
    panel.append(paragraph);
  }
  document.querySelectorAll('[data-scenario]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.scenario === key));
  });
}
document.querySelectorAll('[data-scenario]').forEach((button) => {
  button.addEventListener('click', () => selectScenario(button.dataset.scenario));
});
menuButton.addEventListener('click', () => {
  const open = document.body.classList.toggle('menu-open');
  menuButton.setAttribute('aria-expanded', String(open));
  navigation.inert = mobile.matches && !open;
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && document.body.classList.contains('menu-open')) {
    closeMenu();
    menuButton.focus();
  }
});
document.getElementById('print').addEventListener('click', () => window.print());
const printDetails = new Map();
window.addEventListener('beforeprint', () => {
  document.querySelectorAll('details').forEach((detail) => {
    printDetails.set(detail, detail.open);
    detail.open = true;
  });
});
window.addEventListener('afterprint', () => {
  for (const [detail, open] of printDetails) detail.open = open;
  printDetails.clear();
});
mobile.addEventListener('change', closeMenu);
window.addEventListener('hashchange', () => showPage(true));
selectScenario('helper');
showPage();
