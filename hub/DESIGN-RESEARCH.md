# Hub design research: usability rules

Scope: the apps.dosbuhos.com launcher and admin pages, plus small KPI tiles inside the apps. Every rule comes from a page I opened (see Sources). Where I drew a Hub-specific conclusion from a general rule, it is marked *(inference)*.

## Top 10 rules for this Hub

1. **Recents and favorites go above the 7 sections.** People should recognize the app they want, not remember where it lives. [NN/g recognition]
2. **Each person sees their own apps by default, with an "All apps" link always available.** Reorder what's shown; don't hide it with no way back. [NN/g personalization]
3. **Group the "coming soon" apps into one collapsed "Próximamente" row.** They shouldn't take space or tap targets from apps that work. *(inference from NN/g complex apps #6 and #8)*
4. **Tap targets of at least 48×48 px with 8 px gaps, and about 2 cm for primary actions used while walking or working.** The WCAG floor is 24 px, and it isn't enough here. [Android, NN/g, WCAG]
5. **One column, high contrast, plain Spanish at a 6th-grade reading level, and labels on every icon.** [NN/g low-literacy, recognition; apario]
6. **Never use color alone.** Pair it with an icon or word (▲/▼, "Atrasado") so it still reads in sunlight and for color-blind users. [NN/g dashboards, UKHSA, web.dev]
7. **Assume a bad connection.** Save locally first, say "Guardado, se enviará", and don't block the screen with a full-screen loader. [web.dev offline, apario]
8. **Assign the role in the same step as adding the Gmail, default to Viewer, and explain each role in one plain sentence.** [saasui permissions]
9. **Write each audit entry as "Who did what to what, from → to," with the exact time in America/Mexico_City.** [saasui audit log]
10. **Every tile has a number, its period, a comparison, and the data source.** Bar baselines start at zero; sparklines in the same group share the same range. [CDC, ONS, UKHSA]

## 1. Launcher / app portal

- **Recents strip first.** Show the 3–4 apps this person opened most recently, then their favorites (star toggle). This supports picking up an interrupted task. [NN/g recognition]
- **Personalize by role, but keep an exit.** Personalization works best when it pre-selects frequent choices and adds or reorders content instead of removing it. Give people an "Todas las apps" view and let them fix wrong assumptions themselves. Keep segments broad: department or section, not one per person. [NN/g personalization]
- **Search that forgives typos.** Lower-literacy users misspell queries, so match "vendimia/bendimia" or "huerta/uerta", aim for the right app as the first result, and give each result a one-line plain description. [NN/g low-literacy]
- **Linear menu on phones.** A single column of sections works better than a 2D grid that needs scanning. Avoid fly-outs and animation. [NN/g low-literacy]
- **Placeholders.** Most people rely on only 1–2 features of an intranet, so a launcher of 26 apps where half don't work adds noise. Collapse "coming soon" apps into one disclosure per section or one global row, render them as non-tappable, and never mix them into Recents or search results. *(inference from NN/g intranet usability and complex apps #6, #8)*

## 2. Mobile-first frontline UX

- **Size.** Targets should be at least 1 cm (NN/g) or 48×48 dp, roughly 9 mm, with at least 8 dp between them (Android). Make them larger, about 2 cm, for primary buttons used on the move. With few elements on screen, go bigger still. WCAG 2.5.8's 24×24 CSS px is only the legal minimum. [NN/g, Android, WCAG]
- **Grip.** 49% of people hold the phone in one hand, 36% cradle it, and 15% use two hands, and they switch grips often. Keep essential controls reachable in every grip, and keep dangerous actions away from the top corners. The author later retracted the popular "thumb zone" diagrams and found the center of the screen is the fastest area to hit. [Hoober/UXmatters]
- **Outdoors and gloves.** Use high contrast and large text, avoid relying on color, use large targets because capacitive screens miss gloved or wet fingers, and make the current step obvious from a quick glance between tasks. Build the minimum interaction for each field task (value, confirm, save) and leave dashboards out of those screens. [apario]
- **Literacy.** Use one column, put the main point at the top, write at about a 6th-grade level, keep text static, and label every icon. Unlabeled icons fail new users. [NN/g low-literacy, recognition]
- **Staff forms.** Ask one question per screen, with the question as the heading. Put a Back link at the top, a "Continuar" button, "(opcional)" on optional fields and no asterisks. Pre-fill anything already known, and allow "No sé" where it's a valid answer. [GOV.UK question pages]
- **Spanish copy.** Short strings grow 200–300% in translation into European languages, so don't use fixed-width buttons or chips. Let labels wrap and don't abbreviate to make them fit. Write Spanish first instead of translating. *(the "write Spanish first" part is my inference)* [W3C i18n]
- **Offline and slow networks.** Say what the user can still do, show "Actualizado hace 5 min", disable only the features that need a connection, queue actions and confirm "Guardado, se enviará", use skeleton screens instead of blocking spinners, and avoid the words "offline" and "sync" in staff-facing copy. [web.dev]

## 3. Roles and permissions (small org)

