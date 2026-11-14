import {app,BrowserWindow,session} from 'electron';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import type {AppData} from '../shared/types';
import {chromeUserAgent} from './browser-manager';
import {BAIJIAHAO_PUBLISH,electronBaijiahaoIO,publishBaijiahao,readBaijiahaoPage} from './baijiahao';

// Explicit diagnostics only: isolated data and a hard stop before the publish action.
export async function runBaijiahaoProbe(data:AppData,output:string){
  if(!app.getPath('userData').includes('\\work\\baijiahao-publish-fix\\'))throw new Error('仅允许隔离的百家号诊断副本');
  const account=data.accounts.find(a=>a.platform==='baijiahao');
  const draft=data.drafts.find(d=>d.accountIds.includes(account?.id||''));
  if(!account||!draft)throw new Error('缺少百家号诊断账号或草稿');
  const win=new BrowserWindow({show:false,x:-10000,y:-10000,width:1280,height:900,skipTaskbar:true,webPreferences:{session:session.fromPartition('persist:account-'+account.id),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  win.setOpacity(0.01);win.showInactive();
  const wc=win.webContents;wc.setUserAgent(chromeUserAgent);wc.setAudioMuted(true);
  const report:Record<string,unknown>={ok:false,scope:'isolated Baijiahao editor; final publication blocked',progress:[]};
  let publishBlocked=0;
  try{
    await wc.loadURL(BAIJIAHAO_PUBLISH);
    await new Promise(r=>setTimeout(r,7000));
    if(process.env.MULTIPUBLISH_BAIJIAHAO_PROBE_OPEN_COVER==='1'){
      const io=electronBaijiahaoIO(wc,async()=>{throw new Error('仅查看封面窗口，不上传文件');},async()=>{});
      report.coverOpened=await io.click('cover');
      await new Promise(r=>setTimeout(r,1800));
    }
    if(process.env.MULTIPUBLISH_BAIJIAHAO_PROBE_PREPARE==='1'){
      const io=electronBaijiahaoIO(wc,async(kind,file)=>{
        if(!wc.debugger.isAttached())wc.debugger.attach('1.3');
        await wc.debugger.sendCommand('DOM.enable');
        const deadline=Date.now()+60000;
        while(Date.now()<deadline){
          const {nodes}=await wc.debugger.sendCommand('DOM.getFlattenedDocument',{depth:-1,pierce:true});
          const inputs=nodes.filter((node:any)=>node.nodeName==='INPUT'&&node.attributes?.includes('file'));
          const candidates=inputs.filter((node:any)=>{const index=node.attributes.indexOf('accept');const accept=index>=0?node.attributes[index+1]:'';return (kind==='video'?/video|mp4|mov|mkv/i:/image|png|jpe?g/i).test(accept)});
          const target=kind==='video'?candidates[0]:candidates.at(-1);if(target){await wc.debugger.sendCommand('DOM.setFileInputFiles',{backendNodeId:target.backendNodeId,files:[file]});return;}
          await new Promise(r=>setTimeout(r,500));
        }
        throw new Error('诊断未找到 '+kind+' 上传控件');
      },async(status,message)=>{(report.progress as unknown[]).push({status,message,at:new Date().toISOString()});});
      const click=io.click;
      io.click=async action=>{
        if(action==='publish'){publishBlocked++;report.readyBeforeSubmit=await io.snapshot();return false;}
        return click(action);
      };
      const snapshot=io.snapshot;let previous='';
      io.snapshot=async()=>{const state=await snapshot();const serialized=JSON.stringify(state);if(serialized!==previous){previous=serialized;await fs.appendFile(output+'.trace.ndjson',JSON.stringify({at:new Date().toISOString(),state})+'\n');}return state;};
      report.result=await publishBaijiahao(io,draft);
      report.publishBlocked=publishBlocked;
    }
    report.state=await wc.executeJavaScript('('+readBaijiahaoPage.toString()+')()');
    report.dom=await wc.executeJavaScript(`(()=>{
      const visible=e=>!!e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
      return {text:document.body.innerText.slice(0,12000),url:location.href,
        editors:Array.from(document.querySelectorAll('[contenteditable],[class*=contentEditable]')).filter(visible).map(e=>({cls:e.className,editable:e.getAttribute('contenteditable'),html:e.outerHTML.slice(0,1800)})),
        controls:Array.from(document.querySelectorAll('button,input,textarea,[role=button],[role=tab]')).filter(e=>visible(e)||e.type==='file').map(e=>({tag:e.tagName,cls:e.className,text:(e.innerText||'').slice(0,90),type:e.type,accept:e.accept,placeholder:e.placeholder,disabled:!!e.disabled,testid:e.getAttribute('data-testid'),parent:e.type==='file'?e.parentElement.outerHTML.replace(/src="[^"]*"/g,'src="[redacted]"').slice(0,1400):undefined})),
        dialogs:Array.from(document.querySelectorAll('[role=dialog],[class*=modal],[class*=Modal]')).filter(visible).map(e=>({tag:e.tagName,cls:e.className,role:e.getAttribute('role'),text:e.innerText.slice(0,800)})),
        coverNodes:Array.from(document.querySelectorAll('[data-testid],[class*=cover],[class*=Cover]')).filter(visible).slice(0,100).map(e=>({tag:e.tagName,cls:e.className,testid:e.getAttribute('data-testid'),text:e.innerText?.slice(0,80)}))};
    })()`);
    await fs.writeFile(output+'.png',(await wc.capturePage()).toPNG());
    report.ok=true;
  }catch(error){report.error=String(error);await fs.writeFile(output+'.png',(await wc.capturePage()).toPNG()).catch(()=>undefined);}
  await fs.writeFile(output,JSON.stringify(report,null,2));
  win.destroy();app.exit(report.ok?0:1);
}
