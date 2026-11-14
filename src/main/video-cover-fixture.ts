import { app, BrowserWindow } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { applyVideoCover } from './video-cover-electron';
import type { CoverPlatform } from './video-cover';

export async function runVideoCoverFixture(output: string, cover: string, oldCover: string) {
  if (!app.getPath('userData').includes('\\work\\')) throw new Error('仅允许离线隔离测试目录');
  let requests = 0;
  const server = createServer((req, res) => {
    if (req.url !== '/cover/upload') { res.writeHead(404); res.end(); return; }
    requests++;
    setTimeout(() => { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify({ data: { coverKey: 'offline-fixture-cover' } })); }, 800);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const origin = 'http://127.0.0.1:' + address.port;
  const oldImage = 'data:image/png;base64,' + (await fs.readFile(oldCover)).toString('base64');
  // Keep one window alive between cases; the production window-all-closed handler quits the app.
  const keeper = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  const report: Record<string, unknown> = { ok: false, scope: 'offline UI fixture; no real platform publication', results: [] };
  try {
    for (const platform of ['douyin','kuaishou','xiaohongshu','weixin'] as CoverPlatform[]) {
      const win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'cover-fixture-' + platform } });
      const wc = win.webContents;
      wc.session.webRequest.onBeforeRequest({ urls: ['http://*/*','https://*/*'] }, (d, cb) => cb({ cancel: !d.url.startsWith(origin + '/') }));
      try {
        const mainClass = platform === 'douyin' ? 'cover-box' : platform === 'kuaishou' ? 'cover-setting' : platform === 'xiaohongshu' ? 'upload-cover' : 'vertical-cover-wrap';
        const modalClass = platform === 'douyin' ? 'dy-creator-content-modal' : platform === 'kuaishou' ? 'ant-modal' : platform === 'xiaohongshu' ? 'd-modal' : 'weui-desktop-dialog';
        await wc.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><html><head><style>
          body{font:16px sans-serif;margin:30px}button{padding:12px;margin:5px}img{width:120px;height:90px;object-fit:contain}.modal{position:fixed;left:300px;top:90px;width:650px;padding:20px;background:#eee;border:2px solid #555}.crop{top:230px;z-index:5}input{display:none}
          </style></head><body><h2>${platform} 自选封面离线测试</h2>
          <div class="${mainClass}" id="entry"><img id="main" src="${oldImage}"><button>选择封面</button></div>
          ${platform === 'weixin' ? `<div class="horizontal-cover-wrap" id="landscape"><img id="main-landscape" src="${oldImage}"><button>选择封面</button></div>` : ''}
          <div class="${modalClass}" style="display:none"><h3>隐藏的旧封面窗口</h3><input id="hidden-decoy" type="file" accept="image/*"><button>确定</button></div>
          <div id="dialog" class="modal ${modalClass}" style="display:none"><h3>设置封面</h3>
          ${platform === 'douyin' ? '<button class="tab">设置竖封面</button><button class="tab">设置横封面</button><div class="semi-upload"><label>生成参考图</label><input id="ai-decoy" class="semi-upload-hidden-input" type="file" accept="image/*"></div>' : ''}
          <button id="tab">上传封面</button><div class="upload-wrapper single-cover-uploader-wrap semi-upload"><span class="semi-upload-drag-area-main-text">点击上传文件</span><input id="actual" type="file" accept="image/png,image/jpeg" class="semi-upload-hidden-input"></div>
          <div id="status"></div><img id="preview" src="${oldImage}"><div class="d-modal-footer weui-desktop-dialog__ft"><button id="confirm" disabled>${platform === 'douyin' ? '完成' : platform === 'kuaishou' || platform === 'weixin' ? '确认' : '确定'}</button></div></div>
          <script>
          const $=s=>document.querySelector(s);let current='main',imageUrl='',uploads=0,confirmations=0,crops=0;
          function open(id){current=id;$('#dialog').style.display='block';$('#confirm').disabled=true;$('#preview').src=${JSON.stringify(oldImage)};$('#status').textContent='';$('#actual').value='';}
          $('#entry').onclick=()=>open('main');if($('#landscape'))$('#landscape').onclick=()=>open('main-landscape');
          document.querySelectorAll('.tab').forEach(el=>el.onclick=()=>{$('#actual').value='';$('#preview').src=${JSON.stringify(oldImage)};$('#status').textContent='';$('#confirm').disabled=true;});
          $('#actual').onchange=async()=>{uploads++;$('#status').textContent='正在处理';imageUrl=URL.createObjectURL($('#actual').files[0]);if(window.saveWrongImage)imageUrl=URL.createObjectURL(await(await fetch(${JSON.stringify(oldImage)})).blob());$('#preview').onload=()=>setTimeout(()=>{$('#status').textContent='清空上传';$('#confirm').disabled=false;},120);$('#preview').src=imageUrl;
            if(${JSON.stringify(platform)}==='weixin'){const crop=document.createElement('div');crop.className='modal crop weui-desktop-dialog';crop.innerHTML='<h3>裁剪封面图</h3><img src="'+imageUrl+'"><button>确定</button>';crop.querySelector('button').onclick=()=>{crops++;crop.remove()};document.body.append(crop);}
          };
          $('#confirm').onclick=()=>{confirmations++;$('#'+current).src=imageUrl;$('#dialog').style.display='none';if(${JSON.stringify(platform)}==='kuaishou')fetch(${JSON.stringify(origin + '/cover/upload')},{method:'POST'});};
          window.result=()=>({uploads,confirmations,crops,actualFile:$('#actual').files[0]?.name,decoyFiles:$('#hidden-decoy').files.length+($('#ai-decoy')?.files.length||0),changed:$('#main').src!==${JSON.stringify(oldImage)},landscapeChanged:!$('#main-landscape')||$('#main-landscape').src!==${JSON.stringify(oldImage)}});
          </script></body></html>`));
        await new Promise(r => setTimeout(r, 200));
        const result = await applyVideoCover(wc, platform, cover);
        const ui = await wc.executeJavaScript('window.result()');
        if (!ui.changed || !ui.landscapeChanged || ui.decoyFiles !== 0 || !ui.actualFile) throw new Error('封面控件回归失败：' + JSON.stringify(ui));
        if (platform === 'douyin' && ui.uploads !== 2) throw new Error('抖音横竖封面未全部上传');
        if (platform === 'weixin' && (ui.confirmations !== 2 || ui.crops !== 2)) throw new Error('视频号裁剪或双封面未全部确认');
        (report.results as unknown[]).push({ platform, result, ui });
        await fs.writeFile(path.join(path.dirname(output), 'fixture-' + platform + '.png'), (await wc.capturePage()).toPNG());
        if(platform==='xiaohongshu'){
          await wc.executeJavaScript('window.saveWrongImage=true');
          let rejected=false;try{await applyVideoCover(wc,platform,cover)}catch(error){rejected=/图片与自选图片不符/.test(String(error))}
          if(!rejected)throw new Error('小红书新 URL 的错误视频帧未被拦截');
          report.wrongXhsImageRejected=true;
        }
      } finally { win.destroy(); }
    }
    if (requests !== 1) throw new Error('快手确认请求次数错误');
    report.ok = true;
  } catch (error) { report.error = String(error); }
  finally { server.close(); }
  await fs.writeFile(output, JSON.stringify(report, null, 2));
  void keeper;
  app.exit(report.ok ? 0 : 1);
}
