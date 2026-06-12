/**
 * Test servers for the reftest suite.
 *
 * Main server (--port, default 8080):
 *   - serves the repository root statically (reftest pages, dist/, assets, ...)
 *
 * CORS server (--cors, default 8081), used by cross-origin reftests:
 *   - /proxy  -> html2canvas-proxy (used as the default `proxy` option by the reftest runner)
 *   - /cors   -> repository root with CORS headers (e.g. images/cross-origin.html)
 *   - /       -> tests/ directory WITHOUT CORS headers (e.g. crossorigin-iframe.html, images/base.html)
 */
import express from 'express';
import cors from 'cors';
import * as path from 'path';

/* eslint-disable @typescript-eslint/no-require-imports */
// These packages ship without type declarations.
const serveIndex = require('serve-index');
const proxy = require('html2canvas-proxy');
/* eslint-enable @typescript-eslint/no-require-imports */

const root = path.resolve(__dirname, '..');

export const app = express();
app.use(express.static(root));
app.use('/', serveIndex(root, {icons: true}));

export const corsApp = express();
corsApp.use('/proxy', proxy());
corsApp.use('/cors', cors(), express.static(root));
corsApp.use('/', express.static(path.resolve(__dirname, '.')));

const numericArg = (name: string, defaultValue: number): number => {
    const arg = process.argv.find((value) => value.startsWith(`--${name}=`));
    const parsed = arg ? parseInt(arg.slice(name.length + 3), 10) : NaN;
    return isNaN(parsed) ? defaultValue : parsed;
};

const port = numericArg('port', 8080);
const corsPort = numericArg('cors', 8081);

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

corsApp.listen(corsPort, () => {
    console.log(`CORS server running on port ${corsPort}`);
});
