# HydraScout Placement

A lightweight web app that suggests where to install HydraScout soil & temperature sensors (HSTI France) in a field.

It runs entirely in the browser: no server, no account, no API keys. Open `index.html` locally, or host the folder on GitHub Pages (Settings → Pages → Deploy from branch `main`, folder `/`).

To serve it from your own VPS (Debian/Ubuntu) with nginx, HTTPS and automatic updates from `main`, point a domain at the VPS and run [`deploy/setup-vps.sh`](deploy/setup-vps.sh) as root: `bash setup-vps.sh placement.example.com you@example.com`.

## How it works

The app opens on one question: **Install new probes** (the steps below) or **Check probes already installed**.

**Check probes already installed**: type the device IDs (Digital Matter serials); each probe goes on the map at its device's last GPS position, read through HSTI Logger Overview. Probes without GPS can be placed by hand or imported (CSV with lat/lon columns, GPX, KML, GeoJSON points), and every probe can be dragged to its true position. After the blocks are drawn, **Check my probes** works out the recommended spots and rates each installed probe: good spot, worth a look or should move. It checks that the probe is inside a block, at least the border distance from the block's border, at a point typical of its block (terrain, soil, NDVI) and clear of the pivot's bad spots, flags a second probe in a block that needs only one, lists blocks with no probe, and suggests where to move each probe (distance and direction to the recommended spot). Dragging a probe re-checks it at once. A check report and a CSV are available.

**Install new probes**:

