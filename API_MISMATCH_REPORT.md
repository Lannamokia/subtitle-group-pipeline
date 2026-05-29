# 前后端接口失配与功能完整度核查报告

> 生成日期：2026-05-29
> 扫描范围：前端 `frontend/app/src` + 后端 `backend/src/modules` + OpenSpec `openspec/changes/subtitle-group-task-platform`

---

## 1. 执行摘要

| 维度 | 数量 | 状态 |
|------|------|------|
| 前端 API 调用 | 119 | 已扫描 |
| 后端路由 | 176 | 已扫描 |
| OpenSpec 功能需求 | 46 | 已提取 |
| **接口失配** | **18 项** | 需修复 |
| **功能缺失** | **25+ 项** | 待实现 |

**关键结论：**
- 后端已实现 176 条路由，覆盖面较广，但部分路由与前端调用路径存在失配。
- 前端调用的 119 个 API 中，约 **15% 存在路径或方法失配**。
- OpenSpec 定义的 46 个功能需求中，**核心 CRUD 已实现，但后台任务、通知渠道升级、审核快照等功能尚未落地**。

---

## 2. 前端 API 调用清单

前端通过 axios 实例 `api`（baseURL: `http://localhost:3000/api/v1`）发起调用，共 **119 个 API 调用**，分布在 20+ 个文件中。

### 2.1 按模块分布

| 模块 | 调用数 | 主要文件 |
|------|--------|----------|
| Auth | 18 | `api.ts`, `LoginPage.tsx`, `ProfilePage.tsx`, `SkillProfilePage.tsx`, `RegistrationSettingsPage.tsx` |
| Project | 15 | `api.ts`, `ProjectListPage.tsx`, `ProjectCreatePage.tsx`, `ProjectDetailPage.tsx`, `ArchivePage.tsx` |
| Task | 10 | `api.ts`, `ProjectDetailPage.tsx`, `DashboardPage.tsx`, `WorkloadPage.tsx` |
| File | 10 | `api.ts`, `FileListPage.tsx`, `ProjectDetailPage.tsx` |
| Storage | 8 | `api.ts`, `StorageBackendPage.tsx`, `ProfilePage.tsx` |
| Notification | 5 | `api.ts`, `NotificationPage.tsx` |
| Template | 6 | `api.ts`, `TemplatePage.tsx` |
| Wiki | 3 | `api.ts`, `ProjectDetailPage.tsx`, `WikiPage.tsx` |
| Announcement | 4 | `api.ts`, `DashboardPage.tsx`, `AnnouncementAdminPage.tsx` |
| Timeline | 3 | `api.ts`, `DashboardPage.tsx`, `TimelineEvent.tsx` |
| Member | 3 | `api.ts`, `MemberPage.tsx`, `TaskCommentPanel.tsx` |
| Subtitle | 2 | `DedupPage.tsx`, `ProjectDetailPage.tsx` |

### 2.2 无真实 API 调用的页面（纯 Mock/静态）

- `src/pages/Home.tsx` — 纯 Vite 默认模板
- `src/pages/NotificationSettingsPage.tsx` — 仅本地 store
- `src/pages/admin/DataRetentionPage.tsx` — 纯静态 UI

---

## 3. 后端路由清单

后端共 **176 条路由**（含 App 级别 4 条），挂载在 `/api/v1` 前缀下。

### 3.1 按模块分布

| 模块 | 路由数 | 认证要求 |
|------|--------|----------|
| task | 32 | 大部分需认证 |
| file | 24 | 大部分需认证 |
| project | 21 | 混合 |
| subtitle | 22 | 大部分需认证 |
| auth | 18 | 混合 |
| storage | 14 | 混合 |
| wiki | 15 | 混合 |
| notification | 10 | 全部需认证 |
| template | 6 | 混合 |
| announcement | 6 | 混合 |
| timeline | 4 | 全部需认证 |

### 3.2 App 级别路由

- `GET /health` — 健康检查
- `GET /` — 根路径重定向
- `GET /download/:token` — 公开下载
- `POST /webhook/qq-verify` — QQ 验证 webhook

---

## 4. 接口失配分析

### 4.1 前端调用但后端缺失/失配的 API（❌ 需修复）

