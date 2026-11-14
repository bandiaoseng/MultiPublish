import { nativeImage } from 'electron';
import type { WebContents, WebFrameMain } from 'electron';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { coverPageAction, setCustomVideoCover } from './video-cover';
import type { CoverIO, CoverPlatform, CoverSnapshot, CoverVariant } from './video-cover';
import { preparePlatformCover } from './cover-aspect';

export function createElectronCoverIO(wc: WebContents, platform: CoverPlatform) {
  const tracePath=process.env.MULTIPUBLISH_COVER_TRACE;
  let lastState='';
  const trace=async (value:unknown)=>{if(tracePath?.startsWith('F:\\Codex\\MultiPublish\\outputs\\cover-publish-fix\\'))await fs.appendFile(tracePath,JSON.stringify({at:new Date().toISOString(),platform,...value as object})+'\n').catch(()=>undefined);};
  let coverKeyConfirmed = false;
  const pending = new Set<string>();
  const listener = async (_event: unknown, method: string, params: any) => {
    if (method === 'Network.responseReceived' && /cover\/upload/.test(String(params.response?.url)) && params.response?.status >= 200 && params.response?.status < 300) pending.add(params.requestId);
    if (method === 'Network.loadingFinished' && pending.delete(params.requestId)) {
      try {
        const body = await wc.debugger.sendCommand('Network.getResponseBody', { requestId: params.requestId });
        const payload = JSON.parse(body.base64Encoded ? Buffer.from(body.body, 'base64').toString() : body.body);
        if (typeof payload?.data?.coverKey === 'string' && payload.data.coverKey.length > 0) coverKeyConfirmed = true;
      } catch { /* Remain unconfirmed; the caller must stop rather than publish a default cover. */ }
    }
  };
  wc.debugger.on('message', listener);
  const frames = () => [...new Set([wc.mainFrame, ...wc.mainFrame.framesInSubtree])].filter(frame => {
    if (frame === wc.mainFrame) return true;
    try { return new URL(frame.url).hostname === new URL(wc.getURL()).hostname; } catch { return false; }
  });
  const call = (frame: WebFrameMain, action: string, variant: CoverVariant, token = '') => frame.executeJavaScript(`(${coverPageAction.toString()})(${JSON.stringify(platform)},${JSON.stringify(variant)},${JSON.stringify(action)},${JSON.stringify(token)})`) as Promise<{ state: CoverSnapshot; found?: boolean; x?: number; y?: number }>;
  const find = async (action: string, variant: CoverVariant) => {
    for (const frame of frames()) {
      const token = randomUUID();
      const hit = await call(frame, action, variant, token).catch(() => undefined);
      if (hit?.found && hit.x !== undefined && hit.y !== undefined) return { frame, x: hit.x, y: hit.y, token };
    }
    return undefined;
  };
  const io: CoverIO = {
    async read(variant) {
      const states: CoverSnapshot[] = [];
      for (const frame of frames()) {
        const result = await call(frame, 'read', variant).catch(() => undefined);
        if (result?.state) states.push(result.state);
      }
      if (!states.length) throw new Error('无法读取封面编辑器');
      const combined = {
        dialogs: states.reduce((n,s) => n+s.dialogs, 0), preview: states.flatMap(s => s.preview), modalPreview: states.flatMap(s => s.modalPreview),
        busy: states.some(s => s.busy), error: states.find(s => s.error)?.error || '', login: states.some(s => s.login), uploaded: states.some(s => s.uploaded),
        portrait: states.some(s => s.portrait), landscape: states.some(s => s.landscape),
        separateEntries: states.some(s=>s.separateEntries),
        entryBusy:states.some(s=>s.entryBusy),
      };
      const serialized=JSON.stringify(combined);if(serialized!==lastState){lastState=serialized;await trace({variant,state:combined});}
      return combined;
    },
    async action(kind, variant) {
      if (kind === 'open') {
        for (const frame of frames()) {
          const dismissed = await call(frame,'dismissGuide',variant).catch(()=>undefined);
          if (dismissed?.found) await io.sleep(400);
        }
      }
      const found = await find(kind, variant);
      if (!found) return false;
      await trace({action:kind,variant,control:await found.frame.executeJavaScript(`(()=>{const e=document.querySelector('[data-multipublish-cover-control="${found.token}"]');return {tag:e?.tagName,cls:e?.className,text:e?.textContent?.slice(0,60)}})()`)});
      // The publisher is deliberately off-screen. Dispatch on the measured,
      // scoped DOM control so Windows occlusion cannot swallow dialog actions.
      if (kind !== 'open') {
        return await found.frame.executeJavaScript(`(()=>{
          const el=document.querySelector('[data-multipublish-cover-control="${found.token}"]');
          if(!el||!el.getClientRects().length||el.closest('button:disabled,[aria-disabled="true"]'))return false;
          el.click();return true;
        })()`) as boolean;
      }
      await found.frame.executeJavaScript(`(()=>{
        const el=document.querySelector('[data-multipublish-cover-control="${found.token}"]');if(!el)return;
        const r=el.getBoundingClientRect();const options={bubbles:true,cancelable:true,composed:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2,view:window,pointerId:1,pointerType:'mouse',isPrimary:true,button:0};
        if(${JSON.stringify(platform)}==='weixin')el.click();else for(const name of ['pointerover','pointerenter','pointerdown','mousedown','pointerup','mouseup','click'])el.dispatchEvent(new (name.startsWith('pointer')?PointerEvent:MouseEvent)(name,options));
      })()`);
      await io.sleep(300);
      if ((await io.read(variant)).dialogs) return true;
      // Translate an embedded editor's current rectangle into the main viewport.
      let x=found.x,y=found.y;
      for (let frame=found.frame; frame.parent; frame=frame.parent) {
        const adopted=await frame.parent.executeJavaScript(`(()=>{
          const matches=[];const walk=root=>{for(const el of root.querySelectorAll('*')){if(el.getAttribute('data-multipublish-cover-control')===${JSON.stringify(found.token)})matches.push(el);if(el.shadowRoot)walk(el.shadowRoot)}};walk(document);
          if(matches.length!==1)return null;const r=matches[0].getBoundingClientRect();return r.width&&r.height?{x:r.x+r.width/2,y:r.y+r.height/2}:null;
        })()`) as {x:number;y:number}|null;
        if(adopted){x=adopted.x;y=adopted.y;continue;}
        // Wujie runs scripts in a hidden iframe while its DOM is adopted by the
        // parent document; its element rectangles are already in that viewport.
        const owner=await found.frame.executeJavaScript(`document.querySelector('[data-multipublish-cover-control="${found.token}"]')?.ownerDocument?.URL`).catch(()=>undefined);
        if(owner===frame.parent.url)continue;
        const box=await frame.parent.executeJavaScript(`(()=>{
          const list=Array.from(document.querySelectorAll('iframe')).filter(e=>{const r=e.getBoundingClientRect();return r.width>100&&r.height>100});
          const exact=list.filter(e=>{let current='';try{current=e.contentWindow.location.href}catch{}return e.src===${JSON.stringify(frame.url)}||current===${JSON.stringify(frame.url)}||(${JSON.stringify(frame.name)}&&e.name===${JSON.stringify(frame.name)})});
          const el=exact.length===1?exact[0]:list.length===1?list[0]:null;if(!el)return null;
          const r=el.getBoundingClientRect();return {x:r.x,y:r.y,sx:r.width/el.offsetWidth,sy:r.height/el.offsetHeight,left:el.clientLeft,top:el.clientTop};
        })()`) as {x:number;y:number;sx:number;sy:number;left:number;top:number}|null;
        if(!box){
          await trace({action:'frame-location-failure',frame:new URL(frame.url).pathname,parent:new URL(frame.parent.url).pathname,iframes:await frame.parent.executeJavaScript(`Array.from(document.querySelectorAll('iframe')).map(e=>{const r=e.getBoundingClientRect();let current='';try{current=e.contentWindow.location.pathname}catch{};return {name:e.name,path:(()=>{try{return new URL(e.src).pathname}catch{return e.src}})(),current,width:r.width,height:r.height,display:getComputedStyle(e).display}})`)});
          throw new Error('无法确认嵌入式封面编辑器的位置');
        }
        x=box.x+(x+box.left)*box.sx;y=box.y+(y+box.top)*box.sy;
      }
      if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
      await wc.debugger.sendCommand('Input.dispatchMouseEvent', {type:'mouseMoved',x,y});
      await io.sleep(200);
      await wc.debugger.sendCommand('Input.dispatchMouseEvent', {type:'mousePressed',x,y,button:'left',clickCount:1});
      await wc.debugger.sendCommand('Input.dispatchMouseEvent', {type:'mouseReleased',x,y,button:'left',clickCount:1});
      if (kind === 'open') {
        await io.sleep(300);
        const state = await io.read(variant);
        if (!state.dialogs) {
          await found.frame.executeJavaScript(`(()=>{
            const root=document.querySelector('[data-multipublish-cover-control="${found.token}"]');if(!root)return;
            const el=[...root.querySelectorAll('div,span,button')].filter(e=>e.getClientRects().length&&['编辑封面','编辑','选择封面'].includes(e.textContent.trim())).sort((a,b)=>a.getBoundingClientRect().width*a.getBoundingClientRect().height-b.getBoundingClientRect().width*b.getBoundingClientRect().height)[0]||root;
            const r=el.getBoundingClientRect();const options={bubbles:true,cancelable:true,composed:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2,view:window,pointerId:1,pointerType:'mouse',isPrimary:true,button:0};
            for(const name of ['pointerover','pointerdown','mousedown','pointerup','mouseup','click']) el.dispatchEvent(new (name.startsWith('pointer')?PointerEvent:MouseEvent)(name,options));
          })()`);
        }
      }
      return true;
    },
    async upload(file, variant) {
      const deadline = Date.now() + 15000;
      let found;
      while (Date.now() < deadline && !found) { found = await find('input', variant); if (!found) await io.sleep(300); }
      if (!found) throw new Error('未找到封面弹窗内的图片上传控件');
      if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
      await wc.debugger.sendCommand('DOM.enable');
      await wc.debugger.sendCommand('Network.enable');
      const { nodes } = await wc.debugger.sendCommand('DOM.getFlattenedDocument', { depth: -1, pierce: true });
      const input = nodes.find((node: any) => node.nodeName === 'INPUT' && node.attributes?.some((value: string, i: number) => value === 'data-multipublish-cover-control' && node.attributes[i+1] === found.token));
      if (!input?.backendNodeId) throw new Error('封面上传控件已刷新，请重试');
      coverKeyConfirmed = false;
      pending.clear();
      await wc.debugger.sendCommand('DOM.setFileInputFiles', { backendNodeId: input.backendNodeId, files: [file] });
      await trace({action:'upload',variant,control:await found.frame.executeJavaScript(`(()=>{const e=document.querySelector('[data-multipublish-cover-control="${found.token}"]');return {cls:e?.className,count:e?.files?.length,area:e?.closest('.semi-upload,.upload-wrapper,.single-cover-uploader-wrap')?.innerText.slice(0,200)}})()`)});
    },
    uploadConfirmed: () => coverKeyConfirmed,
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    now: () => Date.now(),
  };
  return { io, dispose: () => wc.debugger.removeListener('message', listener) };
}

