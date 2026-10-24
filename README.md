# Hydrascout Placement

A lightweight web app that suggests where to install Hydrascout soil & temperature sensors (HSTI France) in a field.

It runs entirely in the browser: no server, no account, no API keys. Open `index.html` locally, or host the folder on GitHub Pages (Settings → Pages → Deploy from branch `main`, folder `/`).

## How it works

1. **Irrigation blocks asked first**: the app starts by asking how many irrigation blocks the grower has. HSTI sizes a kit as one probe per block, so the answer gives the number of probes straight away. It opens one row per block, each with a name and a **Draw borders** button (or import the blocks from GeoJSON/KML). Drawn blocks also set the field when no outline is drawn.
2. **Field**: draw the boundary on the satellite map, or import a GeoJSON/KML file. Optional when the blocks are drawn: the outline around them is used.
3. **Crop vigour (NDVI)**: the app searches free Sentinel-2 L2A images of the last 14 months, checks the clouds over the field with the scene classification layer, and computes 10 m NDVI from the clearest image with full crop cover. Any other clear date can be picked, or a drone NDVI GeoTIFF uploaded instead.
4. **Irrigation blocks (optional)**: HSTI sizes a kit as one probe per irrigation block. Draw or import the blocks (GeoJSON/KML, one polygon per block): each block gets one probe at its most typical point, never close to the block's border (same distance as the field edge), and a block made of two clearly different parts (terrain, soil, NDVI, pivot) gets an optional second probe with the difference explained. Without blocks, the number of probes is picked by hand (e.g. the number of blocks) or by field size.
5. **Irrigation equipment (optional)**: drip (emitter and line spacing, flow), micro-sprinkler or sprinkler (head spacing), centre pivot (centre, radius, span length), linear move, furrow/flood.
6. **Analysis**: the field is sampled on a grid. Each point gets elevation, slope, relative position (hollow or rise), soil texture, NDVI and pivot coverage. Points are grouped into zones (k-means on standardised variables), and each sensor goes at the most typical point of its zone, away from the field edge and its block's border, the pivot centre, the end of the pivot and tower wheel tracks.
7. **Map key**: the soil map and NDVI each get a legend on the map. The soil key lists the most likely soil groups at the field (SoilGrids classification) with a plain description, and NDVI values are grouped into bare soil, sparse, moderate, dense and very dense. Tap the map to read the soil and NDVI at a spot.
8. **Adjusting spots**: drag a numbered pin to move a sensor. Its notes are rewritten for the new point, with warnings when it leaves its zone, comes too close to the field edge or its block's border or sits on a pivot track; "Back to recommended spot" restores it.
9. **Return on investment** (its own tab): the farmer's own figures (irrigated area, water used per year, price of 1 m³, pump flow and power with the price of 1 kWh, or diesel use and price per litre) and HSTI's quote (price per probe, installation, yearly subscription, entered by hand) give the water, pumping hours and money saved per year, the payback in irrigation seasons and the 3-year net gain, for a low / expected / high water saving (10 / 20 / 30% by default). It goes into the report.
10. **Exports**: a printable placement report (reason for each spot, installation tip, blank fields for install date, depth and serial number), plus GPX, CSV and GeoJSON.

## Data sources

| Data | Source | Resolution |
| --- | --- | --- |
| Elevation | Copernicus DEM GLO-90 via [Open-Meteo](https://open-meteo.com/en/docs/elevation-api) | 90 m |
| Soil texture (analysis) | [ISRIC SoilGrids 2.0](https://www.isric.org/explore/soilgrids), 0–60 cm | 250 m |
| Soil maps (display) | ISRIC SoilGrids WMS: WRB soil type, clay 15–30 cm; link to the INRAE / GIS Sol *carte des sols* on cartes.gouv.fr | 250 m |
| NDVI | Copernicus Sentinel-2 L2A COGs via [Earth Search](https://element84.com/earth-search/) (AWS open data) | 10 m |
| Basemap | Esri World Imagery, OpenStreetMap | |

## Code layout

- `index.html`: page structure
- `css/app.css`: styles (light and dark)
- `js/util.js`: helpers, geometry, projections, colour ramps
- `js/sources.js`: elevation, soil, NDVI file and Sentinel-2 loading
- `js/analysis.js`: grid, terrain, zoning, spot selection and explanations
- `js/roi.js`: return on investment (water and pumping savings, payback)
- `js/report.js`: report and GPX/CSV/GeoJSON exports
- `js/app.js`: map and UI wiring

Libraries load from CDNs: Leaflet 1.9.4, proj4 2.9.2, geotiff.js 2.1.3.
