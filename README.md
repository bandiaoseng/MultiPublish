# MultiPublish 多平台发布

基于 [whut09/MultiPublish](https://github.com/whut09/MultiPublish) 的内部开发版本，保留原作者 MIT 许可。本仓库用于保存本地改进和后续版本发布。

## 当前状态

2026-11-14 导入的源码快照，package.json 版本为 0.1.57-fdrive.5，包含多平台视频发布、百家号与封面适配，以及尚需继续验收的消息中心代码。源码上传不等于稳定安装版发布。

本仓库不含任何用户的平台账号、登录会话、发布记录、视频素材或本机运行数据。使用者必须自行登录自己的平台账号。

## 开发与构建

使用支持 TypeScript 类型剥离的 Node.js（建议 Node 22.18 或更新的受支持版本），在项目目录执行：

~~~powershell
npm ci
npm run typecheck
npm test
node --experimental-strip-types --test src/main/inbox-core.test.ts
npm run build
~~~

npm run dist 可生成 Windows NSIS 安装包。依赖缓存、临时目录和构建目录请放到可用空间充足的磁盘；安装包发布前必须检查干净环境的安装与升级。

## 数据位置

当前仍保留个人 F 盘构建的路径行为，默认数据目录为 F:/Codex/MultiPublish/data。
可通过 MULTIPUBLISH_USER_DATA_DIR 指定独立绝对路径。尚未针对没有 F 盘的同事电脑完成通用安装适配，不能直接当作通用安装版分发。

## 来源和发布

- 原作者许可：LICENSE。
- 封面与百家号相关参考：docs/THIRD_PARTY.md。
- 本次源码版本及校验值：SOURCE_SNAPSHOT.json。
- 后续上传规则：UPLOAD_POLICY.md。

平台页面变化可能影响适配；本次本地构建检查不代表所有平台线上发布和消息回复均已验收。
