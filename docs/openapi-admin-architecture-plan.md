# OpenAPI Admin Architecture Plan

本文档描述 FizzyX OpenAPI Admin 从可运行 CRUD 原型演进为长期可维护的管理后台生成器所需的架构调整、组件边界和实施顺序。

当前实现已经可以生成 Next.js 或 TanStack Start 管理后台，但后续工作不应继续通过增加页面模板分支来堆叠能力。目标架构应围绕声明式 Admin 中间模型、薄框架适配层、通用运行时组件和用户拥有的扩展层展开。

## Goals

- 根据 OpenAPI 和显式配置生成可运行的管理后台。
- 支持资源级、操作级的 `page`、`dialog`、`sheet` 展示模式。
- 根据 OpenAPI tags 和 Admin 元数据生成分组菜单。
- 在后端 API 更新后安全地增量同步生成项目。
- 不覆盖用户自定义页面、组件和业务逻辑。
- 让 Next.js 和 TanStack Start 共用尽可能多的后台运行时能力。
- 为权限、批量操作、导入导出和自定义业务操作保留稳定扩展点。

## Non-Goals

- 不从 OpenAPI 猜测无法可靠推断的业务规则。
- 不让前端权限替代后端鉴权。
- 不通过修改生成文件作为长期定制方式。
- 不为每个框架维护一套完全独立的后台组件实现。
- 不在第一阶段实现审计、多租户和实时通知等所有生产能力。

## Current Architecture

当前生成链路如下：

```text
CLI / .fizzyx.yaml
        ↓
OpenAPI loader and parser
        ↓
ParsedSpec
        ↓
planAdminApp
        ↓
AdminAppPlan
        ↓
renderAdminApp
        ↓
Next.js or TanStack Start templates
        ↓
manifest-aware file writer
        ↓
format, lint, test, and build workflow
```

主要边界：

- `src/use-cases/openapi-parser.ts` 负责解析 OpenAPI、schema、operation、tags 和鉴权扩展。
- `src/use-cases/openapi-admin-plan.ts` 负责把 endpoint 推断为 Admin CRUD 资源。
- `src/domain/openapi-admin-models.ts` 定义当前的 `AdminAppPlan`。
- `src/use-cases/openapi-admin-render.ts` 同时处理页面结构、操作模式、组件 import 和框架差异。
- `src/templates/openapi-admin/` 存放共享组件及两套框架路由模板。
- `src/use-cases/openapi-admin-manifest.ts` 使用文件哈希保护用户修改。
- `src/use-cases/openapi-admin-service.ts` 编排客户端生成、脚手架、渲染、写入和质量检查。

### Existing Capabilities

当前已经支持：

- Next.js 和 TanStack Start 项目生成。
- OpenAPI CRUD 资源推断。
- 列表、详情、新增、编辑和删除。
- Zod 表单 schema 和基础字段约束。
- 枚举选择框。
- 常见分页、搜索、排序和过滤参数推断。
- TanStack Query hooks。
- 登录、服务端 Cookie、BFF 和受保护路由。
- 全局 `page` 或 `dialog` 新增/编辑模式。
- shadcn preset。
- manifest 文件哈希和重复生成冲突保护。
- 未修改的废弃生成文件清理。

### Current Limitations

#### Admin plan is too small

当前 `AdminResourcePlan` 主要包含资源 ID、路径、列、字段、CRUD operation 和查询参数映射。它尚不能表达：

- 菜单分组和排序。
- 资源级展示模式。
- 响应 envelope 映射。
- 权限和可见性。
- 自定义操作。
- 字段、单元格和详情展示方式。
- 稳定的资源身份。

#### Resource identity and tags are coupled

当前使用 operation 的 `tags[0]` 推断资源 ID；没有 tag 时才使用路径片段。这意味着同一个 tag 不能在没有约定的情况下同时可靠表示资源和菜单分组。

#### Rendering owns too many decisions

`openapi-admin-render.ts` 当前同时决定：

- 路由文件路径。
- React import。
- 查询和 mutation hook。
- 列表页面 JSX。
- `page` 和 `dialog` 分支。
- Next.js 和 TanStack Start 差异。

增加 `sheet` 或新的资源行为会继续扩大字符串模板和条件分支。

#### Presentation is a global switch

当前 `create_mode` 只有 `page` 和 `dialog`，并且同时控制新增和编辑。真实后台通常需要类似以下组合：

- 新增使用 dialog。
- 编辑使用 sheet。
- 详情使用 page。
- 某个复杂资源的新增单独使用 page。

#### List responses assume arrays

