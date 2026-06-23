# 自建部署与 CI/CD 完整指南

本仓库 fork 自 [QuantumNous/new-api](https://github.com/QuantumNous/new-api)，
在其基础上做了自定义改动，并搭建了一套「push 到 main → 自动构建镜像 → 自动部署到服务器」的全自动流水线。

本文档说明：从零开始（比如换一台新服务器）如何把这套源码部署成全自动 CI/CD。

> ⚠️ **安全提示**：本文档中所有密码、私钥、IP 均用占位符（如 `<你的服务器IP>`）。
> 真实值不要写进任何提交到仓库的文件。本仓库是 Public，任何写进去的密钥都会被永久公开。

---

## 0. 整体架构

```
本地改代码
   │  git push origin main
   ▼
GitHub Actions (.github/workflows/deploy.yml)
   │  1. 构建 Docker 镜像（前端 bun + 后端 Go）
   │  2. 推送到 ghcr.io/<你的GitHub用户名>/new-api:latest
   │  3. SSH 登录服务器执行 docker compose pull && up -d
   ▼
服务器
   docker compose 用新镜像滚动重启 new-api 容器
   （mysql / redis / 数据卷不动，数据不丢）
```

涉及三个地方：

| 位置 | 作用 |
|------|------|
| **GitHub 仓库** | 存代码、跑 Actions 构建、存 Secrets |
| **ghcr.io** | GitHub 自带的 Docker 镜像仓库，存构建好的镜像 |
| **你的服务器** | 跑 docker compose，拉镜像、起容器 |

---

## 1. 分支策略

本仓库用两个分支隔离「你的改动」和「上游更新」：

| 分支 | 用途 |
|------|------|
| `main` | 你的开发 + 部署分支。CI/CD 监听这个分支 |
| `upstream-sync` | 专门跟踪上游 `QuantumNous/new-api`，用于同步更新 |

两个远程：

```bash
origin    = 你自己的仓库（github.com/<你>/new-api）
upstream  = 原上游（github.com/QuantumNous/new-api）
```

### 日常开发
```bash
git checkout main
# ...改代码...
git add . && git commit -m "你的改动"
git push origin main          # ← 触发自动构建 + 部署
```

### 同步上游更新
```bash
git checkout upstream-sync
git pull upstream main
git push origin upstream-sync

git checkout main
git merge upstream-sync       # 把上游更新合进来，处理冲突
git push origin main          # 合完照样自动部署
```

<!-- PLACEHOLDER_SECTION_2 -->

---

## 2. 全新服务器：从零部署（一次性）

假设你拿到一台全新的 Linux 服务器（Debian/Ubuntu，装了 Docker + docker compose），
想把本源码跑起来并接入自动 CI/CD。按顺序做完下面 5 步即可。

### 2.1 准备服务器目录、compose 和 .env

在服务器上选一个目录放部署文件，例如 `/opt/new-api`（宝塔用户通常在
`/www/dk_project/dk_app/newapi/<项目名>`）。

把本仓库 `deploy/docker-compose.yml` 放进该目录，再在**同目录**新建 `.env`：

```bash
# 服务器上执行
mkdir -p /opt/new-api && cd /opt/new-api

# 把仓库 deploy/docker-compose.yml 的内容放进来（scp / 粘贴 / wget 均可）
# 然后创建 .env：
cat > .env <<'EOF'
DB_PASSWORD=<设一个强数据库密码>
SESSION_SECRET=<随机串，可用 openssl rand -hex 32 生成>
HOST_IP=127.0.0.1
WEB_HTTP_PORT=3000
APP_PATH=/opt/new-api
EOF
```

> `deploy/docker-compose.yml` 里镜像已指向 `ghcr.io/<你的用户名>/new-api:latest`，
> 数据库密码、SESSION_SECRET 都从 `.env` 读取，不写死在 compose 里。
> 换成你自己的 GitHub 用户名（小写）。

`docker-compose.yml` 关键行（确认镜像名是你的）：
```yaml
services:
  new-api:
    image: ghcr.io/<你的用户名小写>/new-api:latest
```

### 2.2 生成部署用 SSH 密钥（GitHub Actions 用它登录服务器）

在**本地**（不是服务器）生成一对专用密钥：

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f deploy_key -N ""
# 产出两个文件：
#   deploy_key      ← 私钥，填进 GitHub Secret SSH_KEY
#   deploy_key.pub  ← 公钥，加到服务器
```

把**公钥**加到服务器的 `~/.ssh/authorized_keys`：

```bash
# 服务器上执行（把下面整行换成 deploy_key.pub 的完整内容）
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo "ssh-ed25519 AAAA...完整公钥... github-actions-deploy" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

> ⚠️ 用 `>>`（追加）不要用 `>`（覆盖）。
> ⚠️ 公钥很长，务必整行完整粘贴，不能截断。终端粘贴易出错时，
> 用面板的「文件管理器」直接编辑 `authorized_keys` 更稳。

本地验证密钥能连上（看到 OK 即成功）：
```bash
ssh -i deploy_key -o BatchMode=yes root@<服务器IP> -p <端口> 'echo OK'
```

<!-- PLACEHOLDER_SECTION_3 -->

### 2.3 配置 GitHub Secrets

GitHub 靠这 5 个 Secret 知道服务器在哪、怎么连。两种配置方式任选其一。

**这 5 个 Secret：**

| Secret 名 | 值 | 说明 |
|-----------|-----|------|
| `SSH_HOST` | `<服务器IP>` | 服务器公网 IP |
| `SSH_PORT` | `22` | SSH 端口（宝塔可能改过，在「安全」里看） |
| `SSH_USER` | `root` | SSH 登录用户 |
| `SSH_KEY` | `deploy_key` 私钥全文 | 含 `-----BEGIN...` 到 `-----END...` 全部行 |
| `DEPLOY_PATH` | `/opt/new-api` | 服务器上 compose 所在目录（注意大小写要完全一致） |

**方式 A — 命令行设置（推荐，避免网页多行粘贴出错）：**

需要先装 [GitHub CLI](https://cli.github.com/) 并 `gh auth login`。

```bash
gh secret set SSH_HOST   -R <你的用户名>/new-api -b "<服务器IP>"
gh secret set SSH_PORT   -R <你的用户名>/new-api -b "22"
gh secret set SSH_USER   -R <你的用户名>/new-api -b "root"
gh secret set DEPLOY_PATH -R <你的用户名>/new-api -b "/opt/new-api"
# 私钥从文件读入（保留换行）：
gh secret set SSH_KEY    -R <你的用户名>/new-api < deploy_key

# 确认：
gh secret list -R <你的用户名>/new-api
```

**方式 B — 网页设置：**

打开 `https://github.com/<你的用户名>/new-api/settings/secrets/actions`
（路径：仓库 → Settings → 左侧 Secrets and variables → **Actions** → Secrets 标签页），
点 **New repository secret** 逐个添加。

> 找不到按钮通常是点进了 **Environments**，认准 **Secrets and variables → Actions**。

### 2.4 让服务器能拉到 ghcr 镜像

第一次构建成功后，镜像在 `ghcr.io/<你的用户名>/new-api`。
让服务器能拉取，二选一：

- **设为 Public（最省事）**：
  `https://github.com/users/<你的用户名>/packages` → 进入 `new-api` 包 →
  Package settings → Change visibility → Public。
- **保持 Private**：在服务器上 `docker login ghcr.io`，用户名填 GitHub 用户名，
  密码填一个有 `read:packages` 权限的 Personal Access Token。

验证服务器能拉：
```bash
docker pull ghcr.io/<你的用户名>/new-api:latest
```

### 2.5 首次部署

第一次手动起一下（之后都自动）：

```bash
# 服务器上
cd /opt/new-api
docker compose pull          # 拉你的 ghcr 镜像
docker compose up -d         # 起 new-api + mysql + redis
docker compose ps            # 看状态，new-api 应为 healthy
```

验证服务正常：
```bash
curl -s http://localhost:3000/api/status
```

<!-- PLACEHOLDER_SECTION_4 -->

---

## 3. CI/CD workflow 说明

文件：`.github/workflows/deploy.yml`，触发条件：push 到 `main`（或手动 workflow_dispatch）。

两个 job：

1. **build-and-push**：用 buildx 构建 `linux/amd64` 镜像，登录 ghcr（用内置
   `GITHUB_TOKEN`，无需额外配置），推送 `:latest` 和 `:<短sha>` 两个标签。
2. **deploy**：用 `appleboy/ssh-action` 通过前述 5 个 Secret 登录服务器，执行：
   ```bash
   cd $DEPLOY_PATH
   docker compose pull new-api
   docker compose up -d new-api
   docker image prune -f
   ```

镜像名在 workflow 顶部写死（**必须全小写**，ghcr 不接受大写）：
```yaml
env:
  IMAGE: ghcr.io/<你的用户名小写>/new-api
```

> 换新仓库时记得把这里和 `deploy/docker-compose.yml` 的镜像名都改成你的用户名。

---

## 4. 日常使用

```bash
# 改代码 → 自动构建 + 部署
git add . && git commit -m "xxx" && git push origin main

# 看构建/部署状态
gh run list -R <你的用户名>/new-api --workflow=deploy.yml --limit 3
gh run watch -R <你的用户名>/new-api   # 实时盯最近一次
```

**什么会自动 / 不会自动：**

| 情况 | 是否自动 |
|------|---------|
| 改前端/后端代码 | ✅ 自动构建+部署 |
| new-api 容器滚动重启（数据不丢） | ✅ 自动 |
| 代码有 bug 导致构建失败 | ⛔ 停在构建，**不部署坏镜像**（服务器保持旧版本） |
| 新版本要求加新的环境变量 | ❗ 需手动改服务器 `.env` |
| mysql / redis 升级 | ❗ 不自动（也不该自动） |
| 数据库 schema 变更 | 一般容器内自动迁移，极端情况看日志 |

---

## 5. 故障排查

**部署 job 失败 `Permission denied (publickey)`**
→ 公钥没正确加到服务器，或粘贴时被截断。重新完整粘贴 `deploy_key.pub` 到
   `~/.ssh/authorized_keys`，本地用 `ssh -i deploy_key ... 'echo OK'` 验证。

**部署 job 失败 `cd: <路径>: No such file`**
→ `DEPLOY_PATH` Secret 路径错（注意大小写）。在服务器用下面命令查真实路径：
```bash
docker inspect <容器名> --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}'
```

**服务器 `docker compose pull` 报 `denied` / `not found`**
→ ghcr 镜像还是 Private。按 2.4 设为 Public，或在服务器 `docker login ghcr.io`。

**构建失败 `repository name must be lowercase`**
→ workflow 里 `IMAGE` 用了大写用户名。改成全小写。

**回滚到上一个镜像**：
```bash
# 服务器上，用具体 sha 标签替代 latest
docker compose pull
docker tag ghcr.io/<你的用户名>/new-api:<旧sha> ghcr.io/<你的用户名>/new-api:latest
docker compose up -d new-api
```

---

## 6. 本仓库已修复的上游坑（换源码时注意）

- **前端 date-fns 构建冲突**：上游 `bun.lock`（2026-06-22 起）存在
  `date-fns-tz@1` 与 `date-fns@4` 的 `exports` 冲突，导致 `classic` 前端
  rspack 构建失败。本仓库已通过 `web/package.json` 的 `overrides`
  （把 `date-fns-tz` 提到 `^3.2.0`）+ `web/patches/semi-foundation.patch`
  （把 semi-foundation 内 `zonedTimeToUtc/utcToZonedTime` 改名为 v3 的
  `fromZonedTime/toZonedTime`）修复。`Dockerfile` 已加 `COPY web/patches`
  使补丁在 `bun install --frozen-lockfile` 时生效。
- **`.gitattributes`** 已强制 `*.patch` 和 `web/bun.lock` 为 LF，
  防止 Windows 下 CRLF 导致 Linux CI 上补丁应用失败。

---

## 附：关键文件一览

| 文件 | 作用 |
|------|------|
| `.github/workflows/deploy.yml` | CI/CD 流水线定义 |
| `deploy/docker-compose.yml` | 服务器部署用 compose（镜像指向你的 ghcr） |
| `deploy/.env.example` | 服务器 `.env` 模板（真实 `.env` 不提交） |
| `web/package.json` | 含 `overrides` + `patchedDependencies` |
| `web/patches/semi-foundation.patch` | 修复前端构建的补丁 |
| `Dockerfile` | 多阶段构建（已含 COPY patches） |



