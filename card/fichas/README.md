# Fichas técnicas (technical sheets)

`build_fichas.py` renders one Letter page per wine from a JSON file (title, place, sections, specs, packaging, bottle image, band color) with headless Chrome, in the brand fonts.

- `en.json` + `bottles/` were extracted from the 2025 export Word file; `python3 build_fichas.py en.json out.pdf`.
- For 2026: copy `en.json`, update the text and vintages, drop new bottle images into `bottles/`, run the script, and put the PDF in `public/docs/`.
- The Spanish 2025 PDF is the original design file, kept as is.
