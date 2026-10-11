# 网站运行与部署

## 数据与运行模式

网站版由 React 前端、Node.js 24 HTTP 服务和 SQLite 数据库组成。电脑和手机登录同一个网站后读取同一份项目数据。

`npm run dev` 的浏览器演示与网站版分别存储数据；不要根据浏览器演示判断跨设备同步是否可用。

## 本机运行

```sh
npm ci
npm run build:website
npm run start:website
```

默认入口是 `http://127.0.0.1:4175/`，仅限本机访问。服务只提供 `dist-website` 静态文件和 API，不提供源码或数据库目录。

首次启动后，在本机打开 `.data/setup-token.txt`，使用其中的一次性口令设置账号和密码。初始化完成后使用普通登录页面。可用 `SJ_SETUP_TOKEN` 环境变量提前指定初始化口令，不要提交口令或实际 `.env`。

复制 `.env.example` 为 `.env` 可以自定义配置；启动命令会读取现有 `.env`。已有配置时不要覆盖。

| 配置项 | 含义 |
| --- | --- |
| `SJ_HOST` / `SJ_PORT` | 服务监听地址和端口 |
| `SJ_DATA_DIR` | SQLite 及初始化口令存放目录，默认 `.data` |
| `SJ_STATIC_DIR` | 前端构建目录，默认 `dist-website` |
| `SJ_ALLOWED_ORIGINS` | 允许的完整访问来源，以逗号分隔 |
| `SJ_COOKIE_SECURE` | HTTPS 部署设为 `true`，本机 HTTP 测试设为 `false` |
| `SJ_TRUST_PROXY` | 仅填写实际反向代理的地址；不使用代理时留空 |

## 局域网测试

Windows 上双击 `start-website-lan.cmd`。脚本识别带默认网关的私网 IPv4，绑定所选地址并打印网址，复用原 `.data`。

存在多个候选网卡时，手动指定当前网卡的实际私网 IP：

```powershell
powershell.exe -NoProfile -File scripts/start-website-lan.ps1 -BindAddress 192.168.1.100
```

示例 IP 必须替换为电脑实际地址。端口被占用时先停止原网站进程；不要终止不明服务。脚本只会根据本机保存并逐项核验的进程记录执行自动切换，没有记录时会停止并提示。

手机和电脑需要能够在局域网内互访，访客网络或设备隔离可能阻断访问。网站不会自行更改系统防火墙。换网络后重新启动，并使用新网址。

## 导入、备份与恢复

1. 在原浏览器工作台使用“导出原有数据”下载完整 JSON 备份。
2. 登录网站，在“数据与账号”中选择备份文件，核对预览后确认导入。导入会替换当前业务记录，替换前自动保存快照。
3. 另一个浏览器登录同一网站，检查数据和修改同步。

公开版使用演示成员和公司 ID，业务数据库中引用的人员 ID 必须与对应代码版本一致。不要直接用演示代码替换自定义成员版本的运行程序。

网站保留最近 30 份修改前快照；可在界面下载完整 JSON 备份或恢复历史快照。JSON 备份包括业务记录，不包括账号和登录会话。

要备份账号与业务数据，使用 SQLite 在线备份脚本：

```sh
node scripts/snapshot-website.mjs
```

它读取默认 `.data/workbench.sqlite`，在 `.data/deployment-backups/` 中生成原始备份、清除旧登录会话的迁移副本和清单。自定义数据目录时，把实际数据库文件路径作为第一个参数传入。备份仍含账号及业务数据，应单独保存，不要加入源码仓库。

不要在运行中只复制 SQLite 主文件而忽略 WAL。恢复数据库前停止服务，保留原目录备份，使用一致性快照恢复，再检查登录和项目记录。

## 独立运行包

```sh
npm run build:website
npm run build:website-runtime
npm run test:website-runtime
```

发布文件为 `dist-website/` 与 `dist-server/main.mjs`。后端包只依赖 Node.js 24 内置模块，部署机器无需 npm 安装。

把发布文件放入独立发布目录，配置 `SJ_STATIC_DIR` 和持久化的 `SJ_DATA_DIR`，然后运行：

```sh
node --env-file=/path/to/website.env dist-server/main.mjs
```

配置和数据库放在发布目录之外，升级时备份数据并保留旧发布。通过进程管理器设置服务启动和重启策略，反向代理转发到仅本机监听的应用端口。仓库不包含任何特定服务器的账号或现有部署记录。

## Docker Compose

安装 Docker Engine 和 Compose 后，在仓库根目录运行：

```sh
docker compose config --quiet
docker compose up -d --build web
docker compose exec web cat /app/.data/setup-token.txt
```

默认仅开放 `127.0.0.1:4175`。应用数据位于命名卷 `xu-jian-website-data`，与源码旁的 `.data` 是独立存储。停止时可用 `docker compose down`，需要保留数据时不要加 `-v`。

启用 Caddy HTTPS 前，配置域名解析以及 `.env`：

```dotenv
SJ_DOMAIN=work.example.com
SJ_ALLOWED_ORIGINS=https://work.example.com
SJ_COOKIE_SECURE=true
SJ_TRUST_PROXY=172.30.41.2
```

其中 `work.example.com` 替换为实际域名。`172.30.41.2` 是 Compose 文件固定分配给 Caddy 的容器地址；调整网络时同步修改。完成服务器的域名、网络和证书条件后运行：

```sh
docker compose --profile https up -d --build
```

单个管理账号的登录者均可修改业务数据。代码公开不会公开网站账号和业务记录，也不会自动把网站部署到互联网。