当前列表页面把 `query.data` 直接传给表格，表格只把数组识别为 rows。以下常见响应不能被可靠消费：

```json
{ "data": [], "total": 100 }
```

```json
{ "items": [], "pagination": { "total": 100 } }
```

#### Conflict protection is not a complete sync system

当前重复生成的行为是：

- 未修改的生成文件会更新。
- 手动修改过的生成文件会保留并报告冲突。
- 用户新增且不在 manifest 中的文件不会被修改。
- 不再生成且没有被修改的文件会删除。

这个方向是正确的，但发生冲突时其他文件仍可能更新，manifest 的 spec fingerprint 也会前进，项目可能出现部分同步状态。当前 manifest 也没有记录生成器版本、模板版本、计划快照和待处理冲突。

## Target Architecture

目标生成链路：

```text
OpenAPI contract
       ↓
Parse and infer
       ↓
Admin configuration overlay
       ↓
Validate and diagnose
       ↓
Declarative AdminPlan
       ├── resources
       ├── navigation
       ├── presentation
       ├── fields and columns
       ├── data mappings
       ├── permissions
       └── actions
       ↓
Generated operation adapters and thin routes
       ↓
Shared Admin Runtime components
       ↓
User-owned configuration and component registries
```

### Stable Public Interfaces

演进时应尽量保持以下接口兼容：

- `fizzyx openapi admin` CLI 命令。
- `.fizzyx.yaml` 中现有 `openapi.admin` 配置。
- OpenAPI 输入和已有 `x-fizzyx-admin.auth` 扩展。
- 已生成 API client 和 TanStack Query hooks 的公开导出。
- Next.js 和 TanStack Start 两个 framework 值。
- 现有 `create_mode`，作为新 presentation 配置的兼容别名。

## Declarative Admin Plan

`AdminAppPlan` 应升级为生成器和运行时之间的稳定中间表示。建议结构：

```ts
type AdminSurface = "page" | "dialog" | "sheet"

interface AdminAppPlan {
  version: 2
  title: string
  resources: AdminResourcePlan[]
  navigation: AdminNavigationPlan
  defaults: AdminPresentationDefaults
  diagnostics: AdminPlanDiagnostic[]
  auth: AdminAuthPlan
}

interface AdminResourcePlan {
  key: string
  id: string
  label: string
  path: string
  group?: string
  order?: number
  icon?: string
  hidden?: boolean
  presentation: {
    create?: AdminSurface
    edit?: AdminSurface
    detail?: AdminSurface
  }
  list?: AdminListPlan
  fields: AdminFieldPlan[]
  operations: Partial<Record<AdminOperationKind, AdminResourceOperation>>
  permissions?: AdminResourcePermissions
  actions?: AdminActionPlan[]
}
```

其中 `key` 应是同步时使用的稳定身份，不能只依赖可能变化的展示 label。

## Page, Dialog, and Sheet

### Configuration

全局默认配置：

```yaml
openapi:
  admin:
    presentation:
      create: dialog
      edit: sheet
      detail: page
```

资源覆盖配置可以放在顶层 OpenAPI tag 的扩展中：

```yaml
tags:
  - name: Users
    x-fizzyx-admin:
      group: Identity
      order: 10
      presentation:
        create: dialog
        edit: sheet
        detail: page
```

配置优先级建议为：

```text
resource-level x-fizzyx-admin
        ↓
project .fizzyx.yaml defaults
        ↓
generator built-in defaults
```

API 语义应保存在 OpenAPI 扩展中，项目级视觉和交互默认值应保存在 `.fizzyx.yaml` 中。

### Component Model

三种模式应共享表单和 mutation 逻辑，只替换展示容器：

```tsx
<AdminActionSurface mode="sheet" title="Edit user">
  <ResourceForm resource="users" operation="update" />
</AdminActionSurface>
```

- `ResourceForm` 负责 schema、初始值、字段和提交。
- `AdminActionSurface` 负责 page、dialog 或 sheet 容器。
- `ResourceMutation` 负责请求、错误、成功提示和缓存刷新。
- 框架路由只负责把 URL 参数转换为资源操作参数。

页面模式仍应保留 canonical route。dialog 和 sheet 后续可以选择是否支持 route-backed modal，以便深链接、浏览器后退和刷新恢复。

## Navigation from OpenAPI Tags

### Tag Convention

为保持兼容，建议采用以下约定：

- Operation 的第一个 tag 标识资源。
- OpenAPI 顶层 tag 描述该资源的后台展示元数据。
- `x-fizzyx-admin.group` 指定菜单分组。
- 没有 group 的资源进入默认 `Resources` 分组。

示例：

