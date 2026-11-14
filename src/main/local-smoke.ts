import { app, BrowserWindow, session } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';

// Runs only on explicit local QA invocation. It never opens a platform or publishes.
export async function localSmoke(window: BrowserWindow, output: string) {
  const result: Record<string, unknown> = { ok: false, version: app.getVersion() };
  try {
    let text = '';
    for (let retry = 0; retry < 50; retry++) {
      text = await window.webContents.executeJavaScript('document.body.innerText');
      if (text.includes('账号管理') && text.includes('视频发布')) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    if (!text.includes('账号管理') || !text.includes('视频发布')) throw new Error('主界面未渲染');
    result.preload = await window.webContents.executeJavaScript(`(async () => {
      const api = window.multiPublish;
      if (!api) throw new Error('preload API missing');
      const data = await api.getData();
      return {version: await api.getVersion(), accounts: data.accounts.length, drafts: data.drafts.length, tasks: data.tasks.length};
    })()`);
    result.paths = Object.fromEntries(['userData', 'sessionData', 'temp', 'logs', 'crashDumps'].map(name => [name, app.getPath(name as 'userData')]));
    result.browserStoragePath = session.fromPartition('persist:local-smoke').storagePath;
    if (process.env.MULTIPUBLISH_COVER_REGRESSION === '1') {
      const { runCoverRegression } = await import('./cover-regression');
      result.coverRegression = await runCoverRegression(window);
    }
    if (process.env.MULTIPUBLISH_BAIJIAHAO_SMOKE === '1') {
      if (!app.getPath('userData').includes('\\work\\')) throw new Error('写入测试仅允许隔离的 work 测试目录');
      result.baijiahaoDataCompatibility = await window.webContents.executeJavaScript(`(async () => {
        const api = window.multiPublish;
        const before = await api.getData();
        await api.addAccount({platform:'baijiahao'});
        const after = await api.getData();
        const originalIds = new Set(before.accounts.map(a=>a.id));
        if (JSON.stringify(after.accounts.filter(a=>originalIds.has(a.id))) !== JSON.stringify(before.accounts)) throw new Error('旧账号记录被改变');
        if (JSON.stringify(after.accountSelections) !== JSON.stringify(before.accountSelections)) throw new Error('原平台勾选记录被改变');
        const added = after.accounts.at(-1);
        if (added.platform !== 'baijiahao' || added.name !== '百家号账号') throw new Error('新增账号不正确');
        let rejected = false;
        try { await api.createPublish({type:'video',title:'短',description:'',topics:[],mediaPaths:[],accountIds:[added.id]}); } catch { rejected = true; }
        if (!rejected) throw new Error('短标题未拦截');
        return {previousAccountsPreserved:true,newAccountPlatform:added.platform,shortTitleRejected:rejected};
      })()`);
      const video = process.env.MULTIPUBLISH_FIXTURE_VIDEO;
      const cover = process.env.MULTIPUBLISH_FIXTURE_COVER;
      if (video && cover) {
        result.customCoverPreserved = await window.webContents.executeJavaScript(`(async () => {
          const api=window.multiPublish;
          const data=await api.getData();
          const a=data.accounts.find(a=>a.platform==='baijiahao');
          const draft={type:'video',title:'这是百家号自选封面保存测试',description:'',topics:[],mediaPaths:[${JSON.stringify(video)}],coverPath:${JSON.stringify(cover)},accountIds:[a.id]};
          const saved=await api.createPublish(draft);
          if(saved.drafts[0].coverPath!==draft.coverPath)throw new Error('手选封面被覆盖');
          return true;
        })()`);
      }
      await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('添加账号'))?.click()`);
      await new Promise(resolve => setTimeout(resolve, 500));
      const picker = await window.webContents.executeJavaScript('document.body.innerText');
      if (!picker.includes('百家号')) throw new Error('添加账号列表缺少百家号');
      result.baijiahaoPickerVisible = true;
    }
    if (!Object.values(result.paths as Record<string, string>).every(value => value.startsWith('F:\\'))) throw new Error('存储路径不在 F 盘');
    if (!String(result.browserStoragePath).startsWith('F:\\')) throw new Error('浏览器会话路径不在 F 盘');
    result.visibleText = text;
    await fs.mkdir(path.dirname(output), {recursive: true});
    await fs.writeFile(output + '.png', (await window.webContents.capturePage()).toPNG());
    result.ok = true;
  } catch (error) {
    result.error = String(error);
    result.visibleText = await window.webContents.executeJavaScript('document.body.innerText').catch(() => '');
    await fs.writeFile(output + '.png', (await window.webContents.capturePage()).toPNG()).catch(() => undefined);
  }
  await fs.writeFile(output, JSON.stringify(result, null, 2));
  app.exit(result.ok ? 0 : 1);
}
