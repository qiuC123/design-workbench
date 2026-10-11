# 序间 · 项目与人员排班工作台

面向小型团队的项目看板、客户公司管理和人员排班网站。项目卡片与排班表共用起止日期，支持多位内部负责人、按客户公司管理对接人，以及电脑和手机布局。

本仓库提供可运行的公开源码，默认人员、客户和项目均为演示信息。实际业务数据库、账号、初始化口令、部署配置与操作截图不包含在仓库中。

## 已有功能

- 项目看板：待办、进行中、待核验、已完成，保留核验与退回记录。
- 人员排班：连续四周横向滚动，固定人员列；多人项目显示在每位负责人的排班中。
- 客户公司与对接人：搜索或新建公司，多选联系人，支持编辑和停用。
- 网站账号与 SQLite 持久化：首次初始化管理员，登录、退出与修改密码。
- 跨设备共享：登录同一网站后，在页面可见时每 10 秒检查更新，切回前台也会同步。
- 保存冲突检查、JSON 导入导出，以及最近 30 份修改前快照恢复。

目前使用一个管理账号；尚未实现员工独立账号、附件上传、Excel 导入、钉钉免登或微信消息。

## 快速运行网站版

需要 **Node.js 24** 和 npm。后端使用 Node 内置 SQLite。

```sh
git clone https://github.com/qiuC123/design-workbench.git
cd design-workbench
npm ci
npm run build:website
npm run start:website
```

打开 <http://127.0.0.1:4175/>。首次启动会生成 `.data/setup-token.txt`，在本机读取其中的一次性初始化口令，创建自己的管理账号。没有默认账号或密码。

网站初始没有项目，预置四个演示公司。实际记录保存在 `.data/workbench.sqlite`；重复启动不会清空数据。

需要自定义监听地址、端口或来源时，将 `.env.example` 复制为 `.env` 再修改。已有 `.env` 时保留原文件。

完整运行、备份和部署说明见 [docs/WEBSITE.md](docs/WEBSITE.md)。

## 局域网与手机测试

Windows 上完成构建后，双击 `start-website-lan.cmd`，使用窗口显示的地址访问。手机与电脑需处于允许设备互访的同一局域网，电脑和启动窗口需要保持运行。

如果端口已被旧网站占用，先在原启动窗口停止旧进程再运行。换网络后以新窗口显示的 IP 为准。脚本不会修改防火墙或路由器设置。

## 浏览器独立演示

```sh
npm run dev
```

打开 <http://127.0.0.1:5173/#/board>。此模式带有演示项目，数据保存在当前浏览器的 localStorage 中；网站版才使用服务器共享数据。

```sh
npm run build:trial
npm run start:trial
```

以上命令提供独立的静态试用页面，默认地址为 <http://127.0.0.1:4174/>。试用模式不会迁入浏览器原有工作记录，也不代表已接通钉钉登录或消息。

## 检查与构建

```sh
npm test                         # 当前业务模型、存储与迁移
npm run test:website              # HTTP 服务、账号和客户端处理
npm run test:board-v3             # 旧版本模型与迁移
npm run build:website             # TypeScript 检查与前端构建
npm run build:website-runtime     # 打包独立 Node 后端
npm run test:website-runtime      # 临时数据库下验证登录、保存及重启持久化
```

`test:scheduling-v2`、`test:legacy` 及历史 UI 脚本保留供旧版本参考；旧 UI 脚本不能用来验收当前页面。

## 代码结构

| 目录 | 用途 |
| --- | --- |
| `src/workspace` | 当前项目看板、客户管理、排班和业务模型 |
| `src/website` | 登录、服务器连接、同步与数据管理 |
| `server` | HTTP API、SQLite 存储和认证 |
| `src/board`、`src/scheduling`、`src/domain` | 历史版本及迁移依赖 |
| `scripts` | 构建、局域网启动、备份和验证 |
| `public/demo` | 演示用 SVG 素材 |

公开版本使用五个演示成员，定义于 `src/workspace/model.ts`；演示公司和项目位于 `src/workspace/seed.ts`。旧版本对应的成员定义与迁移规则也需同步维护。已保存的数据通过 ID 关联，调整 ID 前应先备份并规划迁移。

GitHub 仓库用于分发源码。需要另外运行后端才能使用账号和共享数据库；本仓库没有自动部署到 GitHub Pages 或云服务器。
