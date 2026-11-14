import test from 'node:test';
import assert from 'node:assert/strict';
import { setCustomVideoCover } from './video-cover.ts';
import type { CoverIO, CoverSnapshot, CoverVariant } from './video-cover.ts';

function fake(options: { stale?: boolean; noProof?: boolean; busy?: boolean; login?: boolean; multiple?: boolean; noDialog?: boolean; separateEntries?: boolean } = {}) {
  let clock = 10000, dialog = false, uploaded = false, proof = false, confirms = 0;
  const applied = new Set<CoverVariant>();
  const events: string[] = [];
  const io: CoverIO = {
    async read(variant): Promise<CoverSnapshot> { return {
      dialogs: dialog ? 1 : 0,
      preview: [applied.has(variant) && !options.stale ? 'custom-' + variant : 'video-frame-' + variant],
      modalPreview: [uploaded ? 'new-local-image' : 'old-video-frame'],
      busy: !!options.busy && uploaded, uploaded, login: !!options.login, error: '',
      portrait: !!options.multiple, landscape: !!options.multiple,
      separateEntries: options.separateEntries,
    }; },
    async action(kind, variant) {
      events.push(kind + ':' + variant);
      if (kind === 'open') { dialog = !options.noDialog; uploaded = false; }
      if (kind === 'confirm') { assert.equal(uploaded, true); confirms++; dialog = false; applied.add(variant); proof = !options.noProof; }
      return true;
    },
    async upload(_file, variant) { events.push('upload:' + variant); uploaded = true; },
    uploadConfirmed: () => proof,
    async sleep(ms) { clock += ms; }, now: () => clock,
  };
  return { io, events, confirms: () => confirms };
}

test('Kuaishou waits for coverKey after confirmation, not before it', async () => {
  const f = fake();
  assert.equal((await setCustomVideoCover(f.io, 'kuaishou', 'cover.jpg')).ok, true);
  assert.equal(f.confirms(), 1);
  assert.ok(f.events.indexOf('upload:default') < f.events.indexOf('confirm:default'));
});
test('Kuaishou cannot succeed without server coverKey even if preview changes', async () => {
  await assert.rejects(setCustomVideoCover(fake({ noProof: true }).io, 'kuaishou', 'cover.jpg'), /预览未更新/);
});
test('closing the dialog with the old video frame never succeeds', async () => {
  await assert.rejects(setCustomVideoCover(fake({ stale: true }).io, 'douyin', 'cover.jpg'), /预览未更新/);
});
test('unfinished image processing stops before confirmation', async () => {
  const f = fake({ busy: true });
  await assert.rejects(setCustomVideoCover(f.io, 'xiaohongshu', 'cover.jpg'), /上传未确认完成/);
  assert.equal(f.confirms(), 0);
});
test('a missing dialog or login challenge stops before file transmission', async () => {
  for (const options of [{ noDialog: true }, { login: true }]) {
    const f = fake(options);
    await assert.rejects(setCustomVideoCover(f.io, 'weixin', 'cover.jpg'));
    assert.equal(f.events.some(e => e.startsWith('upload:')), false);
  }
});
test('Weixin applies both visible landscape and portrait cover entries', async () => {
  const f = fake({ multiple: true });
  const result = await setCustomVideoCover(f.io, 'weixin', 'cover.jpg');
  assert.deepEqual(result.variants, ['portrait', 'landscape']);
  assert.equal(f.confirms(), 2);
});
test('Douyin separate cover entries are each saved, not mistaken for one modal with two tabs', async () => {
  const f=fake({separateEntries:true});
  assert.deepEqual((await setCustomVideoCover(f.io,'douyin','cover.jpg')).variants,['portrait','landscape']);
  assert.equal(f.confirms(),2);
});
test('Baijiahao confirms the landscape cover and then the portrait cover separately',async()=>{
  const f=fake({multiple:true});
  assert.deepEqual((await setCustomVideoCover(f.io,'baijiahao','cover.jpg')).variants,['landscape','portrait']);
  assert.equal(f.confirms(),2);
});
