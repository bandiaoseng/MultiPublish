import { app, BrowserWindow } from 'electron';
import { promises as fs } from 'node:fs';
import { electronBaijiahaoIO, publishBaijiahao } from './baijiahao';

// Local-only integration fixture: exercises DOM, real file inputs and IPC without any network.
export async function runBaijiahaoFixture(output: string, video: string, cover: string) {
  const win = new BrowserWindow({show: false, webPreferences: {sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'baijiahao-offline-fixture'}});
  win.webContents.session.webRequest.onBeforeRequest({urls: ['http://*/*', 'https://*/*']}, (_details, callback) => callback({cancel: true}));
  const report: Record<string, unknown> = {ok: false, scope: 'offline fixture; not a real Baijiahao publication'};
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><meta charset="utf-8"><body>
      <input id="video" type="file" accept="video/mp4">
      <section id="editor" hidden><div class="contentEditable" contenteditable="true"></div>
      <textarea placeholder="视频简介"></textarea><p id="upload"></p><button id="cover">选择封面</button>
      <div class="cover-preview" id="preview" style="width:221px;height:124px"></div><input placeholder="请选择创作声明" readonly>
      <button data-testid="publish-btn" disabled>发布</button></section>
      <div class="cheetah-modal" style="display:none"><h3>旧封面窗口</h3><input id="decoy" type="file" accept="image/*"><button>确定</button></div>
      <div role="dialog" hidden><h3>封面截取</h3><button id="uploadImage">本地上传</button><input id="image" type="file" accept="image/png,image/jpeg" hidden><img id="modalPreview" style="width:221px;height:124px"><button id="confirm" disabled>确定</button></div>
      <script>
      window.publishClicks=0;
      const $=s=>document.querySelector(s);let pending='';
      const old=document.createElement('canvas');old.width=160;old.height=90;old.getContext('2d').fillStyle='#263e8a';old.getContext('2d').fillRect(0,0,160,90);
      const oldImage=new Image();oldImage.src=old.toDataURL();oldImage.style.width='221px';oldImage.style.height='124px';$('#preview').append(oldImage);
      $('.contentEditable').addEventListener('input',e=>{if(!e.isTrusted&&e.inputType==='insertText')$('.contentEditable').textContent+=e.data||''});
      $('#video').onchange=()=>{window.videoName=$('#video').files[0]?.name;$('#editor').hidden=false;$('#upload').textContent='正在上传 15%';setTimeout(()=>{$('#upload').textContent='上传完成';$('[data-testid="publish-btn"]').disabled=false},200)};
      $('#cover').onclick=$('#preview').onclick=()=>{setTimeout(()=>{$('[role="dialog"]').hidden=false;$('#modalPreview').src=old.toDataURL()},350)};
      $('#uploadImage').onclick=()=>{$('#image').hidden=false};
      $('#image').onchange=()=>{window.coverName=$('#image').files[0]?.name;pending=URL.createObjectURL($('#image').files[0]);$('#modalPreview').onload=()=>setTimeout(()=>{$('#confirm').disabled=false},350);$('#modalPreview').src=pending};
      $('#confirm').onclick=()=>{const img=new Image();img.style.width='221px';img.style.height='124px';img.src=pending;$('#preview').replaceChildren(img);$('[role="dialog"]').hidden=true};
      $('[data-testid="publish-btn"]').onclick=()=>{window.publishClicks++;const n=document.createElement('div');n.className='cheetah-message-success';n.textContent='发布成功';document.body.append(n)};
      </script></body>`));
    const wc = win.webContents;
    const io = electronBaijiahaoIO(wc, async (kind, file) => {
      if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
      const {root} = await wc.debugger.sendCommand('DOM.getDocument');
      const {nodeId} = await wc.debugger.sendCommand('DOM.querySelector', {nodeId: root.nodeId, selector: kind === 'video' ? '#video' : '#image'});
      await wc.debugger.sendCommand('DOM.setFileInputFiles', {nodeId, files: [file]});
    }, async () => {});
    const title = '这是本地百家号控件集成测试';
    const result = await publishBaijiahao(io, {id: 'fixture', type: 'video', title, description: '仅本地测试', topics: [], mediaPaths: [video], coverPath: cover, accountIds: [], createdAt: ''});
    const state = await wc.executeJavaScript('({title:document.querySelector(".contentEditable").innerText,clicks:window.publishClicks,video:window.videoName,cover:window.coverName,decoyFiles:document.querySelector("#decoy").files.length,dialogOpen:!document.querySelector("[role=dialog]").hidden})');
    if (result.status !== 'success' || state.title !== title || state.clicks !== 1 || !state.video || !state.cover || state.decoyFiles || state.dialogOpen) throw new Error(JSON.stringify({result, state}));
    Object.assign(report, {ok: true, result, state});
  } catch (error) { report.error = String(error); }
  await fs.writeFile(output, JSON.stringify(report, null, 2));
  win.destroy();
  app.exit(report.ok ? 0 : 1);
}
