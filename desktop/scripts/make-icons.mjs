// Builds every icon the desktop app needs from the logo in ../assets:
//   assets/logo.svg      the white clef, for the setup and unreachable screens
//   assets/icon.svg      the clef on Stave's dark rounded tile
//   build/icon.png       512 px, for electron-builder
//   build/icon.ico       16-256 px, for the window, taskbar and installer
//   assets/tray.png      16 px (+ @2x), for the notification area
// Run with: npm run icons
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import pngToIco from 'png-to-ico';

const desktop = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const logo = readFileSync(fileURLToPath(new URL('../../assets/stave-logo.svg', import.meta.url)), 'utf8');

// The logo is one white path in a 33.82 x 100 box; centre it on a 100 x 100 tile.
const path = logo.match(/<path[^>]*\sd="([^"]+)"/)[1];
const tile = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<rect width="100" height="100" rx="22" fill="#0b0f1a"/>
<path transform="translate(35.5 10) scale(0.8)" fill="#ffffff" fill-rule="evenodd" d="${path}"/>
</svg>
`;

const render = (svg, size) => new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();

mkdirSync(desktop('assets'), { recursive: true });
mkdirSync(desktop('build'), { recursive: true });
writeFileSync(desktop('assets/logo.svg'), logo);
writeFileSync(desktop('assets/icon.svg'), tile);
writeFileSync(desktop('build/icon.png'), render(tile, 512));
writeFileSync(desktop('assets/tray.png'), render(tile, 16));
writeFileSync(desktop('assets/tray@2x.png'), render(tile, 32));
writeFileSync(desktop('build/icon.ico'), await pngToIco([16, 24, 32, 48, 64, 128, 256].map((size) => render(tile, size))));
console.log('icons written to desktop/assets and desktop/build');