```yaml
tags:
  - name: Users
    description: User management
    x-fizzyx-admin:
      label: 用户管理
      group: 系统管理
      icon: users
      order: 10
      hidden: false

paths:
  /users:
    get:
      tags: [Users]
      operationId: listUsers
```

### Generated Navigation Plan

```ts
interface AdminNavigationPlan {
  groups: AdminNavigationGroup[]
}

interface AdminNavigationGroup {
  id: string
  label: string
  order: number
  items: AdminNavigationItem[]
}
```

`AdminShell` 应消费 `adminPlan.navigation.groups`，不再直接遍历 `adminPlan.resources`。

图标使用受控 registry，例如 `users`、`settings`、`database`，不允许 OpenAPI 元数据直接生成任意 import。

## Safe API Synchronization

### Proposed Commands

```sh
fizzyx openapi admin sync --plan
fizzyx openapi admin sync --apply
fizzyx openapi admin sync --check
```

这些命令是目标设计，当前尚未实现。

### Sync Flow

1. 获取并解析新的 OpenAPI。
2. 读取上一次成功应用的 manifest 和 AdminPlan snapshot。
3. 生成新 AdminPlan。
4. 计算结构化 diff。
5. 检查本地生成文件是否被修改。
6. `--plan` 只输出计划，不写文件。
7. `--apply` 原子应用没有冲突的完整变更。
8. 运行目标项目的格式化、lint、typecheck、测试和 build。
9. 全部成功后才更新 applied fingerprint。

结构化 diff 至少包括：

- 新增、删除和重命名资源。
- 新增、删除和修改 operation。
- request/response schema 变化。
- 字段 required、nullable、enum 和类型变化。
- API path 和 operationId 变化。
- 菜单与 presentation 变化。
- 本地文件冲突。

### CI Drift Check

`sync --check` 应在以下情况返回非零状态：

- OpenAPI fingerprint 已变化。
- 新 AdminPlan 与当前 snapshot 不一致。
- 存在未处理生成文件冲突。
- 生成结果无法通过目标项目的质量检查。

## Manifest v2

建议 manifest 增加生成器、模板和同步状态：

```json
{
  "version": 2,
  "generatorVersion": "x.y.z",
  "templateVersion": 2,
  "appliedSpecFingerprint": "...",
  "pendingSpecFingerprint": null,
  "adminPlanSnapshot": {},
  "files": {
    "src/generated/admin/resources/users.ts": {
      "ownership": "generated",
      "baseHash": "...",
      "generatedHash": "..."
    }
  }
}
```

文件所有权至少分为：

- `generated`：每次同步可重新生成，用户不应编辑。
- `seed-once`：首次生成时创建，之后由用户拥有。
- `user`：不进入 manifest，生成器永远不修改。

发生冲突时不应把新的 spec 记为成功应用状态。

## Generated and User-Owned Boundaries

建议生成项目使用以下目录边界：

```text
src/generated/admin/       generated AdminPlan and resource descriptors
src/lib/api/generated/     generated API client and query hooks
src/components/admin/      shared Admin Runtime components
src/admin/                 user-owned configuration and extensions
src/app/ or src/routes/    thin generated framework adapters and user routes
```

用户扩展文件示例：

```text
src/admin/config.ts
src/admin/fields.tsx
src/admin/cells.tsx
src/admin/actions.tsx
src/admin/dashboard.tsx
src/admin/pages/
```

建议提供稳定配置入口：

```ts
export const adminConfig = defineAdminConfig({
  resources: {
    users: {
      columns: {
        avatar: { cell: "userAvatar" },
      },
      actions: ["approveUser"],
    },
  },
})
```

`userAvatar` 和 `approveUser` 由用户拥有的 registry 注册。同步只更新资源描述和 operation adapter，不更新这些组件。

## Component Boundaries

| Capability | Shared Runtime Component | Generated Input |
| --- | --- | --- |
| Page/dialog/sheet | `AdminActionSurface` | Presentation mode |
| Resource list | `ResourceList`, `DataGrid` | Columns and query adapter |
| Create/edit form | `ResourceForm` | Zod schema and field descriptors |
| Detail view | `ResourceDetails` | Detail field descriptors |
| Delete | `ConfirmAction` | Delete mutation adapter |
| Navigation | `AdminNavigation` | Groups, routes, icon keys |
| Search and filters | `FilterBar` | Query parameter mapping |
| Bulk operations | `BulkActionBar` | Operation adapter |
| Custom operations | `ResourceAction` | Operation ID and input schema |
| Permissions | `PermissionGate` | Permission key |
| Query state | `QueryState` | Query or mutation state |
| Upload | `UploadField` | Multipart operation |
| Relationships | `RelationSelect` | Target resource and list query |