| # | 前端调用 | 前端文件 | 后端现状 | 问题类型 |
|---|----------|----------|----------|----------|
| 1 | `GET /members` | `MemberPage.tsx:15`, `TaskCommentPanel.tsx:49` | ❌ **不存在** | **缺失路由** |
| 2 | `POST /links` | `FileListPage.tsx:131` | ❌ 不存在独立 `/links` | **路径失配**（后端为 `/files/links` 或 `/projects/:id/links`） |
| 3 | `DELETE /links/:linkId` | `FileListPage.tsx:145` | ❌ 不存在独立 `/links/:id` | **路径失配** |
| 4 | `POST /tasks/:taskId/:action` | `ProjectDetailPage.tsx:324` | ⚠️ 无通用 `:action` 路由 | **路径失配**（后端有单独的 `/claim`, `/assign`, `/return` 等） |
| 5 | `GET /users` | `ProjectCreatePage.tsx:139` | ❌ **不存在** | **缺失路由** |
| 6 | `POST /files/:fileId/download` | `FileListPage.tsx:117`, `ProjectDetailPage.tsx:547` | ❌ 无 POST 方法 | **方法失配**（后端为 `GET /files/:fileId/download-link`） |
| 7 | `PUT /projects/:projectId` | `ProjectDetailPage.tsx:1456` | ⚠️ 只有 PATCH | **方法失配** |
| 8 | `GET /storage/stats` | `api.ts:173` | ❌ **不存在** | **缺失路由** |
| 9 | `GET /wiki/:projectId` | `api.ts:290`, `WikiPage.tsx:400` | ⚠️ 后端为 `GET /wiki/by-slug/:slug` 或 `GET /wiki/:id` | **路径失配** |
| 10 | `POST /files/upload` | `FileListPage.tsx:102`, `ProjectDetailPage.tsx:532` | ✅ 存在（兼容路由） | ✅ **正常** |
| 11 | `POST /projects/:projectId/conflicts/:conflictId/resolve` | `DedupPage.tsx:66`, `ProjectDetailPage.tsx:1203` | ⚠️ 后端为 `POST /projects/:id/conflicts/:conflictId/resolve` | **路径参数名差异**（`projectId` vs `id`） |
| 12 | `POST /projects/:projectId/join-requests/:requestId/approve` | `ProjectDetailPage.tsx:1062` | ✅ 存在（兼容路由 `/projects/:id/join-requests/:requestId/respond`） | ⚠️ **路径差异**（approve vs respond） |
| 13 | `POST /projects/:projectId/join-requests/:requestId/reject` | `ProjectDetailPage.tsx:1073` | ✅ 存在（同上） | ⚠️ **路径差异** |
| 14 | `POST /projects/:projectId/announcements` | `ProjectDetailPage.tsx:952` | ⚠️ 后端公告模块独立，无项目级公告路由 | **可能缺失** |
| 15 | `PUT /projects/:projectId/wiki` | `ProjectDetailPage.tsx:697` | ⚠️ 后端 wiki 路由为 `PUT /wiki/:id`，非项目级 | **路径失配** |
| 16 | `PUT /members/:id/role` | `api.ts:316` | ❌ **不存在** | **缺失路由** |
| 17 | `PUT /members/:id/status` | `api.ts:319` | ❌ **不存在** | **缺失路由** |
| 18 | `GET /files` | `api.ts:221` | ✅ 存在 | ✅ **正常** |

### 4.2 后端提供但前端未调用的 API（⚠️ 可能遗漏）

以下后端路由已存在，但前端当前没有调用。部分是因为对应前端页面尚未实现，部分是前端已实现但使用不同路径。

