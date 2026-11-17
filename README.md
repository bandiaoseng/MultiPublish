# MultiPublish 多平台视频发布

基于 [whut09/MultiPublish](https://github.com/whut09/MultiPublish) 的开发版本，保留原作者 MIT 许可。

## 安装和首次使用

打开 [Windows 安装包下载页](https://github.com/bandiaoseng/MultiPublish/releases/tag/v0.1.58)，下载 MultiPublish-Setup-0.1.58.exe，双击选择安装位置，从桌面快捷方式启动。支持 Windows 10/11 64 位，无需另装 Node.js。

在“账号管理”中添加平台并登录自己的账号，再选择视频或图文。安装包不包含账号、Cookie、视频素材或发布记录。

通用安装版数据默认位于 %APPDATA%/MultiPublish。可通过 MULTIPUBLISH_USER_DATA_DIR 指定其他绝对路径。旧个人 F 盘版的数据不会自动导入：如果这台电脑已在使用旧版，请先备份并明确原数据目录，再升级。不要同时让两个版本写入相同目录。

本次 0.1.58 是基于 GitHub 已审核的 0.1.57-fdrive.5 源码快照制作的通用安装试用版；不包含原开发目录此后尚未审核同步的改动。已通过类型检查、32 项离线测试及打包程序空白账号启动检查，未逐平台进行真实发布验收。消息中心仍需继续业务验收。

## 开发

使用 Node.js 22.18 或更新的受支持版本，运行 npm ci、npm run typecheck、npm test、node --experimental-strip-types --test src/main/inbox-core.test.ts。npm run dist -- --publish never 构建 NSIS 安装包。

本机首次打包复用了已有依赖和同版本 Electron 运行时；依赖和临时目录均在 F 盘。个人资料排除规则见 UPLOAD_POLICY.md，第三方来源见 docs/THIRD_PARTY.md。
