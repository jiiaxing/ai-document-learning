'use strict';

// Exercise the real updater against a loopback feed. Installation is always stubbed.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const yaml = require('js-yaml');
const { NsisUpdater } = require('electron-updater');
const { NodeHttpExecutor } = require('builder-util/out/nodeHttpExecutor');
const { ElectronHttpExecutor } = require('electron-updater/out/electronHttpExecutor');

const root = path.resolve(__dirname, '..');
const { version } = require(path.join(root, 'package.json'));
const installerName = `AI-PDF-Tutor-${version}-Setup.exe`;
const installerPath = path.join(root, 'release', installerName);
const metadataPath = path.join(root, 'release', 'latest.yml');
const controllerPath = path.join(root, 'out', 'desktop', 'updateController.js');
const controllers = [];
let server;
let watchdog;

async function sha512(file) {
    const hash = createHash('sha512');
    for await (const chunk of fs.createReadStream(file)) { hash.update(chunk); }
    return hash.digest('base64');
}

async function waitFor(read, expected, label) {
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
        const value = read();
        if (expected(value)) { return value; }
        await delay(25);
    }
    throw new Error(`Timed out waiting for ${label}. Last state: ${JSON.stringify(read())}`);
}

function closeResources() {
    for (const controller of controllers) { controller.dispose(); }
    if (server) {
        server.closeAllConnections();
        server.close();
    }
    clearTimeout(watchdog);
}

