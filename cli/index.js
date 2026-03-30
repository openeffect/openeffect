#!/usr/bin/env node

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');
const http = require('http');

const VERSION = '0.1.0';
const DEFAULT_PORT = 3131;
const HEALTH_TIMEOUT = 30000;
const HEALTH_INTERVAL = 500;

// Colors
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

function banner() {
  console.log('');
  console.log(bold(`  ✦ OpenEffect v${VERSION}`));
  console.log(dim('  Open magic for your media'));
  console.log('');
}

function checkNodeVersion() {
  const major = parseInt(process.version.slice(1).split('.')[0], 10);
  if (major < 20) {
    console.error(red(`  ✗ Node.js >= 20 required (found ${process.version})`));
    console.error(`    Download: https://nodejs.org/`);
    process.exit(1);
  }
}

function checkPython() {
  try {
    const version = execSync('python3 --version', { encoding: 'utf8' }).trim();
    const match = version.match(/Python (\d+)\.(\d+)/);
    if (!match || parseInt(match[1]) < 3 || (parseInt(match[1]) === 3 && parseInt(match[2]) < 12)) {
      throw new Error(`Found ${version}, need 3.12+`);
    }
    console.log(dim(`  ✓ ${version}`));
  } catch (e) {
    console.error(red('  ✗ Python >= 3.12 required'));
    console.error('    Install:');
    if (process.platform === 'darwin') console.error('      brew install python@3.12');
    else if (process.platform === 'linux') console.error('      apt install python3.12');
    else console.error('      winget install Python.Python.3.12');
    process.exit(1);
  }
}

function checkUv() {
  try {
    const version = execSync('uv --version', { encoding: 'utf8' }).trim();
    console.log(dim(`  ✓ ${version}`));
  } catch {
    console.error(red('  ✗ uv is required'));
    console.error('    Install: curl -LsSf https://astral.sh/uv/install.sh | sh');
    process.exit(1);
  }
}

function findPort(startPort) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(startPort, '127.0.0.1', () => {
      server.close(() => resolve(startPort));
    });
    server.on('error', () => resolve(findPort(startPort + 1)));
  });
}

async function checkForUpdates() {
  const cacheDir = path.join(require('os').homedir(), '.openeffect');
  const cacheFile = path.join(cacheDir, '.update_check');

  try {
    if (fs.existsSync(cacheFile)) {
      const stat = fs.statSync(cacheFile);
      const age = Date.now() - stat.mtimeMs;
      if (age < 24 * 60 * 60 * 1000) {
        const cached = fs.readFileSync(cacheFile, 'utf8').trim();
        return cached || null;
      }
    }
  } catch {}

  return new Promise((resolve) => {
    const req = http.get('http://registry.npmjs.org/openeffect/latest', { timeout: 3000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const pkg = JSON.parse(data);
          const latest = pkg.version;
          fs.mkdirSync(cacheDir, { recursive: true });
          fs.writeFileSync(cacheFile, latest !== VERSION ? latest : '');
          resolve(latest !== VERSION ? latest : null);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

function waitForHealth(port, timeout) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function check() {
      if (Date.now() - start > timeout) {
        return reject(new Error('Server failed to start within 30 seconds'));
      }
      const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.status === 'ok') return resolve();
          } catch {}
          setTimeout(check, HEALTH_INTERVAL);
        });
      });
      req.on('error', () => setTimeout(check, HEALTH_INTERVAL));
      req.on('timeout', () => { req.destroy(); setTimeout(check, HEALTH_INTERVAL); });
    }
    check();
  });
}

async function main() {
  banner();
  checkNodeVersion();
  checkPython();
  checkUv();

  const port = await findPort(DEFAULT_PORT);
  const updateVersion = await checkForUpdates();

  // Resolve paths
  const rootDir = path.resolve(__dirname, '..');
  const serverDir = path.join(rootDir, 'server');
  const effectsDir = path.join(rootDir, 'effects');

  // Check if running from npm package (bundled) or dev
  const serverPath = fs.existsSync(path.join(__dirname, 'server'))
    ? path.join(__dirname, 'server')
    : serverDir;

  const effectsPath = fs.existsSync(path.join(__dirname, 'effects'))
    ? path.join(__dirname, 'effects')
    : effectsDir;

  const env = {
    ...process.env,
    OPENEFFECT_PORT: String(port),
    OPENEFFECT_UPDATE_VERSION: updateVersion || '',
    OPENEFFECT_EFFECTS_DIR: effectsPath,
  };

  console.log(dim('  Starting server...'));

  const server = spawn('uv', ['run', '--project', serverPath, 'fastapi', 'dev', '--port', String(port), '--host', '127.0.0.1'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  server.stdout.on('data', (data) => {
    const line = data.toString().trim();
    if (line) console.log(dim(`  ${line}`));
  });

  server.stderr.on('data', (data) => {
    const line = data.toString().trim();
    if (line && !line.includes('INFO')) console.error(dim(`  ${line}`));
  });

  // Graceful shutdown
  let shuttingDown = false;
  function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('');
    console.log(dim('  Shutting down...'));
    server.kill('SIGTERM');
    setTimeout(() => {
      server.kill('SIGKILL');
      process.exit(0);
    }, 3000);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  server.on('close', (code) => {
    if (!shuttingDown) {
      console.error(red(`  Server exited unexpectedly (code ${code})`));
      process.exit(1);
    }
    process.exit(0);
  });

  try {
    await waitForHealth(port, HEALTH_TIMEOUT);
  } catch (e) {
    console.error(red(`  ✗ ${e.message}`));
    server.kill();
    process.exit(1);
  }

  console.log('');
  console.log(green(`  ✓ OpenEffect is running at http://localhost:${port}`));
  console.log('');

  if (updateVersion) {
    console.log(yellow(`  ✦ OpenEffect v${updateVersion} is available — run npx openeffect@latest to update`));
    console.log('');
  }

  // Open browser
  try {
    const open = require('open');
    await open(`http://localhost:${port}`);
  } catch {
    console.log(dim(`  Open http://localhost:${port} in your browser`));
  }
}

main().catch((e) => {
  console.error(red(`  ✗ ${e.message}`));
  process.exit(1);
});
