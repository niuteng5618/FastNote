// 自动确保 Tauri 图标齐全，并尽量让 macOS 图标观感正常
// - 检查 src-tauri/icons/icon.png 是否存在且尺寸>=256（推荐512）
// - 若缺失/过小/源图更新：调用本地 @tauri-apps/cli 生成全量图标集
// - macOS：优先使用带 safe area 的源图（减少 Dock/Finder 里“突兀”感）

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const projectRoot = process.cwd();
const iconsDir = path.join(projectRoot, 'src-tauri', 'icons');
const windowsDir = path.join(projectRoot, 'src-tauri', 'windows');
const iconPng = path.join(iconsDir, 'icon.png');
const iconIco = path.join(iconsDir, 'icon.ico');
const iconIcns = path.join(iconsDir, 'icon.icns');
const fileAssocIconIco = path.join(windowsDir, 'file-association.ico');
const sourceRaw = path.join(projectRoot, 'FastNote.png');
const sourceSafe = path.join(iconsDir, 'icon-source.png');
const safeMaker = path.join(projectRoot, 'scripts', 'make_icon_safearea.py');
const fileAssocSource = path.join(projectRoot, 'FastNote-doc.png');
const fileAssocMaker = path.join(projectRoot, 'scripts', 'make_file_assoc_icon.py');

function mtimeMs(file) {
  try {
    return fs.statSync(file).mtimeMs || 0;
  } catch (_) {
    return 0;
  }
}

function isNewer(a, b) {
  return mtimeMs(a) > mtimeMs(b);
}

function ensureSafeSource() {
  // 没有源图就别折腾，后面会给出提示
  if (!fs.existsSync(sourceRaw)) return null;

  const needMake = !fs.existsSync(sourceSafe) || isNewer(sourceRaw, sourceSafe) || isNewer(safeMaker, sourceSafe);
  if (!needMake) return sourceSafe;

  if (!fs.existsSync(safeMaker)) {
    console.warn(`[ensure-icons] 警告：未找到 safe-area 生成脚本: ${safeMaker}`);
    return sourceRaw;
  }

  const args = [safeMaker, '--in', sourceRaw, '--out', sourceSafe, '--size', '1024', '--scale', '0.88'];
  console.log(`[ensure-icons] 生成 safe-area 源图：python ${args.map((x) => JSON.stringify(x)).join(' ')}`);

  try {
    const r = cp.spawnSync('python', args, { stdio: 'inherit', cwd: projectRoot, env: process.env });
    if (r.status !== 0) throw new Error(`exit ${r.status}`);
  } catch (e) {
    console.warn(`[ensure-icons] 警告：safe-area 源图生成失败，将回退到原始源图：${e.message}`);
    return sourceRaw;
  }

  return fs.existsSync(sourceSafe) ? sourceSafe : sourceRaw;
}

function getPngSize(file) {
  try {
    const b = fs.readFileSync(file);
    if (b.length < 24) return null;
    const pngSig = '89504e470d0a1a0a';
    if (b.slice(0, 8).toString('hex') !== pngSig) return null;
    // IHDR 紧随签名，结构: length(4) + 'IHDR'(4) + width(4) + height(4)
    const ihdr = b.indexOf(Buffer.from('IHDR'));
    if (ihdr < 0 || ihdr + 12 > b.length) return null;
    const w = b.readUInt32BE(ihdr + 4);
    const h = b.readUInt32BE(ihdr + 8);
    return { w, h };
  } catch (_) {
    return null;
  }
}