- **One step.** Paste one or more Gmail addresses and pick the role in the same form. Show pending invites, and support resend, revoke and role changes without re-inviting. [saasui permissions]
- **Few, distinct roles.** Admin, Editor and Viewer, each with a one-line description where it's chosen (for example, "Viewer: can see, cannot change anything"). Test: could the owner pick the right role without reading docs? New users default to the lowest role. [saasui permissions]
- **Friction where it matters.** Ask for confirmation before granting admin or removing access. Block removing the last admin, and warn before an admin removes their own access. [saasui permissions]
- **Show what someone can see.** Show each person's access as a grid of apps by role, with clear allowed, partial and none states. Add a "Ver como" (view as) option so the owner can check it. Replace a bare "Acceso denegado" with the reason and a "Pedir acceso" button that notifies the app's admin. [saasui permissions; NN/g personalization for view-as]
- **Show last login** so the owner can deactivate dormant or departed staff. [saasui permissions]
- **Use staged disclosure.** Reveal per-app role pickers only after an app is ticked. [NN/g complex apps #6]

## 4. Audit log for a non-technical owner

- **Sentence format.** Write "Adrián cambió el rol de Lalo en Mantenimiento de Viewer → Editor," with the actor's name and avatar, never "Record updated." [saasui audit]
- **Exact time and zone.** For audit purposes, show the absolute time with an unambiguous zone as the main element, with relative time ("hace 2 h") as secondary. [saasui audit]
- **Day headers and grouping.** Collapse repeated edits by the same person to the same record into one row that expands. Visually separate system or automatic events from human ones. [saasui audit]
- **Filters an owner actually uses.** By person, by app, "only permission changes", and date range. Put high-signal events (access changes, deletions, exports) first. [saasui audit]
- **Make entries immutable.** Log logins, role changes, exports and deletions. End the list with an explicit "No hay más registros." [saasui audit]

## 5. KPI tiles and sparklines on small screens

- **Use length and position.** Bars for comparisons, lines for trends, bullet bars for value against a target. No gauges, donuts or 3D, and no color to show magnitude. [NN/g dashboards]
- **Give context in each tile.** A short title, the period, and the source ("Zoho · últimos 12 meses"). Sparklines hide scale and point count, so the text has to supply them. [CDC sparklines]
- **Make sparklines comparable.** Tiles in the same group need the same date range, the same number of points and stacked alignment. Test at phone width. [CDC]
- **Honest axes.** Bar baselines always start at 0. A line chart may start above 0 if you mark the break or label the minimum value. When the change is the point, plot the change instead. [ONS, UKHSA]
- **Accessible color.** Marks need 3:1 contrast against the background, use at most four colors, and label lines directly instead of using a legend. Pair the delta with an arrow and sign (▲ +12%), not just green or red. [UKHSA, NN/g]
- **One screen, quick reading.** Lead managers' tiles with exceptions ("3 aprobaciones pendientes"), and show exact values on tap. [NN/g dashboards; NN/g complex apps #7, #8]

## 6. Internal-tool mistakes that hurt adoption

- **Shipping defaults instead of designing for the job.** NN/g found intranet task success at 74% compared with about 80% for public websites, and the time lost adds up across every employee. [NN/g intranet]
- **Designing for everyone.** All-purpose designs leave users lost. Give each role its own short list. [NN/g intranet]
- **Adding features without making them easy.** More features meant longer task times. [NN/g intranet]
- **Copying consumer patterns blindly.** Workplace apps have different trade-offs. [NN/g workplace video]
- **Long tutorials.** Use contextual tips on the page instead. [NN/g recognition]
- **Silent failures.** Errors must say what happened and what to do next. [apario]
- **Dead-end placeholders** that look tappable. Anyone who taps one and finds nothing learns not to trust the launcher. *(inference)*

## Sources (opened)

- https://www.nngroup.com/articles/touch-target-size/
- https://www.nngroup.com/articles/dashboards-preattentive/
- https://www.nngroup.com/articles/personalization/
- https://www.nngroup.com/articles/recognition-and-recall/
- https://www.nngroup.com/alertbox/20050314.html (lower-literacy users)
- https://www.nngroup.com/alertbox/intranet-usability.html
- https://www.nngroup.com/articles/complex-application-design/
- https://www.nngroup.com/videos/workplace-application-usability/
- https://w3c.github.io/wcag/understanding/target-size-minimum.html
- https://www.w3.org/International/articles/article-text-size/index.en
- https://support.google.com/accessibility/android/answer/7101858?hl=en
- https://design-system.service.gov.uk/patterns/question-pages
- https://web.dev/articles/offline-ux-design-guidelines?hl=en
- https://uxmatters.com/mt/archives/2013/02/how-do-users-really-hold-mobile-devices.php
- https://blog.apario.net/on-writing-software-for-people-who-work-outside
- https://www.cdc.gov/cove/data-visualization-types/sparkline.html
- https://digitalblog.ons.gov.uk/2016/06/27/does-the-axis-have-to-start-at-zero-part-1-line-charts
- https://ukhsa-collaboration.github.io/statistics-production-hub/data-vis
- https://www.saasui.design/blog/saas-activity-feed-audit-log-ux-patterns
- https://saasui.design/blog/saas-permissions-roles-ux-patterns

Not reachable this session (blocked or not fetched): NN/g empty-state article, Apple HIG, Baymard, and the WCAG contrast-minimum page. No contrast ratio for text is cited above for that reason.
