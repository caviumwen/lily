# LilyPlan 阿里云版

本分支是 LilyPlan 第一版系统的阿里云部署版本：

- ESA Pages：静态前端（客户入口、管理后台、方案页面）。
- ESA Edge Function：只代理 `lilyplan.vip/api/*`。
- Function Compute：中国香港 Node.js 20 Web 函数。
- Tablestore：中国香港结构化数据。
- OSS：中国香港私有文件存储。

## 目录

```text
app/             前端页面与组件
components/      前端控件
src/             Vite 静态前端入口
public/          图标和社交分享图
server/          Function Compute 后台
edge-proxy/      ESA API 代理函数
esa.jsonc        ESA Pages 构建和 SPA 路由配置
dist/            构建生成，不提交 GitHub
```

旧版 Cloudflare D1/R2 API、Wrangler 和 `.openai/hosting.json` 已移除。

## Tablestore 数据表要求

必须存在以下七张表：

| 数据表 | 推荐主键 |
| --- | --- |
| `lp_admins` | `username` |
| `lp_reports` | `report_id` |
| `lp_access_codes` | `code_hash` |
| `lp_sessions` | `token_hash` |
| `lp_attachments` | `attachment_id` |
| `lp_rate_limits` | `limiter_key` |
| `lp_access_events` | `event_id` |

每张表必须只有一个字符串类型主键，不能使用自增主键或组合主键。代码会自动读取实际主键名称，所以已经使用 `id` 等其他名称时不必重建，只要仍是“单个字符串主键”。

建议表设置：允许更新、最大版本数 `1`、TTL `-1`（永久）。会话和限流数据由应用按到期时间处理。

## ESA Pages

`esa.jsonc` 已配置：

- 安装：`pnpm install --frozen-lockfile`
- 构建：`npm run build:web`
- 静态目录：`./dist`
- 未找到路径：`singlePageApplication`

先让 ESA Pages 从 `system-v1` 分支生成测试版本；完整验证后再合并到 `main`。

## Function Compute

上传 `server/` 生成的 FC 部署 ZIP。配置：

- Runtime：Custom Runtime / Node.js 20 Web 函数
- 启动命令：`npm run start`
- 监听端口：`9000`
- 内存：`512 MB`
- 超时：`60 秒`
- 函数角色：`LilyPlanFunctionRole`
- VPC：与香港 Tablestore 实例相同的 VPC

环境变量见 `server/.env.example`。`ALIBABA_CLOUD_ACCESS_KEY_ID`、`ALIBABA_CLOUD_ACCESS_KEY_SECRET` 和 `ALIBABA_CLOUD_SECURITY_TOKEN` 由 FC 根据函数角色自动注入，不要手工创建，也不要使用主账号 AccessKey。

HTTP 触发器应启用 Bearer Token。Bearer Token 只保存在 ESA 的加密变量 `FC_BEARER_TOKEN` 中。

## ESA API 代理

创建 `lily-api-proxy`，把 `edge-proxy/index.js` 粘贴到函数编辑器，并添加：

- `FC_ORIGIN_URL=https://lilyplan-api-yyrasqrdqp.cn-hongkong.fcapp.run`
- `FC_BEARER_TOKEN=<新生成的 Bearer Token>`（加密存储）

路由必须是 `lilyplan.vip/api/*`，不能配置成 `lilyplan.vip/*`。

## 首次上线检查

1. `https://lilyplan.vip/api/health` 返回 `{"ok":true}`。
2. `https://lilyplan.vip/` 显示访问码入口。
3. `https://lilyplan.vip/admin` 显示“创建首位管理员”。
4. 创建文字方案并验证访问码三个月有效。
5. 上传 HTML、PDF 和图片并在无痕窗口验证权限。

不要上传真实客户资料到 GitHub。客户文字、访问记录和文件只应保存在 Tablestore 与私有 OSS 中。
