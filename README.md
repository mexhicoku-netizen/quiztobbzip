# QuizToBBZip

Free, browser-only quiz converter: drop in a Word (.docx), .txt or .md quiz and download a Blackboard-format test .zip
that Schoology, Canvas, Moodle and Blackboard can import. No server, no uploads, no AI, no build step, no CDN.

A JavaScript port of a Python quiz converter (quiz2bb.py v1.1).

## Files
| File | What it is |
|---|---|
| `index.html`, `how-to.html`, `import.html`, `privacy.html`, `about.html` | the pages |
| `engine.js` | the converter (zip reader/writer, docx reader, parser, LaTeX to plain maths, shuffle, Blackboard XML) |
| `app.js` | the converter page (drag and drop, results table, downloads) |
| `style.css` | all styling (light and dark) |
| `config.js` | site settings: `ADS_ENABLED` (false at launch), AdSense ids, optional contact e-mail and repo link |
| `site.js` | ad boxes and cookie banner; does nothing while `ADS_ENABLED` is false |
| `ads.txt` | template, empty until ads are on |
| `tests/` | `make_fixtures.py` (makes sample quizzes) and `run_tests.js` (`node tests/run_tests.js`) |

## Run it locally
Open `index.html` in a browser, or serve the folder: `python3 -m http.server` then visit http://localhost:8000.

## Publish on GitHub Pages
1. Create a public repository and push these files to the repository root.
2. Settings, Pages, Source: *Deploy from a branch*, branch `main`, folder `/ (root)`.
3. The site appears at `https://<user>.github.io/<repo>/`. (`.nojekyll` is included.)

Later: connect the same repository to Cloudflare Pages (no build command, output directory `/`) and add your own domain.

## Switching ads on (later)
1. Check that your employment contract allows ad or donation income.
2. Edit `config.js`: `ADS_ENABLED: true`, your `ADSENSE_CLIENT`, and the slot ids in `AD_SLOTS`.
3. Put your publisher id in `ads.txt` (it must be served at the site root, so it needs your own domain or a user-site repo).
4. The built-in banner stores one choice in local storage and loads Google's script only after "Accept ads".
   For visitors in the EEA, UK and Switzerland Google requires a certified consent platform; use Google's
   *Privacy & messaging* tool in AdSense in addition to (or instead of) this banner before launching ads there.

## Tests
`python3 tests/make_fixtures.py && node tests/run_tests.js` (Node 18+). The shuffle uses a port of Python's
Mersenne Twister, so the same seed gives the same answer order as `quiz2bb.py`.
