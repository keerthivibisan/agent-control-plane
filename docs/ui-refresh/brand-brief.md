# Brand brief: the Control Core identity (owner, 2026-10-17)

The owner's brief, kept as given, with the owner's decisions on the open points.

## Owner decisions (2026-10-17)

- **Colours: the full brand palette.**
  - Warm ivory light theme, graphite dark theme, signal lime accent.
  - This replaces the Jira-style blue chosen earlier the same day.
- **Name: it stays "Agent Control Plane".**
  - The wordmark reads **AGENT CONTROL PLANE**, not "CONTROL PLANE".
  - No product rename anywhere.
  - The brief's tagline "Observe. Orchestrate. Validate." may be used.
- **Fonts: Inter (UI) and JetBrains Mono (technical labels).**
  - Bundled and local, swapped in `1f2065f`.
- **Agent views follow the logo vocabulary:**
  - square agent nodes;
  - a visually distinct central controller (the lead);
  - straight connectors;
  - lime for active or selected agents;
  - neutral for idle;
  - warning and error colours only for real operational states.
- **Placement:** app top bar, browser tab icon (favicon), README.

## The brief

**Objective.** A distinctive identity for an open-source AI coding agent orchestration and
observability platform. It should say control, coordination, precision and engineering
reliability: developer infrastructure, not a consumer AI chatbot.

**Personality.**

- Technical and precise; minimal, geometric, intentional.
- Modern but not trendy; developer-native, with subtle terminal and systems-design influences.
- Credible open-source infrastructure.
- Avoid glowing neural networks, robots, brains, gradient blobs, neon, glassmorphism and
  decorative circuit boards.

**Logo: the Control Core.** A square canvas:

- a central square at the exact centre;
- four smaller square nodes at the top-left, top-right, bottom-left and bottom-right;
- straight diagonal lines connecting the centre to each node.

Construction rules:

- symmetric on both axes;
- consistent stroke widths, square corners, balanced spacing;
- the centre dominant, the nodes subordinate;
- enough negative space to read at 16×16 and 24×24.

The centre is the control plane, the nodes are managed agents, and the lines are coordination
and delegated execution. It should read as a systems diagram distilled into a mark, not a
generic network icon.

**Variants:**

- primary (symbol and wordmark);
- symbol only (favicon, navigation, GitHub avatar);
- monochrome dark on light;
- monochrome light on dark;
- an accent version with a signal-lime centre node.

Use custom SVG, resolution-independent and themeable.

**Colours:**

| Token       | Colour    | Use                                                          |
| ----------- | --------- | ------------------------------------------------------------ |
| Graphite    | `#171717` | dark surfaces, text, dark-mode background                    |
| Warm Ivory  | `#F4F0E8` | light-mode background, reverse logo                          |
| Signal Lime | `#D8FF64` | active states, the centre-node emphasis, selected indicators |

- Centralise them as tokens.
- Graphite and ivory are the identity; lime is an accent, never a dominant background.
- Check contrast. Never put lime as small text on ivory without verifying it.

**Typography:**

- The wordmark is uppercase, bold or semibold, modern sans, with deliberate letter spacing.
- Headings are a clean sans with strong hierarchy; technical labels are monospaced; body text
  is a readable sans.
- No futuristic, very wide or gimmicky terminal fonts.

**Interface:**

- warm ivory light theme and graphite dark theme;
- neutral grey borders and dividers;
- minimal shadows, with borders and spacing for structure;
- the agent-visualisation rules from the decisions above;
- the logo is not used as decoration, and diagrams show only real relationships and states;
- apply it to the navigation and header, the session and agent views, the token and cost
  dashboards, status indicators, validation results, and the empty, loading and error states.

**Implementation:**

- a reusable SVG logo component and static assets, with symbol and wordmark variants;
- centralised brand tokens and header integration;
- no distortion, and accessible alt text;
- checked in light and dark, at small sizes and responsive widths, and for contrast;
- no new dependencies;
- existing behaviour kept.

**Deliverables:**

- `control-plane-mark.svg` (the symbol);
- `control-plane-logo.svg` (symbol and wordmark);
- a logo component, tokens and header integration;
- light and dark verification;
- a short README section on the logo variants and colours.

**Done when:**

- the mark reads as a centre and four agents and is recognisable at favicon size;
- it works on light and dark;
- palette and typography are consistent;
- it feels like serious developer infrastructure;
- it is reusable outside the app;
- behaviour is intact and the checks pass.
