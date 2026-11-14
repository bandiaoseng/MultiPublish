import { app, BrowserWindow, session } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AppData } from '../shared/types';
import { chromeUserAgent } from './browser-manager';
import { createElectronCoverIO, applyVideoCover } from './video-cover-electron';
import type { CoverPlatform } from './video-cover';

/** Isolated existing-work inspection; explicit prepare mode uploads covers but never submits a post. */
export async function inspectExistingCover(data: AppData) {
  const platform = process.env.MULTIPUBLISH_COVER_INSPECT!;
  const output = process.env.MULTIPUBLISH_COVER_INSPECT_RESULT!;
  if (!app.getPath('userData').includes('\\work\\cover-publish-fix\\')) throw new Error('仅允许诊断副本');
  const account = data.accounts.find(a => a.platform === platform);
  const draft = data.drafts[0];
  const urls: Record<string, string> = { douyin: 'https://creator.douyin.com/creator-micro/content/manage', kuaishou: 'https://cp.kuaishou.com/article/manage/video', xiaohongshu: 'https://creator.xiaohongshu.com/new/note-manager', weixin: 'https://channels.weixin.qq.com/platform/post/list' };
  if (!account || !draft || !urls[platform] || !output) throw new Error('缺少诊断数据');
  const win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { session: session.fromPartition('persist:account-' + account.id), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  win.setPosition(-10000,-10000);
  win.setOpacity(0.01);
  win.showInactive();
  const report: Record<string, unknown> = { ok: false, platform, expectedTitle: draft.title, mode: 'read-only' };
  try {
    const wc = win.webContents;
    wc.setUserAgent(chromeUserAgent);
    wc.setWindowOpenHandler(({url}) => {
      if (new URL(url).hostname === new URL(urls[platform]).hostname) setImmediate(() => void wc.loadURL(url).catch(() => undefined));
      return {action:'deny'};
    });
    await wc.loadURL(urls[platform]).catch(error => { if (!/ERR_ABORTED/.test(String(error))) throw error; });
    await new Promise(r => setTimeout(r, 7000));
    for (let attempt=0; attempt<40; attempt++) {
      const found = await Promise.all([...new Set([wc.mainFrame,...wc.mainFrame.framesInSubtree])].map(frame=>frame.executeJavaScript(`document.body.innerText.includes(${JSON.stringify(draft.title)})`).catch(()=>false)));
      if (found.some(Boolean)) break;
      await new Promise(r=>setTimeout(r,500));
    }
    if (process.env.MULTIPUBLISH_COVER_INSPECT_EDITOR === '1') {
      const results = [];
      for (const frame of [...new Set([wc.mainFrame, ...wc.mainFrame.framesInSubtree])]) {
        const hover = await frame.executeJavaScript(`((title)=>{
          const nodes=[...document.querySelectorAll('a,span,div')].filter(e=>e.getClientRects().length&&e.textContent.includes(title)&&e.textContent.length<250).sort((a,b)=>a.textContent.length-b.textContent.length);
          for(const node of nodes){for(let row=node,i=0;row&&i<8;row=row.parentElement,i++){const r=row.getBoundingClientRect();if(r.width>500&&r.height>80&&r.height<400){row.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));return {x:r.x+r.width/2,y:r.y+r.height/2,html:row.outerHTML.slice(0,16000)}}}}return null;
        })(${JSON.stringify(draft.title)})`).catch(error => {report.hoverError=String(error);return null;}) as {x:number;y:number;html:string}|null;
        if (hover) {
          let offset = {x:0,y:0};
          if (frame !== wc.mainFrame) offset = await wc.mainFrame.executeJavaScript(`(()=>{const f=[...document.querySelectorAll('iframe')].find(e=>e.src===${JSON.stringify(frame.url)});const r=f?.getBoundingClientRect();return {x:r?.x||0,y:r?.y||0}})()`) as {x:number;y:number};
          if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
          await wc.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:hover.x+offset.x,y:hover.y+offset.y});
          report.targetRow = hover.html;
          await new Promise(r => setTimeout(r, 800));
        }
        const opened = await frame.executeJavaScript(`((title)=>{
          const visible=e=>!!e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
          const matches=[...document.querySelectorAll('a,span,div')].filter(e=>visible(e)&&e.textContent.includes(title)&&e.textContent.length<250).sort((a,b)=>a.textContent.length-b.textContent.length);
          for(const match of matches){for(let row=match,depth=0;row&&depth<8;depth++,row=row.parentElement){
            if(row.innerText.length>6000)break;
            let edit=[...row.querySelectorAll('button,a,span,div')].filter(e=>visible(e)&&/^(编辑作品|编辑|修改封面|修改描述和封面)$/.test(e.textContent.trim())).sort((a,b)=>a.getBoundingClientRect().width*a.getBoundingClientRect().height-b.getBoundingClientRect().width*b.getBoundingClientRect().height)[0];
            if(!edit&&location.hostname==='creator.xiaohongshu.com')edit=[...row.querySelectorAll('.note-card__action-btn')].find(e=>[...e.querySelectorAll('svg path')].some(p=>p.getAttribute('d')?.startsWith('M16.1917 17.4916')));
            if(edit){const label=edit.textContent||'编辑图标';const html=edit.parentElement.outerHTML.slice(0,3000);if(label.trim()==='修改描述和封面')edit=edit.closest('.edit-cover-item')?.querySelector('.opr-item')||edit;edit.click();return {opened:true,label,row:row.innerText.slice(0,700),html}}
          }}return {opened:false};
        })(${JSON.stringify(draft.title)})`).catch(error => ({ error: String(error) }));
        results.push(opened);
        if ((opened as { opened?: boolean }).opened) break;
      }
      report.editorAction = results;
      await new Promise(r => setTimeout(r, 3500));
    }
    if (process.env.MULTIPUBLISH_COVER_INSPECT_DIALOG === '1') {
      const adapter = createElectronCoverIO(wc, platform as CoverPlatform);
      try {
        report.beforeCover = await adapter.io.read('default');
        report.coverOpenAction = await adapter.io.action('open','default');
        await new Promise(r=>setTimeout(r,1800));
        report.afterCover = await adapter.io.read('default');
        if(process.env.MULTIPUBLISH_COVER_INSPECT_UPLOAD==='1'&&draft.coverPath){
          const {preparePlatformCover}=await import('./cover-aspect');
          await new Promise(r=>setTimeout(r,4000));
          await adapter.io.upload(await preparePlatformCover(draft.coverPath,platform as CoverPlatform,'default'),'default');
          await new Promise(r=>setTimeout(r,8000));
          report.afterUpload=await adapter.io.read('default');
        }
        report.selectedCoverControls = await Promise.all([...new Set([wc.mainFrame,...wc.mainFrame.framesInSubtree])].map(frame=>frame.executeJavaScript(`Array.from(document.querySelectorAll('[data-multipublish-cover-control]')).map(e=>({tag:e.tagName,cls:e.className,text:e.innerText.slice(0,100),html:e.outerHTML.slice(0,1200),parent:e.parentElement.outerHTML.slice(0,1800)}))`).catch(()=>[])));
      } finally { adapter.dispose(); }
    }
    if (process.env.MULTIPUBLISH_COVER_REPAIR_PREPARE === '1') {
      report.mode='prepare existing work cover; no final submit';
      if (!(report.editorAction as {opened?:boolean}[])?.some(r=>r.opened) || !draft.coverPath) throw new Error('目标作品编辑页未确认，停止封面操作');
      const readFields=async()=> (await Promise.all([...new Set([wc.mainFrame,...wc.mainFrame.framesInSubtree])].map(frame=>frame.executeJavaScript(`(()=>{
        const visible=e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
        const values=Array.from(document.querySelectorAll('textarea,input[type=text],input:not([type]),[contenteditable=true]')).filter(visible).map(e=>typeof e.value==='string'?e.value:e.innerText);
        // Channels' existing-post editor uses selectable text until a word is selected.
        if(location.hostname==='channels.weixin.qq.com'&&location.pathname.endsWith('/coverEdit')){
          values.push(...Array.from(document.querySelectorAll('span,div')).filter(e=>visible(e)&&e.textContent.trim()===${JSON.stringify(draft.title)}&&!Array.from(e.children).some(c=>c.textContent.trim()===${JSON.stringify(draft.title)})).map(e=>e.textContent.trim()));
        }return values;
      })()`).catch(()=>[])))).flat() as string[];
      const fieldsBefore=await readFields();
      if(!fieldsBefore.some(value=>value.includes(draft.title)))throw new Error('编辑页没有目标标题，停止封面操作');
      report.coverPrepared=await applyVideoCover(wc,platform as CoverPlatform,draft.coverPath);
      const fieldsAfter=await readFields();
      report.textUnchanged=JSON.stringify(fieldsBefore)===JSON.stringify(fieldsAfter);
      if(!report.textUnchanged)throw new Error('封面处理后文案字段发生变化，未提交修改');
    }
    report.frames = await Promise.all([...new Set([wc.mainFrame, ...wc.mainFrame.framesInSubtree])].map(frame => frame.executeJavaScript(`(()=>({url:location.href,text:document.body.innerText.slice(0,16000),controls:[...document.querySelectorAll('button,a,input,[role=button],[role=menuitem]')].filter(e=>e.getClientRects().length).map(e=>({tag:e.tagName,text:e.textContent?.trim().slice(0,80),type:e.type,accept:e.accept,href:e.tagName==='A'?e.href:undefined})).slice(0,120)}))()`).catch(error => ({ error: String(error) }))));
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output + '.png', (await wc.capturePage()).toPNG());
    report.ok = true;
  } catch (error) {
    report.error = String(error);
    report.frames = await Promise.all([...new Set([win.webContents.mainFrame,...win.webContents.mainFrame.framesInSubtree])].filter(frame=>{try{return new URL(frame.url).hostname===new URL(urls[platform]).hostname}catch{return false}}).map(frame=>frame.executeJavaScript(`({url:location.href,text:document.body.innerText.slice(-10000),controls:Array.from(document.querySelectorAll('[data-multipublish-cover-control],input[type=file],button')).filter(e=>e.getClientRects().length||e.type==='file').map(e=>({tag:e.tagName,cls:e.className,text:(e.innerText||'').slice(0,80),disabled:!!e.disabled,files:e.files?.length,html:e.outerHTML.replace(/src="[^"]*"/g,'src="[redacted]"').slice(0,800)}))})`).catch(()=>({}))));
    await fs.writeFile(output+'.png',(await win.webContents.capturePage()).toPNG()).catch(()=>undefined);
  }
  await fs.writeFile(output, JSON.stringify(report, null, 2));
  win.destroy();
  app.exit(report.ok ? 0 : 1);
}
