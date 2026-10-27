# Publishing the KT guide

## Local preview and artifact

Open `site/index.html` directly, or from the repository root:

```sh
python3 -m http.server 8765 --bind 127.0.0.1 --directory docs/knowledge-transfer/site
```

The deployable artifact is **only `docs/knowledge-transfer/site/`**. Its root contains `index.html`
and `.nojekyll`; assets use relative URLs and hash navigation works under a project-site prefix.
The checked-in artifact needs no build, ACP server, API credential or browser storage.
After editing chapters, run `node docs/knowledge-transfer/prepare-site.mjs` to refresh the
explicitly allowlisted Markdown downloads and diagram sources, and update matching visual prose. Do not serve the repository
root, local ACP data, screenshots or unrelated docs as the public artifact.

## GitHub Pages preparation

Use GitHub Actions as the Pages publishing source and upload that folder as the artifact root.
The adjacent [workflow example](pages-workflow.example.yml) is intentionally outside `.github/`;
it is documentation, not an active deployment. After reviewing it, maintainers can place it in a
separate workflow change, choose the publication branch and configure the `github-pages`
environment. It is manual-dispatch-only and checks out the selected workflow ref; restrict that
ref with environment branch rules. Action versions are taken from current GitHub examples;
apply repository action-pinning policy when activating.
The workflow must exist on the repository default branch to be manually dispatched; the current
default is `main`, even though this documentation PR targets `dev`. Include activation in the
normal release/default-branch change, then select the intended publication ref.
[Manual workflow reference](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow?tool=webui).
[GitHub custom-workflow reference](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

The current repository is private. Pages availability depends on the account/organization plan,
and the resulting site may be public even with private source. Decide the intended site audience
before enabling hosting; this PR does not change visibility or deploy anything.
[GitHub Pages visibility reference](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site).

## Publication review

Confirm baseline/status labels, diagram readability, keyboard/mobile/print behavior, relative asset
paths, links and no unexpected requests. The evidence section should distinguish historical figures
from synthetic examples. Do not publish numerical examples as measured savings or imply future
providers are supported. Once hosting returns an actual URL, use that URL in public posts; no live
URL is claimed by the draft.