| 模块 | 路由 | 说明 |
|------|------|------|
| auth | `POST /auth/verify-qq` | QQ 验证 |
| auth | `POST /auth/request-password-reset` | 密码重置 |
| auth | `POST /auth/refresh` | Token 刷新（前端可能通过拦截器处理） |
| project | `POST /projects/from-template` | 从模板创建 |
| project | `POST /projects/:id/archive` | 归档 |
| project | `POST /projects/:id/unarchive` | 取消归档 |
| project | `POST /projects/:id/delete` | 软删除 |
| project | `POST /projects/:id/restore` | 恢复 |
| project | `GET /projects/:id/conflicts` | 获取项目冲突 |
| task | `POST /tasks/:id/start` | 开始任务 |
| task | `POST /tasks/:id/cancel` | 取消任务 |
| task | `POST /tasks/:id/reset` | 重置任务 |
| task | `PATCH /tasks/:id/deadline` | 更新截止时间 |
| task | `POST /tasks/:id/claim-segment` | 领取翻译区间 |
| task | `POST /tasks/:id/abandon-segment/:claimId` | 放弃区间 |
| task | `POST /tasks/:id/submit-translation` | 提交翻译 |
| task | `POST /tasks/:id/dependencies` | 创建依赖 |
| task | `DELETE /tasks/:id/dependencies/:dependencyId` | 删除依赖 |
| file | `POST /files/:fileId/replace` | 替换文件 |
| file | `GET /files/:fileId/versions` | 获取版本历史 |
| file | `POST /files/:fileId/versions/:versionId/approve` | 审核版本 |
| file | `GET /upload-policy` | 上传策略 |
| file | `POST /upload-policy` | 更新上传策略 |
| notification | `DELETE /notifications/:id` | 删除通知 |
| notification | `PUT /notifications/preferences` | 更新偏好 |
| subtitle | `POST /subtitles/projects/:projectId/units/:unitId/claims` | 创建翻译区间 |
| subtitle | `GET /subtitles/projects/:projectId/units/:unitId/claims` | 获取区间 |
| subtitle | `POST /subtitles/tasks/:taskId/submissions` | 提交翻译稿 |
| subtitle | `POST /subtitles/units/:unitId/merge-jobs` | 创建合并作业 |
| subtitle | `GET /subtitles/merge-jobs/:jobId/conflicts` | 获取冲突 |
| subtitle | `POST /subtitles/conflicts/:conflictId/resolve` | 解决冲突 |
| subtitle | `GET /subtitles/files/:fileId/compare/:otherFileId` | 版本对比 |
| storage | `GET /storage/default` | 默认后端 |
| storage | `GET /storage/:id` | 后端详情 |
| storage | `POST /storage/avatar` | 上传头像 |
| wiki | `POST /wiki/:id/approve` | 审批 wiki |
| wiki | `POST /wiki/:id/reject` | 驳回 wiki |
| wiki | `GET /wiki/:wikiId/comments` | wiki 评论 |
| wiki | `POST /wiki/:wikiId/comments` | 创建评论 |
| announcement | `POST /announcements/:id/pin` | 置顶公告 |
| template | `POST /templates/:id/set-default` | 设置默认模板 |

---

## 5. OpenSpec 功能完整度检查

### 5.1 已实现 ✅（核心功能）

| 模块 | 功能 | 状态 |
|------|------|------|
| Auth | 用户注册/登录 | ✅ 已实现 |
| Auth | QQ 群验证框架 | ⚠️ 基础结构存在，NoneBot 回调待验证 |
| Auth | 用户资料（昵称） | ✅ 已实现 |
| Auth | 资格标签 CRUD | ✅ 已实现 |
| Project | 项目 CRUD | ✅ 已实现 |
| Project | 项目模板 CRUD | ✅ 已实现 |
| Project | 项目成员管理 | ✅ 已实现 |
| Project | 进组申请/审批 | ✅ 已实现 |
| Task | 任务 CRUD | ✅ 已实现 |
| Task | 任务状态流转 | ✅ 已实现（claim/assign/return/submit/approve/reject） |
| Task | 工作负载视图 | ✅ 已实现 |
| File | 文件上传 | ✅ 已实现 |
| File | 项目文件列表 | ✅ 已实现 |
| File | 版本历史 | ✅ 已实现 |
| File | 下载链接 | ✅ 已实现 |
| Notification | 通知列表/标记已读 | ✅ 已实现 |
| Notification | 通知偏好 | ✅ 已实现 |
| Wiki | Wiki CRUD | ✅ 已实现 |
| Wiki | Wiki 审批流 | ✅ 已实现（approve/reject） |
| Announcement | 公告 CRUD | ✅ 已实现 |
| Timeline | 时间线事件 | ✅ 已实现 |
| Storage | 存储后端 CRUD | ✅ 已实现 |

### 5.2 部分实现 ⚠️（有路由但功能不完整）

