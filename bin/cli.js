#!/usr/bin/env node

'use strict';

const path = require('path');

// Set working directory to package root so server.js can find public/
process.chdir(path.resolve(__dirname, '..'));

const args = process.argv.slice(2);

// Parse --port or -p flag
let customPort = null;
for (let i = 0; i < args.length; i++) {
  if ((args[i] === '--port' || args[i] === '-p') && args[i + 1]) {
    customPort = parseInt(args[i + 1], 10);
    break;
  }
  const match = args[i].match(/^--port=(\d+)$/);
  if (match) { customPort = parseInt(match[1], 10); break; }
}

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
  Claude Map — Visual dashboard for Claude Code configurations

  Usage:
    claude-map              Start the dashboard (default port 3131)
    claude-map -p 8080      Start on a custom port
    claude-map --help       Show this help

  Options:
    -p, --port <number>     Port to listen on (default: 3131)
    -h, --help              Show help
    -v, --version           Show version
`);
  process.exit(0);
}

if (args.includes('--version') || args.includes('-v')) {
  const pkg = require('../package.json');
  console.log(pkg.version);
  process.exit(0);
}

if (customPort) {
  process.env.PORT = String(customPort);
}

require('../server.js');
