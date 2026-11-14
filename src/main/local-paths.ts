import { app } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Personal F-drive build: never silently fall back to the system drive.
const root = process.env.MULTIPUBLISH_USER_DATA_DIR || 'F:\\Codex\\MultiPublish\\data';
if (!path.isAbsolute(root)) throw new Error('MultiPublish 数据目录必须是绝对路径');
const locations = {
  userData: root,
  sessionData: path.join(root, 'browser'),
  temp: path.join(root, 'temp'),
  logs: path.join(root, 'logs'),
  crashDumps: path.join(root, 'crashes'),
};
for (const directory of Object.values(locations)) mkdirSync(directory, { recursive: true });
app.setPath('userData', locations.userData);
app.setPath('sessionData', locations.sessionData);
app.setPath('temp', locations.temp);
app.setPath('crashDumps', locations.crashDumps);
app.setAppLogsPath(locations.logs);
process.env.TEMP = locations.temp;
process.env.TMP = locations.temp;
writeFileSync(path.join(root, 'storage-paths.json'), JSON.stringify(locations, null, 2));