| 模块 | 功能 | 缺失内容 |
|------|------|----------|
| Project | 项目归档/回收站 | 路由存在但清理逻辑未实现 |
| Project | 批量操作 | 路由缺失 |
| Project | 交付清单 | 无独立路由 |
| Project | 成品配置 | 无独立路由 |
| Task | 翻译区间领取 | 路由存在，但竞争校验待完善 |
| Task | 流水线审核关卡 | 基础审核存在，但级联审核未实现 |
| Task | 下游级联重置 | 路由缺失 |
| Task | 超期任务处理 | 无自动标记机制 |
| File | 网盘链接管理 | 有 links 路由但前端调用路径失配 |
| File | 敏感标签控制 | schema 中无敏感标签字段 |
| Subtitle | ASS 解析 | 基础解析存在 |
| Subtitle | 合并作业 | 路由存在但去重逻辑待完善 |
| Subtitle | 冲突解决 | 路由存在 |
| Notification | 送达日志 | 无独立路由 |
| Notification | 渠道升级 | 未实现 |
| Notification | 评论 @ 通知 | 无评论系统路由 |

### 5.3 未实现 ❌（缺失路由/服务）

| 模块 | 功能 | 优先级 |
|------|------|--------|
| Admin | 数据保留配置 | P2 |
| Admin | 全局工作负载视图 | P2 |
| Task | 发布任务管理 | P2 |
| Task | 任务评论系统 | P2 |
| File | 审核快照 | P2 |
| Subtitle | 在线去重页面 API | P2 |
| Notification | 通知投递触发 | P1 |
| Notification | 重试机制 | P1 |
| Background | 超期任务自动标记 | P1 |
| Background | 归档版本清理 | P2 |
| Background | 回收站物理清理 | P2 |
| Background | 通知渠道升级 | P1 |
| Background | 下载链接过期清理 | P1 |
| Review | 审核快照表 | P2 |
| Review | 级联重置触发 | P1 |

---

## 6. Prisma Schema 完整度

基于 `backend/prisma/schema.prisma` 检查：

### 6.1 已定义的模型

- `User`, `Project`, `ProjectTemplate`, `Task`, `FileEntity`, `FileVersion`
- `Notification`, `TimelineEvent`, `WikiDocument`, `Announcement`
- `ProjectMember`, `JoinRequest`, `TaskDependency`, `TranslationClaim`
- `MergeJob`, `SubtitleConflict`, `StorageBackend`, `RoleTag`, `TagApplication`
- `Comment`（通过 wiki 模块）

### 6.2 缺失的模型/字段

| 缺失项 | 影响 |
|--------|------|
| `review_snapshots` 表 | 审核驳回时无法保留快照 |
| `link_history` 独立表 | 网盘链接历史记录 |
| `download_links` 表 | 临时下载链接管理 |
| `delivery_checklists` 表 | 交付清单 |
| `notification_deliveries` 表 | 送达日志 |
| `project_units` 的 `episode_length` | 翻译区间领取 |
| `files` 的 `sensitive` 标签 | 敏感文件控制 |
| `projects` 的 `storage_backend_id` | 存储后端绑定 |

---

## 7. 修复优先级建议

### P0 — 阻塞级（前端无法正常工作）

1. **修复 `/members` 路由** — 前端 MemberPage 和 TaskCommentPanel 依赖
2. **修复 `/links` 路由路径** — 与前端调用对齐（`POST /files/links` 或独立 `/links`）
3. **修复 `/users` 路由** — ProjectCreatePage 依赖
4. **修复 `POST /files/:fileId/download` 方法** — 改为 `GET /files/:fileId/download-link`
5. **修复 `/storage/stats` 路由** — 或从前端移除

### P1 — 高优先级（核心功能缺失）

6. 实现后台任务：超期标记、通知升级、链接清理
7. 实现 `review_snapshots` 表和审核快照逻辑
8. 实现 `download_links` 表和临时链接管理
9. 实现通知投递触发和重试机制
10. 实现任务评论系统（独立于 wiki 评论）

### P2 — 中优先级（功能增强）

11. 实现 `link_history` 独立表
12. 实现 `delivery_checklists` 表
13. 实现归档版本清理和回收站清理
14. 实现敏感标签控制
15. 实现项目级存储后端绑定

---

## 8. 附录

### 8.1 扫描工具

- 前端扫描：`grep -r "api\.(get\|post\|put\|delete\|patch)" frontend/app/src`
- 后端扫描：`find backend/src/modules -name "*.routes.ts" | xargs cat`
- OpenSpec 扫描：读取 design.md + tasks.md + 6 个 spec.md

### 8.2 相关文件

- `frontend-api-calls.json` — 前端 API 调用详细清单
- `backend-routes.json` — 后端路由详细清单
- `openspec-requirements.json` — OpenSpec 功能需求清单
- `openspec/changes/subtitle-group-task-platform/` — 原始规格文档

---

*报告由子代理扫描 + 主代理综合生成*
