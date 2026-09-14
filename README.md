# eputney.io

Personal site of Eric Putney. Built with Jekyll on GitHub Pages; no local tooling needed.

## Common edits

| Task | Where |
|---|---|
| Add a paper | `_data/publications.yml` (newest first) |
| Add a talk | `_data/talks.yml` |
| Write a research post | copy `_drafts/example-research-post.md` to `_posts/YYYY-MM-DD-slug.md` |
| Change bio, positions, snapshots | `index.html` |
| Update CV | replace `attachments/Eric_Putney_CV.pdf` |
| Profile links, site description | `_config.yml` |

Posts appear on the homepage and at `/writing/` once at least one file exists in `_posts/`. The RSS feed is at `/feed.xml` and the sitemap at `/sitemap.xml`.

## Local preview

Ruby 3.4 on Arch needs two workarounds: the gem bin dir on PATH, and `RUBYOPT=-rcgi` (bundler 4 hits a `cgi` bug otherwise).

```sh
export PATH="$HOME/.local/share/gem/ruby/3.4.0/bin:$PATH"
export RUBYOPT=-rcgi
bundle install            # first time only; gems go in vendor/bundle
bundle exec jekyll serve --drafts --livereload
```

Then open http://localhost:4000/. Drafts in `_drafts/` show up locally but never on the live site.

## Design

Layout adapted from the [HTML5 UP "Read Only"](https://html5up.net/read-only) template (CCA 3.0, see `LICENSE.txt`). Type is [Geist](https://vercel.com/font) (OFL), self-hosted in `assets/fonts/`. Icons are Font Awesome Free 5.