1. **Find the field**: search an address or place, or coordinates. (A new customer has no device yet, so device IDs are only asked when checking installed probes.)
2. **Irrigation blocks**: how many irrigation blocks the grower has. HSTI sizes a kit as one probe per block, so the answer gives the number of probes straight away.
3. **Draw the blocks**: one row per block, each with a name and a **Draw borders** button, or import them (GeoJSON/KML, one polygon per block). The blocks together are the field: crop vigour, soil and the analysis only cover them. Each block gets one probe at its most typical point, away from its border, and a block made of two clearly different parts gets an optional second probe. Without a block count, the whole field is drawn instead and the number of probes follows its size.
4. **Irrigation equipment (optional)**: drip (emitter and line spacing, flow), micro-sprinkler or sprinkler (head spacing), centre pivot (centre, radius, span length), linear move, furrow/flood, and the row direction (automatic: along each block's long side). The app draws the equipment layout on the map (layer *Irrigation layout*, with its own entry in the map key): drip lines or sprinkler laterals and heads along the rows at the spacing entered, a header pipe and a valve per block (drag the valve to its real place and the header moves to that end of the rows), the pivot arm, towers and wheel tracks, or the linear machine and the area it travels over. Lines are thinned when zoomed out. **Cross-section** (irrigation and crop steps) draws one vertical cut, along the drip line for drip (across the rows otherwise), with a small view from above: the crop and its roots (deepest roots of the season, the top half where most water is taken, roots now), the drip line with its emitters and the wetted bulbs, shaped by the soil texture (narrow and deep in sandy soil, onion-shaped in loam and clay), and the suggested or chosen HydraScout® probe with its sensor depths. Under drip the probe goes a quarter of the way from the wettest point (under an emitter) to the driest (halfway to the next emitter, or halfway to the next line when the bulbs join into a strip); the placement tips use the same rule. It saves as PNG or SVG and goes into the placement report. Spacings left empty use usual values and are listed as assumed.
5. **Crop vigour and soil**: the app searches free Sentinel-2 L2A images of the last 14 months, checks the clouds over the field with the scene classification layer, and computes 10 m NDVI from the clearest image with full crop cover. Any other clear date can be picked, or a drone NDVI GeoTIFF uploaded instead.
6. **Analysis**: the field is sampled on a grid. Each point gets elevation, slope, relative position (hollow or rise), soil texture, NDVI and pivot coverage. Points are grouped into zones (k-means on standardised variables), and each sensor goes at the most typical point of its zone, away from the field edge and its block's border, the pivot centre, the end of the pivot and tower wheel tracks.
7. **Map key**: the soil map and NDVI each get a legend on the map. The soil key lists the most likely soil groups at the field (SoilGrids classification) with a plain description, and NDVI values are grouped into bare soil, sparse, moderate, dense and very dense. Tap the map to read the soil type, texture and NDVI at a spot (the soil shows even with the soil map off).
8. **Adjusting spots**: drag a numbered pin, or press **Set by hand** and tap the map, to put a sensor where the customer wants it. A short "why here" note can be added; it goes into the report and the exports. Its notes are rewritten for the new point, with warnings when it leaves its zone, comes too close to the field edge or its block's border or sits on a pivot track; "Back to recommended spot" restores it.
9. **Return on investment** (its own tab): the farmer's own figures (irrigated area, water used per year, price of 1 m³, pump flow and power with the price of 1 kWh, or diesel use and price per litre) and HSTI's quote (price per probe, installation, yearly subscription, entered by hand) give the water, pumping hours and money saved per year, the payback in irrigation seasons and the 3-year net gain, for a low / expected / high water saving (10 / 20 / 30% by default). It goes into the report.
10. **Lidar relief and 3D view** (the analysis uses the same lidar terrain: slope, hollows and rises at plot scale, with less smoothing than the 90 m fallback; the report gets a Terrain section with a 3D picture of the blocks and each block's lowest and highest ground, height difference, mean slope and probe heights): the map's layer menu has a *Relief (lidar)* layer (IGN LiDAR HD hillshade in France, Esri hillshade elsewhere) shaded into the satellite image. **3D view** (under the blocks, the results and the probe check) shows the drawn blocks on a terrain model with the satellite image, NDVI or height colours draped on it, the probe spots as numbered pins, a relief exaggeration (×1 to ×10) and each block's lowest and highest point. The terrain is IGN LiDAR HD, then IGN RGE ALTI (France, about 1 m), then the AWS terrain tiles (worldwide, about 30 m). three.js loads only when the 3D view is opened.
11. **Exports**: a printable placement report (reason for each spot, installation tip, blank fields for install date, depth and serial number), plus GPX, CSV and GeoJSON.

## Data sources

| Data | Source | Resolution |
| --- | --- | --- |
| Elevation (analysis) | IGN LiDAR HD, then RGE ALTI (France); AWS terrain tiles elsewhere; Copernicus DEM GLO-90 via [Open-Meteo](https://open-meteo.com/en/docs/elevation-api) if those fail | 1 m (France), ~30 m, 90 m |
| Soil texture (analysis) | [ISRIC SoilGrids 2.0](https://www.isric.org/explore/soilgrids), 0–60 cm | 250 m |
| Soil maps (display) | ISRIC SoilGrids WMS: WRB soil type, clay 15–30 cm; link to the INRAE / GIS Sol *carte des sols* on cartes.gouv.fr | 250 m |
| NDVI | Copernicus Sentinel-2 L2A COGs via [Earth Search](https://element84.com/earth-search/) (AWS open data) | 10 m |
| Relief and 3D terrain | IGN Géoplateforme LiDAR HD / RGE ALTI (France, WMS-R); AWS terrain tiles and Esri World Hillshade elsewhere | 1 m (France), ~30 m |
| Basemap | Esri World Imagery, OpenStreetMap | |

## Code layout

- `index.html`: page structure
- `css/app.css`: styles (light and dark)
- `js/util.js`: helpers, geometry, projections, colour ramps
- `js/icons.js`: the [Papicons](https://github.com/PapillonApp/papicons) icons the app uses (MIT, copied in so there is no build step)
- `js/sources.js`: elevation, soil, NDVI file and Sentinel-2 loading
- `js/analysis.js`: grid, terrain, zoning, spot selection and explanations
- `js/roi.js`: return on investment (water and pumping savings, payback)
- `js/section.js`: cross-section of crop, roots, irrigation and probe
- `js/layout.js`: irrigation equipment layout on the map (lines, heads, header pipes, valves, pivot, linear)
- `js/report.js`: report and GPX/CSV/GeoJSON exports
- `js/terrain3d.js`: lidar relief layer, terrain loading and the 3D view
- `js/app.js`: map and UI wiring

Libraries load from CDNs: Leaflet 1.9.4, proj4 2.9.2, geotiff.js 2.1.3, and three.js r128 (only when the 3D view opens).