async function main() {
    for (const file of [installerPath, metadataPath, controllerPath]) {
        if (!fs.existsSync(file)) {
            throw new Error(`Missing ${path.relative(root, file)}. Run npm run dist:win first.`);
        }
    }
    const { UpdateController } = require(controllerPath);
    const originalYaml = await fsp.readFile(metadataPath, 'utf8');
    const metadata = yaml.load(originalYaml);
    assert.equal(metadata.version, version, 'Build metadata must match package.json');
    const installerInfo = metadata.files.find(file => file.url === installerName);
    assert.ok(installerInfo, 'The current build installer must be present in latest.yml');
    const originalHash = await sha512(installerPath);
    assert.equal(originalHash, installerInfo.sha512, 'The source installer must match its build metadata');
    const corruptedMetadata = JSON.parse(JSON.stringify(metadata));
    corruptedMetadata.sha512 = Buffer.alloc(64).toString('base64');
    for (const file of corruptedMetadata.files) { file.sha512 = corruptedMetadata.sha512; }
    const invalidYaml = yaml.dump(corruptedMetadata);
    const outputDir = path.join(root, 'test-results', `update-download-${Date.now()}`);
    await fsp.mkdir(outputDir, { recursive: true });
    const requestLog = [];
    const installerSize = (await fsp.stat(installerPath)).size;

    server = http.createServer((request, response) => {
        const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
        requestLog.push({ method: request.method, path: pathname });
        if (request.method !== 'GET' && request.method !== 'HEAD') {
            response.writeHead(405).end();
            return;
        }
        if (pathname === '/valid/latest.yml' || pathname === '/invalid/latest.yml') {
            const body = pathname.startsWith('/valid/') ? originalYaml : invalidYaml;
            response.writeHead(200, { 'Content-Type': 'text/yaml', 'Content-Length': Buffer.byteLength(body) });
            response.end(request.method === 'HEAD' ? undefined : body);
            return;
        }
        if (pathname === `/valid/${installerName}` || pathname === `/invalid/${installerName}`) {
            response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': installerSize });
            if (request.method === 'HEAD') { response.end(); return; }
            const stream = fs.createReadStream(installerPath);
            stream.on('error', error => response.destroy(error));
            response.on('close', () => stream.destroy());
            stream.pipe(response);
            return;
        }
        response.writeHead(404).end();
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const port = server.address().port;

    async function runScenario(name, corrupt) {
        const scenarioDir = path.join(outputDir, name);
        await fsp.mkdir(scenarioDir, { recursive: true });
        const feed = `http://127.0.0.1:${port}/${corrupt ? 'invalid' : 'valid'}/`;
        const configPath = path.join(scenarioDir, 'app-update.yml');
        await fsp.writeFile(configPath, yaml.dump({ provider: 'generic', url: feed, updaterCacheDirName: 'download-cache' }));
        let quitHandlers = 0;
        const appAdapter = {
            version: '0.1.1', name: 'AI PDF Tutor Update Smoke Test', isPackaged: true,
            appUpdateConfigPath: configPath, userDataPath: path.join(scenarioDir, 'user-data'),
            baseCachePath: path.join(scenarioDir, 'cache'),
            whenReady: async () => {},
            relaunch: () => assert.fail('The smoke test must never relaunch the real application'),
            quit: () => assert.fail('The smoke test must never quit the real application'),
            onQuit: () => { quitHandlers += 1; }
        };
        await fsp.mkdir(appAdapter.userDataPath, { recursive: true });
        const backend = new NsisUpdater(null, appAdapter);
        const executor = new NodeHttpExecutor();
        // Reuse the updater's native streaming/checksum path with Node HTTP transport.
        executor.download = ElectronHttpExecutor.prototype.download;
        executor.createRequest = (options, callback) => {
            assert.equal(options.protocol, 'http:', 'Only the loopback HTTP feed is allowed');
            assert.equal(options.hostname || options.host, '127.0.0.1', 'External network requests are forbidden');
            assert.equal(Number(options.port), port, 'Only the smoke test server port is allowed');
            return http.request({ ...options, agent: false }, callback);
        };
        backend.httpExecutor = executor;
        backend.disableDifferentialDownload = true;
        backend.logger = null;
        backend.setFeedURL({ provider: 'generic', url: feed });
        const installCalls = [];
        backend.quitAndInstall = (...args) => { installCalls.push(args); };
        backend.doInstall = () => assert.fail('Starting an actual installer is forbidden');
        const statuses = [];
        let progressEvents = 0;
        backend.on('download-progress', () => { progressEvents += 1; });
        const controller = new UpdateController(backend, {
            currentVersion: appAdapter.version, installMode: 'installed', enabled: true,
            onStatus: status => statuses.push(status)
        });
        controllers.push(controller);
        assert.equal(backend.autoInstallOnAppQuit, false);
        await controller.check();
        const available = await waitFor(() => controller.getStatus(), status => ['available', 'error'].includes(status.phase), `${name}: available`);
        assert.equal(available.phase, 'available', available.message);
        assert.equal(available.version, version);
        await controller.install();
        assert.equal(installCalls.length, 0, 'An available update cannot be installed before downloading');
        const started = await controller.download();
        assert.equal(started.phase, 'downloading');
        await controller.download();
        const finished = await waitFor(() => controller.getStatus(), status => ['downloaded', 'error'].includes(status.phase), `${name}: download completion`);
        if (corrupt) {
            assert.equal(finished.phase, 'error', 'A checksum mismatch must fail the update');
            assert.equal(finished.message, '更新文件校验失败，请重新下载。');
            assert.equal(statuses.some(status => status.phase === 'downloaded'), false);
            await controller.install();
            await delay(200);
            assert.equal(installCalls.length, 0, 'A corrupted download must never reach the installer');
        } else {
            assert.equal(finished.phase, 'downloaded', finished.message);
            assert.ok(backend.installerPath, 'The real updater must produce a downloaded installer');
            assert.equal(await sha512(backend.installerPath), originalHash, 'Downloaded bytes must match the original build');
            assert.ok(progressEvents > 0, 'The real download must emit progress');
            assert.equal(quitHandlers, 0, 'Downloading must not register automatic installation on quit');
            assert.equal(installCalls.length, 0, 'A completed download must not launch installation automatically');
            await controller.install();
            await controller.install();
            await waitFor(() => installCalls.length, count => count === 1, 'stubbed explicit installation');
            assert.deepEqual(installCalls, [[false, true]]);
        }
        const result = { scenario: name, passed: true, progressEvents, installCalls, statusPhases: [...new Set(statuses.map(status => status.phase))], finalStatus: controller.getStatus(), downloadedPath: backend.installerPath };
        controller.dispose();
        return result;
    }

    const results = [await runScenario('valid-download', false), await runScenario('invalid-checksum', true)];
    const report = { version, sourceInstaller: installerPath, sourceSha512: originalHash, installerBytes: installerSize, network: 'loopback-only', realInstallerLaunched: false, results, requests: requestLog };
    const reportPath = path.join(outputDir, 'report.json');
    await fsp.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`PASS: Real ${version} installer downloaded and SHA512 matched (${installerSize} bytes).`);
    console.log('PASS: Incorrect SHA512 rejected; installation blocked. Explicit install was safely stubbed.');
    console.log(`Report: ${reportPath}`);
}

watchdog = setTimeout(() => {
    console.error('FAIL: Update download smoke test exceeded 120 seconds.');
    closeResources();
    process.exit(1);
}, 120000);

main().catch(error => {
    console.error(`FAIL: ${error.stack || error.message}`);
    process.exitCode = 1;
}).finally(closeResources);
