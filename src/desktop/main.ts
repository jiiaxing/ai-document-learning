import { app, BrowserWindow, Menu, MenuItemConstructorOptions, shell } from 'electron';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { loadConfig } from '../standalone/config';
import { DeveloperLogger } from '../standalone/logger';
import { startServer } from '../standalone/server';
import { AppConfig } from '../standalone/types';

type ServerHandle = Awaited<ReturnType<typeof startServer>>;

let mainWindow: BrowserWindow | null = null;
let serverHandle: ServerHandle | null = null;
let desktopConfig: AppConfig | null = null;

app.setName('AI PDF Tutor');

function appRoot(): string {
    return app.isPackaged ? app.getAppPath() : resolve(__dirname, '..', '..');
}

function createDesktopConfig(): AppConfig {
    const root = appRoot();
    const userDataDir = app.getPath('userData');
    const configFile = join(userDataDir, 'ai-tutor.config.json');
    const logFile = join(userDataDir, 'logs', 'app.log');
    mkdirSync(dirname(logFile), { recursive: true });

    return loadConfig(root, {
        ...process.env,
        AI_TUTOR_CONFIG: configFile,
        AI_TUTOR_HOST: '127.0.0.1',
        AI_TUTOR_PORT: process.env.AI_TUTOR_DESKTOP_PORT ?? '0',
        AI_TUTOR_PUBLIC_DIR: join(root, 'public'),
        AI_TUTOR_LOG_FILE: logFile
    });
}

async function createMainWindow(serverUrl: string): Promise<void> {
    mainWindow = new BrowserWindow({
        width: 1440,
        height: 920,
        minWidth: 900,
        minHeight: 720,
        title: 'AI PDF Tutor',
        backgroundColor: '#f5f7f4',
        show: false,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            spellcheck: true
        }
    });

    mainWindow.once('ready-to-show', () => {
        mainWindow?.show();
    });
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        void shell.openExternal(url);
        return { action: 'deny' };
    });

    await mainWindow.loadURL(serverUrl);
}

function buildMenu(): void {
    const template: MenuItemConstructorOptions[] = [
        {
            label: '文件',
            submenu: [
                {
                    label: '打开 PDF',
                    accelerator: 'CmdOrCtrl+O',
                    click: () => {
                        void mainWindow?.webContents.executeJavaScript(
                            "document.getElementById('pdfInput')?.click()",
                            true
                        );
                    }
                },
                { type: 'separator' },
                {
                    label: '打开日志目录',
                    click: () => {
                        const logDir = desktopConfig ? dirname(desktopConfig.logFile) : join(app.getPath('userData'), 'logs');
                        void shell.openPath(logDir);
                    }
                },
                {
                    label: '打开配置文件',
                    click: () => {
                        const configFile = desktopConfig?.configFile ?? join(app.getPath('userData'), 'ai-tutor.config.json');
                        void shell.openPath(configFile);
                    }
                },
                { type: 'separator' },
                { role: 'quit', label: '退出' }
            ]
        },
        {
            label: '编辑',
            submenu: [
                { role: 'undo', label: '撤销' },
                { role: 'redo', label: '重做' },
                { type: 'separator' },
                { role: 'cut', label: '剪切' },
                { role: 'copy', label: '复制' },
                { role: 'paste', label: '粘贴' },
                { role: 'selectAll', label: '全选' }
            ]
        },
        {
            label: '视图',
            submenu: [
                { role: 'reload', label: '刷新' },
                { role: 'toggleDevTools', label: '开发者工具' },
                { type: 'separator' },
                { role: 'resetZoom', label: '重置缩放' },
                { role: 'zoomIn', label: '放大' },
                { role: 'zoomOut', label: '缩小' },
                { type: 'separator' },
                { role: 'togglefullscreen', label: '全屏' }
            ]
        }
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function bootDesktop(): Promise<void> {
    desktopConfig = createDesktopConfig();
    const logger = new DeveloperLogger({
        logFile: desktopConfig.logFile,
        level: desktopConfig.logLevel
    });
    serverHandle = await startServer(desktopConfig, logger);
    if (process.argv.includes('--smoke-test')) {
        const [indexResponse, settingsResponse] = await Promise.all([
            fetch(serverHandle.url),
            fetch(`${serverHandle.url}/api/settings`)
        ]);
        console.log(JSON.stringify({
            url: serverHandle.url,
            configFile: desktopConfig.configFile,
            logFile: desktopConfig.logFile,
            publicDir: desktopConfig.publicDir,
            indexStatus: indexResponse.status,
            settingsStatus: settingsResponse.status
        }));
        app.quit();
        return;
    }
    buildMenu();
    await createMainWindow(serverHandle.url);
}

app.on('before-quit', () => {
    serverHandle?.server.close();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (!mainWindow && serverHandle) {
        void createMainWindow(serverHandle.url);
    }
});

void app.whenReady()
    .then(bootDesktop)
    .catch((error: unknown) => {
        console.error(error);
        app.quit();
    });