通用组件只负责展示容器、状态和生命周期。审批、退款、发布等业务规则必须由配置或用户组件提供。

## Missing Admin Capabilities

### P0: Foundation

- Per-resource and per-operation presentation modes.
- Grouped navigation with order, icon, label, and visibility.
- List response and total-count mappings.
- Normalized API errors and notifications.
- Menu, action, and field permission descriptors.
- Generated/user-owned file separation.
- Safe sync planning and CI drift checks.
- Field, cell, action, and page registries.

### P1: Common Operations

- Column visibility, width, order, and pinning.
- URL-persisted pagination, filtering, and sorting.
- Row selection and bulk actions.
- Import, export, and download.
- Relationship selectors.
- File and image uploads.
- Nested object and array forms.
- Custom workflow actions.
- Breadcrumbs and active navigation state.
- Current-user UI and account actions.
- Dashboard widgets.
- Internationalization and branding.

### P2: Production Enhancements

- Audit log.
- Multi-tenancy.
- Row-level permission presentation.
- Saved views and filters.
- Realtime data and notification center.
- Feature flags.
- Error monitoring and performance instrumentation.
- End-to-end generation and upgrade tests for both frameworks.

## Implementation Plan

### Phase 1: Admin IR and Sync Foundation

- Version `AdminAppPlan` and add navigation, presentation, data mapping, permissions, and actions.
- Parse top-level OpenAPI tags and their `x-fizzyx-admin` metadata.
- Separate resource identity from navigation grouping.
- Add stable resource keys and diagnostics.
- Design and migrate to manifest v2.
- Add structured AdminPlan diff.
- Add `sync --plan`, `sync --apply`, and `sync --check`.
- Preserve existing CLI and `create_mode` compatibility.

### Phase 2: Runtime Components

- Introduce `AdminActionSurface`.
- Refactor forms into reusable `ResourceForm`.
- Refactor lists into `ResourceList` and `DataGrid` adapters.
- Introduce `AdminNavigation`.
- Add field, cell, operation, and icon registries.
- Add `sheet` support.
- Convert generated routes to thin adapters.

### Phase 3: Real API Adaptation

- Add list rows path and total path mappings.
- Add request and response transforms.
- Normalize API errors.
- Configure cache invalidation after mutations.
- Add multipart uploads.
- Add relationship fields and complex forms.

### Phase 4: Production Admin Features

- Add permission-aware navigation and actions.
- Add bulk actions.
- Add import/export.
- Add audit integration points.
- Add dashboard widgets and user-owned dashboards.
- Add internationalization.
- Add end-to-end sync and generator-upgrade coverage.

## Smallest Safe First Change

第一条实施主线应只升级中间模型，不立即重写所有模板：

1. 给 `AdminAppPlan` 增加版本、navigation 和 presentation。
2. 把现有 `create_mode` 映射到新的 presentation defaults。
3. 保持现有 page/dialog 输出和测试不变。
4. 让 `AdminShell` 从 navigation plan 读取菜单。
5. 再增加资源级覆盖和 `sheet`。
6. 最后引入新的 sync 命令和 manifest v2。

这样可以保留现有 CLI、OpenAPI 输入、两个框架和已有生成项目，同时逐步把模板逻辑迁移到稳定的声明式运行时架构。

## Risks

- OpenAPI tags 在不同项目中可能表示资源、领域或权限，必须提供明确约定和诊断。
- operationId 或 tag 重命名可能被误判为删除后新增，需要稳定 key 或显式 rename mapping。
- Next.js 和 TanStack Start 的 route-backed modal 行为不同，不应泄漏到共享资源组件。
- 生成器升级可能改变格式化结果，manifest 必须区分语义变化和机械变化。
- 冲突时部分应用会让项目进入不一致状态，sync apply 应尽量原子化。
- 前端隐藏菜单和按钮不能代替后端权限检查。
- 自动推断不可靠时必须要求显式配置，不能静默生成错误行为。

## Verification Strategy

- 保留现有 Admin plan、render、CLI、service 和 manifest 测试。
- 为 AdminPlan v1 到 v2 增加兼容测试。
- 为 tags、menu ordering 和 presentation precedence 增加 planner 测试。
- 为 page、dialog、sheet 增加两套框架的 golden render 测试。
- 为 manifest migration、sync plan、conflict 和 atomic apply 增加集成测试。
- 为数组和常见 envelope 响应增加数据映射测试。
- 为生成项目增加登录、CRUD、权限展示和同步后的端到端测试。