function ensureIcons() {
  const want = 256; // 最低 256，CI 会生成 512
  let needGen = false;

  const source = ensureSafeSource() || sourceRaw;

  if (!fs.existsSync(iconsDir)) {
    needGen = true;
  }
  if (!fs.existsSync(iconPng)) {
    needGen = true;
  }
  if (!fs.existsSync(iconIco)) needGen = true;
  if (!fs.existsSync(iconIcns)) needGen = true;

  if (!fs.existsSync(source)) console.warn(`[ensure-icons] 警告：源图标不存在: ${source}`);

  if (!needGen && fs.existsSync(iconPng)) {
    const sz = getPngSize(iconPng);
    if (!sz || sz.w < want || sz.h < want) {
      console.log(`[ensure-icons] icon.png 尺寸 ${sz ? `${sz.w}x${sz.h}` : '未知'} < ${want}，需要重新生成`);
      needGen = true;
    }
  }

  // 源图更新：需要重新生成（否则 macOS 的 icns 仍然是旧的）
  if (!needGen && fs.existsSync(source)) {
    const outFiles = [iconPng, iconIco, iconIcns].filter((f) => fs.existsSync(f));
    if (outFiles.length === 0) {
      needGen = true;
    } else if (outFiles.some((f) => isNewer(source, f))) {
      console.log('[ensure-icons] 源图较新，需要重新生成图标集');
      needGen = true;
    }
  }

  // ICO 粗略检查（文件过小通常无效）
  if (!needGen && fs.existsSync(iconIco)) {
    const stat = fs.statSync(iconIco);
    if (stat.size < 1000) {
      console.log(`[ensure-icons] icon.ico 体积异常(${stat.size}B)，需要重新生成`);
      needGen = true;
    }
  }

  if (!needGen) {
    console.log('[ensure-icons] 图标已满足要求，跳过生成');
    return true;
  }

  // 生成：优先使用本地 CLI，避免 npx 触网
  const cliJs = path.join(projectRoot, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
  const hasLocalCli = fs.existsSync(cliJs);

  const args = ['icon'];
  if (fs.existsSync(source)) args.push(source);

  console.log(`[ensure-icons] 生成图标：${hasLocalCli ? `node ${path.relative(projectRoot, cliJs)}` : 'tauri'} ${args.join(' ')}`);

  try {
    if (hasLocalCli) {
      const r = cp.spawnSync(process.execPath || 'node', [cliJs, ...args], {
        stdio: 'inherit',
        cwd: projectRoot,
        env: process.env,
      });
      if (r.status !== 0) throw new Error(`exit ${r.status}`);
    } else {
      // 回退到全局 tauri（需用户环境已安装）
      const r = cp.spawnSync('tauri', args, { stdio: 'inherit', cwd: projectRoot, env: process.env });
      if (r.status !== 0) throw new Error(`exit ${r.status}`);
    }
  } catch (e) {
    console.error(`[ensure-icons] 生成失败：${e.message}`);
    // 不阻断构建，仅给出提示
    return false;
  }

  // 确认生成结果
  const ok = fs.existsSync(iconPng) && fs.existsSync(iconIco) && fs.existsSync(iconIcns);
  console.log(`[ensure-icons] 生成完成：${ok ? 'OK' : '未检测到关键文件（icon.png/icon.ico/icon.icns）'}`);
  return ok;
}

function ensureFileAssociationIcon() {
  if (!fs.existsSync(fileAssocSource)) {
    console.warn(`[ensure-icons] 警告：未找到文件关联图标源文件: ${fileAssocSource}`);
    return false;
  }

  if (!fs.existsSync(fileAssocMaker)) {
    console.warn(`[ensure-icons] 警告：未找到文件关联图标生成脚本: ${fileAssocMaker}`);
    return false;
  }

  const needGen =
    !fs.existsSync(fileAssocIconIco) ||
    isNewer(fileAssocSource, fileAssocIconIco) ||
    isNewer(fileAssocMaker, fileAssocIconIco) ||
    fs.statSync(fileAssocIconIco).size < 1000;

  if (!needGen) {
    console.log('[ensure-icons] 文件关联图标已满足要求，跳过生成');
    return true;
  }

  const args = [fileAssocMaker, '--in', fileAssocSource, '--out', fileAssocIconIco];
  console.log(`[ensure-icons] 生成文件关联图标：python ${args.map((x) => JSON.stringify(x)).join(' ')}`);

  try {
    const r = cp.spawnSync('python', args, {
      stdio: 'inherit',
      cwd: projectRoot,
      env: process.env,
    });
    if (r.status !== 0) throw new Error(`exit ${r.status}`);
  } catch (e) {
    console.error(`[ensure-icons] 文件关联图标生成失败：${e.message}`);
    return false;
  }

  const ok = fs.existsSync(fileAssocIconIco) && fs.statSync(fileAssocIconIco).size >= 1000;
  console.log(`[ensure-icons] 文件关联图标生成完成：${ok ? 'OK' : '未检测到有效的 file-association.ico'}`);
  return ok;
}

ensureIcons();
ensureFileAssociationIcon();
