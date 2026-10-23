# Hydrascout Placement

A lightweight web app that suggests where to install Hydrascout soil & temperature sensors (HSTI France) in a field.

It runs entirely in the browser: no server, no account, no API keys. Open `index.html` locally, or host the folder on GitHub Pages (Settings → Pages → Deploy from branch `main`, folder `/`).

## How it works

1. **Field**: draw the boundary on the satellite map, or import a GeoJSON/KML file.
2. **Crop vigour (NDVI)**: the app searches free Sentinel-2 L2A images of the last 14 months, checks the clouds over the field with the scene classification layer, and computes 10 m NDVI from the clearest image with full crop cover. Any other clear date can be picked, or a drone NDVI GeoTIFF uploaded instead.
3. **Irrigation (optional)**: drip (emitter and line spacing, flow), micro-sprinkler or sprinkler (head spacing), centre pivot (centre, radius, span length), linear move, furrow/flood.
4. **Analysis**: the field is sampled on a grid. Each point gets elevation, slope, relative position (hollow or rise), soil texture, NDVI and pivot coverage. Points are grouped into zones (k-means on standardised variables), and each sensor goes at the most typical point of its zone, away from the field edge, the pivot centre, the end of the pivot and tower wheel tracks.
5. **Exports**: a printable placement report (reason for each spot, installation tip, blank fields for install date, depth and serial number), plus GPX, CSV and GeoJSON.

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
- `js/report.js`: report and GPX/CSV/GeoJSON exports
- `js/app.js`: map and UI wiring

Libraries load from CDNs: Leaflet 1.9.4, proj4 2.9.2, geotiff.js 2.1.3.