export async function applyVideoCover(wc: WebContents, platform: CoverPlatform, file: string) {
  const stat = await fs.stat(file).catch(() => undefined);
  if (!stat?.isFile() || !stat.size || nativeImage.createFromPath(file).isEmpty()) throw new Error('自选封面不存在或无法读取，请重新选择 JPG/PNG 图片');
  const adapter = createElectronCoverIO(wc, platform);
  const originalUpload = adapter.io.upload;
  const prepared = new Map<CoverVariant,string>();
  adapter.io.upload = async (source, variant) => {
    let image = prepared.get(variant);
    if (!image) { image = await preparePlatformCover(source, platform, variant); prepared.set(variant,image); }
    await originalUpload(image,variant);
  };
  try {
    const result=await setCustomVideoCover(adapter.io, platform, file);
    if(platform==='xiaohongshu'||platform==='weixin'||platform==='baijiahao')for(const variant of result.variants){
      if(!await verifySavedCoverImage(wc,platform,variant,prepared.get(variant)||file))throw new Error('保存后的封面图片与自选图片不符，已停止提交视频');
    }
    return result;
  }
  finally { adapter.dispose(); }
}

// The XHS canvas can save a newly generated video frame after accepting a file.
// Compare the actual saved cover pixels, rather than treating a new URL as proof.
async function verifySavedCoverImage(wc:WebContents,platform:CoverPlatform,variant:CoverVariant,expectedFile:string){
  const expected=nativeImage.createFromPath(expectedFile).resize({width:32,height:32,quality:'best'}).toBitmap();
  if(expected.length!==4096)return false;
  for(let attempt=0;attempt<4;attempt++){
    for(const frame of [...new Set([wc.mainFrame,...wc.mainFrame.framesInSubtree])]){
      const data=await frame.executeJavaScript(`(${coverPageAction.toString()})(${JSON.stringify(platform)},${JSON.stringify(variant)},'images','')`).catch(()=>undefined) as {images?:string[]}|undefined;
      for(const url of data?.images||[]){
        try{
          let bytes:Buffer;
          if(url.startsWith('data:image/'))bytes=Buffer.from(url.split(',')[1],'base64');
          else if(url.startsWith('blob:')){
            const encoded=await frame.executeJavaScript(`(async()=>{const response=await fetch(${JSON.stringify(url)});const blob=await response.blob();if(blob.size>10000000)return '';return await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(blob)})})()`);
            bytes=Buffer.from(String(encoded).split(',')[1]||'','base64');
          }else if(url.startsWith('https:')){
            const response=await wc.session.fetch(url,{signal:AbortSignal.timeout(5000)});
            if(!response.ok||!response.headers.get('content-type')?.startsWith('image/')||Number(response.headers.get('content-length'))>10000000)continue;
            bytes=Buffer.from(await response.arrayBuffer());
          }else continue;
          const decoded=nativeImage.createFromBuffer(bytes);if(decoded.isEmpty())continue;
          const actual=decoded.resize({width:32,height:32,quality:'best'}).toBitmap();
          let difference=0;for(let i=0;i<4096;i++){if(i%4!==3)difference+=Math.abs(actual[i]-expected[i]);}
          if(difference/(32*32*3*255)<0.1)return true;
        }catch{/* A preview that cannot be checked must not allow publication. */}
      }
    }
    await new Promise(r=>setTimeout(r,750));
  }
  return false;
}

export async function verifyVideoCover(wc: WebContents, platform: CoverPlatform, evidence: string[]) {
  const adapter=createElectronCoverIO(wc,platform);
  try {
    const state=await adapter.io.read('default');
    return !state.dialogs && !state.login && evidence.length>0 && evidence.every(value=>state.preview.includes(value));
  } finally { adapter.dispose(); }
}
