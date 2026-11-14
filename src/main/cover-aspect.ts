import { app, nativeImage } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpegStatic from 'ffmpeg-static';
import { resolveFfmpegBinary } from './ffmpeg';
import type { CoverPlatform, CoverVariant } from './video-cover';

const execFileAsync = promisify(execFile);

export async function preparePlatformCover(source: string, platform: CoverPlatform, variant: CoverVariant) {
  // Kuaishou uses the video aspect; other editors expose 3:4 / 4:3 cover slots.
  if (platform === 'kuaishou') return source;
  const width = variant === 'landscape' ? 1280 : 960;
  const height = variant === 'landscape' ? (platform==='baijiahao'?720:960) : 1280;
  const original = nativeImage.createFromPath(source).getSize();
  if (!original.width || !original.height) throw new Error('自选封面图片无法读取');
  if (Math.abs(original.width / original.height - width / height) < 0.002) return source;
  const directory = path.join(app.getPath('userData'), 'covers');
  await fs.mkdir(directory, { recursive: true });
  const target = path.join(directory, platform + '-' + variant + '-' + randomUUID() + '.jpg');
  const binary = resolveFfmpegBinary({ resourcesPath: process.resourcesPath, appPath: app.getAppPath(), importedPath: ffmpegStatic, envPath: process.env.FFMPEG_PATH });
  try {
    await execFileAsync(binary, ['-hide_banner','-loglevel','error','-nostdin','-y','-i',source,'-frames:v','1','-vf',
      `scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0x151821,setsar=1`,
      '-q:v','2','-update','1',target], { windowsHide:true, timeout:30000, maxBuffer:1024*1024 });
    const size = nativeImage.createFromPath(target).getSize();
    if (size.width !== width || size.height !== height) throw new Error('封面副本尺寸错误');
    return target;
  } catch (error) {
    await fs.rm(target, { force:true }).catch(()=>undefined);
    throw new Error('封面比例适配失败，已停止提交视频', { cause:error });
  }
}
