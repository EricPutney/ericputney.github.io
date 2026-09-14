---
title: "Example post: replace this title"
description: "One sentence that will appear under the title and in search results."
math: true
---

This file lives in `_drafts/`, so it is **not** published. To publish a post:

1. Copy this file to `_posts/YYYY-MM-DD-short-slug.md` (the date goes in the filename).
2. Replace the front matter and the text below.
3. Commit and push. GitHub Pages rebuilds the site in about a minute.

Everything above the `<!--more-->` marker is the excerpt shown in the RSS feed.

<!--more-->

## Math

Set `math: true` in the front matter to load MathJax. Jekyll's Markdown (kramdown) uses `$$...$$` for inline math, like $$\rho_\mathrm{DM} \approx 0.47\ \mathrm{GeV\,cm^{-3}}$$, and a `$$` block on its own lines for display math:

$$
\frac{\partial f}{\partial t} + \mathbf{v}\cdot\nabla_{\mathbf{x}} f - \nabla_{\mathbf{x}}\Phi\cdot\nabla_{\mathbf{v}} f = 0
$$

## Figures

Put images in `images/posts/` and reference them with a relative path:

```markdown
![Alt text describing the figure](/images/posts/my-figure.png)
```

## Code

```python
import torch
flow = build_flow(dim=6)
```
