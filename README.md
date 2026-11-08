# 31 by Cartio website

The home page is one pinned, scroll-driven film. It opens in the dark studio, the lights come on and the pop-ups rise. The camera then moves around the car and steps inside, through the gauges, the radio, the mirror and the leather. Editorial chapters cover each service, followed by available stock, the story and contact. There's no build step: it's plain HTML, CSS and JavaScript, hosted on Netlify. The team edits cars and contact details in a browser at `/admin`.

```
index.html              captions for each stop on the tour (edit the text here)
assets/js/site.js       the camera, the hidden details, search, menu, car pages
assets/css/site.css     the look
assets/photos/          the studio stills (AI-generated, upscaled 2x)
content/inventory.json  cars for sale   } edited by the team at /admin
content/settings.json   phone, email, social links }
assets/uploads/         photos uploaded through the editor
admin/                  the site editor (Decap CMS)
```

---

## Going live (one-time, about 30 minutes)

1. **GitHub:** create a repository called `31bycartio-site` and upload everything inside this folder (not the folder itself).
2. **Netlify:** Add new site → Import from GitHub → pick the repo. Leave the build command empty and the publish directory as `.`. Deploy. Check it at the temporary `.netlify.app` address.
3. **Editor login:**
   - In `admin/config.yml`, change `repo: YOUR-GITHUB-NAME/31bycartio-site` to your real account and repository.
   - GitHub → Settings → Developer settings → OAuth Apps → New. Homepage `https://31bycartio.com`, callback `https://api.netlify.com/auth/done`. Copy the Client ID and a new Client secret.
   - Netlify → Site configuration → Access & security → OAuth → Install provider → GitHub, and paste both.
   - Team members: invite their GitHub accounts to the repository. Everyone logs in at `/admin`.
   - *Option B, invite staff by email without GitHub:* enable Netlify Identity (invite only) and Git Gateway, set `backend: name: git-gateway` in `admin/config.yml`, and uncomment the identity script in `admin/index.html` (and add it to `index.html`). Netlify lists Git Gateway as deprecated, so Option A is safer long-term.
4. **Domain:** Netlify → Domain management → add `31bycartio.com` and follow the DNS records it shows. HTTPS turns on automatically.
5. **Contact form:** Netlify → Forms → enable form detection, redeploy once, then add an email notification to `alec@31bycartio.com`.

### Before launch
- Replace the 8 **Sample listing** cars with real ones in the editor.
- Confirm the Facebook username (set to `31bycartio`). Leave it empty to hide the Facebook links.
- The studio images are AI illustrations. Listings for real cars should use real photos of those cars.

---

## Everyday editing (no code)

- **Add a car:** `/admin` → Cars for sale → Inventory → Add car → fill it in → add photos (first one is the cover) → Publish. The site updates in about a minute.
- **Mark sold:** change Status to *Sold*.
- **Share one car:** each car has its own link, `31bycartio.com/#car-<link name>`. Use "Copy link to this car" on the car page.
- **Phone, email, social:** `/admin` → Contact and social. The odometer, the on-board computer and every contact button update automatically.

---

## How the tour works (for whoever maintains it)

- Each photo is a **scene** in `SC` (site.js) with its original pixel size. Every position on the tour is measured in that photo's original pixels.
- The tour is the `SEG` list. Each step is one of:
  - `hold`: the camera rests, and a caption shows
  - `move`: the camera pans or zooms within one photo (with `box: 'split'` it plays in the editorial frame)
  - `in`: the camera pushes into a "portal" area and the next photo grows out of it
  - `out`: the reverse, pulling back out of a photo into the next
  - `x`: two layers at once, for the lights-on swap, dolly tracks, chapter wipes and frame expansions
  - `d` is how long each step lasts, in screen-heights of scrolling.
- **Hidden details** (the plate, the odometer, the radio, the mirror and the leather badge) are HTML placed on the stills in `OVERLAYS`, so they stay crisp at any zoom. The odometer and radio read the phone and email from `content/settings.json`.
- **To swap a tour photo:** keep the same file name in `assets/photos/`, update its `w`/`h` in `SC` to the new photo's original size, and adjust the camera points (`K(x, y, width)`) and any overlays for that scene.
- **Search** covers services, cars and contact. Press `/` or Cmd/Ctrl-K to open it. Add keywords in `SERVICES`.
- Images are served through the Netlify Image CDN. If you host somewhere else, delete `<meta name="image-cdn" content="netlify">`.
- Fonts: TeX Gyre Heros and Schola (GUST Font License, free for commercial use).
- Local preview: run `python3 -m http.server` in this folder and open `http://localhost:8000`.
