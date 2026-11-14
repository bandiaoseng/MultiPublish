import { nativeImage } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Preserve the selected cover; only Baijiahao gets a separate landscape copy. */
export async function prepareBaijiahaoCover(
  source: string,
  outputDir: string,
  getBinary: () => Promise<string>,
): Promise<string> {
  const file = await fs.stat(source).catch(() => undefined);
  if (!file?.isFile() || !file.size) throw new Error('封面文件不存在或为空，请重新选择封面');
  const size = nativeImage.createFromPath(source).getSize();
  if (!size.width || !size.height) throw new Error('封面图片无法读取，请选择有效的 JPG 或 PNG 图片');
  if (size.width > size.height) return source;

  await fs.mkdir(outputDir, { recursive: true });
  const output = path.join(outputDir, 'baijiahao-' + randomUUID() + '.jpg');
  try {
    await execFileAsync(await getBinary(), [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', source,
      '-frames:v', '1', '-vf',
      'scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0x151821,setsar=1',
      '-q:v', '2', '-update', '1', output,
    ], { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 });
    const converted = nativeImage.createFromPath(output).getSize();
    if (converted.width !== 1280 || converted.height !== 720) throw new Error('封面转换结果尺寸不正确');
    return output;
  } catch (error) {
    await fs.rm(output, { force: true }).catch(() => undefined);
    throw new Error('百家号横版封面生成失败，请选择横版 JPG/PNG 图片后重试', { cause: error });
  }
}
